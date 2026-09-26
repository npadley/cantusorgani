"""Catalogue a volume from its printed index — by script, with no AI.

Three steps, each checked by the next:

1. **Read the index as a table.** Page numbers are right-aligned to shared
   column edges; ordinals inside titles ("Solemnibus 2") share no edge and, unlike
   a page-number column, do not increase down the page. Numbers come from two
   sources: the PDF's embedded text layer, which has holes (it never captured
   Masses V-X in NOH5), and Tesseract on each number column of the rendered page.

2. **Resolve each OCR'd number.** Damaged digits ("S8", "il0") expand to candidate
   pages. The folio check cannot choose between them -- every body page carries
   its own folio, so a wrong 53 passes as readily as the true 58. Instead each
   candidate page is scored on its HEADINGS: the text printed outside the music
   systems, where a new piece announces itself ("VIII. (Firmator sancte)").

3. **Snap titles to the calendar.** For Proper volumes, the OCR'd title is matched
   to Missalemeum's Latin titles, which read like NOH's own index, to give each
   entry its 1962 calendar key.

Output is a PROPOSAL (data/index-<vol>.proposed.yml) with a status on every
entry. It never overwrites a reviewed index: a person promotes it.
"""

from __future__ import annotations

import itertools
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from difflib import SequenceMatcher
from pathlib import Path

from pipeline.offset import PageMap

# ------------------------------------------------------------------ digits ---

# OCR confusions observed on NOH index pages: 98->"S8", 106->":06", 110->"il0",
# 114->"j14", 11->"II", 23->"2.3", 46->"16". "S" is ambiguous between 5 and 9.
REPAIR: dict[str, str] = {
    "S": "59", "s": "59", ":": "1", "i": "1", "l": "1", "I": "1", "j": "1", "|": "1",
    "!": "1", "O": "0", "o": "0", "B": "8", "Z": "2", "g": "9", "W": "0", "~": "4",
    ";": "", "\\": "", "'": "", ".": "", ",": "",
}
NUMBER_TOKEN = re.compile(r"^[0-9SsIil:j|!OoBZgW\\;'.,~]{1,5}$")
RANGE_SPLIT = re.compile(r"\s*[-·–]\s*")


def page_candidates(token: str, lowest: int = 1, highest: int = 999) -> list[int]:
    """Every page a damaged OCR token could be, within bounds, smallest first."""
    first = RANGE_SPLIT.split(token.strip().strip("-·–"))[0]
    if len(first) > 3 and first.isdigit():
        first = first[:3]            # "1141": a page number with the leader dot fused on
    options: list[tuple[str, ...]] = []
    for ch in first:
        if ch.isdigit():
            options.append((ch,))
        else:
            repaired = REPAIR.get(ch)
            if repaired is None:
                return []
            options.append(tuple(repaired) or ("",))
    found: set[int] = set()
    for combo in itertools.product(*options):
        text = "".join(combo)
        if text.isdigit() and 1 <= len(text) <= 3 and lowest <= int(text) <= highest:
            found.add(int(text))
    return sorted(found)


# ------------------------------------------------------------------- table ---

@dataclass(frozen=True)
class Word:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    source: str = "embedded"


@dataclass
class Column:
    right: float
    members: list[Word] = field(default_factory=list)


@dataclass(frozen=True)
class Row:
    y: float
    column: int
    title: str
    token: str
    source: str
    section: str = ""


def is_number_like(word: Word) -> bool:
    return bool(NUMBER_TOKEN.match(word.text)) and any(c.isdigit() or c in REPAIR for c in word.text)


def increasing_fraction(words: list[Word]) -> float:
    """How often a column's values increase top to bottom. Page-number columns do;
    ordinals restarting in each section ("Duplicibus 1, 2, 3, 4, 5") do not."""
    values = [min(page_candidates(w.text) or [0]) for w in sorted(words, key=lambda w: w.y0)]
    steps = list(itertools.pairwise(values))
    return sum(1 for a, b in steps if b > a) / len(steps) if steps else 0.0


INLINE_GAP = 12.0       # points; a column gutter is wider, a word space narrower


def find_number_columns(words: list[Word], min_members: int = 4, tolerance: float = 6.0,
                        min_increasing: float = 0.7, left_limit: float = 150.0) -> list[Column]:
    """Right-aligned columns of page numbers."""
    columns: list[Column] = []
    for word in sorted((w for w in words if is_number_like(w) and w.x0 > left_limit),
                       key=lambda w: w.x1):
        for column in columns:
            if abs(column.right - word.x1) <= tolerance:
                column.members.append(word)
                column.right = sum(m.x1 for m in column.members) / len(column.members)
                break
        else:
            columns.append(Column(right=word.x1, members=[word]))
    # Page numbers are distinct; a column of repeated ordinals ("2", "2", "2")
    # is not, which matters when order cannot be the test (an alphabetical index).
    # And a page number ends its line: "Ad I Missam", "Ad II Missam", "Ad III
    # Missam" stack numerals that read 1, 11, 111 -- increasing, distinct, and
    # each running straight into the next word.
    def runs_on(number: Word) -> bool:
        return any(abs(w.y0 - number.y0) < 5 and 0 <= w.x0 - number.x1 < INLINE_GAP
                   and re.search(r"[A-Za-z]{2}", w.text) for w in words)

    return sorted((c for c in columns if len(c.members) >= min_members
                   and len({m.text for m in c.members}) * 2 > len(c.members)
                   and sum(map(runs_on, c.members)) * 2 <= len(c.members)
                   and increasing_fraction(c.members) >= min_increasing),
                  key=lambda c: c.right)


def merge_second_source(columns: list[Column], extra: list[Word], row_tolerance: float = 5.0,
                        ordered: bool = True) -> None:
    """Add second-source numbers only where the first source has none on that row.

    The embedded layer is kept where it exists; the heading check decides every
    number whichever source proposed it. In a page-ordered index, a reading that
    cannot fit between the embedded numbers above and below it is noise ("-2"
    read off a title's hyphen between 23 and 58) and is dropped."""
    for word in extra:
        target = min(columns, key=lambda c: abs(c.right - word.x1), default=None)
        if target is None or abs(target.right - word.x1) > 24:
            continue
        if any(abs(m.y0 - word.y0) < row_tolerance for m in target.members):
            continue
        if ordered:
            above = [m for m in target.members if m.y0 < word.y0 and page_candidates(m.text)]
            below = [m for m in target.members if m.y0 > word.y0 and page_candidates(m.text)]
            low = min(page_candidates(max(above, key=lambda m: m.y0).text)) if above else 0
            high = max(page_candidates(min(below, key=lambda m: m.y0).text)) if below else 10_000
            # Judge only against consistent neighbours: they are OCR too.
            if low < high and not any(low < c < high for c in page_candidates(word.text)):
                continue
        target.members.append(word)


def column_spans(columns: list[Column], reach: float) -> list[tuple[float, float]]:
    return [(min(m.y0 for m in c.members) - reach, max(m.y0 for m in c.members) + reach)
            for c in columns]


def column_at(x0: float, y: float, columns: list[Column],
              spans: list[tuple[float, float]]) -> int | None:
    """The column whose title region holds a word at (x0, y).

    A column only governs the rows it spans: NOH5's index changes layout halfway
    down, from two columns to one centred column, so the region's left edge is the
    nearest column to the left THAT IS LIVE AT THIS HEIGHT."""
    live = [i for i, (top, bottom) in enumerate(spans) if top <= y <= bottom]
    for index in sorted(live, key=lambda i: columns[i].right):
        left = [columns[j].right for j in live if columns[j].right < columns[index].right]
        left_bound = max(left) + 4 if left else 0.0
        if left_bound < x0 < columns[index].right - 8:
            return index
    return None


def is_heading_word(word: Word) -> bool:
    letters = [c for c in word.text if c.isalpha()]
    return len(letters) >= 3 and sum(c.isupper() for c in letters) / len(letters) >= 0.75


def section_headings(words: list[Word], line_tolerance: float = 5.0) -> list[tuple[float, str]]:
    """Section headings: lines set in capitals ("ORDINARIUM MISSAE"), top to bottom.
    Roman numerals are capitals too, so a line needs two capitalised words or one
    long one; "Pag." column heads are not sections."""
    lines: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w.y0, w.x0)):
        if lines and abs(lines[-1][0].y0 - word.y0) <= line_tolerance:
            lines[-1].append(word)
        else:
            lines.append([word])
    headings: list[tuple[float, str]] = []
    for line in lines:
        caps = [w for w in line if is_heading_word(w) and not _ROMAN.match(fold(w.text).strip(".,"))]
        if any(is_number_like(w) and page_candidates(w.text) for w in line):
            continue
        if (len(caps) >= 2 or any(len(w.text) >= 6 for w in caps)) and len(caps) >= len(line) / 2:
            headings.append((line[0].y0, " ".join(w.text for w in sorted(line, key=lambda w: w.x0))))
    # A heading set over two lines ("CANTUS AD" / "LIBITUM") is one heading.
    merged: list[tuple[float, str]] = []
    for y, text in headings:
        if merged and y - merged[-1][0] <= 3 * line_tolerance and not text.upper().startswith("INDEX"):
            merged[-1] = (merged[-1][0], f"{merged[-1][1]} {text}")
        else:
            merged.append((y, text))
    return [(y, t) for y, t in merged if not t.upper().startswith("INDEX")]


LABEL = re.compile(r"^[IVXLivxl1/]{1,6}[.,]$")


def add_label_anchors(words: list[Word], columns: list[Column], row_tolerance: float = 5.0,
                      reach: float = 14.0) -> None:
    """A numbered entry whose page number neither source could read still opens
    with its label ("VI.", "Viii."). It becomes a row with an empty token, so its
    title is not swallowed by the entry above; its page is found by search."""
    spans = column_spans(columns, reach)
    placed = [(w, column_at(w.x0, w.y0, columns, spans)) for w in words]
    for word, index in placed:
        if index is None or not LABEL.match(word.text):
            continue
        if not _ROMAN.match(_repair_numeral(fold(word.text)[:-1].replace("/", "i"))):
            continue
        first_on_line = not any(i == index and abs(o.y0 - word.y0) < row_tolerance and o.x0 < word.x0
                                for o, i in placed)
        column = columns[index]
        if first_on_line and not any(abs(m.y0 - word.y0) < row_tolerance for m in column.members):
            column.members.append(Word(column.right - 12, word.y0, column.right, word.y1, "", "label"))


def rows_from_columns(words: list[Word], columns: list[Column], band_gap: float = 24.0,
                      reach: float = 14.0) -> list[Row]:
    """One row per page number, joined to its title, in reading order.

    Titles wrap: the incipit of a Mass sits on the line below its number, and a
    long feast name ends on the number's line having begun on the line above. So
    each title word joins the NEAREST number in its column, within `reach`."""
    headings = section_headings(words)
    heading_ys = {round(y) for y, _ in headings}
    add_label_anchors(words, columns)
    numbers = {id(m) for c in columns for m in c.members}
    title_words: dict[int, list[Word]] = {}
    spans = column_spans(columns, reach)
    for word in words:
        if id(word) in numbers or not re.search(r"[A-Za-z]", word.text):
            continue
        if any(abs(word.y0 - y) <= 5 for y in heading_ys) or word.text.lower().startswith("pag"):
            continue
        index = column_at(word.x0, word.y0, columns, spans)
        if index is None:
            continue
        nearest = min(columns[index].members, key=lambda m: abs(m.y0 - word.y0))
        if abs(nearest.y0 - word.y0) <= reach:
            title_words.setdefault(id(nearest), []).append(word)

    rows: list[Row] = []
    for index, column in enumerate(columns):
        for number in column.members:
            parts = sorted(title_words.get(id(number), []), key=lambda w: (round(w.y0 / 4), w.x0))
            section = next((t for y, t in reversed(headings) if y < number.y0), "")
            rows.append(Row(number.y0, index, " ".join(w.text for w in parts), number.text,
                            number.source, section))
    # Sections read top-down; inside a two-column section, left column then right.
    rows.sort(key=lambda r: r.y)
    bands: list[list[Row]] = []
    for row in rows:
        if bands and row.y - bands[-1][-1].y <= band_gap:
            bands[-1].append(row)
        else:
            bands.append([row])
    return [r for band in bands for r in sorted(band, key=lambda r: (r.column, r.y))]


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
    coverage = covered / len(words_r) if words_r and _numerals(right) <= _numerals(left) else 0.0
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


def feast_date(title: str) -> tuple[int, int] | None:
    """The date the Proper of Saints index prints with each feast ("16 Septembris").

    OCR damages month names ("Feb1'uarli", "!'Iovembris"), so each is matched by
    similarity rather than spelling; the day must be a clean 1-31."""
    words = re.findall(r"[0-9]{1,2}|[A-Za-z!':;1]{4,}", title)
    for day_word, month_word in itertools.pairwise(words):
        if not day_word.isdigit() or not 1 <= int(day_word) <= 31:
            continue
        cleaned = fold(re.sub(r"[^A-Za-z1]", "", month_word)).replace("1", "i")
        best = max(MONTHS_GENITIVE, key=lambda m: SequenceMatcher(None, cleaned, m).ratio())
        if SequenceMatcher(None, cleaned, best).ratio() >= 0.7:
            return MONTHS_GENITIVE[best], int(day_word)
    return None


# ----------------------------------------------------------- page reading ---

PX_PER_PT = 300 / 72
# Headings are read from just below the page edge: a piece's title can sit at
# 9% of the height, inside what a folio reader treats as the running head. The
# running head itself is removed by line -- the line carrying the page's folio.
TOP_BAND, FOOT_BAND = 0.03, 0.08


def drop_running_head(text: str, printed: int) -> str:
    """Remove lines that carry this page's folio: the running head, which on a
    continuation page repeats the piece's heading ("XIII. IN FESTIS
    SEMIDUPLICIBUS 2  77") and would verify the wrong page."""
    folio = str(printed)
    return "\n".join(line for line in text.splitlines()
                     if folio not in re.split(r"[^0-9]+", line))


def embedded_words(vol_id: str, pdf_page: int) -> list[Word]:
    import pymupdf

    from pipeline.volumes import load_volumes

    with pymupdf.open(load_volumes()[vol_id].path) as doc:
        raw = doc[pdf_page - 1].get_text("words")
    return [Word(w[0], w[1], w[2], w[3], w[4]) for w in raw]


def tesseract_column_words(vol_id: str, pdf_page: int, columns: list[Column]) -> list[Word]:
    """Tesseract, digits only, down each number column: the second source, and the
    only one for rows the embedded layer never captured."""
    import pytesseract
    from PIL import Image

    from pipeline.render import render_page

    image = Image.open(render_page(vol_id, pdf_page)).convert("L")
    found: list[Word] = []
    for column in columns:
        left, right = int((column.right - 30) * PX_PER_PT), int((column.right + 6) * PX_PER_PT)
        data = pytesseract.image_to_data(
            image.crop((left, 0, right, image.height)),
            config="--psm 6 -c tessedit_char_whitelist=0123456789-",
            output_type=pytesseract.Output.DICT)
        for text, top in zip(data["text"], data["top"], strict=True):
            text = text.strip()
            if text and any(c.isdigit() for c in text):
                y = top / PX_PER_PT
                found.append(Word(column.right - 12, y, column.right, y + 8, text, "tesseract"))
    return found


def read_index_rows(vol_id: str, pdf_page: int, ordered: bool = True,
                    second_source: bool = True) -> list[Row]:
    words = embedded_words(vol_id, pdf_page)
    columns = find_number_columns(words, min_increasing=0.7 if ordered else 0.0)
    if second_source and columns:
        merge_second_source(columns, tesseract_column_words(vol_id, pdf_page, columns),
                            ordered=ordered)
    return rows_from_columns(words, columns)


class HeadingReader:
    """Text a page prints OUTSIDE its music: the headings that open a piece.

    The embedded layer is read first. Where it scores an entry below the verified
    line -- it lost some headings entirely -- Tesseract reads the gaps between the
    systems. The same rule applies to every page, so neighbours compete fairly."""

    def __init__(self, vol_id: str, page_map: PageMap, pdf_pages: int, ocr: bool = True,
                 cache_dir: Path | None = None, excluded: frozenset[int] = frozenset()) -> None:
        self.vol_id, self.page_map, self.pdf_pages, self.ocr = vol_id, page_map, pdf_pages, ocr
        # The index pages themselves print every title: they would verify anything.
        self.cache_dir, self.excluded = cache_dir, excluded
        self._embedded: dict[int, str] = {}
        self._ocr: dict[int, str] = {}

    def _boxes(self, pdf_page: int) -> list[tuple[int, int]]:
        from pipeline.evaluate import analyse_page

        return [(b.top, b.bottom) for b in analyse_page(self.vol_id, pdf_page).boxes]

    def embedded(self, printed: int) -> str:
        pdf = self.page_map.to_pdf(printed) or 0
        if pdf not in self._embedded:
            if not 1 <= pdf <= self.pdf_pages or pdf in self.excluded:
                self._embedded[pdf] = ""
            else:
                boxes = [(t / PX_PER_PT, b / PX_PER_PT) for t, b in self._boxes(pdf)]
                words = embedded_words(self.vol_id, pdf)
                height = max((w.y1 for w in words), default=1.0) / (1 - FOOT_BAND / 2)
                kept = [w for w in words
                        if TOP_BAND * height < w.y0 < (1 - FOOT_BAND) * height
                        and not any(top <= (w.y0 + w.y1) / 2 <= bottom for top, bottom in boxes)]
                lines: list[list[Word]] = []
                for w in sorted(kept, key=lambda w: (w.y0, w.x0)):
                    if lines and abs(lines[-1][0].y0 - w.y0) <= 4:
                        lines[-1].append(w)
                    else:
                        lines.append([w])
                self._embedded[pdf] = drop_running_head("\n".join(
                    " ".join(w.text for w in sorted(line, key=lambda w: w.x0)) for line in lines),
                    printed)
        return self._embedded[pdf]

    def recognised(self, printed: int) -> str:
        pdf = self.page_map.to_pdf(printed) or 0
        cache = self.cache_dir / f"{pdf:04d}.txt" if self.cache_dir else None
        if pdf not in self._ocr and cache is not None and cache.exists():
            self._ocr[pdf] = cache.read_text(encoding="utf-8")
        if pdf not in self._ocr:
            if not self.ocr or not 1 <= pdf <= self.pdf_pages or pdf in self.excluded:
                self._ocr[pdf] = ""
            else:
                import pytesseract
                from PIL import Image

                from pipeline.render import render_page

                image = Image.open(render_page(self.vol_id, pdf)).convert("L")
                width, height = image.size
                edges = [int(height * TOP_BAND)] + [y for box in self._boxes(pdf) for y in box]
                edges.append(int(height * (1 - FOOT_BAND)))
                gaps = [(edges[i], edges[i + 1]) for i in range(0, len(edges) - 1, 2)
                        if edges[i + 1] - edges[i] > 40]
                self._ocr[pdf] = "\n".join(
                    pytesseract.image_to_string(image.crop((0, a, width, b)), lang="lat",
                                                config="--psm 6")
                    for a, b in gaps)
                if cache is not None:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(self._ocr[pdf], encoding="utf-8")
        return drop_running_head(self._ocr[pdf], printed)

    def score(self, entry_text: str, printed: int) -> float:
        first = heading_score(entry_text, self.embedded(printed))
        if first >= VERIFIED_AT:
            return first
        return max(first, heading_score(entry_text,
                                        f"{self.embedded(printed)}\n{self.recognised(printed)}"))


# -------------------------------------------------------------- proposals ---

@dataclass(frozen=True)
class Proposal:
    title: str
    section: str
    token: str
    source: str
    page: int | None
    status: str
    score: float
    candidates: tuple[int, ...]
    days: tuple[str, ...] = ()
    calendar_note: str = ""


def extract(vol_id: str, ordered: bool = True, ocr: bool = True,
            vocabulary: dict[str, dict[str, object]] | None = None,
            reader: HeadingReader | None = None) -> list[Proposal]:
    """Read a volume's printed index and verify every page against its headings."""
    from pipeline.offset import load_page_map
    from pipeline.volumes import load_volumes

    vol = load_volumes()[vol_id]
    page_map = load_page_map(vol_id)
    if reader is None:
        from pipeline.render import BUILD

        reader = HeadingReader(vol_id, page_map, vol.pdf_pages, ocr=ocr,
                               cache_dir=BUILD / "headings-v2" / vol_id,
                               excluded=frozenset(vol.index_pdf_pages))
    highest = page_map.last_printed
    rows = [r for page in vol.index_pdf_pages for r in read_index_rows(vol_id, page, ordered, ocr)]

    floor = 0
    out: list[Proposal] = []
    for row in rows:
        candidates = page_candidates(row.token, 1, highest) if row.token else []
        result = resolve(candidates, lambda p, t=row.title: reader.score(t, p),
                         floor if ordered else 0)
        if ordered and result.status == "verified" and result.page is not None:
            floor = result.page          # only verified pages constrain what follows
        out.append(Proposal(row.title, row.section, row.token, row.source, result.page,
                            result.status, result.score, result.candidates))
    if ordered:
        out = search_gaps(out, reader, highest)
    if vocabulary:
        out = assign_calendar(out, vocabulary)
    return out


def assign_calendar(proposals: list[Proposal], vocabulary: dict[str, dict[str, object]]
                    ) -> list[Proposal]:
    """Calendar keys for every entry, read in index order so each title has the
    context of the Sunday before it: "Feria quinta" after Easter Sunday is
    Thursday of Easter week, not Holy Thursday."""
    sunday: str | None = None
    out: list[Proposal] = []
    previous: tuple[str, ...] = ()
    heading = ""
    for prop in proposals:
        days, note = calendar_keys(prop.title, vocabulary, sunday)
        if re.match(r"\s*ad\b", fold(prop.title)) and heading:
            # "In Nativitate Domini. Ad I Missam ..." then "Ad II Missam in
            # aurora": read the continuation with its heading, and failing that
            # it is a part of the day above ("Ad Missam" after "Feria IV cinerum").
            joined, joined_note = calendar_keys(f"{heading} {prop.title}", vocabulary, sunday)
            if joined and not joined_note:
                days, note = joined, "read with the entry above"
            elif not days and previous:
                days, note = previous, "part of the entry above"
        else:
            heading = re.split(r"\bAd\b", prop.title)[0].strip()
        previous = days
        # Any Temporale key places the index in its week: after "Feria II
        # Hebdomadae sanctae", a bare "Sabbato sancto" is Holy Saturday.
        week = re.match(r"(tempora:[A-Za-z]+\d+)-\d+r?$", days[-1]) if days else None
        if week:
            sunday = f"{week.group(1)}-0"
        out.append(replace(prop, days=days, calendar_note=note))
    return out


CANDIDATE_BONUS = 0.3


def search_gaps(proposals: list[Proposal], reader: HeadingReader, highest: int,
                max_span: int = 60) -> list[Proposal]:
    """Second pass for an index in page order.

    Between two verified entries lies a run of unverified ones. Their pages must
    increase, and each run is assigned jointly -- a best monotonic fit of entries
    to pages, scored by heading evidence plus a bonus where the page is one the
    OCR'd number could be. Choosing each entry alone would let "V." settle on a
    later page that happens to print "B. Mariae V.".

    Statuses: "found" (heading evidence alone placed it), "consistent" (its own
    number, in order but without heading evidence), "unresolved" (neither)."""
    out = list(proposals)
    anchors = [i for i, p in enumerate(out) if p.status == "verified" and p.page is not None]
    bounds = [-1, *anchors, len(out)]
    for left, right in itertools.pairwise(bounds):
        run = list(range(left + 1, right))
        if not run:
            continue
        low = out[left].page if left >= 0 and out[left].page is not None else 0
        high = out[right].page if right < len(out) and out[right].page is not None else highest + 1
        span = range(low + 1, high) if high - low - 1 <= max_span else range(0)
        for i, (page, how, score) in zip(run, _fit_run([out[i] for i in run], span, low, high, reader),
                                         strict=True):
            out[i] = replace(out[i], page=page, status=how, score=score)
    return out


def _fit_run(run: list[Proposal], span: range, low: int, high: int,
             reader: HeadingReader) -> list[tuple[int | None, str, float]]:
    options: list[dict[int, tuple[float, str, float]]] = []
    own_pages: list[set[int]] = []
    for prop in run:
        choices: dict[int, tuple[float, str, float]] = {}
        # Its own number may equal a neighbour's: two short Masses can begin on
        # one page (Feria V and VI post dom. III Quadragesimae, both 244).
        own = [c for c in prop.candidates if low <= c <= high]
        own_pages.append(set(own))
        for page in sorted(set(span) | set(own)):
            score = reader.score(prop.title, page)
            if page in own:
                # Its own number, in order: placed even without heading evidence.
                choices[page] = (score + CANDIDATE_BONUS,
                                 "found" if score >= VERIFIED_AT else "consistent", score)
            elif score >= VERIFIED_AT:
                # Headings alone, against what its number said: a person decides.
                choices[page] = (score, "conflict" if own else "found", score)
        options.append(choices)
    # State: the last page placed so far. Each entry is either skipped (state
    # unchanged) or placed on a page after the state. Keep the best total per state.
    states: dict[int, float] = {low: 0.0}
    history: list[dict[int, tuple[int, int | None]]] = []   # state -> (previous state, placed)
    for i, choices in enumerate(options):
        nxt: dict[int, float] = {}
        back: dict[int, tuple[int, int | None]] = {}
        for state, total in states.items():
            if total > nxt.get(state, -1.0):
                nxt[state], back[state] = total, (state, None)
            for page, (value, how, _score) in choices.items():
                shared = page == state and how in ("consistent", "found") and page in own_pages[i]
                if (page > state or shared) and total + value > nxt.get(page, -1.0):
                    nxt[page], back[page] = total + value, (state, page)
        states = nxt
        history.append(back)
    picks: list[int | None] = [None] * len(options)
    state = max(states, key=lambda k: (states[k], -k))
    for i in range(len(options) - 1, -1, -1):
        state, placed = history[i][state]
        picks[i] = placed
    return [(p, options[i][p][1], options[i][p][2]) if p is not None else (None, "unresolved", 0.0)
            for i, p in enumerate(picks)]


WEEKDAYS = {"secunda": 1, "tertia": 2, "quarta": 3, "quinta": 4, "sexta": 5,
            "ii": 1, "iii": 2, "iv": 3, "v": 4, "vi": 5}
CONFIDENT_SNAP = 0.85


def weekday_of(title: str) -> int | None:
    """1-6 for "Feria II"/"Feria secunda" ... "Sabbato"; None for anything else."""
    words = [_repair_numeral(w) for w in re.findall(r"[a-z1|!]+", fold(title))]
    if words and words[0].startswith("sabbat"):
        return 6
    if len(words) > 1 and words[0] == "feria":
        best = max(WEEKDAYS, key=lambda w: SequenceMatcher(None, words[1], w).ratio())
        exact_numeral = _ROMAN.match(words[1]) and words[1] in WEEKDAYS
        if exact_numeral or not _ROMAN.match(words[1]) and SequenceMatcher(
                None, words[1], best).ratio() >= 0.75:
            return WEEKDAYS[words[1] if exact_numeral else best]
    return None


def calendar_keys(title: str, vocabulary: dict[str, dict[str, object]],
                  sunday: str | None = None) -> tuple[tuple[str, ...], str]:
    """1962 calendar keys for an index title, and a note when there is none.

    A dated feast maps by its date -- among that date's observances, the one whose
    title fits best, since a day can carry a feast and a commemoration. A weekday
    ("Feria quinta") maps by the Sunday before it unless its own title names its
    day outright (the September Ember days do). Anything else is matched on its
    Latin title. A 1942 entry with no 1962 observance is recorded, not dropped."""
    date = feast_date(title)
    if date is not None:
        month, day = date
        prefix = f"sancti:{month:02d}-{day:02d}"
        same_day = {k: v for k, v in vocabulary.items()
                    if k.startswith(prefix) and not k[len(prefix):len(prefix) + 1].isdigit()}
        if not same_day:
            return (), f"no 1962 observance on {prefix[7:]}"
        if len(same_day) == 1:
            return (next(iter(same_day)),), ""
        scored = sorted(same_day, key=lambda k: (-title_similarity(
            title, str(same_day[k].get("title_la", ""))), k))
        return (scored[0],), "" if title_similarity(title, str(same_day[scored[0]].get(
            "title_la", ""))) > 0 else f"several observances on {prefix[7:]}; chose {scored[0]}"
    tempora = {k: v for k, v in vocabulary.items() if k.startswith("tempora:")}
    numerals = [w for w in (_repair_numeral(x) for x in re.findall(r"[a-z1|!/]+", fold(title)))
                if _ROMAN.match(w)]
    if len(numerals) > 1 and re.search(r",|\bet\b", fold(title)):
        # "Dominica IV, V et VI post Epiphaniam": one Proper, several Sundays.
        stem = " ".join(w for w in re.findall(r"[A-Za-z]+", title)
                        if not _ROMAN.match(_repair_numeral(fold(w))) and fold(w) != "et")
        keys = [snap_title(f"{stem} {n}", tempora, minimum=CONFIDENT_SNAP, after=sunday).key
                for n in numerals]
        if all(keys):
            return tuple(k for k in keys if k), ""
    snap = snap_title(title, tempora, after=sunday)
    # A saint kept inside the Temporale (St Stephen in the Christmas octave), or a
    # feast Missalemeum files by date (the Epiphany): whichever fits better.
    # Keys ending in a lone "c" are commemorations filed beside a feast ("Pro
    # Octava Nativitatis" on 26-28 December): never the Mass an entry names.
    sancti = {k: v for k, v in vocabulary.items()
              if k.startswith("sancti:") and not re.search(r"\d[c]$", k)}
    saint = snap_title(title, sancti, strict_numerals=not re.match(r"\s*Ss?\.", title))
    if saint.key is not None and saint.score > snap.score:
        snap = saint
    if snap.key is not None and snap.score >= CONFIDENT_SNAP:
        return (snap.key,), ""
    weekday = weekday_of(title)
    if weekday is not None and sunday is not None:
        week = re.sub(r"-0r?$", "", sunday)
        key = next((k for k in (f"{week}-{weekday}", f"{week}-{weekday}r") if k in vocabulary), None)
        if key is not None:
            return (key,), ""
    if snap.key is None:
        return (), "no 1962 title matched"
    return (snap.key,), f"weak title match ({snap.score}): check"


# ------------------------------------------------------------ writing out ---

GENRE_WORDS: tuple[tuple[str, str], ...] = (
    ("asperges", "asperges"), ("aspersionem", "asperges"), ("kyrie", "kyrie"),
    ("gloria", "gloria"), ("credo", "credo"), ("sanctus", "sanctus"), ("agnus", "agnus"),
    ("toni", "tonus"), ("missa", "mass_ordinary"), ("requiem", "requiem"),
    ("dominica", "proper"), ("feria", "proper"), ("sabbato", "proper"), ("vigilia", "proper"),
)
DIVISION_WORDS: tuple[tuple[str, str], ...] = (
    ("commune", "commune"), ("sanctorum", "sanctorale"), ("defunctis", "defunctorum"),
    ("defunctorum", "defunctorum"), ("ordinarium", "kyriale"), ("tempore", "temporale"),
    ("vesper", "vesperale"),
)
REVIEW_STATUSES = frozenset({"found", "consistent", "conflict", "unresolved"})


def guess(title: str, table: tuple[tuple[str, str], ...], default: str) -> str:
    words = tokens(title)
    return next((value for key, value in table
                 if any(w.startswith(key) or _fuzzy_in(key, {w}) for w in words)), default)


def to_yaml_doc(vol_id: str, part: str, proposals: list[Proposal], division: str) -> dict[str, object]:
    """A proposal in the shape of data/index-<vol>.yml, loadable by `load_index`.

    Every entry carries its evidence (`status`, `score`, the raw OCR `token`), so
    the reviewer promoting it sees what the script was and was not sure of.
    Entries with no page at all are listed apart: they cannot be catalogued."""
    sections: dict[str, dict[str, object]] = {}
    unplaced: list[dict[str, object]] = []
    for prop in proposals:
        label = (label_of(prop.title) or "").upper() or prop.title.split(" ")[0] if prop.title else "?"
        entry: dict[str, object] = {
            "label": label, "title": prop.title, "genre": guess(prop.title, GENRE_WORDS, "proper"),
            "page": prop.page, "status": prop.status, "score": prop.score, "token": prop.token,
        }
        if prop.days:
            entry["days"] = list(prop.days)
        if prop.calendar_note:
            entry["calendar_note"] = prop.calendar_note
        if prop.page is None:
            unplaced.append(entry)
            continue
        name = prop.section or "Index"
        section = sections.setdefault(name, {
            "name": name, "division": guess(name, DIVISION_WORDS, division), "entries": []})
        entries = section["entries"]
        assert isinstance(entries, list)
        entries.append(entry)
    return {"volume": vol_id, "part": part, "generated_by": "noh index-extract",
            "sections": list(sections.values()), "unplaced": unplaced}


@dataclass(frozen=True)
class Comparison:
    agree: int
    differ: list[tuple[int, int | None, str]]     # (reviewed page, proposed page, title)
    missing: list[int]


def compare(proposals: list[Proposal], reviewed_pages: list[int]) -> Comparison:
    """Proposed pages against a reviewed index, entry by entry in page order."""
    proposed = [p.page for p in proposals]
    agree = sum(1 for page in reviewed_pages if page in proposed)
    missing = [page for page in reviewed_pages if page not in proposed]
    differ = [(0, p.page, p.title) for p in proposals
              if p.page is not None and p.page not in reviewed_pages]
    return Comparison(agree, differ, missing)
