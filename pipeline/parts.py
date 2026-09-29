"""A Proper's sections, as the book prints them: its Introit, each Gradual (an
Ember Saturday prints four), a hymn, the Tract ... Offertory, Communion.

Three signals, none enough alone (measured on NOH3, 2026-09-26):

- the label printed in the left margin ("Intr.", "Grad.", "2. Grad.", "Hymn.",
  "Tract.", "Offert.", "Comm."; "Ant.", "Resp." for a blessing or a
  procession), read by Tesseract from each system's slice (pipeline.margins);
- the chant's opening words, from GregoBase (jgabc says which chant each part
  is), fuzzy-matched against the words under the system;
- the mode number printed beside the first system of every chant.

What exists comes from the book: every margin label after the Introit starts a
section of its kind, whether or not jgabc lists it. jgabc gives the chants: each
part it lists takes the first labelled section of its kind; a part no label
names is sought by its words, only in the gap between the sections before and
after it in the order of Mass, never on a system whose words belong to an
earlier section's chant (the Introit's Psalm verse opens the Ember Saturday's
Tract). A required part neither finds is placed only when the page allows one
conclusion -- exactly one chant starts in its gap -- and is marked `inferred`
with the reason; otherwise it goes to the review queue with its candidates.
A section with no chant from jgabc (the extra Graduals, a hymn) is paired with
GregoBase by its opening words and mode, as the Kyriale's movements are.

If nothing finds the Introit at all (`part_mismatch`), the scan may not be this
Proper -- a 1942 text 1962 replaced -- or the Introit is printed elsewhere.
Then a part is placed only where its own words match, never by label or
inference: wrong jump links are worse than none. A layout the order of Mass
cannot describe is a reviewed list (data/sections/).
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from pipeline.catalog import parse_reference
from pipeline.movements import movement_score_for
from pipeline.systemtext import condense

# The order parts are printed in. A Tract and a Paschal Alleluia follow the
# Alleluia: NOH prints the seasonal forms of a feast one after another.
ORDER = ("introit", "gradual", "alleluia", "tract", "alleluia/paschal", "sequence",
         "offertory", "communion")
MIN_SYSTEMS = {"introit": 2, "gradual": 2, "alleluia": 1, "tract": 2, "sequence": 2,
               "offertory": 1, "communion": 1}
STRONG_TEXT = 0.66        # a text match this close places a part without a label
OPENING_CHARS = 24

# OCR variants seen in NOH3's margins (2026-09-26): "ntr.", "srad.", "Grrad.",
# "Oftfert.", "Offe VII", "Comin.", "Comimn", "Cora VII.", "Conn".
LABELS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("introit", re.compile(r"(?:\b[Il1|(]?|^)\s?n\s?\.?\s?t\s?r\b|\bIntroit", re.IGNORECASE)),
    # "2.Gra I." is the Ember Saturday's second Gradual, its d lost to the OCR.
    ("gradual", re.compile(r"\b[GgSs]r+ad\b|\bGraduale\b|\d\s*\.\s*Gra\b", re.IGNORECASE)),
    ("hymn", re.compile(r"\bHym", re.IGNORECASE)),
    ("tract", re.compile(r"\bTra[ce]t\b|\bTractus\b", re.IGNORECASE)),
    ("sequence", re.compile(r"\bSequ|\bSeq\b", re.IGNORECASE)),
    ("offertory", re.compile(r"\bOf+t?f?e(?:rt)?\b|\bOf+t?fert|\bOffertor", re.IGNORECASE)),
    ("communion", re.compile(r"\bCo[mnr]{1,2}[in]{0,2}n?\s*\.|\bComm|\bCora\b|\bCommunio\b", re.IGNORECASE)),
)
# Under the staff the words are Latin, and "cor", "con", "offero" are words:
# there a label counts only in full, with its full stop.
TEXT_LABELS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("introit", re.compile(r"\b[Ifl1|]\s?ntr\.")), ("gradual", re.compile(r"\bGrad\.")),
    ("tract", re.compile(r"\bTract\.")), ("sequence", re.compile(r"\bSequentia\b")),
    ("offertory", re.compile(r"\bOffert\.")), ("communion", re.compile(r"\bComm\.")),
)
_REFERENCE = re.compile(r"ut\s+supra|ut\s+infra|ibid|Pars\s|p\.\s*\d", re.IGNORECASE)
# Sections outside the Mass: a blessing's or a procession's antiphons and responsories.
OTHER_LABELS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Ant.", re.compile(r"\bAnt\b\.?")), ("Resp.", re.compile(r"\bResp\b\.?")), ("Cant.", re.compile(r"\bCant\b\.?")),
)
# A label is printed at the margin's left edge: every real one begins within the
# first 4 characters of its OCR (642 of 642, 2026-09-29). A label word deeper in
# is noise the OCR read from inside the staff ("... rat Qu Com. = 2a:").
LABEL_START = 6
# "2.Grad", "3. Grad.": the 2nd (3rd ...) of its kind, numbered in the margin.
_NUMBERED = re.compile(r"^\W{0,3}([2-9])\s*\.\s*[A-Za-z]")
# How NOH abbreviates each kind in the margin, for a section's printed label.
ABBREVIATIONS = {"introit": "Intr.", "gradual": "Grad.", "tract": "Tract.", "sequence": "Seq.", "hymn": "Hymn.",
                 "offertory": "Offert.", "communion": "Comm."}
# The order of Mass: a part is sought between the sections before and after it.
MASS_ORDER = ("introit", "gradual", "hymn", "alleluia", "tract", "alleluia/paschal", "sequence",
              "offertory", "communion")
# GregoBase's office parts each kind of section is paired among.
OFFICES = {"introit": ("in",), "gradual": ("gr",), "hymn": ("hy", "ca"), "alleluia": ("al",), "tract": ("tr",),
           "sequence": ("se",), "offertory": ("of",), "communion": ("co",), "other": ("an", "re", "ca", "hy")}
VERIFIED_TEXT = 0.8       # a pairing this close, in the printed mode, is linked


@dataclass(frozen=True)
class PartSystem:
    ref: str
    text: str                        # words under the staff, from the PDF text layer
    label: str | None = None         # the kind of section the margin label names, if any
    mode_marker: str | None = None   # mode number beside the system, if any
    number: int | None = None        # "2. Grad.": the 2nd of its kind, as numbered in the margin
    mark: str | None = None          # a label outside the Mass as printed ("Ant. 1", "Resp.")


@dataclass(frozen=True)
class ExpectedPart:
    part: str                        # introit | gradual | alleluia | tract | sequence | offertory | communion
    variant: str = ""                # "" | paschal | 1, 2 ... when a part repeats
    opening: str | None = None       # condensed opening words, from GregoBase
    gregobase_id: int | None = None
    optional: bool = False           # printed on some pages only (Tract, Paschal Alleluia)
    text: str = ""                   # the whole chant's words, condensed


@dataclass(frozen=True)
class ChantInfo:
    """A GregoBase chant, for pairing a section jgabc gives no chant."""
    id: int
    office: str | None
    opening: str                     # condensed opening words
    mode: str | None
    incipit: str
    notation: bool                   # has GABC to draw


@dataclass(frozen=True)
class PartBoundary:
    part: str
    variant: str
    index: int
    ref: str
    gregobase_id: int | None
    placed: str                      # label | text | inferred
    score: float
    label: str | None = None         # as printed in the margin ("2. Grad. II"), where it was read
    title: str | None = None         # its chant's incipit, where known
    why: str | None = None           # an inferred start's reason


@dataclass(frozen=True)
class PartProblem:
    kind: str                        # part_missing | part_mismatch | unverified_pairing
    part: str
    variant: str
    expected_opening: str | None
    best_index: int | None
    best_score: float
    candidates: tuple[str, ...] = ()  # the systems a person should look at
    chant_id: int | None = None       # an unverified pairing's chant


@dataclass
class Segmentation:
    parts: list[PartBoundary] = field(default_factory=list)
    problems: list[PartProblem] = field(default_factory=list)


def read_label(margin: str) -> tuple[str, int | None, str | None] | None:
    """(kind, number, mark) of a margin label: ("gradual", 2, None) for "2.Grad
    I.", ("other", None, "Ant. 1") for "Ant. 1 VIII."; None for no label."""
    kind = label_of(margin, max_start=LABEL_START)
    if kind is not None:
        m = _NUMBERED.match(margin)
        return kind, int(m.group(1)) if m else None, None
    for mark, pattern in OTHER_LABELS:
        m = pattern.search(margin)
        if m and m.start() <= LABEL_START and not _REFERENCE.search(margin[m.end():m.end() + 80]):
            number = re.match(r"\s*(\d)\b", margin[m.end():])
            return "other", None, f"{mark} {number.group(1)}" if number else mark
    return None


def label_of(margin: str, patterns: tuple[tuple[str, re.Pattern[str]], ...] = LABELS,
             max_start: int | None = None) -> str | None:
    """The part a margin label names, or None. A label followed by "ut supra",
    "ibid." or a page names a part printed elsewhere, not one that starts here.
    `max_start`: the label must begin within that many characters."""
    for part, pattern in patterns:
        m = pattern.search(margin)
        if m and (max_start is None or m.start() <= max_start) and not _REFERENCE.search(margin[m.end():m.end() + 80]):
            return part
    return None


def _text_label(text: str) -> str | None:
    """A label in the words under the staff (the text layer catches some).
    An opening system's words run longer before its margin: the Requiem's
    "Intr." reads "fntr." some 45 characters in (NOH5 p. 163), Pentecost's
    some 60 (NOH2 p. 109)."""
    return label_of(text[:40], TEXT_LABELS) or label_of(text[:100], TEXT_LABELS[:1])


_ROMAN_VALUES = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8}


def margin_mode(margin: str) -> str | None:
    """The mode number printed in a margin ("VII.", OCR'd "VIL." or "Vil."),
    which marks the first system of a chant. The printed numeral always ends in
    a full stop; a lone "i" or "f" of noise does not."""
    for m in re.finditer(r"(?:^|[\s|€(\[.])([IVLli1]{1,4})\s*\.", margin):
        numeral = re.sub(r"[Lli1]", "I", m.group(1)).upper()
        if numeral in _ROMAN_VALUES:
            return numeral
    return None


# "Al _ Ie", "AI Ie", "al . Ie": its first two syllables, apart under the notes,
# which is how the OCR most often keeps them when it loses the rest ("Iii la").
_ALLE = re.compile(r"\b[aA][lI1!]\s*[-_.~]*\s*[lI1][ec]\b")
_BEFORE_ALLELUIA = re.compile(r"\b[IVvl]{1,4}\s*\.|T\s?\.\s?P|deinde|Pasch", re.IGNORECASE)
# The mode, where the text layer carries the margin at the line's end ("AI _ Ie Vll.").
_MODE_AFTER = re.compile(r"[\s_\-.]*\S{0,6}\s*\b[IVvl]{1,4}\s*\.\s*$|[\s_\-.]*\b[IVvl]{2,4}\s*\.")
# Its intonation's asterisk, as the OCR reads it.
_ASTERISK = re.compile(r"\*|•|'\"|I<")


def _contains_alleluia(text: str) -> bool:
    """Whether an Alleluia starts on this system: the word where a chant begins,
    not the "alleluia" that ends a Paschal Offertory or Communion ("... bis. al _
    Ie lti la."). It starts one: at the start of the line, after a mode number or
    "T.P." / "deinde:", or with the asterisk of its intonation soon after. OCR
    reads the syllables' l as i or I ("AL Ie III * al _ Ie lu la"), so the words
    are compared with every i taken as l."""
    def starts_chant(at: int, after: int) -> bool:
        return (at <= 28 or bool(_BEFORE_ALLELUIA.search(text[max(0, at - 16):at]))
                or bool(_MODE_AFTER.match(text[after:after + 14])) or bool(_ASTERISK.search(text[after:after + 30])))
    if any(starts_chant(m.start(), m.end()) for m in _ALLE.finditer(text)):
        return True
    condensed = condense(text).replace("i", "l")
    target = "allelula"
    return any(SequenceMatcher(None, condensed[o:o + 8], target).ratio() >= 0.8
               for o in range(min(12, max(1, len(condensed) - 7))))


def _key(p: ExpectedPart) -> str:
    return f"{p.part}/{p.variant}" if p.variant == "paschal" else p.part


def _position(kind: str, variant: str) -> int | None:
    """Where a kind stands in the order of Mass; None for a section outside it."""
    key = f"{kind}/paschal" if variant == "paschal" else kind
    return MASS_ORDER.index(key) if key in MASS_ORDER else (MASS_ORDER.index(kind) if kind in MASS_ORDER else None)


def _inside(text: str, chant: str) -> bool:
    """Whether a system's words are a stretch of a chant's words (the Introit's
    Psalm verse and Gloria Patri are its own, not the next part's opening)."""
    words = condense(text)[:20]
    if len(words) < 8 or not chant:
        return False
    match = SequenceMatcher(None, words, chant, autojunk=False).find_longest_match(0, len(words), 0, len(chant))
    return match.size >= 0.8 * len(words)


_PSALM = re.compile(r"\bPs\s?[.,]|\bP,\.")      # "Ps.", "Ps," (NOH2 p. 127), "P,." (NOH3 p. 218)
# The Gloria Patri's words, where the OCR lost its "Amen" (NOH2 p. 127).
_GLORIA = ("gloriapatri", "sicuterat", "etnunc", "semper", "saecula")
_AMEN = re.compile(r"A\s?_?\s?me[nm]\b|\bmen\s*\.")      # "A _ mem." (NOH2 p. 110)


def _introit_end(systems: list[PartSystem], start: int) -> int:
    """The last system of the Introit starting at `start`: the one ending its
    Gloria Patri ("... saeculorum. Amen."), after the Psalm verse ("Ps.").
    Where the OCR lost the "Ps." (Pentecost, NOH2 p. 110), the first "Amen"
    close by; where neither is found, the Introit's own start."""
    near = range(start + 1, min(len(systems), start + 16))
    verse = next((i for i in near if _PSALM.search(systems[i].text)), None)
    if verse is None:
        return next((i for i in near if _AMEN.search(systems[i].text)), start)
    after = range(verse, min(len(systems), verse + 7))
    amen = next((i for i in after if _AMEN.search(systems[i].text)), None)
    if amen is not None:
        return amen
    # No Amen read: the last line with the Gloria Patri's words (its Amen may
    # be on that line, cut short by the OCR, or on the next).
    gloria = [i for i in after if any(w in condense(systems[i].text) for w in _GLORIA)]
    return gloria[-1] if gloria else verse


_NAMES = {"introit": "Introit", "gradual": "Gradual", "hymn": "hymn", "alleluia": "Alleluia", "tract": "Tract",
          "sequence": "Sequence", "offertory": "Offertory", "communion": "Communion", "other": "section"}


@dataclass
class _Found:
    index: int
    kind: str
    variant: str
    placed: str
    score: float
    part: ExpectedPart | None = None
    number: int | None = None
    mark: str | None = None
    why: str | None = None
    chant: int | None = None
    title: str | None = None


def segment_proper(systems: list[PartSystem], expected: list[ExpectedPart],
                   chants: list[ChantInfo] | None = None,
                   heading: Callable[[int], str | None] | None = None) -> Segmentation:
    """A Proper's sections in printed order, and what a person should check.

    `chants`: GregoBase's chants, to pair the sections jgabc gives none;
    `heading(i)`: the heading printed above system `i`, for the suggested
    label of a section outside the Mass. A layout the order of Mass cannot
    describe (NOH3's Queenship addendum prints its Paschal Alleluia before the
    Gradual) is a reviewed list instead (data/sections/)."""
    result = Segmentation()
    n = len(systems)
    if n == 0:
        return result
    labels: list[tuple[str, int | None, str | None] | None] = [
        (s.label, s.number, s.mark) if s.label else ((t, None, None) if (t := _text_label(s.text)) else None)
        for s in systems]

    def text_score(i: int, part: ExpectedPart) -> float:
        if part.part == "alleluia" and _contains_alleluia(systems[i].text):
            # The Alleluia follows the Gradual's verse, often mid-system and
            # with no label: its own first word is the one reliable sign.
            return 0.8
        return movement_score_for((part.opening,), systems[i].text) if part.opening else 0.0

    found: list[_Found] = []

    # 1. The Introit anchors the Mass. A scan can open on the tail of the Mass
    # before (its "Comm."), so the Introit is sought through the whole piece.
    anchored, start = True, 0
    introit = next((e for e in expected if e.part == "introit"), None)
    if introit is not None:
        at = next((i for i in range(n) if labels[i] and labels[i][0] == "introit"), None)   # type: ignore[index]
        how, score = "label", 1.0
        if at is None:
            at = next((i for i in range(n) if text_score(i, introit) >= STRONG_TEXT), None)
            how, score = "text", text_score(at, introit) if at is not None else 0.0
        if at is None:
            best = max(range(n), key=lambda i: text_score(i, introit))
            result.problems.append(PartProblem("part_mismatch", "introit", "", introit.opening, best,
                                               text_score(best, introit)))
            # Without the Introit the page may print another formulary (a 1942
            # text 1962 replaced), where a "Grad." label would link the wrong
            # chant: the rest are placed only where their own words match.
            anchored = False
        else:
            start = at
            found.append(_Found(at, "introit", "", how, round(score, 3), introit))
    introit_end = _introit_end(systems, start) if introit is not None and anchored else -1

    # 2. What the book prints: every label after the Introit starts a section
    # (before it, a Mass part's label is the Mass before's; a blessing's is not).
    if anchored:
        for i, label in enumerate(labels):
            if label is None or any(f.index == i for f in found):
                continue
            kind, number, mark = label
            if kind == "introit" or (kind != "other" and i < start):
                continue
            found.append(_Found(i, kind, "", "label", 1.0, number=number, mark=mark))

    def starts() -> set[int]:
        return {f.index for f in found}

    def rank(kind: str, variant: str) -> float | None:
        # A repeated part's 1st stands before its 2nd (the Easter week's two Alleluias).
        pos = _position(kind, variant)
        return None if pos is None else pos + (int(variant) / 100 if variant.isdigit() else 0)

    def neighbours(part: ExpectedPart) -> tuple[_Found | None, _Found | None]:
        pos = rank(part.part, part.variant) or 0
        ordered = sorted((f for f in found if rank(f.kind, f.variant) is not None), key=lambda f: f.index)
        before = [f for f in ordered if (rank(f.kind, f.variant) or 0) < pos]
        prev = before[-1] if before else None
        low = prev.index if prev else -1
        nxt = next((f for f in ordered if f.index > low and (rank(f.kind, f.variant) or 0) > pos), None)
        return prev, nxt

    # 3. The parts jgabc lists: a labelled section of the kind, else its words
    # in its gap, else the one chant start its gap allows.
    for part in expected:
        if part.part == "introit":
            continue
        free = [f for f in found if f.part is None and f.placed == "label" and f.kind == part.part
                and part.variant != "paschal"]
        if anchored and free:
            free[0].part = part
            continue
        prev, nxt = neighbours(part)
        low = prev.index + MIN_SYSTEMS.get(prev.kind, 1) if prev else 0
        # Nothing unlabelled starts inside the Introit's Psalm verse: Easter's
        # "Resurrexi" sings "alleluia" on every line, and OCR too noisy for its
        # words to be recognised hides it from the check below.
        low = max(low, introit_end + 1)
        high = nxt.index if nxt else n
        taken = starts()
        earlier = [f for f in found if f.part is not None and f.part.text]

        def fits(i: int, part: ExpectedPart = part, prev: _Found | None = prev, taken: set[int] = taken,
                 earlier: list[_Found] = earlier) -> bool:
            if i in taken or text_score(i, part) < STRONG_TEXT:
                return False
            # Not where an earlier section's own words run on (the Introit's
            # verse), nor where the part before's opening fits as well: the
            # Requiem repeats its Introit after the verse, and its Gradual opens
            # with the same "Requiem aeternam".
            if any(f.index < i and not any(f.index < g < i for g in taken)          # still within that section
                   and _inside(systems[i].text, f.part.text) for f in earlier):    # type: ignore[union-attr]
                return False
            last = prev.part if prev is not None else None
            return not (last is not None and last.opening and part.opening and "alleluia" not in (part.part, last.part)
                        and movement_score_for((last.opening,), systems[i].text) >= text_score(i, part))

        hit = next((i for i in range(low, high) if fits(i)), None)
        if hit is not None:
            found.append(_Found(hit, part.part, part.variant, "text", round(text_score(hit, part), 3), part))
            continue
        if part.optional or not anchored:
            continue
        candidates = [i for i in range(low, high) if i not in taken and systems[i].mode_marker]
        best = max(range(low, high), key=lambda i: (text_score(i, part), -i)) if low < high else None
        if len(candidates) == 1:
            after = _NAMES.get(prev.kind, prev.kind) if prev else "start of the piece"
            before = _NAMES.get(nxt.kind, nxt.kind) if nxt else "end of the piece"
            found.append(_Found(candidates[0], part.part, part.variant, "inferred", 0.0, part,
                                why=f"the one chant start between the {after} and the {before}"))
            continue
        result.problems.append(PartProblem("part_missing", part.part, part.variant, part.opening, best,
                                           text_score(best, part) if best is not None else 0.0,
                                           tuple(systems[i].ref for i in candidates)))

    # 4. A chant for each section jgabc gives none, by its opening words.
    info = {c.id: c for c in chants or []}
    for f in found:
        f.chant = f.part.gregobase_id if f.part else None
        if f.chant is None and chants:
            f.chant, problem = _pair(f, systems[f.index], chants)
            if problem:
                result.problems.append(problem)
        if f.chant is not None and f.chant in info:
            f.title = incipit_title(info[f.chant].incipit)

    # 5. Numbered where a kind repeats, in printed order; labelled as printed.
    found.sort(key=lambda f: f.index)
    counts: dict[tuple[str, str], int] = {}
    for f in found:
        counts[(f.kind, f.variant)] = counts.get((f.kind, f.variant), 0) + 1
    seen: dict[tuple[str, str], int] = {}
    for f in found:
        key = (f.kind, f.variant)
        variant = f.variant
        if counts[key] > 1 and f.variant != "paschal":
            seen[key] = seen.get(key, 0) + 1
            variant = str(seen[key])
        result.parts.append(PartBoundary(f.kind, variant, f.index, systems[f.index].ref, f.chant, f.placed, f.score,
                                         _printed_label(f, systems[f.index], heading), f.title, f.why))
    return result


def incipit_title(incipit: str) -> str | None:
    """A chant's opening words for a heading, without GregoBase's notes:
    "Anima nostra (Off.)" is "Anima nostra"; "Confitebor tibi... Deus" is
    "Confitebor tibi"."""
    text = re.sub(r"\s*\([^)]*\)\s*$", "", incipit.split("...")[0].split(" Ps. ")[0]).strip(" .,;:")
    return text or None


def _printed_label(f: _Found, system: PartSystem, heading: Callable[[int], str | None] | None) -> str | None:
    """A section's label as the book prints it: "2. Grad. II" from the margin;
    for a section outside the Mass, the heading printed above it, else its mark."""
    if f.placed != "label":
        return None
    if f.kind == "other":
        above = heading(f.index) if heading else None
        return above or f.mark
    mode = margin_mode(system.mode_marker or "") if system.mode_marker and "." not in system.mode_marker else None
    mode = mode or system.mode_marker
    return " ".join(x for x in (f"{f.number}." if f.number else "", ABBREVIATIONS.get(f.kind, ""), mode or "") if x) or None


# The margin OCR drops or adds a thin stroke of a numeral ("2.Gra I." is II;
# "Hymn. Vil." is VII or VIII): modes a stroke apart count as agreeing.
_ONE_STROKE = {frozenset((1, 2)), frozenset((2, 3)), frozenset((6, 7)), frozenset((7, 8))}


def _modes_agree(printed: int | None, chant: str | None) -> bool:
    if printed is None or not chant or not chant.isdigit():
        return True
    return int(chant) == printed or frozenset((int(chant), printed)) in _ONE_STROKE


def _pair(f: _Found, system: PartSystem, chants: list[ChantInfo]) -> tuple[int | None, PartProblem | None]:
    """The GregoBase chant a section's opening words name, in its printed mode:
    (chant id, None) when verified; (None, the unverified pairing) when the words
    fit less closely or the mode differs; (None, None) when nothing fits."""
    offices = OFFICES.get(f.kind, ())
    scored = sorted(((movement_score_for((c.opening,), system.text), c) for c in chants
                     if c.office in offices and len(c.opening) >= 12),
                    key=lambda sc: (-sc[0], not sc[1].notation, sc[1].id))
    if not scored or scored[0][0] < STRONG_TEXT:
        return None, None
    printed = _ROMAN_VALUES.get(system.mode_marker or "")
    best_score = scored[0][0]
    same_words = [c for s, c in scored if s >= best_score - 0.02]
    in_mode = [c for c in same_words if _modes_agree(printed, c.mode)]
    if best_score >= VERIFIED_TEXT and in_mode:
        return in_mode[0].id, None
    chosen = (in_mode or same_words)[0]
    why = "mode" if not in_mode else "words"
    return None, PartProblem("unverified_pairing", f.kind, why, chosen.opening, f.index, best_score,
                             (system.ref,), chosen.id)


# --------------------------------------------------------- expected parts ---

_PART_OF = {"in": "introit", "gr": "gradual", "al": "alleluia", "tr": "tract", "se": "sequence",
            "sq": "sequence", "of": "offertory", "co": "communion"}
_FIELDS = (("inID", "introit"), ("grID", "gradual"), ("alID", "alleluia"), ("trID", "tract"),
           ("seqID", "sequence"), ("ofID", "offertory"), ("coID", "communion"))


def chant_text(gabc: str | None) -> str:
    """The sung words of a GregoBase chant, neumes and markup removed."""
    if not gabc:
        return ""
    try:
        items = json.loads(gabc)
    except (json.JSONDecodeError, TypeError):
        items = gabc
    # GregoBase stores a chant's GABC as a list of [kind, text] items, or (older
    # entries: Benedictus es, the Ember Saturday's hymn) as one quoted string.
    body = items if isinstance(items, str) else next(
        (str(x[1]) for x in items if isinstance(x, list) and x and x[0] == "gabc"), "") if isinstance(items, list) else ""
    body = re.sub(r"\([^)]*\)", "", body)
    body = re.sub(r"<[^>]+>|[{}*]|\[[^\]]*\]", "", body)
    return " ".join(body.split())


def _expected(field_name: str, default_part: str, gid: object,
              chants: dict[int, tuple[str | None, str]], variant: str = "",
              optional: bool = False) -> ExpectedPart | None:
    if not isinstance(gid, int):
        return None
    office, text = chants.get(gid, (None, ""))
    part = _PART_OF.get(office or "", default_part)
    whole = condense(text)
    return ExpectedPart(part, variant, whole[:OPENING_CHARS] or None, gid, optional, whole)


def expected_parts(key: str, proprium: dict[str, dict[str, object]],
                   chants: dict[int, tuple[str | None, str]]) -> list[ExpectedPart]:
    """The parts of jgabc's Proper `key`, in printed order, with the seasonal
    forms NOH prints beside a feast as optional parts.

    `chants` maps a GregoBase id to (office part, sung text)."""
    from pipeline.jgabc import resolve

    entry = resolve(proprium, key)
    if not entry:
        return []
    found: list[ExpectedPart] = []
    for field_name, part in _FIELDS:
        e = _expected(field_name, part, entry.get(field_name), chants)
        if e is not None:
            found.append(e)
    seasonal = [
        _expected("alPaschID", "alleluia", entry.get("alPaschID"), chants, "paschal", True),
        _expected("trSeptID", "tract", entry.get("trSeptID"), chants, "", True),
    ]
    quad = resolve(proprium, f"{key}Quad") or {}
    pasch = resolve(proprium, f"{key}Pasch") or {}
    seasonal.append(_expected("trID", "tract", quad.get("trID"), chants, "", True))
    seasonal.append(_expected("alID", "alleluia", pasch.get("alID"), chants, "paschal", True))
    for e in seasonal:
        if e is not None and not any((f.part, f.variant) == (e.part, e.variant) for f in found):
            found.append(e)
    # NOH prints a Tract and a Paschal Alleluia with most feasts; offer them
    # even where jgabc has no chant for them (found by label and word only).
    for part, variant in (("tract", ""), ("alleluia", "paschal")):
        if not any((f.part, f.variant) == (part, variant) for f in found):
            found.append(ExpectedPart(part, variant, None, None, True))
    # A part jgabc lists twice keeps both, numbered in print order.
    counts: dict[str, int] = {}
    for e in found:
        counts[_key(e)] = counts.get(_key(e), 0) + 1
    numbered: list[ExpectedPart] = []
    seen: dict[str, int] = {}
    for e in found:
        k = _key(e)
        if counts[k] > 1 and e.variant != "paschal":
            seen[k] = seen.get(k, 0) + 1
            e = ExpectedPart(e.part, str(seen[k]), e.opening, e.gregobase_id, e.optional, e.text)
        numbered.append(e)
    # Stable: Eastertide's two Alleluias keep jgabc's order.
    return sorted(numbered, key=lambda e: ORDER.index(_key(e) if _key(e) in ORDER else e.part))


# --------------------------------------------------------- borrowed parts ---

_PART_WORDS = {"introitus": "introit", "graduale": "gradual", "alleluia": "alleluia",
               "tractus": "tract", "sequentia": "sequence", "offertorium": "offertory",
               "communio": "communion"}
_PART_SPLIT = re.compile(r"\b(Introitus|Graduale|Tractus|Sequentia|Offertorium|Communio)\b\.?")


def borrowed_parts(reference: str, volume: str) -> list[tuple[str, str, int]]:
    """(part, volume, printed page) for each part a piece prints by reference:
    "Introitus. Mihi autem, ut supra, p. 4. Graduale. ..., ibid., p. 62."
    A whole-Mass reference ("Missa. Os justi, Pars IV, p. 76") is a rubric's,
    handled by link_rubrics, not here."""
    out: list[tuple[str, str, int]] = []
    pieces = _PART_SPLIT.split(reference or "")
    previous_volume = volume
    for word, chunk in zip(pieces[1::2], pieces[2::2], strict=False):
        part = _PART_WORDS[word.lower()]
        where = parse_reference(chunk, previous_volume if "ibid" in chunk.lower() else volume)
        if where is None:
            continue
        previous_volume = where[0]
        out.append((part, where[0], where[1]))
    return out


def link_one(part: dict[str, object], piece: dict[str, object], pieces: list[dict[str, object]]) -> bool:
    """Resolve one borrowed section to the lending piece's section, in place
    (borrowed_from, borrowed_ref); False, with both None, where none lends it."""
    volume, page = part["borrowed_volume"], int(part["borrowed_page"])  # type: ignore[call-overload]
    lenders = [p for p in pieces if p["volume"] == volume and p.get("systems")
               and p is not piece and not p.get("pagination")   # the body's page
               and p["printed_pages"][0] <= page <= p["printed_pages"][1]]  # type: ignore[index]
    lenders.sort(key=lambda p: p["printed_pages"][0] != page)  # type: ignore[index]
    for lender in lenders:
        own = [q for q in lender.get("sections", []) or []  # type: ignore[union-attr]
               if q.get("kind") == part["kind"] and "ref" in q and q.get("placed") != "order"]
        # The lender's Alleluia serves a borrowed Paschal Alleluia when it
        # is the only one it prints (a votive Mass cited in the rubric).
        own.sort(key=lambda q: q.get("variant", "") != part.get("variant", ""))
        if own:
            part["borrowed_from"], part["borrowed_ref"] = lender["slug"], own[0]["ref"]
            return True
    part["borrowed_from"], part["borrowed_ref"] = None, None
    return False


def link_parts(catalog: dict[str, object]) -> list[dict[str, object]]:
    """Resolve each borrowed section to the lending piece's section, after every
    volume is merged (a Proper in NOH3 borrows from NOH4's Commons). Returns
    the ones that could not be resolved, for the review queue."""
    pieces: list[dict[str, object]] = list(catalog["pieces"])  # type: ignore[arg-type]
    unresolved: list[dict[str, object]] = []
    for piece in pieces:
        for part in piece.get("sections", []) or []:   # type: ignore[union-attr]
            if "borrowed_page" in part and not link_one(part, piece, pieces):
                unresolved.append({"kind": "part_borrowed_unresolved", "piece": piece["slug"],
                                   "part": part["kind"], "volume": part["borrowed_volume"],
                                   "printed_page": int(part["borrowed_page"])})
    return unresolved


__all__ = [
    "ORDER",
    "ChantInfo",
    "ExpectedPart",
    "PartBoundary",
    "PartProblem",
    "PartSystem",
    "Segmentation",
    "borrowed_parts",
    "chant_text",
    "expected_parts",
    "label_of",
    "link_one",
    "link_parts",
    "read_label",
    "segment_proper",
]
