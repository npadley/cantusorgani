"""Reading an index page as a table: damaged digits read as candidate pages,
number columns found by their shared right edge, and each title joined to its
page number (step 1 of pipeline.indexextract)."""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from pipeline.indexextract.matching import _ROMAN, _repair_numeral, fold

# ------------------------------------------------------------------ digits ---

# OCR confusions observed on NOH index pages: 98->"S8", 106->":06", 110->"il0",
# 114->"j14", 11->"II", 23->"2.3", 46->"16". "S" is ambiguous between 5 and 9.
REPAIR: dict[str, str] = {
    "S": "59", "s": "59", ":": "1", "i": "1", "l": "1", "I": "1", "j": "1", "|": "1",
    "!": "1", "O": "0", "o": "0", "B": "8", "Z": "2", "g": "9", "W": "0", "~": "45",
    ";": "", "\\": "1_", "'": "", ".": "", ",": "",
}
# In a REPAIR value, "_" is the option of reading nothing at all: "\76" is 176 in
# NOH8 (the backslash a broken 1), but in NOH5 a backslash is often stray ink.
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
            options.append(tuple("" if c == "_" else c for c in repaired) or ("",))
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
    head: str = ""          # the title's first line: what a dashed sub-entry below inherits
    dashed: bool = False    # the index prints "—" before it: a sub-entry of the row above


def is_number_like(word: Word) -> bool:
    """Could be a page number: digits or digit-shaped letters -- not a lone leader
    dot, which REPAIR maps to nothing."""
    return bool(NUMBER_TOKEN.match(word.text)) and bool(page_candidates(word.text))


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
    # A real word: "(Ol1I1S)" is OCR of "(Alius tonus)", not a capitals heading.
    if re.search(r"[0-9()/]", word.text):
        return False
    letters = [c for c in word.text if c.isalpha()]
    return len(letters) >= 3 and sum(c.isupper() for c in letters) / len(letters) >= 0.75


COLUMN_GAP = 30.0        # points between words that belong to different columns
KNOWN_SECTIONS = ("proprium de tempore", "proprium sanctorum", "commune sanctorum", "hymni",
                  "ordinarium missae", "cantus ad libitum", "missa pro defunctis", "festa sanctorum")


def _known_section(text: str) -> bool:
    folded = " ".join(re.findall(r"[a-z]+", fold(text)))
    return any(SequenceMatcher(None, folded, k).ratio() >= 0.85 for k in KNOWN_SECTIONS)


def section_headings(words: list[Word], line_tolerance: float = 5.0) -> list[tuple[float, str]]:
    """Section headings, top to bottom: lines set in capitals ("ORDINARIUM
    MISSAE"), or a known section title in any case ("Proprium Sanctorum").
    Roman numerals are capitals too, so a capitals line needs two capitalised
    words or one long one; "Pag." column heads are not sections."""
    return [(y, t) for y, t, _x0, _x1 in section_heading_spans(words, line_tolerance)]


def section_heading_spans(words: list[Word], line_tolerance: float = 5.0
                          ) -> list[tuple[float, str, float, float]]:
    """`section_headings` with each heading's horizontal extent.

    Lines are split where a wide horizontal gap separates two columns: NOH8's
    "Proprium Sanctorum" shares its baseline with a numbered row of the right
    column, and read as one line it would look like an entry."""
    rows: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w.y0, w.x0)):
        if rows and abs(rows[-1][0].y0 - word.y0) <= line_tolerance:
            rows[-1].append(word)
        else:
            rows.append([word])
    lines: list[list[Word]] = []
    for row in rows:
        segment: list[Word] = []
        for word in sorted(row, key=lambda w: w.x0):
            if segment and word.x0 - segment[-1].x1 > COLUMN_GAP:
                lines.append(segment)
                segment = []
            segment.append(word)
        if segment:
            lines.append(segment)
    headings: list[tuple[float, str, float, float]] = []
    for line in lines:
        caps = [w for w in line if is_heading_word(w) and not _ROMAN.match(fold(w.text).strip(".,"))]
        if any(is_number_like(w) and page_candidates(w.text) for w in line):
            continue
        text = " ".join(w.text for w in sorted(line, key=lambda w: w.x0))
        if re.search(r"printed|imprim|dessain|mechlin|belgi", fold(text)):
            continue                      # the printer's line at the foot of the page
        capitals = (len(caps) >= 2 or any(len(w.text) >= 6 for w in caps)) and len(caps) >= len(line) / 2
        if capitals or _known_section(text):
            headings.append((line[0].y0, text, min(w.x0 for w in line), max(w.x1 for w in line)))
    # A heading set over two lines ("CANTUS AD" / "LIBITUM") is one heading.
    merged: list[tuple[float, str, float, float]] = []
    for y, text, x0, x1 in headings:
        if merged and y - merged[-1][0] <= 3 * line_tolerance and not text.upper().startswith("INDEX") \
                and x0 < merged[-1][3] + COLUMN_GAP and x1 > merged[-1][2] - COLUMN_GAP:
            py, pt, px0, px1 = merged[-1]
            merged[-1] = (py, f"{pt} {text}", min(px0, x0), max(px1, x1))
        else:
            merged.append((y, text, x0, x1))
    return [h for h in merged if not h[1].upper().startswith("INDEX")]


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


def group_lines(words: list[Word], tolerance: float = 4.0) -> list[list[Word]]:
    """Words into lines, top to bottom, each line left to right. A day number set
    a point lower than its month is still on the month's line."""
    lines: list[list[Word]] = []
    for word in sorted(words, key=lambda w: (w.y0, w.x0)):
        if lines and abs(lines[-1][0].y0 - word.y0) <= tolerance:
            lines[-1].append(word)
        else:
            lines.append([word])
    return [sorted(line, key=lambda w: w.x0) for line in lines]


def owner_of_line(i: int, lines: list[list[Word]], members: list[Word], reach: float,
                  tolerance: float = 5.0) -> Word | None:
    """The page number a title line belongs to.

    A line carrying a number belongs to it. A line without one is either the
    tail of the entry above -- set indented beneath it, like a Mass's incipit --
    or the head of the entry below, which then continues indented on the
    number's line (a long feast name in the Proper of Saints)."""
    y = lines[i][0].y0
    on_line = [m for m in members if abs(m.y0 - y) < tolerance]
    if on_line:
        return on_line[0]
    above = [m for m in members if y - reach <= m.y0 < y]
    below = [m for m in members if y < m.y0 <= y + reach]
    if not above or not below:
        return (above[-1:] or below[:1] or [None])[0]
    here = lines[i][0].x0
    after = lines[i + 1][0].x0 if i + 1 < len(lines) else here
    before = lines[i - 1][0].x0 if i else here
    if here > before + tolerance:
        return above[-1]             # indented under the line above: its tail
    if after > here + tolerance:
        return below[0]              # the next line is indented under this: its head
    return min(above[-1], below[0], key=lambda m: abs(m.y0 - y))


def rows_from_columns(words: list[Word], columns: list[Column], band_gap: float = 24.0,
                      reach: float = 14.0) -> list[Row]:
    """One row per page number, joined to its title, in reading order.

    Titles wrap, in both directions: see `owner_of_line`."""
    spans_h = section_heading_spans(words)
    add_label_anchors(words, columns)
    numbers = {id(m) for c in columns for m in c.members}
    spans = column_spans(columns, reach)
    by_column: dict[int, list[Word]] = {}
    for word in words:
        # Digits stay in a title: the Proper of Saints dates every feast ("4 Augusti").
        if id(word) in numbers or not re.search(r"[A-Za-z0-9]", word.text):
            continue
        if any(abs(word.y0 - y) <= 5 and x0 - 2 <= word.x0 <= x1 + 2 for y, _t, x0, x1 in spans_h) \
                or word.text.lower().startswith("pag"):
            continue                      # a heading's own words, not a title's
        index = column_at(word.x0, word.y0, columns, spans)
        if index is not None:
            by_column.setdefault(index, []).append(word)
    title_lines: dict[int, list[list[Word]]] = {}
    dashes: dict[int, list[Word]] = {}
    for word in words:
        if re.fullmatch(r"[-–—]+", word.text):
            index = column_at(word.x0, word.y0, columns, spans)
            if index is not None:
                dashes.setdefault(index, []).append(word)
    for index, column_words in by_column.items():
        members = sorted(columns[index].members, key=lambda m: m.y0)
        lines = group_lines(column_words)
        for i, line in enumerate(lines):
            owner = owner_of_line(i, lines, members, reach)
            if owner is not None:
                title_lines.setdefault(id(owner), []).append(line)

    # A heading governs the columns it spans (NOH5's "ORDINARIUM MISSAE" crosses
    # both; NOH8's "Proprium Sanctorum" heads one). A column with no heading of
    # its own above a row continues the section the previous column ended in.
    rows: list[Row] = []
    carried = ""
    for index, column in enumerate(columns):
        last_own = ""
        for number in sorted(column.members, key=lambda m: m.y0):
            # The column's extent at this row: from the nearest column to its left
            # that is present at this height (NOH5's index adds a middle column
            # only lower down).
            live = [c.right for c, (top, bottom) in zip(columns, spans, strict=True)
                    if top <= number.y0 <= bottom and c.right < column.right]
            left = max(live, default=0.0)
            own = [(y, t) for y, t, x0, x1 in spans_h if x0 < column.right and x1 > left]
            lines = title_lines.get(id(number), [])
            parts = [w for line in lines for w in line]
            above = [t for y, t in own if y < number.y0]
            section = above[-1] if above else carried
            if above:
                last_own = above[-1]
            head = " ".join(w.text for w in lines[0]) if lines else ""
            dashed = bool(lines) and any(
                abs(d.y0 - lines[0][0].y0) < 5 and d.x1 <= lines[0][0].x0 + 1
                for d in dashes.get(index, []))
            rows.append(Row(number.y0, index, " ".join(w.text for w in parts), number.text,
                            number.source, section, head, dashed))
        if last_own:
            carried = last_own
    # Sections read top-down; inside a two-column section, left column then right.
    rows.sort(key=lambda r: r.y)
    bands: list[list[Row]] = []
    for row in rows:
        if bands and row.y - bands[-1][-1].y <= band_gap:
            bands[-1].append(row)
        else:
            bands.append([row])
    return [r for band in bands for r in sorted(band, key=lambda r: (r.column, r.y))]


