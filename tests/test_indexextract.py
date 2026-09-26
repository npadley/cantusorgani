"""`noh index-extract`: the no-AI index reader.

Pure logic is tested on synthetic words laid out like an NOH index page. The
end-to-end test runs on NOH5 against its hand transcription.
"""

from __future__ import annotations

import pytest
import yaml

from pipeline.folio import tesseract_available
from pipeline.indexextract import (
    GENRE_WORDS,
    Column,
    HeadingReader,
    Proposal,
    Word,
    add_label_anchors,
    calendar_keys,
    compare,
    feast_date,
    find_number_columns,
    guess,
    heading_score,
    increasing_fraction,
    label_of,
    merge_second_source,
    page_candidates,
    resolve,
    rows_from_columns,
    search_gaps,
    section_headings,
    snap_title,
    title_similarity,
    to_yaml_doc,
    tokens,
)
from pipeline.offset import PageMap, Segment

needs_tesseract = pytest.mark.skipif(not tesseract_available(), reason="tesseract not installed")


class FakeReader(HeadingReader):
    """Headings from a dict of printed page -> text, no PDF."""

    def __init__(self, pages: dict[int, str]) -> None:
        super().__init__("test", PageMap((Segment(1, 999, 0),)), 999, ocr=False)
        self.pages = pages

    def embedded(self, printed: int) -> str:
        return self.pages.get(printed, "")


def word(x0: float, y: float, text: str, width: float = 10.0, source: str = "embedded") -> Word:
    return Word(x0, y, x0 + width, y + 8, text, source)


@pytest.fixture
def index_page() -> list[Word]:
    """Two page-number columns (right edges 286 and 508), a capitals heading, and
    an ordinal inside a title ("Solemnibus 2") that must not become a column."""
    words = [word(220, 160, "ORDINARIUM", 80), word(310, 160, "MISSAE", 50)]
    left = [("I.", "Lux", "5"), ("II.", "Fons", "11"), ("III.", "Deus", "17"),
            ("IV.", "Cunctipotens", "23"), ("V.", "Magnae", "29")]
    right = [("XI.", "Orbis", "62"), ("XII.", "Pater", "68"), ("XIII.", "Stelliferi", "73"),
             ("XIV.", "Jesu", "78"), ("XV.", "Dominator", "84")]
    for row, ((l_lab, l_title, l_page), (r_lab, r_title, r_page)) in enumerate(
            zip(left, right, strict=True)):
        y = 200 + 13 * row
        words += [word(80, y, l_lab), word(105, y, l_title, 40), word(186, y, "2"),
                  word(286 - 6 * len(l_page), y, l_page, 6 * len(l_page)),
                  word(301, y, r_lab), word(325, y, r_title, 40),
                  word(508 - 6 * len(r_page), y, r_page, 6 * len(r_page))]
    return words


# ------------------------------------------------------------------ digits ---

def test_page_candidates_clean_number_single_candidate():
    assert page_candidates("58") == [58]


def test_page_candidates_ocr_confusions_expand():
    assert page_candidates("S8") == [58, 98]
    assert page_candidates("il0") == [110]
    assert page_candidates("j14") == [114]


def test_page_candidates_range_takes_first_page():
    assert page_candidates("139·144") == [139]
    assert page_candidates("147-149") == [147]


def test_page_candidates_leading_hyphen_and_fused_leader():
    assert page_candidates("-58") == [58]
    assert page_candidates("1141") == [114]


def test_page_candidates_bounds_and_garbage():
    assert page_candidates("S8", lowest=60) == [98]
    assert page_candidates("Kyrie") == []


def test_increasing_fraction_page_column_vs_ordinals():
    pages = [word(0, y, t) for y, t in ((1, "5"), (2, "11"), (3, "17"), (4, "23"))]
    ordinals = [word(0, y, t) for y, t in ((1, "1"), (2, "2"), (3, "1"), (4, "2"))]
    assert increasing_fraction(pages) == 1.0
    assert increasing_fraction(ordinals) < 0.7
    assert increasing_fraction([]) == 0.0


# ------------------------------------------------------------------- table ---

def test_find_number_columns_right_edges_only(index_page):
    columns = find_number_columns(index_page)
    assert [round(c.right) for c in columns] == [286, 508]


def test_find_number_columns_alphabetical_keeps_unordered(index_page):
    swap = {"17": "3", "29": "1"}
    shuffled = [Word(w.x0, w.y0, w.x1, w.y1, swap.get(w.text, w.text)) for w in index_page]
    assert len(find_number_columns(shuffled)) == 1
    assert len(find_number_columns(shuffled, min_increasing=0.0)) == 2


def test_find_number_columns_inline_numerals_rejected():
    """"Ad I Missam" / "Ad II Missam" / "Ad III Missam": OCR reads 1, 11, 111 in
    a neat increasing right-aligned stack, and every one runs into a word."""
    words = []
    for i, numeral in enumerate(["1", "11", "111", "1V"]):
        y = 200 + 10 * i
        words += [word(182, y, "Ad"), word(206 - 5 * len(numeral), y, numeral, 5 * len(numeral)),
                  word(210, y, "Missam", 26), word(292, y, str(49 + 5 * i), 12)]
    assert [round(c.right) for c in find_number_columns(words)] == [304]


def test_section_headings_capitals_line(index_page):
    assert section_headings(index_page) == [(160, "ORDINARIUM MISSAE")]


def test_section_headings_two_line_heading_merges():
    words = [word(220, 380, "CANTUS", 50), word(280, 380, "AD", 20), word(300, 392, "LIBITUM", 60)]
    assert section_headings(words) == [(380, "CANTUS AD LIBITUM")]


def test_rows_from_columns_reading_order_and_titles(index_page):
    rows = rows_from_columns(index_page, find_number_columns(index_page))
    assert [r.token for r in rows] == ["5", "11", "17", "23", "29", "62", "68", "73", "78", "84"]
    assert rows[0].title.startswith("I. Lux")
    assert rows[5].title == "XI. Orbis"
    assert all(r.section == "ORDINARIUM MISSAE" for r in rows)


def test_rows_from_columns_wrapped_title_joins_nearest_number():
    words = [word(80, 200, "Sabbato", 40), word(125, 200, "sancto", 30),
             word(80, 212, "Vigiliae", 40), word(125, 212, "paschalis", 40), word(274, 212, "345", 12)]
    words += [word(80, 212 + 13 * i, "Dominica", 40) for i in range(1, 4)]
    words += [word(274, 212 + 13 * i, str(346 + i), 12) for i in range(1, 4)]
    rows = rows_from_columns(words, find_number_columns(words))
    assert rows[0].title == "Sabbato sancto Vigiliae paschalis"


def test_merge_second_source_fills_holes_and_drops_noise():
    column = Column(286, [word(276, 200, "17"), word(276, 226, "58")])
    extra = [word(274, 213, "29", source="tesseract"),     # between 17 and 58: kept
             word(274, 220, "2", source="tesseract"),      # cannot fit: dropped
             word(274, 201, "71", source="tesseract"),     # row already read: ignored
             word(100, 213, "40", source="tesseract")]     # far from any column
    merge_second_source([column], extra)
    assert sorted(m.text for m in column.members) == ["17", "29", "58"]


def test_merge_second_source_alphabetical_keeps_any_reading():
    column = Column(286, [word(276, 200, "17"), word(276, 226, "58")])
    merge_second_source([column], [word(274, 213, "2", source="tesseract")], ordered=False)
    assert len(column.members) == 3


def test_add_label_anchors_numbered_entry_without_number():
    words = [word(80, 200 + 13 * i, f"{lab}.") for i, lab in enumerate(["IV", "V", "VI/"])]
    column = Column(286, [word(274, 200, "23"), word(274, 239, "41")])
    add_label_anchors(words, [column])
    assert [(round(m.y0), m.text, m.source) for m in column.members[2:]] == [
        (213, "", "label"), (226, "", "label")]


# --------------------------------------------------------------- headings ---

def test_tokens_repair_numerals_and_drop_stopwords():
    assert tokens("Ill. In Festis") == {"iii", "festis"}
    assert tokens("Vil.") == {"vii"}
    assert tokens("VI/.") == {"vii"}


def test_label_of_leading_numeral_only():
    assert label_of("V. In Festis Duplicibus") == "v"
    assert label_of("Kyrie IV. Kyrie altissime") == "iv"
    assert label_of("In Festis B. Mariae V.") is None


def test_heading_score_fuzzy_words():
    assert heading_score("In FeStili Solemnlbull", "IN FESTIS SOLEMNIBUS") == 1.0
    assert heading_score("Cred(), I", "CREDO. I") == 1.0


def test_heading_score_lone_numeral_is_not_evidence():
    assert heading_score("Cndo II", "Et in carnatus II") == 0.0


def test_heading_score_label_line_lifts_illegible_title():
    title = "V. In Festis DuplidlJull. K,'i\" magna Deus po. tentia"
    assert heading_score(title, "V. IN FESTIS DUPLICIBUS. 2.") == 0.6
    assert heading_score(title, "IN FESTIS B. MARIAE V.") < 0.34


def test_heading_score_empty_entry():
    assert heading_score("", "anything") == 0.0


def test_resolve_verified_beats_neighbours():
    scores = {58: 0.8, 57: 0.1, 59: 0.2, 98: 0.0}
    r = resolve([58, 98], lambda p: scores.get(p, 0.0))
    assert (r.page, r.status) == (58, "verified")


def test_resolve_continuation_page_is_not_verified():
    scores = {58: 0.8, 57: 0.8}
    r = resolve([58], lambda p: scores.get(p, 0.0))
    assert r.status == "unverified"


def test_resolve_floor_excludes_earlier_pages():
    assert resolve([10], lambda p: 1.0, floor=58).status == "unresolved"


def test_resolve_ambiguous_without_evidence_unresolved():
    r = resolve([58, 98], lambda p: 0.0)
    assert (r.page, r.status) == (None, "unresolved")


def test_resolve_ambiguous_weak_evidence_unverified():
    r = resolve([58, 98], lambda p: 0.2 if p == 98 else 0.0)
    assert (r.page, r.status) == (98, "unverified")


# ------------------------------------------------------------- gap search ---

def proposal(title: str, page: int | None, status: str, candidates: tuple[int, ...] = ()) -> Proposal:
    return Proposal(title, "", "", "embedded", page, status, 0.0, candidates)


def test_search_gaps_places_run_monotonically():
    reader = FakeReader({29: "V. IN FESTIS DUPLICIBUS", 35: "VI. IN FESTIS DUPLICIBUS",
                         57: "IN FESTIS B. MARIAE V."})
    props = [proposal("IV. In Festis", 23, "verified", (23,)),
             proposal("V. In Festis Duplicibus", None, "unresolved"),
             proposal("VI. In Festis Duplicibus", None, "unresolved"),
             proposal("X. In Festis", 58, "verified", (58,))]
    out = search_gaps(props, reader, 200)
    assert [(p.page, p.status) for p in out[1:3]] == [(29, "found"), (35, "found")]


def test_search_gaps_own_number_in_order_is_consistent():
    props = [proposal("A", 10, "verified", (10,)), proposal("Credo II", 12, "unverified", (12,)),
             proposal("B", 20, "verified", (20,))]
    out = search_gaps(props, FakeReader({}), 200)
    assert (out[1].page, out[1].status) == (12, "consistent")


def test_search_gaps_heading_against_number_is_conflict():
    reader = FakeReader({14: "KYRIE II. SUMME DEUS"})
    props = [proposal("A", 10, "verified", (10,)),
             proposal("Kyrie II. Summe Deus", 12, "unverified", (12,)),
             proposal("B", 20, "verified", (20,))]
    out = search_gaps(props, reader, 200)
    assert (out[1].page, out[1].status) == (14, "conflict")


def test_search_gaps_nothing_found_unresolved():
    props = [proposal("A", 10, "verified", (10,)), proposal("Lost", None, "unresolved"),
             proposal("B", 20, "verified", (20,))]
    assert search_gaps(props, FakeReader({}), 200)[1].status == "unresolved"


def test_search_gaps_wide_gap_is_not_searched():
    reader = FakeReader({50: "LOST TITLE HERE"})
    props = [proposal("A", 1, "verified", (1,)), proposal("Lost title here", None, "unresolved"),
             proposal("B", 200, "verified", (200,))]
    assert search_gaps(props, reader, 300, max_span=60)[1].page is None


# --------------------------------------------------------------- calendar ---

@pytest.fixture
def vocabulary() -> dict[str, dict[str, object]]:
    return {
        "tempora:Adv2-0": {"title_la": "Dominica II Adventus"},
        "tempora:Adv3-0": {"title_la": "Dominica III Adventus"},
        "tempora:Adv3-3": {"title_la": "Feria IV Quattuor Temporum Adventus"},
        "sancti:09-16": {"title_la": "Ss. Cornelii Papæ et Cypriani Episcopi, Martyrum"},
        "sancti:09-16cc": {"title_la": "S. Euphemiae Virginis"},
        "sancti:02-09": {"title_la": "S. Cyrilli Episcopi Alexandrini"},
    }


def test_title_similarity_numeral_must_match():
    assert title_similarity("Dominica II. Adventus", "Dominica II Adventus") == 1.0
    assert title_similarity("Dominica II. Adventus", "Dominica III Adventus") == 0.0


def test_snap_title_tolerates_spelling(vocabulary):
    snap = snap_title("Feria IV Quatuor Temp. Adventus", vocabulary)
    assert snap.key == "tempora:Adv3-3"


def test_snap_title_below_minimum_is_none(vocabulary):
    assert snap_title("De Benedictione ramorum", vocabulary).key is None


def test_feast_date_reads_damaged_month():
    assert feast_date("Cyrilli Ep. Aiexandrinl, 9 Feb1'uarli") == (2, 9)
    assert feast_date("Cornelii Papre et Cypriani, 16 Septembris") == (9, 16)
    assert feast_date("Dominica I Adventus") is None


def test_calendar_keys_dated_feast_picks_best_of_day(vocabulary):
    keys, note = calendar_keys("Cornelii Papre et Cypriani Ep., Mm., 16 Septembris", vocabulary)
    assert keys == ("sancti:09-16",)
    assert note == ""


def test_calendar_keys_dated_feast_single_observance(vocabulary):
    assert calendar_keys("Cyrilli, 9 Februarii", vocabulary) == (("sancti:02-09",), "")


def test_calendar_keys_1942_only_feast_is_recorded(vocabulary):
    keys, note = calendar_keys("S. Nemo, 3 Martii", vocabulary)
    assert keys == ()
    assert "03-03" in note


def test_calendar_keys_temporale_title_and_miss(vocabulary):
    assert calendar_keys("Dominica III Adventus", vocabulary) == (("tempora:Adv3-0",), "")
    assert calendar_keys("De processione", vocabulary) == ((), "no 1962 title matched")


# ------------------------------------------------------------ writing out ---

def test_guess_genre_from_title():
    assert guess("Kyrie IV. Cunctipotens", GENRE_WORDS, "proper") == "kyrie"
    assert guess("Dominica II Adventus", GENRE_WORDS, "x") == "proper"
    assert guess("", GENRE_WORDS, "x") == "x"


def test_to_yaml_doc_sections_and_unplaced():
    props = [Proposal("II. Missa", "ORDINARIUM MISSAE", "11", "embedded", 11, "verified", 0.6, (11,)),
             Proposal("Lost", "ORDINARIUM MISSAE", "", "label", None, "unresolved", 0.0, ()),
             Proposal("Dominica I Adventus", "", "1", "embedded", 1, "consistent", 0.0, (1,),
                      ("tempora:Adv1-0",), "")]
    doc = to_yaml_doc("noh1", "I", props, "temporale")
    sections = doc["sections"]
    assert [s["division"] for s in sections] == ["kyriale", "temporale"]
    assert sections[0]["entries"][0]["label"] == "II"
    assert sections[1]["entries"][0]["days"] == ["tempora:Adv1-0"]
    assert [e["title"] for e in doc["unplaced"]] == ["Lost"]


def test_compare_counts_agreement():
    props = [proposal("a", 1, "verified"), proposal("b", 5, "found"), proposal("c", None, "unresolved")]
    result = compare(props, [1, 4])
    assert (result.agree, result.missing) == (1, [4])
    assert [p for _, p, _ in result.differ] == [5]


# ------------------------------------------------------------ end to end ---

@pytest.mark.source
@pytest.mark.slow
@needs_tesseract
def test_extract_noh5_agrees_with_hand_transcription():
    """No entry the script calls verified, found or consistent contradicts the
    hand transcription, and it recovers at least 43 of the 46 pages."""
    from pipeline.indexextract import extract
    from pipeline.volumes import DATA

    truth = [e["page"] for s in yaml.safe_load((DATA / "index-noh5.yml").read_text())["sections"]
             for e in s["entries"]]
    props = extract("noh5")
    confident = [p for p in props if p.status in ("verified", "found", "consistent")]
    assert [p.page for p in confident if p.page not in truth] == []
    assert compare(props, truth).agree >= 43
