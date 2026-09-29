"""Stage 6: emit data/catalog.base.json, then data/catalog.json with the hand
corrections of data/corrections.yml applied (pipeline.corrections).

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
from pipeline.movements import (
    MovementHit,
    SystemFeature,
    best_match,
    expected_movements,
    kyrie_offset,
    mode_marker,
    segment_mass,
)
from pipeline.offset import PageMap, load_page_map, segment_record
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
    text: str = ""                       # the system's chant words, as OCR read them
    mode_marker: str | None = None       # a mode number printed to its left


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
        margin = _left_margin_text(page, box)
        text = texts[i] if i < len(texts) else ""
        refs.append(SystemRef(
            ref=f"{vol_id}/{pdf_page:04d}/{i:03d}", pdf_page=pdf_page, index=i,
            aspect=(width, height), asset=asset, text=text, mode_marker=mode_marker(margin),
        ))
        hit = best_match(text, margin)
        if hit is not None:
            hits.append((i, hit))
    return refs, hits, texts


# Index statuses that place a piece with evidence: a heading confirmed the page
# ("verified", "found"), or its own number agreed with the page order
# ("consistent"). Anything else is published but marked for review.
CONFIDENT_INDEX = frozenset({"verified", "found", "consistent"})
# Divisions whose pieces are Masses divided into movements.
MOVEMENT_DIVISIONS = frozenset({"kyriale", "defunctorum"})


PageScan = tuple[list[SystemRef], list[tuple[int, MovementHit]], list[str]]


def scan_pdf(page_map: PageMap, printed: int, scan: Callable[[int], PageScan],
             pagination: str | None = None) -> list[SystemRef]:
    """Systems on a printed page, through the caller's page cache."""
    pdf_page = page_map.to_pdf(printed, pagination)
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
    pdf_page = page_map.to_pdf(entry.page, entry.pagination)
    if pdf_page is None or systems == 0:
        return 0
    from pipeline.pagesplit import GapReader, first_system

    analysis = analyse_page(vol_id, pdf_page)
    reader = GapReader(vol_id, pdf_page, entry.page,
                       [(b.top, b.bottom) for b in analysis.boxes], analysis.page_height)
    return first_system(reader, entry_text(entry))


def ordinary_movements(label: str, refs: list[SystemRef]
                       ) -> tuple[list[Record], list[Record]]:
    """Movement starts of a Kyriale Mass, and review entries for weak ones.

    Every movement the Mass contains is placed -- the order guarantees it is
    there -- but one whose opening words matched poorly is marked `placed:
    "order"` and queued for a person to check."""
    features = [SystemFeature(r.ref, r.text, r.mode_marker) for r in refs]
    movements: list[Record] = []
    uncertain: list[Record] = []
    for b in segment_mass(features, expected_movements(label)):
        ref = refs[b.index]
        record: Record = {
            "movement": b.movement, "score": b.score, "pdf_page": ref.pdf_page,
            "system": ref.index, "ref": b.ref, "mode_marker": b.mode_marker,
            "placed": "match" if b.confident else "order",
        }
        movements.append(record)
        if not b.confident:
            uncertain.append({"kind": "uncertain_movement", **record,
                              "why": "placed by the Mass's order; its opening words matched weakly"})
    return movements, uncertain


def load_hymns(vol_id: str, index_path: Path | None = None) -> list[Record]:
    """Hymns an index lists by name (NOH8's "Hymni"), with their printed pages."""
    path = index_path if index_path is not None else DATA / f"index-{vol_id}.yml"
    if not path.exists():
        return []
    doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return [h for h in doc.get("hymns", []) or [] if h.get("page")]


def hymn_system(title: str, texts: list[str], systems: int) -> int:
    """The first system on a page whose words open with the hymn's title, or 0."""
    from pipeline.movements import movement_score_for

    opening = condense(re.sub(r"\(.*?\)|,.*$", "", title))[:24]
    if len(opening) < 8:
        return 0
    for i, text in enumerate(texts[:systems]):
        if movement_score_for((opening,), text) >= HYMN_MATCH:
            return i
    return 0


HYMN_MATCH = 0.6


def attach_hymns(vol_id: str, page_map: PageMap, pieces: list[Record], review: list[Record],
                 hymns: list[Record]) -> None:
    """Give each hymn to the office that prints it, at the system it begins.

    A hymn is found at its page's heading gap where the page names it; failing
    that, at the page's first system -- still the right office, and the reader
    lands on the page the index gives."""
    by_ref: dict[str, Record] = {}
    for piece in pieces:
        piece["hymns"] = []
        for ref in list(piece["systems"]):  # a list of refs
            by_ref[str(ref)] = piece
    for hymn in hymns:
        title, printed = str(hymn["title"]), int(hymn["page"])
        pdf_page = page_map.to_pdf(printed)
        prefix = f"{vol_id}/{pdf_page:04d}/" if pdf_page else None
        on_page = sorted(r for r in by_ref if prefix and r.startswith(prefix))
        if not on_page:
            review.append({"piece": None, "kind": "hymn_unplaced", "title": title, "printed_page": printed})
            continue
        from pipeline.pagesplit import GapReader, first_system

        analysis = analyse_page(vol_id, pdf_page)
        reader = GapReader(vol_id, pdf_page, printed, [(b.top, b.bottom) for b in analysis.boxes],
                           analysis.page_height)
        index = min(first_system(reader, title), len(on_page) - 1)
        if index == 0:
            # No heading names it: a hymn's title is its first sung words, so
            # find the system whose chant text opens with them.
            index = hymn_system(title, system_texts(vol_id, pdf_page), len(on_page))
        ref = on_page[index]
        owner = by_ref[ref]
        hymns_list = owner["hymns"]
        assert isinstance(hymns_list, list)
        hymns_list.append({"title": title, "ref": ref, "printed_page": printed})
        if index == 0 and hymn_system(title, system_texts(vol_id, pdf_page), len(on_page)) == 0 \
                and hymn.get("status") not in ("verified", "found"):
            review.append({"piece": owner["slug"], "kind": "hymn_at_page_top", "title": title,
                           "printed_page": printed,
                           "why": "no heading placed the hymn on its page; linked to the page's first system"})


# Divisions whose pieces are Propers, divided into Introit, Gradual ... Communion.
PART_DIVISIONS = frozenset({"temporale", "sanctorale", "commune", "varia"})
# The Requiem Mass is a Proper too (Introit to Communion), printed among the
# Masses for the Dead with its Ordinary.
PART_GENRES = frozenset({"requiem"})


def has_parts(entry: IndexEntry) -> bool:
    """Whether a piece is a Proper divided into parts."""
    return entry.division in PART_DIVISIONS or entry.genre in PART_GENRES


class PartsUnavailable(RuntimeError):
    """The chant data Proper parts are found by is missing or fails its hash."""


@dataclass
class PartsContext:
    proprium: dict[str, dict[str, object]]
    chants: dict[int, tuple[str | None, str]]     # GregoBase id -> (office part, sung text)
    margins: object                                # pipeline.margins.MarginReader


def parts_context() -> PartsContext:
    """Everything segmentation needs, or PartsUnavailable naming the fix. It
    never falls back to placing parts by order alone: a catalogue with wrong
    jump links is worse than one with the previous ones."""
    from pipeline.jgabc import JgabcIntegrityError, load_proprium
    from pipeline.margins import MarginReader
    from pipeline.parts import chant_text
    if not DUMP.exists():
        raise PartsUnavailable(
            f"parts need {DUMP.relative_to(DUMP.parent.parent)} (not in git). Fix: uv run noh "
            f"gregobase-fetch. To rebuild without re-dividing Propers, pass --no-parts.")
    try:
        proprium = load_proprium()
    except JgabcIntegrityError as exc:
        raise PartsUnavailable(f"{exc} To rebuild without re-dividing Propers, pass --no-parts.") from exc
    chants = {c.id: (c.office_part, chant_text(c.gabc)) for c in load_chants(include_copyrighted=True)}
    return PartsContext(proprium, chants, MarginReader())


def jgabc_url(slug: str, days: list[str]) -> str | None:
    """jgabc's page for this Proper in chant, when jgabc has it. Needs only the
    vendored menus, not the GregoBase dump; None when they are missing."""
    from pipeline.jgabc import JgabcIntegrityError, jgabc_key_for_piece, load_menus, proper_url
    key = jgabc_key_for_piece({"slug": slug, "days": days, "linked_days": []})
    if key is None:
        return None
    try:
        return proper_url(key, load_menus())
    except JgabcIntegrityError:
        return None


def proper_parts(vol_id: str, slug: str, days: list[str], reference: str | None,
                 refs: list[SystemRef], ctx: PartsContext, zone: str = "",
                 hand: dict[str, int] | None = None
                 ) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """A Proper's parts and the review entries for any placed by order, missing,
    or not found at all. Parts printed by reference are recorded as borrowed and
    resolved later by link_parts, once every volume is merged."""
    from pipeline.jgabc import jgabc_key_for_piece
    from pipeline.parts import (
        ORDER,
        PartSystem,
        borrowed_parts,
        expected_parts,
        label_of,
        margin_mode,
        segment_proper,
    )

    key = jgabc_key_for_piece({"slug": slug, "days": days, "linked_days": []})
    expected = expected_parts(key, ctx.proprium, ctx.chants) if key else []
    if not expected:
        return [], [{"piece": slug, "kind": "part_unsupported",
                     "why": f"no jgabc Proper for {key or 'its day'}; parts are not divided"}]
    from pipeline.partrefs import reference_parts
    borrowed = borrowed_parts(reference or "", vol_id)
    # And the reference lines on the page itself, which the index often lacks.
    for part, volume, page in reference_parts(zone, vol_id):
        if not any(b[0] == part for b in borrowed):
            borrowed.append((part, volume, page))
    lent = {part for part, _, _ in borrowed}
    printed = [e for e in expected
               if (f"{e.part}/{e.variant}" if e.variant == "paschal" else e.part) not in lent]
    features = []
    for r in refs:
        margin = ctx.margins.text(r.ref, r.asset)                    # type: ignore[attr-defined]
        # The margin's own OCR first: the text layer's marker reads a stray "f"
        # of the brace as "I" (pipeline.movements.mode_marker). Only where the
        # OCR read nothing at all -- a lone "I." is too small for it -- does the
        # text layer's marker count.
        mode = margin_mode(margin) if margin.strip() else r.mode_marker
        features.append(PartSystem(r.ref, r.text, label_of(margin), mode))
    try:
        seg = segment_proper(features, printed, hand)
    except ValueError as error:
        raise ValueError(f"{vol_id} {slug}: {error}") from error
    records: list[dict[str, object]] = [
        {"part": b.part, "variant": b.variant, "system": b.index, "ref": b.ref,
         "gregobase_id": b.gregobase_id, "placed": b.placed, "score": b.score}
        for b in seg.parts]
    ids = {e.part: e.gregobase_id for e in expected}
    for key, volume, page in borrowed:
        part, _, variant = key.partition("/")
        records.append({"part": part, "variant": variant, "gregobase_id": ids.get(part) if not variant else None,
                        "borrowed_volume": volume, "borrowed_page": page, "borrowed_from": None})

    def order(record: dict[str, object]) -> tuple[int, int]:
        name = f"{record['part']}/paschal" if record.get("variant") == "paschal" else str(record["part"])
        return (ORDER.index(name) if name in ORDER else len(ORDER), int(record.get("system", -1)))

    records.sort(key=order)
    review = [{"piece": slug, "kind": p.kind, "part": p.part, "variant": p.variant,
               "expected_incipit": p.expected_opening,
               "best_system": p.best_index,
               "ref": refs[p.best_index].ref if p.best_index is not None else None,
               "score": round(p.best_score, 3)} for p in seg.problems]
    return records, review


def build_catalog(vol_id: str, index_path: Path | None = None, parts: bool = True
                  ) -> tuple[dict[str, object], list[dict[str, object]]]:
    """`parts=False` leaves Proper parts undivided (the caller carries the
    previous ones over); otherwise the chant data must be present."""
    vol = load_volumes()[vol_id]
    page_map = load_page_map(vol_id)
    # Chant pairing is optional: the site is usable without it, and the vendored
    # GregoBase dump is not tracked in git.
    chants = load_chants() if DUMP.exists() else []
    pieces: list[dict[str, object]] = []
    review: list[dict[str, object]] = []

    entries = load_index(vol_id, index_path)
    known = {None} | {s.pagination for s in page_map.segments}
    for e in entries:
        if e.pagination not in known:
            raise ValueError(f"{vol_id} {e.slug}: pagination {e.pagination!r} has no page map; "
                             f"declare it under addenda in data/volumes.yml and re-derive "
                             f"(uv run noh offset --volume {vol_id} --segments)")
    ctx = parts_context() if parts and any(has_parts(e) for e in entries) else None
    with pymupdf.open(vol.path) as doc:
        scanned: dict[int, PageScan] = {}

        def scan(pdf_page: int) -> PageScan:
            if pdf_page not in scanned:
                scanned[pdf_page] = scan_page(vol_id, pdf_page, doc[pdf_page - 1])
                analysis = analyse_page(vol_id, pdf_page)
                if analysis.warning:
                    review.append({"piece": None, "kind": "segmentation_fallback",
                                   "pdf_page": pdf_page, "why": analysis.warning})
                if analysis.error:
                    # Music on this page is not catalogued at all: never silently.
                    review.append({"piece": None, "kind": "segmentation_failed",
                                   "pdf_page": pdf_page, "why": analysis.error})
            return scanned[pdf_page]

        lines_cache: dict[int, list[object]] = {}

        def zone_of(piece_refs: list[SystemRef]) -> str:
            """The text between a Proper's heading and the next one."""
            from pipeline.partrefs import page_lines, zone_text
            first_pdf, last_pdf = piece_refs[0].pdf_page, piece_refs[-1].pdf_page
            lines = []
            for pg in range(max(1, first_pdf - 1), min(len(doc), last_pdf + 1) + 1):
                if pg not in lines_cache:
                    lines_cache[pg] = page_lines(doc[pg - 1], pg)    # type: ignore[assignment]
                lines.extend(lines_cache[pg])
            boxes = analyse_page(vol_id, first_pdf).boxes
            top = boxes[piece_refs[0].index].top * PX_TO_PT if piece_refs[0].index < len(boxes) else 0.0
            return zone_text(lines, (first_pdf, top))                # type: ignore[arg-type]

        # Where each piece begins: (printed page, first system on it). Pieces
        # own every system from their start up to the next piece's start.
        starts = [(e.page, start_system(vol_id, page_map, e,
                                        len(scan_pdf(page_map, e.page, scan, e.pagination))))
                  for e in entries]
        # A Kyriale Mass begins at its Kyrie: systems above it on the first page
        # close the Mass before, whatever the page split made of the heading.
        for i, e in enumerate(entries):
            if e.genre == "mass_ordinary" and e.division == "kyriale":
                page, first_system = starts[i]
                on_page = [r for r in scan_pdf(page_map, page, scan) if r.index >= first_system]
                shift = kyrie_offset([SystemFeature(r.ref, r.text, r.mode_marker) for r in on_page])
                if shift:
                    starts[i] = (page, first_system + shift)
        # Each pagination (the body, and any addendum) is bounded on its own: an
        # entry runs to the next entry in its pagination, and the last one to the
        # end of its pages rather than stopping at itself.
        spans: dict[int, tuple[int, int, tuple[int, int]]] = {}
        groups: dict[str | None, list[int]] = {}
        for i, e in enumerate(entries):
            groups.setdefault(e.pagination, []).append(i)
        for pagination, members in groups.items():
            end = page_map.last_in(pagination)
            ranges = resolve_ranges([entries[i] for i in members], end)
            for j, (i, (_, first, last)) in enumerate(zip(members, ranges, strict=True)):
                spans[i] = (first, last, starts[members[j + 1]] if j + 1 < len(members) else (end + 1, 0))
        for i, entry in enumerate(entries):
            first, last, stop = spans[i]
            start = starts[i]
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
            ordinary = entry.genre == "mass_ordinary" and entry.division == "kyriale"
            for printed in range(first, last + 1):
                pdf_page = page_map.to_pdf(printed, entry.pagination)
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
                    # Only a Mass has movements: an Introit's "Gloria Patri" or a
                    # Vespers antiphon's "Kyrie" is not one.
                    if system_index not in mine or ordinary or entry.division not in MOVEMENT_DIVISIONS:
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
            if ordinary:
                # An Ordinary is segmented whole, in the order the Kyriale prints
                # it, rather than trusting each system's hit on its own.
                movements, uncertain = ordinary_movements(entry.label, refs)
                review.extend({"piece": entry.slug, **u} for u in uncertain)
            if refs:
                # Printed pages that actually carry this piece's music.
                on = sorted({page_map.to_printed(int(r.ref.split("/")[1])) or first for r in refs})
                first, last = on[0], on[-1]
            if not refs:
                review.append({"piece": entry.slug, "kind": "no_systems",
                               "printed_pages": [first, last]})
            proper: list[dict[str, object]] = []
            jgabc = jgabc_url(entry.slug, list(entry.days)) if has_parts(entry) else None
            if ctx is not None and refs and has_parts(entry):
                proper, part_review = proper_parts(vol_id, entry.slug, list(entry.days),
                                                   entry.reference, refs, ctx, zone_of(refs),
                                                   {k: n - 1 for k, n in entry.parts})
                review.extend(part_review)
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
                **({"pagination": entry.pagination} if entry.pagination else {}),
                "pdf_pages": _pdf_span(page_map, first, last, entry.pagination),
                "systems": [r.ref for r in refs],
                "system_assets": [r.asset for r in refs],
                "system_aspect": [list(r.aspect) for r in refs],
                "movements": movements,
                "parts": proper,
                "jgabc_url": jgabc,
                "chant": [
                    {"source": "gregobase", "id": p.chant_id, "movement": p.movement,
                     "incipit": p.chant_incipit, "mode": p.mode,
                     "score": p.score, "status": p.status}
                    for p in pairings
                ],
                "review_status": "verified" if refs and entry.status in CONFIDENT_INDEX
                else "review",
            })

        attach_hymns(vol_id, page_map, pieces, review, load_hymns(vol_id, index_path))

    for gap_first, gap_last in page_map.gaps:
        review.append({"piece": None, "kind": "unmapped_pages", "pdf_pages": [gap_first, gap_last],
                       "why": "pages between page-map segments (an insert, or a page scanned "
                              "twice) carry no printed page and are not catalogued"})
    catalog: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "volumes": {vol_id: {"title": vol.title, "part": vol.part,
                             "page_map": [segment_record(seg) for seg in page_map.segments],
                             **({"addenda": {a.id: a.title for a in vol.addenda}} if vol.addenda else {})}},
        "chant_source": {
            "name": "GregoBase", "url": "https://gregobase.selapa.net",
            "licence": "CC0",
            "note": "GregoBase releases its transcriptions under CC0; the site credits it "
                    "beside every rendered chant. Transcriptions it flags copyrighted are "
                    "never published. See data/LICENSES.md.",
        } if chants else None,
        "pieces": pieces,
    }
    return catalog, review


def _pdf_span(page_map: PageMap, first: int, last: int, pagination: str | None = None) -> list[int]:
    mapped = [p for p in (page_map.to_pdf(n, pagination) for n in range(first, last + 1)) if p is not None]
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
# OCR reads the I of "IV" as 1, l, | or i, drops the stop after "p", reads the
# comma as a semicolon and the "p" itself as "»" -- or drops it ("Pars I, 169").
REFERENCE = re.compile(r"Pars\s+(?P<part>[IVX]+|[1l|i][VvI]+)\s*[,.;]?\s*'?(?:(?:p|»)\s*\.?\s*)?(?P<page>\d{1,3})(?:[l|](?![\w]))?(?![\w])")
# "vide ad calcem Partis IV": at the end of Part IV, where the Common of Supreme
# Pontiffs was added after the feasts pro aliquibus locis ("ad co/cern Portis").
AT_CALCEM = re.compile(r"\bad\s+c\S{1,3}(?:em|ern)\b")
AT_END = -1                              # the page of "the end of the volume"


SAME_VOLUME = re.compile(r"\bp\.?\s*(?P<page>\d{1,3})(?:[l|](?![\w]))?(?![\w])")


def parse_reference(text: str, volume: str | None = None) -> tuple[str, int] | None:
    """("noh4", 76) from "Missa. Os justi, Pars IV, p. 76." -- OCR reads IV as 1V.
    A page with no part ("Missa. Justus ut palma, p. 82") is in `volume`."""
    m = REFERENCE.search(text)
    if not m and AT_CALCEM.search(text):
        return ("noh4", AT_END)
    if not m:
        bare = SAME_VOLUME.search(text) if volume and "Pars" not in text else None
        return (volume, int(bare.group("page"))) if volume and bare else None
    part = re.sub(r"[1l|i]", "I", m.group("part")).upper()
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
            # Only a piece with music: a heading whose own Mass is by reference
            # (SS Cosmas and Damian above St Michael on NOH3 p. 354) cannot be
            # the Mass another feast borrows. A page cited is the body's, never an
            # addendum's, whose pages are numbered again from 1.
            with_music = [p for p in pieces if p["volume"] == volume and p.get("systems")
                          and not p.get("pagination")]
            if page == AT_END and with_music:
                page = max(int(p["printed_pages"][0]) for p in with_music)
            candidates = [p for p in with_music
                          if p["printed_pages"][0] <= page <= p["printed_pages"][1]]
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
    # Days the 1962 rubrics give another day's Mass, with no line in NOH to say so.
    extra = data_dir / "rubrics-1962.yml"
    if extra.exists():
        rubrics += list(yaml.safe_load(extra.read_text(encoding="utf-8")).get("rubrics") or [])
    return rubrics


def write_catalog(vol_id: str, data_dir: Path = DATA,
                  index_path: Path | None = None, parts: bool = True) -> tuple[Path, Path]:
    catalog, review = build_catalog(vol_id, index_path, parts=parts)
    cat_path = data_dir / "catalog.json"
    base_path = data_dir / "catalog.base.json"
    rev_path = data_dir / "review-queue.json"
    # Merge into the generated base, never into catalog.json: that has the hand
    # corrections applied, which must not be baked into other volumes' records.
    source = base_path if base_path.exists() else cat_path
    existing = json.loads(source.read_text(encoding="utf-8")) if source.exists() else None
    if not parts and existing is not None:
        # Keep each Proper's previous parts rather than writing none.
        previous = {str(p["slug"]): p.get("parts", []) for p in existing.get("pieces", [])}
        for piece in catalog["pieces"]:            # type: ignore[union-attr]
            piece["parts"] = previous.get(str(piece["slug"]), [])
        review = [r for r in review if not str(r.get("kind", "")).startswith("part_")]
        review += [r for r in (json.loads(rev_path.read_text(encoding="utf-8")) if rev_path.exists() else [])
                   if r.get("volume") == vol_id and str(r.get("kind", "")).startswith("part_")]
        review = [{k: v for k, v in r.items() if k != "volume"} for r in review]
    merged = merge_catalog(existing, catalog)
    from pipeline.parts import link_parts
    unlinked = link_rubrics(merged, load_rubrics(data_dir))
    unlinked += link_parts(merged)
    queue = json.loads(rev_path.read_text(encoding="utf-8")) if rev_path.exists() else []
    queue = [r for r in queue if r.get("volume", "noh5") != vol_id
             and r["kind"] not in ("rubric_unlinked", "part_borrowed_unresolved")]
    queue += [{"volume": vol_id, **r} for r in review]
    queue += [{"volume": "links", **r} for r in unlinked]
    base_path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    rev_path.write_text(json.dumps(queue, indent=2) + "\n", encoding="utf-8")
    # Last: the hand corrections. A stale one stops here with the base already
    # written, so fixing corrections.yml needs only `noh apply-corrections`.
    from pipeline.corrections import write as apply_corrections
    apply_corrections(base_path, data_dir / "corrections.yml", cat_path)
    return cat_path, rev_path


__all__ = ["AT_END", "PART_DIVISIONS", "PART_GENRES", "SCHEMA_VERSION", "PartsUnavailable", "SystemRef", "asdict", "build_catalog", "has_parts", "write_catalog"]
