"""Piecewise page maps: scans with inserted, duplicated or missing pages."""

from __future__ import annotations

import json

import pytest

from pipeline.catalog import SCHEMA_VERSION, merge_catalog
from pipeline.offset import PageMap, Segment, load_page_map, runs_from_readings


@pytest.fixture
def noh1_map() -> PageMap:
    """NOH1 as derived: printed 96 scanned twice (PDF 122 and 123), printed
    348-349 missing, so three offsets."""
    return PageMap((Segment(29, 122, 26), Segment(123, 374, 27), Segment(375, 379, 25)))


def test_page_map_to_pdf_each_segment(noh1_map):
    assert noh1_map.to_pdf(3) == 29
    assert noh1_map.to_pdf(97) == 124
    assert noh1_map.to_pdf(350) == 375


def test_page_map_duplicate_page_maps_to_first_scan(noh1_map):
    assert noh1_map.to_pdf(96) == 122


def test_page_map_missing_pages_map_to_none(noh1_map):
    assert noh1_map.to_pdf(348) is None
    assert noh1_map.to_pdf(349) is None
    assert noh1_map.to_pdf(1) is None


def test_page_map_to_printed_and_outside(noh1_map):
    assert noh1_map.to_printed(123) == 96
    assert noh1_map.to_printed(28) is None


def test_page_map_last_printed_and_gaps(noh1_map):
    assert noh1_map.last_printed == 354
    assert noh1_map.gaps == []
    split = PageMap((Segment(10, 20, 5), Segment(25, 40, 7)))
    assert split.gaps == [(21, 24)]


def test_runs_from_readings_shift_needs_a_run():
    readings = [(p, p - 33) for p in range(100, 110)]
    readings += [(110, 50)]                                  # one misread folio
    readings += [(p, p - 35) for p in range(111, 120)]
    assert runs_from_readings(readings) == [(100, 109, 33), (111, 119, 35)]


def test_runs_from_readings_noise_between_same_offset_merges():
    readings = [(p, p - 33) for p in range(100, 105)] + [(105, 7)]
    readings += [(p, p - 33) for p in range(106, 110)]
    assert runs_from_readings(readings) == [(100, 109, 33)]


def test_runs_from_readings_nothing_consistent_is_empty():
    assert runs_from_readings([(1, 7), (2, 50), (3, 9)]) == []


@pytest.fixture
def offsets_file(tmp_path, monkeypatch):
    from pipeline import offset

    monkeypatch.setattr(offset, "sha256_of", lambda _path: "abc")
    path = tmp_path / "derived-offsets.json"
    return path


def test_load_page_map_single_offset_covers_body(offsets_file):
    offsets_file.write_text(json.dumps({"noh5": {"offset": 46, "source_sha256": "abc"}}))
    page_map = load_page_map("noh5", offsets_file)
    assert page_map.to_pdf(1) == 47
    assert page_map.to_pdf(185) is None        # PDF 231 is the index


def test_load_page_map_segments(offsets_file):
    offsets_file.write_text(json.dumps({"noh5": {
        "offset": 46, "source_sha256": "abc",
        "segments": [{"first_pdf": 47, "last_pdf": 100, "offset": 46, "verified": 3}]}}))
    assert load_page_map("noh5", offsets_file).segments == (Segment(47, 100, 46, 3),)


def test_load_page_map_wrong_checksum_refuses(offsets_file):
    offsets_file.write_text(json.dumps({"noh5": {"offset": 46, "source_sha256": "other"}}))
    with pytest.raises(RuntimeError, match="different source PDF"):
        load_page_map("noh5", offsets_file)


def piece(vol: str, slug: str) -> dict[str, object]:
    return {"id": f"{vol}-{slug}", "volume": vol, "slug": slug}


def catalog(vol: str, *slugs: str) -> dict[str, object]:
    return {"schema_version": SCHEMA_VERSION, "volumes": {vol: {"page_map": []}},
            "chant_source": None, "pieces": [piece(vol, s) for s in slugs]}


def test_merge_catalog_replaces_only_its_volume():
    merged = merge_catalog(catalog("noh5", "a", "b"), catalog("noh2", "c"))
    merged = merge_catalog(merged, catalog("noh5", "a2"))
    assert [p["slug"] for p in merged["pieces"]] == ["c", "a2"]
    assert set(merged["volumes"]) == {"noh2", "noh5"}


def test_merge_catalog_from_nothing_or_old_schema():
    assert merge_catalog(None, catalog("noh2", "c"))["pieces"] == [piece("noh2", "c")]
    old = {"schema_version": 1, "volume": "noh5", "pieces": [piece("noh5", "x")]}
    assert merge_catalog(old, catalog("noh2", "c"))["pieces"] == [piece("noh2", "c")]


def test_merge_catalog_slug_collision_across_volumes_raises():
    with pytest.raises(ValueError, match="slugs repeat"):
        merge_catalog(catalog("noh5", "kyrie-i"), catalog("noh2", "kyrie-i"))


@pytest.fixture
def noh3_map() -> PageMap:
    """NOH3 as derived: the body in two segments, then two addenda, each
    numbered from its own title page."""
    return PageMap((Segment(34, 409, 33), Segment(410, 475, 35),
                    Segment(480, 489, 478, 1, "regina"), Segment(490, 499, 488, 4, "pius-x")))


def test_page_map_an_addendum_has_its_own_printed_pages(noh3_map):
    assert noh3_map.to_pdf(3) == 36                      # the body's p. 3
    assert noh3_map.to_pdf(3, "regina") == 481
    assert noh3_map.to_pdf(3, "pius-x") == 491
    assert noh3_map.to_pdf(12, "regina") is None         # past its last page
    assert noh3_map.to_pdf(3, "unknown") is None
    assert noh3_map.to_printed(481) == 3 and noh3_map.to_printed(491) == 3
    assert noh3_map.segment_of(495).pagination == "pius-x"


def test_page_map_addenda_are_not_the_body(noh3_map):
    assert noh3_map.last_printed == 440                  # the body's, not an addendum's
    assert noh3_map.last_in("regina") == 11
    assert noh3_map.gaps == []                           # the index pages are not a gap in the body


def test_segment_record_names_a_pagination_only_where_there_is_one(noh3_map):
    from pipeline.offset import segment_record
    assert segment_record(noh3_map.segments[0]) == {"first_pdf": 34, "last_pdf": 409, "offset": 33, "verified": 0}
    assert segment_record(noh3_map.segments[2])["pagination"] == "regina"


def test_load_page_map_reads_an_addendum_segment(offsets_file):
    offsets_file.write_text(json.dumps({"noh5": {"offset": 46, "source_sha256": "abc", "segments": [
        {"first_pdf": 47, "last_pdf": 100, "offset": 46},
        {"first_pdf": 101, "last_pdf": 110, "offset": 98, "pagination": "extra"}]}}))
    assert load_page_map("noh5", offsets_file).to_pdf(3, "extra") == 101
