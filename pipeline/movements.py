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
# For placing movements in order, only a movement's true opening counts: the
# Benedictus and "Dominus Deus Sabaoth" lie inside the Sanctus, and placing the
# Sanctus there hands its first systems to the Gloria. "Qui tollis peccata
# mundi" is sung in the Gloria too, but by the time the Agnus is placed the
# Gloria is behind it.
OPENINGS: dict[str, tuple[str, ...]] = {
    "kyrie":   ("kyrieeleison",),
    "gloria":  ("gloriainexcelsisdeo", "etinterrapaxhominibus"),
    "sanctus": ("sanctussanctussanctus", "sanctussanctus"),
    "agnus":   ("agnusdeiquitollispeccatamundi", "agnusdei", "quitollispeccatamundi"),
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


# ------------------------------------------------------- Mass segmentation ---
#
# Hits alone cannot place the movements of a Mass: "Agnus Dei" is sung inside
# the Gloria ("Domine Deus, Agnus Dei, Filius Patris"), each Agnus invocation
# repeats the incipit, and half the Kyries are too damaged to match at all. But
# the order is fixed -- Kyrie, Gloria, Sanctus, Agnus Dei, then the dismissal --
# and the Kyrie is always the Mass's first system. So a Mass is segmented as a
# whole: the best-scoring increasing placement of its remaining movements.

ORDINARY_ORDER = ("kyrie", "gloria", "sanctus", "agnus", "ite")
# The Kyriale prints no Gloria for the ferial Masses: XVI (per annum), XVII
# (Sundays of Advent and Lent) and XVIII (ferias of Advent and Lent).
WITHOUT_GLORIA = frozenset({"XVI", "XVII", "XVIII"})
# Fewest systems a movement fills before the next can begin.
MIN_SYSTEMS = {"kyrie": 4, "gloria": 8, "sanctus": 3, "agnus": 2, "ite": 1}
MARKER_BONUS = 0.15       # the mode number printed beside a movement's first system
CONFIDENT_AT = 0.66


@dataclass(frozen=True)
class SystemFeature:
    ref: str
    text: str
    mode_marker: str | None = None


@dataclass(frozen=True)
class Boundary:
    movement: str
    index: int               # position of the movement's first system within the Mass
    ref: str
    score: float
    mode_marker: str | None

    @property
    def confident(self) -> bool:
        return self.movement == "kyrie" or self.score >= CONFIDENT_AT or (
            self.mode_marker is not None and self.score >= CONFIDENT_AT - MARKER_BONUS)


def movement_score(movement: str, system_text: str) -> float:
    """How well a system's opening words match a movement's incipit, 0-1."""
    return movement_score_for(OPENINGS[movement], system_text)


def movement_score_for(openings: tuple[str, ...], system_text: str) -> float:
    condensed = condense(system_text)
    if len(condensed) < MIN_TEXT:
        return 0.0
    best = 0.0
    for incipit in openings:
        for offset in range(min(LEAD_WINDOW, max(1, len(condensed) - MIN_TEXT))):
            window = condensed[offset:offset + len(incipit) + 4]
            if len(window) < MIN_TEXT:
                break
            best = max(best, SequenceMatcher(None, window, incipit).ratio())
    return round(best, 3)


def expected_movements(mass_label: str) -> tuple[str, ...]:
    return tuple(m for m in ORDINARY_ORDER if not (m == "gloria" and mass_label in WITHOUT_GLORIA))


# A system opening this close to a movement's words begins it -- the FIRST such
# system, because the Agnus Dei's invocation repeats and the best-scoring one is
# as likely the third as the first.
STRONG = {"gloria": 0.7, "sanctus": 0.7, "agnus": 0.6, "ite": 0.66}
# Where nothing matches strongly, the start is sought this many systems past the
# earliest point it could be, at the best score in that window.
WINDOW = 6
GLORIA_ENDS = ("cumsanctospiritu", "gloriadeipatrisamen", "patrisamen")
GLORIA_END_CLUSTER = 4
HOSANNA = ("hosannainexcelsis", "hosanna", "inexcelsis")
SABAOTH = ("dominusdeussabaoth",)


def _contains(system_text: str, words: tuple[str, ...], at: float = 0.8) -> bool:
    condensed = condense(system_text)
    return any(SequenceMatcher(None, condensed[o:o + len(w)], w).ratio() >= at
               for w in words for o in range(max(1, len(condensed) - len(w) + 1)))


def segment_mass(systems: list[SystemFeature], movements: tuple[str, ...]) -> list[Boundary]:
    """Place each movement of a Mass at its first system, in order.

    The Kyrie takes system 0. Each later movement begins at the first system,
    after the one before has had its MIN_SYSTEMS, whose opening words match it
    strongly. The Sanctus is sought only after the Gloria's last line ("cum
    Sancto Spiritu ... Amen"), so the Gloria's "tu solus Sanctus" cannot take it.
    Where nothing matches strongly -- OCR ruins many openings -- the movement is
    still placed, at the best score (a printed mode number helping) in a short
    window, and reported with its low score; the dismissal is left out instead."""
    if not systems or not movements:
        return []
    n = len(systems)
    first, rest = movements[0], movements[1:]
    out = [Boundary(first, 0, systems[0].ref, 1.0, systems[0].mode_marker)]
    position, previous = 0, first
    for k, movement in enumerate(rest):
        low = position + MIN_SYSTEMS[previous]
        after_gloria = False
        if previous == "gloria":
            ends = [i for i in range(position + 1, n) if _contains(systems[i].text, GLORIA_ENDS)]
            if ends:
                # The Gloria's close runs over a system or two ("...cum Sancto" |
                # "Spiritu, in gloria Dei Patris. Amen") and "qui sedes ad dexteram
                # Patris" can look like it: its end is the last marker of the first
                # cluster.
                j = ends[0]
                for e in ends[1:]:
                    if e - j > GLORIA_END_CLUSTER:
                        break
                    j = e
                low, after_gloria = max(low, j + 1), True
        room = sum(MIN_SYSTEMS[m] for m in rest[k + 1:] if m != "ite")
        high = n - room
        if low >= n:
            continue                          # no systems left for it: not in this scan
        if low >= high:
            if movement == "ite":
                continue
            high = n                          # cramped: give it what is left
        raw = [movement_score(movement, systems[i].text) for i in range(n)]
        after_sanctus = False
        if previous == "sanctus":
            # The Agnus follows the Sanctus's last "Hosanna in excelsis".
            strong = next((i for i in range(low, high) if raw[i] >= STRONG[movement]), high)
            hosannas = [i for i in range(position + 1, min(strong, position + 10))
                        if _contains(systems[i].text, HOSANNA)]
            if hosannas and hosannas[-1] + 1 < high:
                low, after_sanctus = max(low, hosannas[-1] + 1), True
        if movement == "sanctus" and not after_gloria:
            # With no Gloria before it, the Sanctus can also be found by its second
            # line, "Dominus Deus Sabaoth", when its first is lost to OCR (XVII).
            sabaoth = next((i for i in range(low, high)
                            if movement_score_for(SABAOTH, systems[i].text) >= STRONG[movement]), None)
            if sabaoth is not None and not any(raw[i] >= STRONG[movement] for i in range(low, sabaoth + 1)):
                back = sabaoth - 1 if sabaoth - 1 >= low and len(condense(systems[sabaoth - 1].text)) < MIN_TEXT \
                    else sabaoth
                raw[back] = max(raw[back], STRONG[movement])
        pick = next((i for i in range(low, high) if raw[i] >= STRONG[movement]), None)
        if pick is None:
            if movement == "ite":
                continue
            if after_gloria or after_sanctus:
                pick = low                    # it follows the last line of the one before
            else:
                # Without a Gloria to end, the Kyrie can run long (XVII): search all.
                whole = movement == "sanctus" and previous == "kyrie"
                window = range(low, high) if whole else range(low, min(high, low + WINDOW))
                pick = max(window, key=lambda i: (raw[i] + (MARKER_BONUS if systems[i].mode_marker else 0.0), -i))
        out.append(Boundary(movement, pick, systems[pick].ref, round(raw[pick], 3), systems[pick].mode_marker))
        position, previous = pick, movement
    return out


KYRIE_SEARCH = 4          # systems into a Mass's first page within which its Kyrie must open


def kyrie_offset(systems: list[SystemFeature]) -> int:
    """How many systems at the start of a Mass belong to the Mass before it.

    A Mass often begins below the last systems of the one before ("... Ite,
    missa est" then "IV. CUNCTIPOTENS GENITOR DEUS"), and when the page split
    finds no heading those systems are handed to the wrong Mass. They are
    recognised by what ends a Mass -- its dismissal -- not by the first
    "eleison", which may be the middle of this Mass's own Kyrie."""
    last_end = -1
    for i, s in enumerate(systems[:KYRIE_SEARCH]):
        if ends_a_mass(s.text):
            last_end = i
    return last_end + 1


DISMISSALS = ("itemissaest", "deogratias", "benedicamusdomino")


def ends_a_mass(system_text: str) -> bool:
    """The dismissal anywhere in the system -- it is often the last words of a
    long line ("...dona nobis pacem. Ite, missa est"), past the opening window."""
    condensed = condense(system_text)
    for word in DISMISSALS:
        for offset in range(max(1, len(condensed) - len(word) + 1)):
            if SequenceMatcher(None, condensed[offset:offset + len(word)], word).ratio() >= 0.8:
                return True
    return False
