"""Proposals: resolving each entry to a page, ordering and checking them against
the book and the calendar, and writing data/index-<vol>.proposed.yml."""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from pipeline.indexextract.matching import (
    _ROMAN,
    VERIFIED_AT,
    _fuzzy_in,
    _repair_numeral,
    feast_date,
    fold,
    label_of,
    resolve,
    snap_title,
    title_similarity,
    tokens,
)
from pipeline.indexextract.pages import HeadingReader, read_index_rows
from pipeline.indexextract.table import page_candidates

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
    reference: str = ""          # a rubric's pointer elsewhere: "Missa. Os justi, Pars IV, p. 76."


def make_reader(vol_id: str, ocr: bool = True) -> HeadingReader:
    from pipeline.offset import load_page_map
    from pipeline.render import BUILD
    from pipeline.volumes import load_volumes

    vol = load_volumes()[vol_id]
    return HeadingReader(vol_id, load_page_map(vol_id), vol.pdf_pages, ocr=ocr,
                         cache_dir=BUILD / "headings-v2" / vol_id,
                         excluded=frozenset(vol.index_pdf_pages))


def extract(vol_id: str, ordered: bool = True, ocr: bool = True,
            vocabulary: dict[str, dict[str, object]] | None = None,
            reader: HeadingReader | None = None) -> list[Proposal]:
    """Read a volume's printed index and verify every page against its headings."""
    from pipeline.offset import load_page_map
    from pipeline.volumes import load_volumes

    vol = load_volumes()[vol_id]
    page_map = load_page_map(vol_id)
    reader = reader or make_reader(vol_id, ocr)
    highest = page_map.last_printed
    rows = [r for page in vol.index_pdf_pages for r in read_index_rows(vol_id, page, ordered, ocr)]

    # Page order is checked section by section: NOH8's index runs the Proper of
    # Time and the Common in page order, but not its Proper of Saints, and its
    # hymns alphabetically.
    groups: list[tuple[bool, list[Proposal]]] = []
    floor = 0
    for section, group in itertools.groupby(rows, key=lambda r: r.section):
        in_order = ordered and section_in_page_order(section)
        placed: list[Proposal] = []
        for row in group:
            candidates = page_candidates(row.token, 1, highest) if row.token else []
            result = resolve(candidates, lambda p, t=row.title: reader.score(t, p),
                             floor if in_order else 0)
            if in_order and result.status == "verified" and result.page is not None:
                floor = result.page          # only verified pages constrain what follows
            placed.append(Proposal(row.title, row.section, row.token, row.source, result.page,
                                   result.status, result.score, result.candidates))
        groups.append((in_order, placed))
    # Sections in page order that follow one another bound each other: the
    # Ordinarium's last Credos lie before the Cantus ad libitum's first Kyrie.
    in_order_verified = [p.page for flag, g in groups if flag for p in g
                         if p.status == "verified" and p.page is not None]
    out: list[Proposal] = []
    seen_order = 0
    for in_order, placed in groups:
        if in_order:
            count = sum(1 for p in placed if p.status == "verified" and p.page is not None)
            before = in_order_verified[:seen_order]
            after = in_order_verified[seen_order + count:]
            seen_order += count
            placed = search_gaps(placed, reader, highest, low_bound=max(before, default=0),
                                 high_bound=min(after, default=highest + 1))
        elif not ordered:
            placed = order_by_feast_date(placed, reader, highest)
        else:
            placed = within_section_span(placed)
        out += placed
    if vocabulary:
        out = assign_calendar(out, vocabulary)
    return out


def within_section_span(proposals: list[Proposal]) -> list[Proposal]:
    """A section listed by name still occupies one stretch of the book. An
    unconfirmed entry whose reading could be several pages ("\\76": 76 or 176)
    takes the one inside the stretch its confirmed neighbours span."""
    confirmed = [p.page for p in proposals if p.status == "verified" and p.page is not None]
    if len(confirmed) < 2:
        return proposals
    lo, hi = min(confirmed), max(confirmed)
    out: list[Proposal] = []
    for p in proposals:
        inside = [c for c in p.candidates if lo <= c <= hi]
        if p.status in ("unverified", "unresolved") and len(inside) == 1 and len(p.candidates) > 1:
            p = replace(p, page=inside[0], status="consistent")
        out.append(p)
    return out


UNORDERED_SECTIONS = ("proprium sanctorum", "hymni")


def section_in_page_order(section: str) -> bool:
    """False for index sections listed by name rather than by page."""
    folded = " ".join(re.findall(r"[a-z]+", fold(section)))
    return not any(SequenceMatcher(None, folded, s).ratio() >= 0.85 for s in UNORDERED_SECTIONS)


def is_hymn_section(section: str) -> bool:
    return SequenceMatcher(None, " ".join(re.findall(r"[a-z]+", fold(section))), "hymni").ratio() >= 0.85


def liturgical_date_order(month: int, day: int) -> tuple[int, int]:
    """The Proper of Saints runs from St Saturninus (29 November) to 28 November."""
    return (-1, day) if month == 11 and day >= 29 else ((month - 12) % 12, day)


def order_by_feast_date(proposals: list[Proposal], reader: HeadingReader,
                        highest: int) -> list[Proposal]:
    """An alphabetical index has no page order to check against -- but its feasts
    are dated, and the book prints them in date order. Sorted by date, the dated
    entries are an ordered index again, and get the same second pass."""
    dated = [(liturgical_date_order(*d), i) for i, p in enumerate(proposals)
             if (d := feast_date(p.title)) is not None]
    order = [i for _, i in sorted(dated)]
    fitted = search_gaps([proposals[i] for i in order], reader, highest)
    out = list(proposals)
    for i, prop in zip(order, fitted, strict=True):
        out[i] = prop
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
                max_span: int = 60, low_bound: int = 0, high_bound: int | None = None
                ) -> list[Proposal]:
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
        low = out[left].page if left >= 0 and out[left].page is not None else low_bound
        high = (out[right].page if right < len(out) and out[right].page is not None
                else (high_bound if high_bound is not None else highest + 1))
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


_ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}


def roman_value(numeral: str) -> int | None:
    if not _ROMAN.match(numeral):
        return None
    total = 0
    for a, b in itertools.zip_longest(numeral, numeral[1:], fillvalue=""):
        value = _ROMAN_VALUES[a]
        total += -value if b and _ROMAN_VALUES[b] > value else value
    return total


def to_roman(n: int) -> str:
    out = ""
    for value, symbol in ((50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= value:
            out, n = out + symbol, n - value
    return out


def calendar_keys(title: str, vocabulary: dict[str, dict[str, object]],
                  sunday: str | None = None, require_title: bool = False
                  ) -> tuple[tuple[str, ...], str]:
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
        if require_title:
            # A feast kept only in some places: its date alone says nothing,
            # since the general calendar keeps another saint that day.
            best = max(same_day, key=lambda k: title_similarity(title, str(same_day[k].get("title_la", ""))))
            if title_similarity(title, str(same_day[best].get("title_la", ""))) < 0.5:
                return (), f"no 1962 observance of this feast on {prefix[7:]}"
            return (best,), ""
        if len(same_day) == 1:
            return (next(iter(same_day)),), ""
        scored = sorted(same_day, key=lambda k: (-title_similarity(
            title, str(same_day[k].get("title_la", ""))), k))
        return (scored[0],), "" if title_similarity(title, str(same_day[scored[0]].get(
            "title_la", ""))) > 0 else f"several observances on {prefix[7:]}; chose {scored[0]}"
    tempora = {k: v for k, v in vocabulary.items() if k.startswith("tempora:")}
    numerals = [w for w in (_repair_numeral(x) for x in re.findall(r"[a-z1|!/]+", fold(title)))
                if _ROMAN.match(w)]
    span = re.search(r"\b([ivxl1|!]+)\s*[-·–.]\s*([ivxl1|!]+)\b", fold(title))
    if span:
        # "Dominicae I-IV Adventus", "Dominicae IV-XXIV post Pentecosten": a range.
        lo, hi = (roman_value(_repair_numeral(g)) for g in span.groups())
        if lo and hi and lo < hi <= 30:
            numerals = [to_roman(n).lower() for n in range(lo, hi + 1)]
    if len(numerals) > 1 and (span or re.search(r",|\bet\b", fold(title))):
        # "Dominica IV, V et VI post Epiphaniam": one Proper, several Sundays.
        stem = " ".join(w for w in re.findall(r"[A-Za-z]+", title)
                        if not _ROMAN.match(_repair_numeral(fold(w))) and fold(w) != "et")
        stem = re.sub(r"(?i)\bdominic(?:ae|e|re|lE)\b", "Dominica", stem)   # plural to singular
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
        # Missalemeum files Friday in Passion Week as "Quad5-5Feria".
        key = next((k for k in (f"{week}-{weekday}", f"{week}-{weekday}r", f"{week}-{weekday}Feria")
                    if k in vocabulary), None)
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
# The division of each section NOH4 prints (read by pipeline.indexextract.headings).
SECTION_DIVISIONS = {"Commune Sanctorum": "commune", "Missae Votivae": "varia",
                     "Missae pro aliquibus locis": "sanctorale"}
REVIEW_STATUSES = frozenset({"found", "consistent", "conflict", "unresolved", "unverified"})


def guess(title: str, table: tuple[tuple[str, str], ...], default: str) -> str:
    words = tokens(title)
    return next((value for key, value in table
                 if any(w.startswith(key) or _fuzzy_in(key, {w}) for w in words)), default)


PROPER_DIVISIONS = frozenset({"temporale", "sanctorale", "commune"})
BOOK_DIVISIONS = frozenset({"vesperale"})
WORST_FIRST = ("unresolved", "conflict", "unverified", "consistent", "found", "verified")


def _calendar_title(prop: Proposal, vocabulary: dict[str, dict[str, object]] | None) -> str | None:
    """The calendar's Latin title, where the key is sure."""
    if vocabulary and prop.days and not prop.calendar_note:
        titles = [str(vocabulary[k].get("title_la", "")) for k in prop.days if k in vocabulary]
        if titles and all(titles):
            return " · ".join(dict.fromkeys(titles))
    return None


def _group_title(group: list[Proposal], vocabulary: dict[str, dict[str, object]] | None
                 ) -> tuple[str, bool]:
    """A piece's title and whether it is clean: the calendar titles of the
    entries that have one, else the index's own words as OCR read them."""
    # A piece serving several days ("Dominicae I-IV Adventus") keeps its own
    # title: four calendar titles in a row name no piece.
    clean = [t for p in group if len(p.days) == 1 and (t := _calendar_title(p, vocabulary))]
    if clean:
        return " · ".join(dict.fromkeys(clean)), True
    return " ".join(group[0].title.split()), False


def to_yaml_doc(vol_id: str, part: str, proposals: list[Proposal], division: str,
                vocabulary: dict[str, dict[str, object]] | None = None,
                section_name: str | None = None) -> dict[str, object]:
    """A proposal in the shape of data/index-<vol>.yml, loadable by `load_index`.

    Entries are put in PAGE order -- an alphabetical index is not -- because a
    piece runs until the next one begins. Every entry carries its evidence (`status`,
    `score`, the raw OCR `token` and `index_title`) for the reviewer. Entries
    with no page are listed apart: they cannot be catalogued."""
    from pipeline.index import slugify

    hymns = [p for p in proposals if is_hymn_section(p.section)]
    proposals = [p for p in proposals if not is_hymn_section(p.section)]
    placed = sorted((p for p in proposals if p.page is not None and p.status != "rubric"),
                    key=lambda p: p.page or 0)
    # Entries that begin on one page stay separate pieces: the catalog divides
    # the page at each heading (pipeline.pagesplit). Only true duplicates -- the
    # same day twice on one page, as two sources read it -- are merged.
    groups: list[list[Proposal]] = []
    for prop in placed:
        if groups and groups[-1][0].page == prop.page and prop.days and prop.days == groups[-1][0].days:
            groups[-1].append(prop)
        else:
            groups.append([prop])

    sections: dict[str, dict[str, object]] = {}
    seen: set[str] = set()
    for group in groups:
        first = group[0]
        title, clean = _group_title(group, vocabulary)
        days = list(dict.fromkeys(k for p in group for k in p.days))
        name = first.section or section_name or "Index"
        # A book that is one division throughout (the Vesperale) is not sorted by
        # its section names, which borrow the Missal's ("Proprium de Tempore").
        section_division = division if division in BOOK_DIVISIONS else (
            SECTION_DIVISIONS.get(name) or guess(name, DIVISION_WORDS, division))
        # A URL is kept for good: never build one from OCR noise. A slug comes
        # from the first clean title, or else from the volume and page.
        base = slugify(title.split(" · ")[0])[:64].strip("-") if clean else ""
        slug = base = base or f"{vol_id}-p{first.page}"
        n = 2
        while slug in seen:
            slug, n = f"{base}-{n}", n + 1
        seen.add(slug)
        entry: dict[str, object] = {
            "slug": slug,
            # A Proper is named by its day; a numeral label ("I") would only
            # repeat part of the title.
            "label": title if section_division in PROPER_DIVISIONS
            else (label_of(first.title) or "").upper() or title,
            "title": title,
            # Only the Kyriale and the Requiem are sorted by what they contain;
            # every other Mass (a Common, a votive Mass) is a Proper.
            "genre": guess(first.title, GENRE_WORDS, "proper")
            if section_division in ("kyriale", "defunctorum") else "proper",
            "page": first.page,
            "status": min((p.status for p in group), key=WORST_FIRST.index),
            "score": min(p.score for p in group),
            "token": " | ".join(p.token for p in group),
            "index_title": " | ".join(" ".join(p.title.split()) for p in group),
        }
        if days:
            entry["days"] = days
        cited = [p.reference for p in group if p.reference]
        if cited:
            entry["reference"] = cited[0]
        notes = [p.calendar_note for p in group if p.calendar_note]
        if notes:
            entry["calendar_note"] = "; ".join(notes)
        section = sections.setdefault(name, {"name": name, "division": section_division,
                                             "entries": []})
        entries = section["entries"]
        assert isinstance(entries, list)
        entries.append(entry)
    unplaced = [{"index_title": " ".join(p.title.split()), "token": p.token, "status": p.status,
                 **({"days": list(p.days)} if p.days else {})}
                for p in proposals if p.page is None]
    rubrics: list[dict[str, object]] = []
    for p in proposals:
        record = {"title": _calendar_title(p, vocabulary) or " ".join(p.title.split()),
                  "page": p.page, "reference": p.reference,
                  **({"days": list(p.days)} if p.days else {})}
        if p.status == "rubric" and not any(r["page"] == p.page and r.get("days") == record.get("days")
                                            and record.get("days") for r in rubrics):
            rubrics.append(record)
    doc: dict[str, object] = {"volume": vol_id, "part": part, "generated_by": "noh index-extract",
                              "sections": list(sections.values()), "unplaced": unplaced}
    if rubrics:
        doc["rubrics"] = rubrics
    if hymns:
        # Hymns are printed inside the offices; the index lists them by name. They
        # are named points in the office that contains their page, not pieces.
        doc["hymns"] = [{"title": " ".join(h.title.split()), "page": h.page, "status": h.status,
                         "token": h.token} for h in hymns]
    return doc


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


