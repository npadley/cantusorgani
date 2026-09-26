"""Rubric feasts linked to the Masses they take (pipeline.catalog.link_rubrics)."""

from __future__ import annotations

import pytest

from pipeline.catalog import link_rubrics, load_rubrics, parse_reference


@pytest.fixture
def catalog() -> dict[str, object]:
    return {"pieces": [
        {"volume": "noh4", "slug": "confessor-os-justi", "printed_pages": [76, 81], "days": []},
        {"volume": "noh4", "slug": "abbot", "printed_pages": [82, 90], "days": ["commune:C5b"]},
    ]}


def test_parse_reference_part_and_page():
    assert parse_reference("Missa. Os justi, Pars IV, p. 76.") == ("noh4", 76)
    assert parse_reference("Missa. Os justi, Pars 1V, p. 76") == ("noh4", 76)
    assert parse_reference("Missa. Si diligis me, vide ad calcem Partis IV.") is None
    assert parse_reference("Missa. X, Pars XI, p. 7") is None


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


def test_link_rubrics_unresolvable_goes_to_review(catalog):
    unresolved = link_rubrics(catalog, [
        {"title": "S. Y", "reference": "vide ad calcem Partis IV", "days": ["sancti:05-01"]},
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
