"""Divide a Proper into its parts: Introit, Gradual, Alleluia, Tract, Sequence,
Offertory, Communion.

Three signals, none enough alone (measured on NOH3, 2026-09-26):

- the label printed in the left margin ("Intr.", "Grad.", "Tract.", "Offert.",
  "Comm."), read by Tesseract from each system's slice (pipeline.margins); the
  PDF's own text layer misses most of them;
- the chant's opening words, from GregoBase (jgabc says which chant each part
  is), fuzzy-matched against the words under the system;
- the mode number printed beside the first system of every chant.

The parts come in a fixed order, so, like the Kyriale's movements
(pipeline.movements.segment_mass), a Proper is segmented as a whole: each part
at the first system after the part before that a label or a strong text match
names, never past a later part's label. A required part nothing names is
placed at the next chant start and reported (`part_by_order`); the site does
not show those (a mode number alone found the right system 5 times in 12 in a
hand check, 2026-09-26), they wait in the review queue. If nothing
finds the Introit at all, the scan is not this Proper -- a blessing printed
before the Mass, or a 1942 text 1962 replaced -- and nothing is placed
(`part_mismatch`): wrong jump links are worse than none.
"""

from __future__ import annotations

import json
import re
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
    ("gradual", re.compile(r"\b[GgSs]r+ad\b|\bGraduale\b", re.IGNORECASE)),
    ("tract", re.compile(r"\bTra[ce]t\b|\bTractus\b", re.IGNORECASE)),
    ("sequence", re.compile(r"\bSequ", re.IGNORECASE)),
    ("offertory", re.compile(r"\bOf+t?f?e(?:rt)?\b|\bOf+t?fert|\bOffertor", re.IGNORECASE)),
    ("communion", re.compile(r"\bCo[mnr]{1,2}[in]{0,2}n?\s*\.|\bComm|\bCora\b|\bCommunio\b", re.IGNORECASE)),
)
# Under the staff the words are Latin, and "cor", "con", "offero" are words:
# there a label counts only in full, with its full stop.
TEXT_LABELS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("introit", re.compile(r"\bIntr\.")), ("gradual", re.compile(r"\bGrad\.")),
    ("tract", re.compile(r"\bTract\.")), ("sequence", re.compile(r"\bSequentia\b")),
    ("offertory", re.compile(r"\bOffert\.")), ("communion", re.compile(r"\bComm\.")),
)
_REFERENCE = re.compile(r"ut\s+supra|ut\s+infra|ibid|Pars\s|p\.\s*\d", re.IGNORECASE)


@dataclass(frozen=True)
class PartSystem:
    ref: str
    text: str                        # words under the staff, from the PDF text layer
    label: str | None = None         # part named by the margin label, if any
    mode_marker: str | None = None   # mode number beside the system, if any


@dataclass(frozen=True)
class ExpectedPart:
    part: str                        # introit | gradual | alleluia | tract | sequence | offertory | communion
    variant: str = ""                # "" | paschal | 1, 2 ... when a part repeats
    opening: str | None = None       # condensed opening words, from GregoBase
    gregobase_id: int | None = None
    optional: bool = False           # printed on some pages only (Tract, Paschal Alleluia)


@dataclass(frozen=True)
class PartBoundary:
    part: str
    variant: str
    index: int
    ref: str
    gregobase_id: int | None
    placed: str                      # label | text | order
    score: float


@dataclass(frozen=True)
class PartProblem:
    kind: str                        # part_by_order | part_missing | part_mismatch
    part: str
    variant: str
    expected_opening: str | None
    best_index: int | None
    best_score: float


@dataclass
class Segmentation:
    parts: list[PartBoundary] = field(default_factory=list)
    problems: list[PartProblem] = field(default_factory=list)


def label_of(margin: str, patterns: tuple[tuple[str, re.Pattern[str]], ...] = LABELS) -> str | None:
    """The part a margin label names, or None. A label followed by "ut supra",
    "ibid." or a page names a part printed elsewhere, not one that starts here."""
    for part, pattern in patterns:
        m = pattern.search(margin)
        if m and not _REFERENCE.search(margin[m.end():m.end() + 80]):
            return part
    return None


def _text_label(text: str) -> str | None:
    """A label in the words under the staff (the text layer catches some)."""
    return label_of(text[:40], TEXT_LABELS)


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


def _contains_alleluia(text: str) -> bool:
    """OCR reads the syllables' l as i or I ("AL Ie III * al _ Ie lu la"), so
    both sides are compared with every i taken as l."""
    condensed = condense(text).replace("i", "l")
    target = "allelula"
    return any(SequenceMatcher(None, condensed[o:o + 8], target).ratio() >= 0.8
               for o in range(max(1, len(condensed) - 7)))


def _starts_chant(system: PartSystem) -> bool:
    return system.label is not None or system.mode_marker is not None


def _key(p: ExpectedPart) -> str:
    return f"{p.part}/{p.variant}" if p.variant == "paschal" else p.part


def segment_proper(systems: list[PartSystem], expected: list[ExpectedPart]) -> Segmentation:
    result = Segmentation()
    if not systems or not expected:
        return result
    n = len(systems)
    labels = [s.label or _text_label(s.text) for s in systems]

    def text_score(i: int, part: ExpectedPart) -> float:
        if part.part == "alleluia" and _contains_alleluia(systems[i].text):
            # The Alleluia follows the Gradual's verse, often mid-system and
            # with no label: its own first word is the one reliable sign.
            return 0.8
        if not part.opening:
            return 0.0
        return movement_score_for((part.opening,), systems[i].text)

    low, label_low, previous = 0, 0, None
    for k, part in enumerate(expected):
        if previous is not None:
            # A printed label beats the minimum length: it may start on the
            # very next system. Text and order placement keep the minimum.
            label_low = previous.index + 1
            low = previous.index + MIN_SYSTEMS[previous.part]
        # A later required part's label bounds the search -- except for the
        # Introit: a scan can open on the tail of the Mass before (its "Comm."),
        # and the Introit is sought through the whole piece.
        later = {e.part for e in expected[k + 1:] if not e.optional} - {part.part}
        opening = k == 0 and part.part == "introit"
        high = n if opening else next((i for i in range(label_low, n) if labels[i] in later), n)
        found: tuple[int, str, float] | None = None
        for i in range(label_low, high):
            if labels[i] == part.part:
                found = (i, "label", 1.0)
                break
            if i < low:
                continue
            score = text_score(i, part)
            if score >= STRONG_TEXT:
                found = (i, "text", score)
                break

        if found is None and k == 0 and part.part == "introit":
            best = max(range(n), key=lambda i: text_score(i, part), default=None)
            result.problems.append(PartProblem("part_mismatch", part.part, part.variant, part.opening,
                                               best, text_score(best, part) if best is not None else 0.0))
            return Segmentation(parts=[], problems=result.problems)
        if found is None:
            if part.optional:
                continue
            if low >= n:
                result.problems.append(PartProblem("part_missing", part.part, part.variant,
                                                   part.opening, None, 0.0))
                continue
            if low >= high:
                result.problems.append(PartProblem("part_missing", part.part, part.variant,
                                                   part.opening, None, 0.0))
                continue
            window = range(low, high)
            best = max(window, key=lambda i: (text_score(i, part), -i))
            start = next((i for i in window if _starts_chant(systems[i])), None)
            if start is None:
                # No chant visibly starts here: not printed in this scan (or
                # printed by a reference the page text did not yield).
                result.problems.append(PartProblem("part_missing", part.part, part.variant,
                                                   part.opening, best, text_score(best, part)))
                continue
            found = (start, "order", text_score(start, part))
            result.problems.append(PartProblem("part_by_order", part.part, part.variant, part.opening,
                                               best, text_score(best, part)))
        index, placed, score = found
        boundary = PartBoundary(part.part, part.variant, index, systems[index].ref, part.gregobase_id,
                                placed, round(score, 3))
        result.parts.append(boundary)
        previous = boundary
    return result


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
        body = next((str(x[1]) for x in items if isinstance(x, list) and x and x[0] == "gabc"), "")
    except (json.JSONDecodeError, TypeError):
        body = gabc
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
    opening = condense(text)[:OPENING_CHARS] or None
    return ExpectedPart(part, variant, opening, gid, optional)


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
            e = ExpectedPart(e.part, str(seen[k]), e.opening, e.gregobase_id, e.optional)
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


def link_parts(catalog: dict[str, object]) -> list[dict[str, object]]:
    """Resolve each borrowed part to the lending piece's part, after every
    volume is merged (a Proper in NOH3 borrows from NOH4's Commons). Returns
    the ones that could not be resolved, for the review queue."""
    pieces: list[dict[str, object]] = list(catalog["pieces"])  # type: ignore[arg-type]
    unresolved: list[dict[str, object]] = []
    for piece in pieces:
        for part in piece.get("parts", []) or []:   # type: ignore[union-attr]
            if "borrowed_page" not in part:
                continue
            volume, page = part["borrowed_volume"], int(part["borrowed_page"])
            lenders = [p for p in pieces if p["volume"] == volume and p.get("systems")
                       and p is not piece
                       and p["printed_pages"][0] <= page <= p["printed_pages"][1]]  # type: ignore[index]
            lenders.sort(key=lambda p: p["printed_pages"][0] != page)  # type: ignore[index]
            target = None
            for lender in lenders:
                own = [q for q in lender.get("parts", []) or []  # type: ignore[union-attr]
                       if q.get("part") == part["part"] and "ref" in q and q.get("placed") != "order"]
                # The lender's Alleluia serves a borrowed Paschal Alleluia when it
                # is the only one it prints (a votive Mass cited in the rubric).
                own.sort(key=lambda q: q.get("variant", "") != part.get("variant", ""))
                if own:
                    target = (lender, own[0])
                    break
            if target is None:
                part["borrowed_from"], part["borrowed_ref"] = None, None
                unresolved.append({"kind": "part_borrowed_unresolved", "piece": piece["slug"],
                                   "part": part["part"], "volume": volume, "printed_page": page})
                continue
            part["borrowed_from"] = target[0]["slug"]
            part["borrowed_ref"] = target[1]["ref"]
    return unresolved


__all__ = ["ORDER", "ExpectedPart", "PartBoundary", "PartProblem", "PartSystem", "Segmentation",
           "borrowed_parts", "chant_text", "expected_parts", "label_of", "link_parts",
           "segment_proper"]
