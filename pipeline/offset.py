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

import json
import random
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

from pipeline.checksum import sha256_of
from pipeline.folio import read_folio_dual
from pipeline.volumes import DATA, load_volumes

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
