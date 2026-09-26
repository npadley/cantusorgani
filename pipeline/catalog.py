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
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import pymupdf
import yaml

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
            # Run to where the next piece begins: into its page when it begins
            # mid-page, and past our own first page when our heading sat below
            # its last system.
            last = max(last, first, stop[0] if stop[1] > 0 else stop[0] - 1)
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
                "reference": entry.reference,
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

    for gap_first, gap_last in page_map.gaps:
        review.append({"piece": None, "kind": "unmapped_pages", "pdf_pages": [gap_first, gap_last],
                       "why": "pages between page-map segments (an insert, or a page scanned "
                              "twice) carry no printed page and are not catalogued"})
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


PART_TO_VOLUME = {"I": "noh1", "II": "noh2", "III": "noh3", "IV": "noh4", "V": "noh5"}
REFERENCE = re.compile(r"Pars\s+(?P<part>[IVX]+|1V|l[VI]+)\s*[,.]?\s*p\.\s*(?P<page>\d{1,3})")


SAME_VOLUME = re.compile(r"\bp\.?\s*(?P<page>\d{1,3})\b")


def parse_reference(text: str, volume: str | None = None) -> tuple[str, int] | None:
    """("noh4", 76) from "Missa. Os justi, Pars IV, p. 76." -- OCR reads IV as 1V.
    A page with no part ("Missa. Justus ut palma, p. 82") is in `volume`."""
    m = REFERENCE.search(text)
    if not m:
        bare = SAME_VOLUME.search(text) if volume and "Pars" not in text else None
        return (volume, int(bare.group("page"))) if volume and bare else None
    part = m.group("part").replace("1", "I").replace("l", "I")
    volume = PART_TO_VOLUME.get(part)
    return (volume, int(m.group("page"))) if volume else None


def link_rubrics(catalog: Catalog, rubrics: list[Record]) -> list[Record]:
    """Give each rubric feast's days to the piece its Mass is taken from.

    NOH3 prints 185 feasts as a single line, "Missa. Os justi, de Communi,
    Pars IV, p. 76": their music is the Common Mass on that page. Linked days
    are kept apart in `linked_days` and recomputed from scratch, so a rebuilt
    volume never keeps a stale link. Returns the rubrics that could not be
    resolved, for the review queue."""
    pieces: list[Record] = list(catalog["pieces"])
    for piece in pieces:
        own = [d for d in piece.get("days", []) if d not in piece.get("linked_days", [])]
        piece["days"], piece["linked_days"] = own, []
    unresolved: list[Record] = []
    for rubric in rubrics:
        ref = parse_reference(str(rubric.get("reference", "")), str(rubric.get("volume") or "") or None)
        days = [str(d) for d in rubric.get("days", [])]
        if not days:
            continue
        target = None
        if ref:
            volume, page = ref
            candidates = [p for p in pieces if p["volume"] == volume
                          and p["printed_pages"][0] <= page <= p["printed_pages"][1]]
            target = next((p for p in candidates if p["printed_pages"][0] == page),
                          candidates[0] if candidates else None)
        if target is None:
            unresolved.append({"kind": "rubric_unlinked", "title": rubric.get("title"),
                               "reference": rubric.get("reference"), "days": days})
            continue
        for day in days:
            if day not in target["days"]:
                target["days"] = [*target["days"], day]
                target["linked_days"] = [*target["linked_days"], day]
    return unresolved


def load_rubrics(data_dir: Path = DATA) -> list[Record]:
    rubrics: list[Record] = []
    for path in sorted(data_dir.glob("index-noh*.yml")):
        if path.name.endswith(".proposed.yml"):
            continue
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        rubrics += [{"volume": doc.get("volume"), **r} for r in doc.get("rubrics", []) or []]
        # A piece whose parts are cited from elsewhere links its days there too:
        # the Annunciation in NOH3 prints only "Introitus. Vultum tuum, Pars IV,
        # p. 175" and the rest of its Mass by reference.
        rubrics += [{"volume": doc.get("volume"), "title": e.get("title"), "page": e.get("page"),
                     "reference": e["reference"], "days": e.get("days", [])}
                    for section in doc.get("sections", []) or [] for e in section["entries"]
                    if e.get("reference")]
    return rubrics


def write_catalog(vol_id: str, data_dir: Path = DATA,
                  index_path: Path | None = None) -> tuple[Path, Path]:
    catalog, review = build_catalog(vol_id, index_path)
    cat_path = data_dir / "catalog.json"
    rev_path = data_dir / "review-queue.json"
    existing = json.loads(cat_path.read_text(encoding="utf-8")) if cat_path.exists() else None
    merged = merge_catalog(existing, catalog)
    unlinked = link_rubrics(merged, load_rubrics(data_dir))
    queue = json.loads(rev_path.read_text(encoding="utf-8")) if rev_path.exists() else []
    queue = [r for r in queue if r.get("volume", "noh5") != vol_id and r["kind"] != "rubric_unlinked"]
    queue += [{"volume": vol_id, **r} for r in review]
    queue += [{"volume": "links", **r} for r in unlinked]
    cat_path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    rev_path.write_text(json.dumps(queue, indent=2) + "\n", encoding="utf-8")
    return cat_path, rev_path


__all__ = ["SCHEMA_VERSION", "SystemRef", "asdict", "build_catalog", "write_catalog"]
