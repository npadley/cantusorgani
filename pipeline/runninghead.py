"""Per-page section attribution from running heads.

NOH prints a running head on most music pages (e.g. "I. TEMPORE PASCHALI",
"IN EXSEQUIIS"). Read from the PDF's embedded text layer it is noisy --
"IN EXSEQUDS" for "IN EXSEQUIIS", "FESTLS" for "FESTIS" -- so it is resolved by
fuzzy match against a controlled vocabulary rather than trusted literally.

The vocabulary is derived from the hand-transcribed index, not written by hand a
second time: the index already names every section of the volume, so the two
cannot drift apart.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

from pipeline.folio import read_embedded
from pipeline.index import load_index

MIN_MATCH = 0.55
MIN_HEAD_CHARS = 4      # below this a head is a fragment, not a section name
MIN_SUBSTRING_CHARS = 6  # 'CREDO V' is 7 chars; an 8-char floor excluded it
_NOISE = re.compile(r"[^A-Z0-9 ]+")


def normalise_head(text: str, drop_folio: bool = False) -> str:
    """Uppercase, strip accents and punctuation, collapse spaces.

    Digits are KEPT. They carry the distinguishing information: Masses IV-VIII are
    all "In Festis Duplicibus", separated only by the trailing 1-5, so dropping
    digits collapses five sections into one and makes the match arbitrary.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    words = _NOISE.sub(" ", stripped.upper()).split()
    if drop_folio:
        # The folio number rides along in the head band; it is not part of the
        # section name and would otherwise dominate short heads.
        words = [w for w in words if not (w.isdigit() and len(w) >= 2)]
    return " ".join(words)


def vocabulary(vol_id: str) -> dict[str, str]:
    """Candidate running-head text -> canonical section label, from the index."""
    vocab: dict[str, str] = {}
    for entry in load_index(vol_id):
        vocab.setdefault(normalise_head(entry.title), entry.label)
        if entry.incipit:
            vocab.setdefault(normalise_head(entry.incipit), entry.label)
        # Section names are a weaker fallback and must not outrank an entry title,
        # so they are added last and only when not already present.
    for entry in load_index(vol_id):
        vocab.setdefault(normalise_head(entry.section), entry.section)
    vocab.pop("", None)
    return vocab


@dataclass(frozen=True)
class HeadReading:
    raw: str
    normalised: str
    matched: str | None
    score: float


def read_running_head(vol_id: str, pdf_page: int,
                      vocab: dict[str, str] | None = None) -> HeadReading:
    raw, _ = read_embedded(vol_id, pdf_page)
    norm = normalise_head(raw, drop_folio=True)
    if len(norm.replace(" ", "")) < MIN_HEAD_CHARS:
        # e.g. a bare "II" left over from a mangled head: too little to identify a
        # section, and matching it would be a coin flip dressed as a result.
        return HeadReading(raw, norm, None, 0.0)
    table = vocabulary(vol_id) if vocab is None else vocab

    best_label: str | None = None
    best_score = 0.0
    for candidate, label in table.items():
        score = SequenceMatcher(None, norm, candidate).ratio()
        # A short head fully contained in a longer index title is a strong signal
        # that ratio() alone underweights.
        shorter = min(len(candidate), len(norm))
        if shorter >= MIN_SUBSTRING_CHARS and (candidate in norm or norm in candidate):
            score = max(score, 0.85)
        if score > best_score:
            best_score, best_label = score, label
    return HeadReading(raw, norm, best_label if best_score >= MIN_MATCH else None,
                       round(best_score, 3))
