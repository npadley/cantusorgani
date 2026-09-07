"""Detect Mass Ordinary movement boundaries from per-system chant text.

The index gives Mass-level pages only. Movements are found by matching each
system's OCR'd Latin against the movement incipits, tolerating heavy OCR damage.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from pipeline.systemtext import condense

# Condensed incipits. Several spellings per movement: NOH prints "Ite missa est"
# or "Benedicamus Domino" for the dismissal depending on season, and the Credo is
# cued either from "Credo in unum Deum" or its continuation.
INCIPITS: dict[str, tuple[str, ...]] = {
    "kyrie":   ("kyrieeleison", "kyrieeleisonchristeeleison"),
    "gloria":  ("gloriainexcelsisdeo", "etinterrapaxhominibus"),
    "credo":   ("credoinunumdeum", "patremomnipotentem"),
    "sanctus": ("sanctussanctussanctus", "dominusdeussabaoth", "benedictusquivenit"),
    "agnus":   ("agnusdeiquitollispeccatamundi", "agnusdei"),
    "ite":     ("itemissaest", "benedicamusdomino", "deogratias"),
}
MIN_SCORE = 0.66
MIN_TEXT = 8
# How far into a system's text an incipit may begin. A movement start carries
# leading junk -- the mode number, staff artefacts, speckle: the Kyrie of Missa I
# reads ", I, VHf. ~ 4V, Ky _ n _ l Ie _ _ son", where 12 characters of noise
# precede "kyrie". Anchoring at position 0 missed it entirely. Searching the whole
# system instead would fire on every repetition of "eleison", so the window is
# bounded rather than unbounded.
LEAD_WINDOW = 26
_ROMAN = re.compile(r"\b(I{1,3}|IV|V|VI{1,3}|IX|X)\b")


@dataclass(frozen=True)
class MovementHit:
    movement: str
    score: float
    matched_incipit: str
    offset: int
    mode_marker: str | None

    @property
    def confident(self) -> bool:
        """A mode number printed left of the system corroborates a start.

        NOH prints the mode beside the first system of a movement, so its presence
        raises a borderline textual match to a confident one. Coverage is partial
        (the Gloria of Missa I has its mode set inline instead), so its absence is
        not evidence against a start.
        """
        return self.score >= 0.75 or (self.mode_marker is not None and self.score >= MIN_SCORE)


def mode_marker(left_margin_text: str) -> str | None:
    """Roman numeral printed to the left of a system, if any."""
    cleaned = left_margin_text.replace("H", "II").replace("f", "I").upper()
    match = _ROMAN.search(cleaned)
    return match.group(1) if match else None


def best_match(system_text: str, left_margin: str = "") -> MovementHit | None:
    """Best movement incipit beginning within the first LEAD_WINDOW characters."""
    condensed = condense(system_text)
    if len(condensed) < MIN_TEXT:
        return None
    marker = mode_marker(left_margin) if left_margin else None

    best: MovementHit | None = None
    for movement, incipits in INCIPITS.items():
        for incipit in incipits:
            for offset in range(min(LEAD_WINDOW, max(1, len(condensed) - MIN_TEXT))):
                window = condensed[offset:offset + len(incipit) + 4]
                if len(window) < MIN_TEXT:
                    break
                score = SequenceMatcher(None, window, incipit).ratio()
                if best is None or score > best.score:
                    best = MovementHit(movement, round(score, 3), incipit, offset, marker)
    if best is None or best.score < MIN_SCORE:
        return None
    return best
