"""Matching words: a heading scored against an index entry, a title snapped to
the 1962 calendar, a feast date read from a NOH3 title (steps 2 and 3)."""

from __future__ import annotations

import itertools
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher

# --------------------------------------------------------------- headings ---

STOPWORDS = frozenset({"in", "et", "de", "ad", "pro", "the", "of", "a", "cum", "s", "ss"})
_ROMAN = re.compile(r"^(?=[ivxlc]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")


_LIGATURES = str.maketrans({"æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe"})


def fold(text: str) -> str:
    """Lower case, accents off, ligatures spelled out: "Quadragesimæ" is one word,
    not "quadragesim" and a stray "æ"."""
    decomposed = unicodedata.normalize("NFKD", text.translate(_LIGATURES))
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


# Headings spell weekdays out ("FERIA TERTIA") where the index numbers them
# ("Feria III"): both become the numeral.
ORDINALS = {"secunda": "ii", "tertia": "iii", "quarta": "iv", "quinta": "v", "sexta": "vi",
            "prima": "i"}
_NUMERAL_OCR = str.maketrans({"l": "i", "1": "i", "|": "i", "!": "i", "/": "i"})


def _repair_numeral(word: str) -> str:
    """"Ill" -> "iii", "Vil" -> "vii": OCR reads the I of a Roman numeral as l or 1."""
    if len(word) <= 5 and re.fullmatch(r"[ivxl1|!/]+", word) and re.search(r"[ivx]", word):
        repaired = word.translate(_NUMERAL_OCR)
        if _ROMAN.match(repaired):
            return repaired
    return word


def tokens(text: str) -> set[str]:
    """Comparable words. Roman numerals are KEPT: for the ad libitum Kyries the
    numeral is the only part of the heading OCR survives ("IV.", "Vil.")."""
    words = [_repair_numeral(w) for w in re.findall(r"[a-z1|!/]+", fold(text))]
    words = [ORDINALS.get(w, w) for w in
             (re.sub(r"[1|!/]", "", w) if not _ROMAN.match(w) else w for w in words)]
    return {w for w in words if w not in STOPWORDS and (len(w) > 1 or _ROMAN.match(w))}


def _fuzzy_in(word: str, pool: set[str]) -> bool:
    if word in pool:
        return True
    if _ROMAN.match(word) or len(word) < 4:
        return False             # numerals and short words must match exactly
    # A clipped word ("Cred" for "Credo") matches as a prefix; only a longer word
    # is allowed a fuzzy match, or four letters would match half the Latin language.
    return any(other.startswith(word) or word.startswith(other) and len(other) >= 4
               or len(word) >= 5 and SequenceMatcher(None, word, other).ratio() >= 0.75
               for other in pool)


def label_of(text: str) -> str | None:
    """The Roman numeral that numbers an entry or a heading, if it leads: "V. In
    Festis Duplicibus", "Kyrie IV.". A numeral further in ("In Festis B. Mariae
    V.") is part of a name, not a label."""
    words = [ORDINALS.get(w, _repair_numeral(w)) for w in re.findall(r"[a-z1|!/]+", fold(text))][:2]
    return next((w for w in words if _ROMAN.match(w)), None)


def heading_score(entry_text: str, heading_text: str) -> float:
    """How well a page's headings announce an entry, 0-1.

    The fraction of the entry's words found in the headings -- fuzzily, so
    "Solemnlbull" finds "Solemnibus" -- raised to at least the verified line when
    a heading line opens with the entry's own label AND shares a word with it.
    An index title is often half-illegible; the label and one word survive."""
    wanted = tokens(entry_text)
    pool = tokens(heading_text)
    if not wanted:
        return 0.0
    found = {w for w in wanted if _fuzzy_in(w, pool)}
    if not found - _numerals(found):
        return 0.0               # a lone "II" is everywhere: numerals need a word beside them
    coverage = round(len(found) / len(wanted), 3)
    label = label_of(entry_text)
    first = next(iter(re.findall(r"[a-z]+", fold(entry_text))), "")
    if label is not None and first and not _ROMAN.match(first):
        for line in heading_text.splitlines():
            words = re.findall(r"[a-z]+", fold(line))
            other = label_of(line)
            if words and words[0] == first and other is not None and other != label:
                # "Feria II post dom. IV" on the page headed "FERIA III POST DOM.
                # IV": every word but the one that matters. The page names a
                # different entry; it cannot verify this one.
                coverage = min(coverage, VERIFIED_AT - 0.01)
                break
    if label is not None:
        for line in heading_text.splitlines():
            words = tokens(line) - {label}
            if label_of(line) == label and any(_fuzzy_in(w, words) for w in wanted - {label}):
                return max(coverage, LABEL_MATCH)
    return coverage


VERIFIED_AT = 0.34
LABEL_MATCH = 0.6


@dataclass(frozen=True)
class Resolution:
    page: int | None
    status: str                     # "verified" | "unverified" | "unresolved"
    score: float
    candidates: tuple[int, ...]


def resolve(candidates: list[int], score_page: Callable[[int], float],
            floor: int = 0) -> Resolution:
    """Choose a page from OCR candidates by heading evidence.

    Verified only when the chosen page's headings match AND beat both neighbours:
    a heading continuing onto the next page must not pass for a new piece.
    """
    viable = [c for c in candidates if c >= floor]
    if not viable:
        return Resolution(None, "unresolved", 0.0, tuple(candidates))
    scored = sorted(((score_page(c), c) for c in viable), key=lambda s: (-s[0], s[1]))
    best_score, best = scored[0]
    beats_neighbours = best_score > max(score_page(best - 1), score_page(best + 1))
    if best_score >= VERIFIED_AT and beats_neighbours:
        return Resolution(best, "verified", best_score, tuple(candidates))
    if len(viable) == 1:
        return Resolution(best, "unverified", best_score, tuple(candidates))
    return Resolution(best if best_score > 0 else None,
                      "unverified" if best_score > 0 else "unresolved",
                      best_score, tuple(candidates))


# ------------------------------------------------------ calendar snapping ---

@dataclass(frozen=True)
class Snap:
    key: str | None
    title_la: str | None
    score: float


def _numerals(words: set[str]) -> set[str]:
    return {w for w in words if _ROMAN.match(w)}


COVERAGE_WEIGHT = 0.9


def _calendar_tokens(text: str) -> set[str]:
    """Tokens for calendar matching: "Feria quinta" and "Feria V" say the same.

    The index's OCR sets the ligature æ as a colon or "lll" ("Papa:",
    "Quadragesimlll"), and abbreviates Our Lord's title (D.N.J.C.)."""
    text = re.sub(r"\bD\.\s?N\.\s?[IJ]\.\s?C\.", "Domini Nostri Jesu Christi", text)
    text = re.sub(r"([A-Za-z])[:;](?=\s|,|$)", r"\1ae", text)
    text = re.sub(r"lll\b", "ae", text)
    return {ORDINALS.get(w, w) for w in tokens(text)}


def title_similarity(a: str, b: str, strict_numerals: bool = True) -> float:
    """Word-level similarity that tolerates OCR and spelling ("Quatuor"/"Quattuor",
    "Penteeostes") but not a different number: Dominica II is never Dominica III.

    Each word contributes how closely it matches, not merely whether it clears the
    bar -- otherwise "Sexagesima" matches "Septuagesima" as well as itself."""
    left, right = _calendar_tokens(a), _calendar_tokens(b)
    if not left or not right:
        return 0.0
    # Every number the entry names, the title must name too -- except in a
    # saint's name, where Missalemeum drops the papal number ("S. Silvestri").
    numerals_agree = _numerals(left) <= _numerals(right) or not strict_numerals
    if strict_numerals and not numerals_agree:
        return 0.0
    words_l, words_r = sorted(left - _numerals(left)), sorted(right - _numerals(right))
    matched = 0.0
    unused = list(words_r)
    for word in words_l:
        best = max(unused, key=lambda w: SequenceMatcher(None, word, w).ratio(), default=None)
        ratio = SequenceMatcher(None, word, best).ratio() if best is not None else 0.0
        if best is not None and ratio >= 0.75:
            matched += ratio
            unused.remove(best)
    total = len(words_l) + len(words_r)
    symmetric = (2 * matched / total if total else 1.0) if _numerals(left) <= _numerals(right) else 0.0
    # Missalemeum abbreviates ("S. Thomae M.", "S. Silvestri"): a calendar title
    # wholly contained in the entry is a strong match, however much longer the
    # entry is. Discounted so a full match still wins a tie.
    covered = 0.0
    for word in words_r:
        ratios = [1.0 if len(word) >= 4 and w.startswith(word) else
                  SequenceMatcher(None, word, w).ratio() for w in words_l]
        best = max(ratios, default=0.0)
        covered += best if best >= 0.75 else 0.0
    numbers_fit = _numerals(right) <= _numerals(left) and (
        _numerals(left) <= _numerals(right) or not strict_numerals)
    coverage = covered / len(words_r) if words_r and numbers_fit else 0.0
    return round(max(symmetric, COVERAGE_WEIGHT * coverage), 3)


TEMPORA_SEASONS = ("Adv", "Nat", "Epi", "Quadp", "Quad", "Pasc", "Pent")


def tempora_rank(key: str) -> tuple[int, int, int]:
    """Liturgical order of a Temporale key: tempora:Pasc7-3 before tempora:Pent02-5,
    and the September Ember days (tempora:093-3) after the Sundays after Pentecost."""
    m = re.match(r"(?:tempora:)?([A-Za-z]*)(\d+)-(\d+)", key)
    if not m:
        return (99, 0, 0)
    season, week, day = m.groups()
    order = TEMPORA_SEASONS.index(season) if season in TEMPORA_SEASONS else len(TEMPORA_SEASONS)
    return (order, int(week), int(day))


def snap_title(ocr_title: str, vocabulary: dict[str, dict[str, object]],
               minimum: float = 0.6, after: str | None = None,
               strict_numerals: bool = True) -> Snap:
    """Match a noisy index title to the 1962 calendar's Latin titles. Ties go to
    the first key at or after `after` in liturgical order, since an index runs
    through the year: the Sacred Heart after Corpus Christi, not the Holy Name."""
    floor = tempora_rank(after) if after else (0, 0, 0)
    best: tuple[float, str, str] | None = None
    for key, entry in sorted(vocabulary.items(), key=lambda kv: (tempora_rank(kv[0]) < floor,
                                                                tempora_rank(kv[0]))):
        title = str(entry.get("title_la", ""))
        score = title_similarity(ocr_title, title, strict_numerals)
        if best is None or score > best[0]:
            best = (score, key, title)
    if best is None or best[0] < minimum:
        return Snap(None, None, best[0] if best else 0.0)
    return Snap(best[1], best[2], best[0])


# ---------------------------------------------------------- dates (NOH3) ---

MONTHS_GENITIVE = {
    "januarii": 1, "februarii": 2, "martii": 3, "aprilis": 4, "maii": 5, "junii": 6,
    "julii": 7, "augusti": 8, "septembris": 9, "octobris": 10, "novembris": 11, "decembris": 12,
}


# How the index's OCR damages a day number: "2;;" is 25, "]7" is 17, "2<J" 29.
DAY_REPAIR = ((";;", "5"), (";)", "5"), ("<J", "9"), ("]", "1"), ("l", "1"), ("I", "1"), ("i", "1"),
              ("O", "0"), ("o", "0"), ("S", "5"))


def _day(token: str) -> int | None:
    for bad, good in DAY_REPAIR:
        token = token.replace(bad, good)
    return int(token) if token.isdigit() and 1 <= int(token) <= 31 else None


def feast_date(title: str) -> tuple[int, int] | None:
    """The date the Proper of Saints index prints with each feast ("16 Septembris").

    OCR damages month names ("Feb1'uarli", "!'Iovembris"), so each is matched by
    similarity rather than spelling; the day is repaired, then must be 1-31."""
    words = title.split()
    for day_word, month_word in itertools.pairwise(words):
        day = _day(day_word.strip(".,"))
        if day is None or not re.search(r"[0-9]", day_word.replace("]", "1").replace(";;", "5")):
            continue
        cleaned = fold(re.sub(r"[^A-Za-z1]", "", month_word)).replace("1", "i")
        if len(cleaned) < 4:
            continue
        best = max(MONTHS_GENITIVE, key=lambda m: SequenceMatcher(None, cleaned, m).ratio())
        if SequenceMatcher(None, cleaned, best).ratio() >= 0.7:
            return MONTHS_GENITIVE[best], day
    return None


