"""Stage 6: emit data/catalog.json.

Two tiers of confidence, kept strictly apart:

* **Index pieces** come from the hand-transcribed index and are verified against
  the printed folios (46 entries, zero mismatches). These are published.
* **Movement boundaries** within a Mass come from OCR'd chant text and are not
  in the index at all -- NOH5 lists Missa I at printed page 5 and Missa II at 11,
  and never says where the Kyrie ends and the Gloria begins. Only confident
  detections are attached; the rest go to review-queue.json.

A movement that is merely probable is never silently promoted into a published
piece: an organist opening "Gloria" and finding the Sanctus is worse than an
organist opening "Missa I" and scrolling.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import pymupdf

from pipeline.evaluate import analyse_page
from pipeline.gregobase import DUMP, load_chants
from pipeline.index import IndexEntry, load_index, resolve_ranges, stated_end
from pipeline.indexextract import MONTH_NAMES
from pipeline.movements import MovementHit, best_match
from pipeline.offset import PageMap, load_page_map
from pipeline.pairing import pair_entry
from pipeline.publish import asset_stem, load_manifest, trimmed_boxes
from pipeline.systemtext import PX_TO_PT, condense, system_texts
from pipeline.volumes import DATA, load_volumes

SCHEMA_VERSION = 2
LEFT_MARGIN_FRAC = 0.18


@dataclass(frozen=True)
class SystemRef:
    ref: str
    pdf_page: int
    index: int
    aspect: tuple[int, int]
    # Published key without its variant suffix. Empty when the page has not been
    # sliced yet, in which case the site falls back to a local path.
    asset: str


def _left_margin_text(page: pymupdf.Page, box) -> str:
    rect = pymupdf.Rect(
        box.left * PX_TO_PT, box.top * PX_TO_PT,
        (box.left + LEFT_MARGIN_FRAC * (box.right - box.left)) * PX_TO_PT,
        box.bottom * PX_TO_PT,
    )
    return " ".join(page.get_text("text", clip=rect).split())


def scan_page(vol_id: str, pdf_page: int, page: pymupdf.Page
              ) -> tuple[list[SystemRef], list[tuple[int, MovementHit]], list[str]]:
    """Systems, movement hits and per-system text for one page."""
    analysis = analyse_page(vol_id, pdf_page)
    texts = system_texts(vol_id, pdf_page)
    # Aspect must describe the PUBLISHED slice, not the pre-trim box, or every
    # system is letterboxed in a slot wider than its own picture.
    # Prefer the manifest written by slicing: it carries the exact dimensions and
    # the content hash of what was actually published, so a catalog built from it
    # cannot describe an image that does not exist at that URL.
    manifest = load_manifest(vol_id, pdf_page)
    published = None if manifest else trimmed_boxes(vol_id, pdf_page)
    refs: list[SystemRef] = []
    hits: list[tuple[int, MovementHit]] = []
    for i, box in enumerate(analysis.boxes):
        if manifest and i < len(manifest):
            entry = manifest[i]
            width, height = int(entry["width"]), int(entry["height"])
            asset = asset_stem(vol_id, pdf_page, i, str(entry["sha256"]))
        else:
            left, top, right, bottom = (published[i] if published and i < len(published)
                                        else (box.left, box.top, box.right, box.bottom))
            width, height = right - left, bottom - top
            asset = ""
        refs.append(SystemRef(
            ref=f"{vol_id}/{pdf_page:04d}/{i:03d}", pdf_page=pdf_page, index=i,
            aspect=(width, height), asset=asset,
        ))
        hit = best_match(texts[i] if i < len(texts) else "", _left_margin_text(page, box))
        if hit is not None:
            hits.append((i, hit))
    return refs, hits, texts


# Index statuses that place a piece with evidence: a heading confirmed the page
# ("verified", "found"), or its own number agreed with the page order
# ("consistent"). Anything else is published but marked for review.
CONFIDENT_INDEX = frozenset({"verified", "found", "consistent"})


PageScan = tuple[list[SystemRef], list[tuple[int, MovementHit]], list[str]]


def scan_pdf(page_map: PageMap, printed: int, scan: Callable[[int], PageScan]) -> list[SystemRef]:
    """Systems on a printed page, through the caller's page cache."""
    pdf_page = page_map.to_pdf(printed)
    return list(scan(pdf_page)[0]) if pdf_page is not None else []


def entry_text(entry: IndexEntry) -> str:
    """What a piece's heading should say: its label, title and incipit, and for
    a dated feast the date (the Proper of Saints heads every feast with it)."""
    dates = [f"{int(k[10:12])} {MONTH_NAMES[int(k[7:9])].capitalize()}" for k in entry.days
             if k.startswith("sancti:") and k[7:9].isdigit() and k[10:12].isdigit()]
    return " ".join([entry.label if entry.label != entry.title else "", entry.title,
                     entry.incipit or "", *dates[:1]]).strip()


def start_system(vol_id: str, page_map: PageMap, entry: IndexEntry, systems: int) -> int:
    """First system of the entry on its first page (see pipeline.pagesplit)."""
    pdf_page = page_map.to_pdf(entry.page)
    if pdf_page is None or systems == 0:
        return 0
    from pipeline.pagesplit import GapReader, first_system

    analysis = analyse_page(vol_id, pdf_page)
    reader = GapReader(vol_id, pdf_page, entry.page,
                       [(b.top, b.bottom) for b in analysis.boxes], analysis.page_height)
    return first_system(reader, entry_text(entry))


def build_catalog(vol_id: str, index_path: Path | None = None
                  ) -> tuple[dict[str, object], list[dict[str, object]]]:
    vol = load_volumes()[vol_id]
    page_map = load_page_map(vol_id)
    # Chant pairing is optional: the site is usable without it, and the vendored
    # GregoBase dump is not tracked in git.
    chants = load_chants() if DUMP.exists() else []
    pieces: list[dict[str, object]] = []
    review: list[dict[str, object]] = []

    entries = load_index(vol_id, index_path)
    with pymupdf.open(vol.path) as doc:
        scanned: dict[int, PageScan] = {}

        def scan(pdf_page: int) -> PageScan:
            if pdf_page not in scanned:
                scanned[pdf_page] = scan_page(vol_id, pdf_page, doc[pdf_page - 1])
            return scanned[pdf_page]

        # Where each piece begins: (printed page, first system on it). Pieces
        # own every system from their start up to the next piece's start.
        starts = [(e.page, start_system(vol_id, page_map, e, len(scan_pdf(page_map, e.page, scan))))
                  for e in entries]
        # The last body page of the volume, so the final entry is bounded by the
        # book rather than by itself.
        last_body_printed = page_map.last_printed
        for i, (entry, first, last) in enumerate(resolve_ranges(entries, last_body_printed)):
            start = starts[i]
            stop = starts[i + 1] if i + 1 < len(starts) else (last_body_printed + 1, 0)
            if stop[1] > 0:
                last = max(last, stop[0])        # the next piece begins mid-page
            declared = stated_end(entry)
            if declared is not None and last > declared:
                review.append({
                    "piece": entry.slug, "kind": "range_extended",
                    "stated": [entry.page, declared], "resolved": [first, last],
                    "why": "pages after the index's stated end were unclaimed",
                })
            if start[1] > 0:
                review.append({"piece": entry.slug, "kind": "starts_mid_page",
                               "printed_page": start[0], "first_system": start[1]})
            refs: list[SystemRef] = []
            movements: list[dict[str, object]] = []
            for printed in range(first, last + 1):
                pdf_page = page_map.to_pdf(printed)
                if pdf_page is None:
                    # A printed page this scan does not contain (NOH1 lacks
                    # 348-349), or one outside the body.
                    review.append({"piece": entry.slug, "kind": "page_out_of_range",
                                   "printed_page": printed, "pdf_page": None})
                    continue
                page_refs, hits, texts = scan(pdf_page)
                mine = {r.index for r in page_refs if start <= (printed, r.index) < stop}
                refs.extend(r for r in page_refs if r.index in mine)
                for system_index, hit in hits:
                    if system_index not in mine:
                        continue
                    record = {
                        "movement": hit.movement, "score": hit.score,
                        "pdf_page": pdf_page, "system": system_index,
                        "ref": f"{vol_id}/{pdf_page:04d}/{system_index:03d}",
                        "mode_marker": hit.mode_marker,
                        "text": condense(texts[system_index])[:60],
                    }
                    if hit.confident:
                        movements.append(record)
                    else:
                        review.append({"piece": entry.slug, "kind": "uncertain_movement",
                                       **record})
            if refs:
                # Printed pages that actually carry this piece's music.
                on = sorted({page_map.to_printed(int(r.ref.split("/")[1])) or first for r in refs})
                first, last = on[0], on[-1]
            if not refs:
                review.append({"piece": entry.slug, "kind": "no_systems",
                               "printed_pages": [first, last]})
            if entry.status not in CONFIDENT_INDEX:
                review.append({"piece": entry.slug, "kind": "index_unverified",
                               "status": entry.status, "printed_page": entry.page,
                               "why": "no heading on the page confirmed the index's page number"})
            pairings = pair_entry(entry, chants) if chants else []
            for pairing in pairings:
                if pairing.status != "verified":
                    review.append({"piece": entry.slug, "kind": "unverified_pairing",
                                   "movement": pairing.movement,
                                   "chant_id": pairing.chant_id,
                                   "chant_incipit": pairing.chant_incipit,
                                   "score": pairing.score})
            if chants and not pairings:
                review.append({"piece": entry.slug, "kind": "unpaired",
                               "genre": entry.genre, "title": entry.title})
            pieces.append({
                "id": f"{vol_id}-{entry.slug}",
                "volume": vol_id,
                "slug": entry.slug,
                "section": entry.section,
                "division": entry.division,
                "days": list(entry.days),
                "label": entry.label,
                "title": entry.title,
                "incipit": entry.incipit,
                "genre": entry.genre,
                "mode": None,
                "mass": entry.label if entry.genre == "mass_ordinary" else None,
                "printed_pages": [first, last],
                "pdf_pages": _pdf_span(page_map, first, last),
                "systems": [r.ref for r in refs],
                "system_assets": [r.asset for r in refs],
                "system_aspect": [list(r.aspect) for r in refs],
                "movements": movements,
                "chant": [
                    {"source": "gregobase", "id": p.chant_id, "movement": p.movement,
                     "incipit": p.chant_incipit, "mode": p.mode,
                     "score": p.score, "status": p.status}
                    for p in pairings
                ],
                "review_status": "verified" if refs and entry.status in CONFIDENT_INDEX
                else "review",
            })

    catalog: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "volumes": {vol_id: {"title": vol.title, "part": vol.part,
                             "page_map": [asdict(seg) for seg in page_map.segments]}},
        "chant_source": {
            "name": "GregoBase", "url": "https://gregobase.selapa.net",
            "licence": "CC BY-SA 4.0",
            "note": "Attribution must appear on every page rendering a chant; "
                    "share-alike attaches to chant fields and renderings, not to "
                    "the public-domain NOH scans. See data/LICENSES.md.",
        } if chants else None,
        "pieces": pieces,
    }
    return catalog, review


def _pdf_span(page_map: PageMap, first: int, last: int) -> list[int]:
    mapped = [p for p in (page_map.to_pdf(n) for n in range(first, last + 1)) if p is not None]
    return [min(mapped), max(mapped)] if mapped else [0, 0]


Catalog = dict[str, object]
Record = dict[str, object]


def merge_catalog(existing: Catalog | None, update: Catalog) -> Catalog:
    """Replace one volume's pieces in the site catalog, keeping every other volume.

    Slugs are URLs (/piece/<slug>/), so a slug may appear once across ALL volumes."""
    new_volumes: dict[str, object] = dict(update["volumes"])  # one volume
    new_pieces: list[Record] = list(update["pieces"])
    if existing is None or existing.get("schema_version") != SCHEMA_VERSION:
        existing = {"schema_version": SCHEMA_VERSION, "volumes": {}, "pieces": []}
    volumes: dict[str, object] = {**dict(existing["volumes"]), **new_volumes}
    old_pieces: list[Record] = list(existing["pieces"])
    pieces = [p for p in old_pieces if p["volume"] not in new_volumes] + new_pieces
    order = {v: i for i, v in enumerate(sorted(volumes))}
    pieces.sort(key=lambda p: order[str(p["volume"])])   # stable: page order within a volume
    slugs = [str(p["slug"]) for p in pieces]
    duplicates = sorted({s for s in slugs if slugs.count(s) > 1})
    if duplicates:
        raise ValueError(f"slugs repeat across volumes: {duplicates}")
    return {**existing, "schema_version": SCHEMA_VERSION, "volumes": volumes,
            "chant_source": update.get("chant_source") or existing.get("chant_source"),
            "pieces": pieces}


def write_catalog(vol_id: str, data_dir: Path = DATA,
                  index_path: Path | None = None) -> tuple[Path, Path]:
    catalog, review = build_catalog(vol_id, index_path)
    cat_path = data_dir / "catalog.json"
    rev_path = data_dir / "review-queue.json"
    existing = json.loads(cat_path.read_text(encoding="utf-8")) if cat_path.exists() else None
    merged = merge_catalog(existing, catalog)
    queue = json.loads(rev_path.read_text(encoding="utf-8")) if rev_path.exists() else []
    queue = [r for r in queue if r.get("volume", "noh5") != vol_id]
    queue += [{"volume": vol_id, **r} for r in review]
    cat_path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    rev_path.write_text(json.dumps(queue, indent=2) + "\n", encoding="utf-8")
    return cat_path, rev_path


__all__ = ["SCHEMA_VERSION", "SystemRef", "asdict", "build_catalog", "write_catalog"]
