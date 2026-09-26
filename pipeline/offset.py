"""Derive and verify the printed-folio to PDF-page offset.

This offset is the single value that can poison every reference in a volume, and
a wrong one looks entirely plausible. So it is derived by sampling and voting,
never hand-entered; only dual-source-agreed folio readings vote; the result is
gated on confidence; and the accepted value is persisted to a git-tracked file so
that any change to it appears as a reviewable line in a diff.

Measured on NOH5 (2026-09-07): offset +46, ~83% of sampled pages yield an agreed
reading. NOH1 is +25 -- the constant is never shared between volumes.
"""

from __future__ import annotations

import itertools
import json
import random
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

from pipeline.checksum import sha256_of
from pipeline.folio import read_folio_dual
from pipeline.volumes import DATA, Volume, load_volumes

MIN_CONFIDENCE = 0.9
MIN_SAMPLES = 10
OFFSETS_FILE = DATA / "derived-offsets.json"


@dataclass(frozen=True)
class OffsetResult:
    offset: int
    confidence: float
    samples: int
    disagreements: list[tuple[int, int]]


def derive_offset(vol_id: str, work_dir: Path | None = None, sample_size: int = 20,
                  seed: int = 0, require_both: bool = True) -> OffsetResult:
    vol = load_volumes()[vol_id]
    body = [
        p for p in range(vol.first_body_pdf_page, vol.pdf_pages + 1)
        if p not in vol.index_pdf_pages
    ]
    # Never infer front-matter size from a fraction of the volume: on NOH5 a 20%
    # heuristic coincidentally equals the true 46-page front matter, and would be
    # wrong for every other volume. It is declared in volumes.yml.
    if len(body) < sample_size:
        raise RuntimeError(f"{vol_id}: only {len(body)} body pages to sample")
    pages = random.Random(seed).sample(body, sample_size)

    votes: Counter[int] = Counter()
    observed: list[tuple[int, int]] = []
    for page in pages:
        reading = read_folio_dual(vol_id, page, work_dir, require_both=require_both)
        # Only agreed readings vote. An unagreed page contributes nothing, rather
        # than contributing noise to the most damaging value in the volume.
        if reading.folio is not None:
            votes[page - reading.folio] += 1
            observed.append((page, reading.folio))

    if not observed:
        raise RuntimeError(
            f"{vol_id}: no folio agreed on any of {len(pages)} sampled pages.\n"
            f"  Likely causes, in order:\n"
            f"    1. Tesseract Latin data missing -- run `uv run noh doctor`.\n"
            f"    2. The folio band/margin constants are wrong for this volume\n"
            f"       (see HEAD_BAND and MIN_CENTRE_OFFSET in pipeline/folio.py).\n"
            f"    3. The sampled pages are front/back matter with no printed folio.\n"
            f"  Sampled PDF pages were: {sorted(pages)}"
        )

    offset, count = votes.most_common(1)[0]
    disagreements = [(p, f) for p, f in observed if p - f != offset]
    return OffsetResult(offset, count / len(observed), len(observed), disagreements)


def assert_consistent(vol_id: str, result: OffsetResult) -> None:
    if result.samples < MIN_SAMPLES:
        raise ValueError(
            f"{vol_id}: only {result.samples} folios agreed; need {MIN_SAMPLES}"
        )
    if result.confidence < MIN_CONFIDENCE:
        raise ValueError(
            f"{vol_id}: inconsistent offset (confidence {result.confidence:.2f}); "
            f"disagreements: {result.disagreements}"
        )


def persist(vol_id: str, result: OffsetResult, seed: int = 0,
            path: Path = OFFSETS_FILE) -> dict[str, object]:
    """Record the accepted offset so a change to it shows up in a diff."""
    vol = load_volumes()[vol_id]
    store: dict[str, object] = {}
    if path.exists():
        store = json.loads(path.read_text(encoding="utf-8"))
    entry = asdict(result) | {"seed": seed, "source_sha256": sha256_of(vol.path)}
    store[vol_id] = entry
    path.write_text(json.dumps(store, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return entry


def load_offset(vol_id: str, path: Path = OFFSETS_FILE) -> int:
    """Read the reviewed offset. Downstream stages use this, never re-deriving."""
    if not path.exists():
        raise RuntimeError(
            f"{path} does not exist. Run `uv run noh offset --volume {vol_id}` first."
        )
    store = json.loads(path.read_text(encoding="utf-8"))
    if vol_id not in store:
        raise RuntimeError(f"{vol_id}: no derived offset recorded in {path}")
    entry = store[vol_id]
    vol = load_volumes()[vol_id]
    actual = sha256_of(vol.path)
    if entry["source_sha256"] != actual:
        raise RuntimeError(
            f"{vol_id}: derived offset was computed against a different source PDF "
            f"(recorded {entry['source_sha256'][:12]}, found {actual[:12]}). "
            f"Re-derive it: uv run noh offset --volume {vol_id}"
        )
    return int(entry["offset"])


# ------------------------------------------------------------ page maps ---
#
# A scan is not always one constant offset. NOH3 gains two pages near its end
# (+33 becomes +35) and NOH1 lacks printed 348-349. A PAGE MAP is a list of
# segments, each a PDF page range with its own offset, derived the same way the
# single offset is: evidence first, verification second, persisted for review.

MIN_RUN = 3            # embedded readings needed in a row before a shift is believed
SEGMENT_SAMPLES = 6    # dual-source readings attempted per segment
MIN_SEGMENT_AGREED = 3


@dataclass(frozen=True)
class Segment:
    first_pdf: int
    last_pdf: int
    offset: int
    verified: int = 0          # dual-source readings that agreed with this offset


@dataclass(frozen=True)
class PageMap:
    segments: tuple[Segment, ...]

    def to_pdf(self, printed: int) -> int | None:
        for seg in self.segments:
            pdf = printed + seg.offset
            if seg.first_pdf <= pdf <= seg.last_pdf:
                return pdf
        return None

    def to_printed(self, pdf: int) -> int | None:
        seg = next((s for s in self.segments if s.first_pdf <= pdf <= s.last_pdf), None)
        return pdf - seg.offset if seg else None

    @property
    def last_printed(self) -> int:
        return max(s.last_pdf - s.offset for s in self.segments)

    @property
    def gaps(self) -> list[tuple[int, int]]:
        """PDF pages between segments: an inserted plate, or a boundary no
        reading could place. Nothing there is catalogued until it is."""
        ordered = sorted(self.segments, key=lambda s: s.first_pdf)
        return [(a.last_pdf + 1, b.first_pdf - 1) for a, b in itertools.pairwise(ordered)
                if b.first_pdf - a.last_pdf > 1]


def runs_from_readings(readings: list[tuple[int, int]], min_run: int = MIN_RUN
                       ) -> list[tuple[int, int, int]]:
    """(first_pdf, last_pdf, offset) runs from (pdf, folio) readings in page order.

    A shift is believed only after `min_run` readings in a row agree on it; a
    shorter disagreement is a misread folio and is dropped. The run limits are
    the first and last pages that READ that offset -- pages between two runs are
    left for verification to place."""
    points = sorted((pdf, pdf - folio) for pdf, folio in readings)
    raw: list[list[tuple[int, int]]] = []
    for pdf, off in points:
        if raw and raw[-1][-1][1] == off:
            raw[-1].append((pdf, off))
        else:
            raw.append([(pdf, off)])
    kept = [r for r in raw if len(r) >= min_run]
    merged: list[tuple[int, int, int]] = []
    for run in kept:
        first, last, off = run[0][0], run[-1][0], run[0][1]
        if merged and merged[-1][2] == off:
            merged[-1] = (merged[-1][0], last, off)
        else:
            merged.append((first, last, off))
    return merged


def derive_page_map(vol_id: str, work_dir: Path | None = None, seed: int = 0) -> PageMap:
    """Read every body page's folio from the text layer (free), find the runs,
    then verify each run with dual-source readings and place the pages between
    runs by any reading that fits one neighbour's offset exactly."""
    from pipeline.folio import read_embedded

    vol = load_volumes()[vol_id]
    body = [p for p in range(vol.first_body_pdf_page, (vol.last_body_pdf_page or vol.pdf_pages) + 1)
            if p not in vol.index_pdf_pages]
    readings = [(p, folio) for p in body if (folio := read_embedded(vol_id, p)[1]) is not None]
    runs = runs_from_readings(readings)
    if not runs:
        raise RuntimeError(f"{vol_id}: no run of {MIN_RUN} consistent folios in the text layer")

    rng = random.Random(seed)
    segments: list[Segment] = []
    for first, last, off in runs:
        pages = [p for p in body if first <= p <= last]
        agreed = disagreed = 0
        for page in rng.sample(pages, min(SEGMENT_SAMPLES, len(pages))):
            folio = read_folio_dual(vol_id, page, work_dir).folio
            if folio is None:
                continue
            if page - folio == off:
                agreed += 1
            else:
                disagreed += 1
        if agreed < min(MIN_SEGMENT_AGREED, len(pages)) or disagreed > agreed * (1 - MIN_CONFIDENCE):
            raise ValueError(
                f"{vol_id}: segment pdf {first}-{last} (offset {off:+d}) is not verified: "
                f"{agreed} dual-source readings agree, {disagreed} disagree")
        segments.append(Segment(first, last, off, agreed))

    # Extend each segment over the unread pages at its edges wherever a reading
    # fits that segment's offset. The outermost segments extend to the ends of the
    # body unless a reading contradicts them; between two segments, a page with no
    # reading stays unmapped -- in NOH1 that is a page scanned twice.
    extended: list[Segment] = []
    last_body = vol.last_body_pdf_page or max(
        p for p in range(1, vol.pdf_pages + 1) if p not in vol.index_pdf_pages)
    for i, seg in enumerate(segments):
        low = segments[i - 1].last_pdf + 1 if i else vol.first_body_pdf_page
        high = segments[i + 1].first_pdf - 1 if i + 1 < len(segments) else last_body
        before = segments[i - 1].offset if i else None
        after = segments[i + 1].offset if i + 1 < len(segments) else None
        first, stopped = _extend(vol_id, seg.offset, before, range(seg.first_pdf - 1, low - 1, -1),
                                 vol, work_dir)
        first = low if first is None and not stopped and i == 0 else (first or seg.first_pdf)
        last, stopped = _extend(vol_id, seg.offset, after, range(seg.last_pdf + 1, high + 1),
                                vol, work_dir)
        last = high if last is None and not stopped and after is None else (last or seg.last_pdf)
        extended.append(Segment(first, last, seg.offset, seg.verified))
    return PageMap(tuple(extended))


def folio_candidates(vol_id: str, pdf_page: int, work_dir: Path | None = None) -> set[int]:
    """Every folio a page might carry: both readers, plus any number in the
    running head, repaired ("3-40", "3il", ")50"). Loose on purpose -- it is only
    ever asked whether ONE expected number is among them."""
    from pipeline.folio import read_embedded, read_folio
    from pipeline.indexextract import page_candidates

    head, embedded = read_embedded(vol_id, pdf_page)
    found = {f for f in (embedded, read_folio(vol_id, pdf_page, work_dir)) if f is not None}
    for token in head.split():
        cleaned = token.strip("()[]'\".,;:").replace("-", "")
        if 2 <= len(cleaned) <= 4 and any(c.isdigit() for c in cleaned):
            found.update(page_candidates(cleaned))
    return found


def _extend(vol_id: str, offset: int, neighbour: int | None, pages: range, vol: Volume,
            work_dir: Path | None) -> tuple[int | None, bool]:
    """Walk outward from a segment. Returns the furthest page that reads at
    `offset`, and whether the walk was stopped by a page reading at the
    neighbour's offset (rather than running out of pages)."""
    reached: int | None = None
    for page in pages:
        if page in vol.index_pdf_pages:
            return reached, True
        found = folio_candidates(vol_id, page, work_dir)
        if page - offset in found:
            reached = page
        elif neighbour is not None and page - neighbour in found:
            return reached, True
    return reached, False


def persist_page_map(vol_id: str, page_map: PageMap, path: Path = OFFSETS_FILE) -> dict[str, object]:
    vol = load_volumes()[vol_id]
    store: dict[str, object] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    main = max(page_map.segments, key=lambda s: s.last_pdf - s.first_pdf)
    entry: dict[str, object] = {
        "offset": main.offset,
        "segments": [asdict(s) for s in page_map.segments],
        "gaps": [list(g) for g in page_map.gaps],
        "source_sha256": sha256_of(vol.path),
    }
    store[vol_id] = entry
    path.write_text(json.dumps(store, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return entry


def load_page_map(vol_id: str, path: Path = OFFSETS_FILE) -> PageMap:
    """The reviewed page map. A volume derived with a single offset maps its whole
    body with that offset, so every stage can use this one interface."""
    offset = load_offset(vol_id, path)      # also enforces the checksum binding
    entry = json.loads(path.read_text(encoding="utf-8"))[vol_id]
    if "segments" in entry:
        return PageMap(tuple(Segment(**s) for s in entry["segments"]))
    vol = load_volumes()[vol_id]
    last = max(p for p in range(1, vol.pdf_pages + 1) if p not in vol.index_pdf_pages)
    return PageMap((Segment(vol.first_body_pdf_page, last, offset),))
