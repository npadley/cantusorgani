"""Catalogues read from the pages rather than the index: feast headings (NOH3)
and section headings (NOH4)."""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from pipeline.indexextract.matching import (
    _ROMAN,
    MONTHS_GENITIVE,
    _day,
    fold,
    snap_title,
    title_similarity,
)
from pipeline.indexextract.pages import HeadingReader
from pipeline.indexextract.proposals import (
    CONFIDENT_SNAP,
    Proposal,
    calendar_keys,
    make_reader,
)

# ----------------------------------------------------------- heading scan ---
#
# NOH3's alphabetical index is the worst-scanned page in the set; its body is
# not. Every feast opens with a dated heading -- "21. MARTII. — S. BENEDICTI
# ABBATIS." -- so the body itself is the better index. And a feast whose whole
# Mass is a reference ("Missa. Os justi, de Communi Abbatum, Pars IV, p. 86")
# has no music here at all: it is recorded as a rubric, not given a page of
# somebody else's music.

FEAST_HEADING = re.compile(
    r"^\W*(?:(?:DIE\s+)?(?P<day>[0-9lIi\]]{1,3})\s*\.?\s*(?P<month>[A-Za-z\\]{4,})[.,]?"
    r"|EADEM\s+D[IL]E\s*(?P<same>[0-9lIi\]]{1,3})?\.?)"
    r"\s*(?:[—–-]+\s*\.?\s*(?P<title>.+))?$")
MONTH_NAMES = {v: k for k, v in MONTHS_GENITIVE.items()}
# The Introit taken from elsewhere: the feast's Mass is (at least partly) another's.
REFERENCED_INTROIT = re.compile(r"\W*Intr(?:oitus)?\b.*\b(?:Pars|ibid|p\.\s*\d)", re.IGNORECASE)


@dataclass(frozen=True)
class FeastHeading:
    page: int
    month: int
    day: int
    title: str
    rubric: str | None          # "Missa. Os justi, ..." when the Mass is only a reference
    cited: str | None = None    # "Introitus. Vultum tuum, Pars IV, p. 175.": parts cited from elsewhere


def parse_feast_heading(line: str, month: int | None) -> tuple[int, int, str] | None:
    """(month, day, title) from a dated heading line, or None. "EADEM DIE" takes
    the month of the heading before it."""
    m = FEAST_HEADING.match(line.strip())
    if not m:
        return None
    title = (m.group("title") or "").strip(" .")
    if m.group("month"):
        cleaned = fold(re.sub(r"[^A-Za-z]", "", m.group("month")))
        best = max(MONTHS_GENITIVE, key=lambda k: SequenceMatcher(None, cleaned, k).ratio())
        if SequenceMatcher(None, cleaned, best).ratio() < 0.7:
            return None
        month = MONTHS_GENITIVE[best]
    elif month is None:
        return None
    raw = m.group("day") or m.group("same")
    day = _day(raw[:2]) if raw else None
    if day is None and raw and len(raw) == 3:
        day = _day(raw[:1])
    if day is None or month is None:
        return None
    return month, day, title


def scan_feast_headings(reader: HeadingReader, printed_pages: range) -> list[FeastHeading]:
    """Every dated feast heading in the body, in page order, from both sources.

    A heading may give its title on the date's line ("21. MARTII. — S.
    BENEDICTI") or on the lines after it ("8. DECEMBRIS." / "IN FESTO
    IMMACULATAE CONCEPTIONIS")."""
    found: list[FeastHeading] = []
    month: int | None = None
    for page in printed_pages:
        # A page can carry two feasts of one date ("EADEM DIE 4."); the second
        # source adds only headings beyond those the first already read.
        counts: list[dict[tuple[int, int], int]] = [{}, {}]
        running = month                  # the month the book was in before this page
        for source, text in enumerate((reader.recognised(page), reader.embedded(page))):
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            for i, line in enumerate(lines):
                parsed = parse_feast_heading(line, month)
                if parsed is None:
                    continue
                month, day, title = parsed
                rest = lines[i + 1:]
                if not title:
                    # The title follows, set in capitals over a line or two.
                    head = [ln for ln in itertools.takewhile(_is_capitals, rest[:3])]
                    title, rest = " ".join(head), rest[len(head):]
                if not title:
                    continue
                key = (month, day)
                counts[source][key] = counts[source].get(key, 0) + 1
                if source and counts[source][key] <= counts[0].get(key, 0):
                    continue
                twin = next((h for h in found if h.page == page and h.day == day
                             and (title_similarity(h.title, title) >= 0.3
                                  or fold(title) in fold(h.title) or fold(h.title) in fold(title))),
                            None) if source else None
                if twin is not None:
                    # The same heading, read by both sources with different dates
                    # ("25. MARTII" / "25. mami"): keep the month the book is in.
                    if twin.month != running and month == running:
                        found[found.index(twin)] = replace(twin, month=month, day=day)
                    month = running
                    continue
                following = rest[0] if rest else ""
                rubric = following if re.match(r"\W*M[il]ssa\b", following, re.IGNORECASE) else None
                cited = following if REFERENCED_INTROIT.match(following) else None
                found.append(FeastHeading(page, month, day, title, rubric, cited))
    return found


def _is_capitals(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return len(letters) >= 4 and sum(c.isupper() for c in letters) / len(letters) >= 0.7


def proposals_from_headings(headings: list[FeastHeading],
                            vocabulary: dict[str, dict[str, object]] | None) -> list[Proposal]:
    out: list[Proposal] = []
    for h in headings:
        title = f"{h.title}, {h.day} {MONTH_NAMES[h.month].capitalize()}"
        days, note = calendar_keys(title, vocabulary) if vocabulary else ((), "")
        out.append(Proposal(title, "", "", "heading", h.page,
                            "rubric" if h.rubric else "verified", 1.0, (h.page,), days, note,
                            h.rubric or h.cited or ""))
    return out



def extract_from_headings(vol_id: str, vocabulary: dict[str, dict[str, object]] | None,
                          reader: HeadingReader | None = None,
                          index: list[Proposal] | None = None) -> list[Proposal]:
    """Catalogue a volume from its body's dated feast headings (NOH3).

    Where OCR lost a heading ("39 JUNIL" for 29 Junii), an index entry placed
    with evidence fills the page -- the two sources cover each other."""
    reader = reader or make_reader(vol_id)
    pages = range(1, reader.page_map.last_printed + 1)
    scanned = proposals_from_headings(scan_feast_headings(reader, pages), vocabulary)
    covered = {p.page for p in scanned}
    extra = [replace(p, source="index") for p in index or []
             if p.page is not None and p.page not in covered
             and p.status in ("verified", "found", "consistent")]
    return sorted(scanned + extra, key=lambda p: p.page or 0)


# ------------------------------------------------------- section headings ---
#
# NOH4 has no index in this scan. Its body is headed like a book of Commons:
# "COMMUNE CONFESSORIS PONTIFICIS." opens a Common, "DE EODEM COMMUNI. ALIA
# MISSA." a second Mass of it, "PRO VIRGINE ET MARTYRE." a variant, and the
# votive Masses follow under their own titles. Each heading (a line or two of
# capitals) begins a piece.

HEADING_STARTS = ("commune", "comm", "de", "pro", "item", "similiter", "in", "missa", "missae",
                  "misse", "alia", "feria", "sabbato", "dominica", "festum", "oratio", "a", "ab")
NOT_HEADINGS = ("commune sanctorum", "pars iv", "pars")
# Headings that only qualify the one before: "DE EODEM COMMUNI. ALIA MISSA.",
# "ITEM PRO VIRGINE TANTUM.", "A PASCHA USQUE AD PENTECOSTEN."
QUALIFIERS = ("de eodem", "item", "pro ", "similiter", "alia", "a ", "ab ")
SECTIONS = (("votiv", "Missae Votivae"), ("aliquibus", "Missae pro aliquibus locis"))


@dataclass(frozen=True)
class SectionHeading:
    page: int
    title: str
    parent: str            # the heading it qualifies ("DE EODEM COMMUNI" -> its COMMUNE)
    section: str
    rubric: str | None = None   # "Missa. Si diligis me, vide ad calcem": no music here
    date: tuple[int, int] | None = None


def _heading_words(line: str) -> list[str]:
    return re.findall(r"[a-z]+", fold(line.replace("~", "i").replace(":", "")))


def is_section_heading(line: str) -> bool:
    words = _heading_words(line)
    if len(words) < 2 or not _is_capitals(line):
        return False
    if " ".join(words) in NOT_HEADINGS or re.match(r"pars\b", " ".join(words)):
        return False
    # Real words, not OCR noise off a stave: a known opening, mostly long words.
    long_words = [w for w in words if len(w) >= 3]
    if words[0] in ("a", "ab") and "usque" not in words:
        return False              # "A PASCHA USQUE AD PENTECOSTEN" -- not stave noise
    return words[0] in HEADING_STARTS and len(long_words) * 2 >= len(words)


def _clean_heading(lines: list[str]) -> str:
    text = " ".join(lines)
    text = re.sub(r"[|!~]", "", text)
    text = re.sub(r"\s+", " ", text).strip(" .,;:")
    return text


def _section_marker(line: str) -> str | None:
    """"MISSAE VOTIVAE" (plural): a section title. "MISSA VOTIVA PRO FIDEI
    PROPAGATIONE" (singular) is a Mass in that section."""
    folded = fold(line)
    first = re.sub(r"[^a-z]", "", folded.split()[0]) if folded.split() else ""
    if not _is_capitals(line) or not first.startswith("miss") or first == "missa":
        return None
    return next((name for key, name in SECTIONS if key in folded), None)


def scan_section_headings(reader: HeadingReader, printed_pages: range) -> list[SectionHeading]:
    """Headings in page order. OCR is read first; the text layer is used on a
    page only where OCR found none (the two read the same headings, differently
    spelt, and would otherwise double every entry).

    Three kinds of line open a piece: a capitals heading ("COMMUNE DOCTORUM.",
    "MISSA PRO PACE."), a dated feast ("10. DECEMBRIS. — TRANSLATIONIS ALMAE
    DOMUS B.M.V."), and a heading continuing onto a second capitals line joins
    the first. Section titles ("MISSAE VOTIVAE") and month titles ("FESTA
    DECEMBRIS") change the context but are not pieces."""
    found: list[SectionHeading] = []
    parent, section, month = "", "Commune Sanctorum", None
    for page in printed_pages:
        texts = (reader.recognised(page), reader.embedded(page))
        # A section title governs its whole page, whichever source read it.
        markers = [m for text in texts for ln in text.splitlines() if (m := _section_marker(ln))]
        if markers and markers[-1] != section:
            section, parent = markers[-1], ""
        for text in texts:
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            page_found: list[SectionHeading] = []
            i = 0
            while i < len(lines):
                line = lines[i]
                if _section_marker(line):
                    i += 1
                    continue
                if re.match(r"\W*festa\s+[a-z]+", fold(line)):
                    i += 1                               # "FESTA DECEMBRIS."
                    continue
                dated = parse_feast_heading(line, month)
                if dated is not None:
                    month, day, title = dated
                    group = [title] if title else []
                    i += 1
                    while i < len(lines) and _is_capitals(lines[i]) and not parse_feast_heading(lines[i], month):
                        if title and not is_section_heading(lines[i]) and len(group) >= 1:
                            group.append(lines[i])       # "CUM S. JOSEPH." ends the title
                        elif not title:
                            group.append(lines[i])
                        else:
                            break
                        i += 1
                    following = lines[i] if i < len(lines) else ""
                    page_found.append(SectionHeading(page, _clean_heading(group), "", section,
                                                     _rubric(following), (month, day)))
                    continue
                if is_section_heading(line):
                    group = [line]
                    i += 1
                    # A heading runs on over further capitals lines ("IN
                    # ANNIVERSARIO" / "ELECTIONIS SEU CONSECRATIONIS EPISCOPI").
                    while (i < len(lines) and _is_capitals(lines[i]) and not _section_marker(lines[i])
                           and parse_feast_heading(lines[i], month) is None
                           and not fold(lines[i]).startswith(("commune", "comm"))):
                        group.append(lines[i])
                        i += 1
                    title = _clean_heading(group)
                    following = lines[i] if i < len(lines) else ""
                    if is_qualifier(title) and parent:
                        page_found.append(SectionHeading(page, title, parent, section,
                                                         _rubric(following)))
                    else:
                        # A heading in its own right names the pieces that qualify it.
                        parent = _clean_heading(group[:1])
                        page_found.append(SectionHeading(page, title, "", section, _rubric(following)))
                    continue
                i += 1
            if page_found:
                found += page_found
                break
    return found


def is_qualifier(title: str) -> bool:
    """A heading that only qualifies the one before it -- "DE EODEM COMMUNI.
    ALIA MISSA.", "ITEM PRO VIRGINE TANTUM. ALIA MISSA.", "A PASCHA USQUE AD
    PENTECOSTEN." -- as against one that names its own Mass ("ITEM FERIA V.
    MISSA DE SS. EUCHARISTIAE SACRAMENTO")."""
    folded = fold(title)
    return (folded.startswith("de eodem") or "alia missa" in folded
            or (folded.startswith(QUALIFIERS) and "missa" not in folded))


def _rubric(following: str) -> str | None:
    return following if re.match(r"\W*M[il]ssa\b", following, re.IGNORECASE) else None


def _title_case(text: str) -> str:
    small = {"et", "de", "in", "pro", "ad", "nec", "non", "tempore", "sine", "cum", "usque"}
    words = text.lower().split()

    def cased(i: int, w: str) -> str:
        if _ROMAN.match(w.strip(".,;:")) or re.fullmatch(r"(?:[a-z]\.){2,}[a-z]?\.?,?", w):
            return w.upper()                     # "II.", "B.M.V.", "D.N.J.C."
        if i and w in small and not words[i - 1].endswith("."):
            return w
        return w[:1].upper() + w[1:]

    return " ".join(cased(i, w) for i, w in enumerate(words))


def proposals_from_sections(headings: list[SectionHeading],
                            vocabulary: dict[str, dict[str, object]] | None = None) -> list[Proposal]:
    """One piece per heading, titled with the heading it qualifies ("Commune
    Virginum — Item pro Virgine tantum, alia Missa"). Dated feasts take calendar
    keys by their date."""
    out: list[Proposal] = []
    for h in headings:
        title = _title_case(h.title)
        if h.parent:
            title = f"{_title_case(h.parent)} — {title}"
        days: tuple[str, ...] = ()
        note = ""
        if h.date is not None and vocabulary:
            month, day = h.date
            days, note = calendar_keys(f"{h.title}, {day} {MONTH_NAMES[month].capitalize()}", vocabulary,
                                       require_title=True)
            title = f"{title}, {day} {MONTH_NAMES[month].capitalize()}"
        elif vocabulary and h.section != "Missae pro aliquibus locis":
            # A votive or Common Mass that is also a day of the calendar (Our
            # Lady's Saturday Masses). A local feast is not one.
            snap = snap_title(h.title, {k: v for k, v in vocabulary.items()
                                        if k.startswith(("commune:", "tempora:"))}, minimum=CONFIDENT_SNAP)
            days = (snap.key,) if snap.key else ()
        out.append(Proposal(title, h.section, "", "heading", h.page,
                            "rubric" if h.rubric else "verified", 1.0, (h.page,), days, note,
                            h.rubric or ""))
    return out


def extract_from_sections(vol_id: str, vocabulary: dict[str, dict[str, object]] | None = None,
                          reader: HeadingReader | None = None) -> list[Proposal]:
    """Catalogue a volume with no index from its section headings (NOH4)."""
    reader = reader or make_reader(vol_id)
    pages = range(1, reader.page_map.last_printed + 1)
    return proposals_from_sections(scan_section_headings(reader, pages), vocabulary)
