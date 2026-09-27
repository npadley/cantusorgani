"""Rubric feasts linked to the Masses they take (pipeline.catalog.link_rubrics)."""

from __future__ import annotations

import pytest

from pipeline.catalog import AT_END, link_rubrics, load_rubrics, parse_reference


@pytest.fixture
def catalog() -> dict[str, object]:
    return {"pieces": [
        {"volume": "noh4", "slug": "confessor-os-justi", "printed_pages": [76, 81], "days": [],
         "systems": ["noh4/0100/000"]},
        {"volume": "noh4", "slug": "abbot", "printed_pages": [82, 90], "days": ["commune:C5b"],
         "systems": ["noh4/0106/000"]},
    ]}


def test_parse_reference_part_and_page():
    assert parse_reference("Missa. Os justi, Pars IV, p. 76.") == ("noh4", 76)
    assert parse_reference("Missa. Os justi, Pars 1V, p. 76") == ("noh4", 76)
    assert parse_reference("Missa. X, Pars XI, p. 7") is None


@pytest.mark.parametrize("text", [
    "Missa. Os justi, de Communi Abbatum, Pars |V, p. 86.",
    "Missa. Os justi, Pars iV, p. 76. |",
    "Missa. Os justi, Pars IV; p. 76.",
    "Missa. Loquébar, Pars IV, p 90.",
    "Missa. Sacerdótes Dei, Pars IV, ». 11.",
    "Missa. Intret, Pars iV, 'p 40.",
])
def test_parse_reference_ocr_damaged_part_and_page_still_read(text):
    """NOH3's rubric lines as OCR left them: I read as | or i, a dropped stop,
    a semicolon for the comma, the p read as »."""
    volume, page = parse_reference(text)
    assert volume == "noh4"
    assert page in {86, 76, 90, 11, 40}


def test_parse_reference_at_the_end_of_part_iv_is_its_last_piece():
    """"vide ad calcem Partis IV": the Common of Supreme Pontiffs, printed after
    the last feast pro aliquibus locis."""
    assert parse_reference("Missa. Si diligis me, de Communi unius Summi Pontificis, "
                           "vide ad calcem Partis IV.") == ("noh4", AT_END)
    assert parse_reference("Missa. Si diligis me, de Communi unius Summi Ponti/ids, "
                           "vide ad co/cern Portis IV.") == ("noh4", AT_END)
    assert parse_reference("— Missa. Si diligis me, de Communi unius Summi Pontificis, "
                           "vide ad calcem Partis") == ("noh4", AT_END)


def test_link_rubrics_at_the_end_links_the_volumes_last_piece_with_music():
    catalog = {"pieces": [
        {"volume": "noh4", "slug": "stanislaus", "printed_pages": [366, 376], "days": [],
         "systems": ["a"]},
        {"volume": "noh4", "slug": "summi-pontifices", "printed_pages": [377, 385], "days": [],
         "systems": ["b"]},
        {"volume": "noh5", "slug": "other", "printed_pages": [1, 9], "days": [], "systems": ["c"]},
    ]}
    unresolved = link_rubrics(catalog, [
        {"title": "S. Callisti", "volume": "noh3", "days": ["sancti:10-14"],
         "reference": "Missa. Si diligis me, de Communi unius Summi Pontificis, vide ad calcem Partis IV."}])
    assert catalog["pieces"][1]["linked_days"] == ["sancti:10-14"]
    assert unresolved == []


def test_parse_reference_bare_page_is_in_the_rubrics_own_volume():
    assert parse_reference("Missa. Justus ut palma, p. 82.", "noh4") == ("noh4", 82)
    assert parse_reference("Missa. Justus ut palma, p. 82.") is None
    assert parse_reference("Missa ut in Graduali, Pars III, p. 244.", "noh4") == ("noh3", 244)


def test_link_rubrics_adds_days_to_the_referenced_piece(catalog):
    unresolved = link_rubrics(catalog, [
        {"title": "S. Casimiri", "reference": "Missa. Os justi, Pars IV, p. 76.",
         "days": ["sancti:03-04"]},
        {"title": "S. Benedicti", "reference": "Missa. Os justi, de Communi Abbatum, Pars IV, p. 86.",
         "days": ["sancti:03-21"]}])
    pieces = catalog["pieces"]
    assert pieces[0]["days"] == ["sancti:03-04"]
    assert pieces[1]["days"] == ["commune:C5b", "sancti:03-21"]
    assert pieces[1]["linked_days"] == ["sancti:03-21"]
    assert unresolved == []


def test_link_rubrics_recomputes_rather_than_accumulates(catalog):
    rubric = {"title": "S. X", "reference": "Pars IV, p. 76", "days": ["sancti:03-04"]}
    link_rubrics(catalog, [rubric])
    link_rubrics(catalog, [])
    assert catalog["pieces"][0]["days"] == []


def test_link_rubrics_heading_without_music_skipped_links_the_mass_below():
    """NOH3 p. 354: SS Cosmas and Damian print only a heading (their Mass is by
    reference) above St Michael's Mass. "Introitus. Benedicite, ut supra, p. 354"
    for the Guardian Angels is St Michael's Introit, not an empty heading's."""
    catalog = {"pieces": [
        {"volume": "noh3", "slug": "cosmas", "printed_pages": [354, 354], "days": [], "systems": []},
        {"volume": "noh3", "slug": "michael", "printed_pages": [354, 361], "days": ["sancti:09-29"],
         "systems": ["noh3/0387/000"]},
    ]}
    unresolved = link_rubrics(catalog, [
        {"title": "Ss. Angelorum Custodum", "volume": "noh3",
         "reference": "Introitus. Benedicite, ut supra, p. 354.", "days": ["sancti:10-02"]}])
    cosmas, michael = catalog["pieces"]
    assert cosmas["days"] == []
    assert michael["linked_days"] == ["sancti:10-02"]
    assert unresolved == []


def test_link_rubrics_only_headings_on_the_page_goes_to_review():
    catalog = {"pieces": [
        {"volume": "noh3", "slug": "frances", "printed_pages": [106, 106], "days": [], "systems": []}]}
    unresolved = link_rubrics(catalog, [
        {"title": "S. X", "volume": "noh3", "reference": "Introitus. Y, ut supra, p. 106.",
         "days": ["sancti:11-11"]}])
    assert catalog["pieces"][0]["days"] == []
    assert [u["title"] for u in unresolved] == ["S. X"]


def test_link_rubrics_unresolvable_goes_to_review(catalog):
    unresolved = link_rubrics(catalog, [
        {"title": "S. Y", "reference": "Missa. Salve sancta Parens, ut in Missis votivis B. M. V.",
         "days": ["sancti:05-01"]},
        {"title": "S. Z", "reference": "Pars IV, p. 999", "days": ["sancti:05-02"]},
        {"title": "no day", "reference": "Pars IV, p. 76", "days": []}])
    assert [u["title"] for u in unresolved] == ["S. Y", "S. Z"]


def test_load_rubrics_reads_reviewed_indexes_only(tmp_path):
    (tmp_path / "index-noh3.yml").write_text(
        "volume: noh3\nsections: []\nrubrics:\n- {title: A, page: 4, reference: 'Pars IV, p. 24'}\n")
    (tmp_path / "index-noh3.proposed.yml").write_text(
        "volume: noh3\nrubrics:\n- {title: B, page: 5, reference: x}\n")
    (tmp_path / "index-noh5.yml").write_text(
        "volume: noh5\nsections:\n- name: S\n  entries:\n"
        "  - {title: C, page: 9, reference: 'Introitus. X, Pars IV, p. 175', days: [sancti:03-25]}\n"
        "  - {title: D, page: 10}\n")
    assert [r["title"] for r in load_rubrics(tmp_path)] == ["A", "C"]


def test_load_rubrics_reads_the_1962_rubrics_file(tmp_path):
    """Days the 1962 rubrics give another day's Mass (an Advent weekday takes the
    Sunday's) are not printed in NOH; they live in their own file."""
    (tmp_path / "rubrics-1962.yml").write_text(
        "rubrics:\n- {title: Feria II infra Hebd I Adventus, reference: 'Pars I, p. 3', "
        "days: [tempora:Adv1-1]}\n")
    assert [(r["title"], r["days"]) for r in load_rubrics(tmp_path)] == [
        ("Feria II infra Hebd I Adventus", ["tempora:Adv1-1"])]


def test_rubrics_1962_every_reference_resolves():
    """The shipped file: every line names a part and page that parse."""
    from pathlib import Path

    import yaml
    doc = yaml.safe_load((Path(__file__).parent.parent / "data" / "rubrics-1962.yml").read_text())
    for rubric in doc["rubrics"]:
        assert rubric["days"], rubric["title"]
        assert parse_reference(rubric["reference"]) is not None, rubric["title"]
