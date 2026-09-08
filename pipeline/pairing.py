"""Pair NOH pieces with GregoBase chants.

For NOH5 the correspondence is structural rather than textual: GregoBase files
every Ordinary movement under office-part `ky` with an incipit like "Gloria III",
"Agnus Dei IV" or "Kyrie (ad lib.) I. - Clemens Rector", and NOH5 numbers its
Masses the same way. So the match is keyed on (movement, roman numeral) and the
incipit text is used to confirm rather than to discover.

Three honest states, never two. A pairing that is merely probable is shown and
labelled, never hidden and never presented as verified: an organist comparing a
wrong chant against the accompaniment will notice, but only if we admit we are
unsure.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from pipeline.gregobase import Chant, load_chants, match_score, normalise_incipit
from pipeline.index import IndexEntry

VERIFIED_AT = 0.85
UNVERIFIED_AT = 0.45

ORDINARY_PART = "ky"
MOVEMENT_WORDS = {
    "kyrie": ("kyrie",),
    "gloria": ("gloria",),
    "credo": ("credo",),
    "sanctus": ("sanctus",),
    "agnus": ("agnus dei", "agnus"),
    "ite": ("ite", "benedicamus"),
}
MASS_MOVEMENTS = ("kyrie", "gloria", "sanctus", "agnus", "ite")
# Genres whose NOH entry is a whole Mass and therefore pairs to several movements.
MASS_LIKE = {"mass_ordinary", "requiem"}
_ROMAN = re.compile(r"\b(X{0,3}(?:IX|IV|V?I{0,3}))\b")

# Distinct repertoires that share the Kyriale's movement names and numbering.
# "Sanctus (Missa Regia I)" is Du Mont, not Mass I of the Kyriale; pairing it to
# NOH5's Missa I and calling it verified is exactly the mistake that makes a
# confidence label worthless. A NOH entry only matches these if it is one of them.
FOREIGN_REPERTOIRE = (
    "missa regia", "requiem", "pro defunctis", "more ambrosiano", "ambrosian",
    "mozarabic", "missa pro defunctis",
)
# Qualifiers that mark a variant of the right chant rather than a different one.
# They are tolerated but demoted, so the plain reading wins when both exist.
VARIANT_MARKERS = ("cum organo", "forma ordinaria", "ad lib", "/", " a", " b", " c")


def roman_of(text: str) -> str | None:
    """First standalone roman numeral in a title, e.g. 'Gloria III' -> 'III'."""
    for match in _ROMAN.finditer(text):
        value = match.group(1)
        if value:
            return value
    return None


def status_for(score: float) -> str:
    if score >= VERIFIED_AT:
        return "verified"
    if score >= UNVERIFIED_AT:
        return "unverified"
    return "unpaired"


def pair_chant(score: float) -> dict[str, object]:
    """Threshold policy, isolated so it can be tested without any data."""
    status = status_for(score)
    return {
        "status": status,
        # An unverified pairing is displayed WITH a warning. Hiding it would deny
        # the reader the one thing that lets them catch our mistake.
        "display": status in ("verified", "unverified"),
        "score": round(score, 3),
    }


@dataclass(frozen=True)
class Pairing:
    movement: str | None
    chant_id: int
    chant_incipit: str
    mode: str | None
    score: float
    status: str

    @property
    def display(self) -> bool:
        return self.status in ("verified", "unverified")


def _residue(chant_incipit: str, movement: str, numeral: str | None) -> str:
    """What is left of an incipit after its movement word and numeral."""
    text = normalise_incipit(chant_incipit)
    for word in sorted(MOVEMENT_WORDS[movement], key=len, reverse=True):
        if text.startswith(word):
            text = text[len(word):]
            break
    if numeral:
        text = re.sub(rf"\b{numeral.lower()}\b", " ", text, count=1)
    return " ".join(text.split())


def _score_candidate(chant: Chant, movement: str, numeral: str | None,
                     incipit: str | None, ad_libitum: bool, entry_text: str) -> float:
    text = normalise_incipit(chant.incipit)
    words = MOVEMENT_WORDS[movement]
    if not any(text.startswith(w) for w in words):
        return 0.0
    chant_ad_lib = "ad lib" in text
    # A numbered Ordinary must never match an ad-libitum chant of the same number:
    # "Kyrie (ad lib.) III" is a different chant from "Kyrie III". The reverse is a
    # preference only, because NOH's "Alii Cantus ad libitum" holds pieces that
    # GregoBase files without the marker.
    if chant_ad_lib and not ad_libitum:
        return 0.0
    chant_numeral = roman_of(chant.incipit)
    if numeral and chant_numeral != numeral:
        return 0.0

    # A chant from a different repertoire may share the movement name and number.
    # The test must run BOTH ways. One-directional checking let NOH5's "Missa pro
    # Defunctis I" pair to Kyrie/Gloria/Sanctus I of the Kyriale at 0.85
    # "verified" -- the Requiem has no Gloria at all, and its "I" is a section
    # ordinal, not a Kyriale number.
    entry_norm = normalise_incipit(entry_text)
    for foreign in FOREIGN_REPERTOIRE:
        if (foreign in text) != (foreign in entry_norm):
            return 0.0

    score = 0.85 if numeral and chant_numeral == numeral else 0.5
    if incipit:
        # The Latin title ("Clemens Rector") confirms a structural match and can
        # lift it to verified; its absence never demotes one.
        score = max(score, min(1.0, score + 0.15 * match_score(
            normalise_incipit(incipit), text.split("-")[-1].strip())))

    # Prefer the plainest incipit: "Gloria III" over "Gloria III (cum organo)".
    # Extra words mean a variant, and a variant is a weaker claim to being *the*
    # chant this accompaniment was written for.
    residue = _residue(chant.incipit, movement, numeral)
    if incipit:
        residue = residue.replace(normalise_incipit(incipit), "").strip()
    # "ad lib" is a required part of the match for these entries, not surplus.
    residue = residue.replace("ad lib", "").strip()
    if ad_libitum and not chant_ad_lib:
        score -= 0.10
    score -= min(0.30, 0.02 * len(residue))
    return round(max(score, 0.0), 3)


def pair_entry(entry: IndexEntry, chants: list[Chant] | None = None) -> list[Pairing]:
    pool = [c for c in (chants if chants is not None else load_chants())
            if c.office_part == ORDINARY_PART and c.gabc]
    numeral = roman_of(entry.label) or roman_of(entry.title)
    ad_libitum = "libitum" in entry.section.lower()

    movements = MASS_MOVEMENTS if entry.genre in MASS_LIKE else (
        (entry.genre,) if entry.genre in MOVEMENT_WORDS else ()
    )
    results: list[Pairing] = []
    for movement in movements:
        best: Pairing | None = None
        entry_text = f"{entry.title} {entry.incipit or ''} {entry.section}"
        for chant in pool:
            score = _score_candidate(chant, movement, numeral, entry.incipit,
                                     ad_libitum, entry_text)
            if score and (best is None or score > best.score):
                best = Pairing(movement, chant.id, chant.incipit, chant.mode,
                               score, status_for(score))
        if best is not None and best.display:
            results.append(best)
    return results
