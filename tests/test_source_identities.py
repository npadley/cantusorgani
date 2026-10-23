"""Card S: registered sources, without importing a second production book."""
import pytest
import yaml

from pipeline import corrections, hymnlinks, hymnpairings, sections, volumes
from pipeline.source_refs import parse_range, parse_ref


@pytest.fixture
def foreign_source(monkeypatch):
    registered = volumes.load_volumes()
    monkeypatch.setattr(volumes, "load_volumes", lambda: {**registered, "test-hymnal": object()})
    return "test-hymnal/0001/000"


def test_non_noh_hymn_link_available_target_preserved(tmp_path, foreign_source):
    path = tmp_path / "links.yml"
    path.write_text(yaml.safe_dump({"hymns": [{"titles": ["Fixture"], "pieces": ["foreign", "foreign"]}]}))
    catalog = {"pieces": [{"slug": "foreign", "volume": "test-hymnal", "genre": "hymn", "systems": [foreign_source]}]}
    assert hymnlinks.load_hymn_links(path, catalog) == {"Fixture": ["foreign"]}
    for change in ({"genre": "antiphon"}, {"systems": []}, {"source_note": "Fragment"}, {"volume": "unknown"}):
        with pytest.raises(ValueError):
            hymnlinks.load_hymn_links(path, {"pieces": [{**catalog["pieces"][0], **change}]})


def test_hyphenated_registered_ref_range_and_sections_preserved(foreign_source):
    last = "test-hymnal/0002/001"
    assert parse_ref(foreign_source, volumes.load_volumes())["volume"] == "test-hymnal"
    assert parse_range(f"{foreign_source}-{last}", volumes.load_volumes())[1]["pdf_page"] == 2
    for value in (f"{foreign_source}-{last}", f"{foreign_source} to {last}", [foreign_source, last]):
        assert corrections.coerce("system_range", value) == [foreign_source, last]
    assert corrections.coerce("refs", foreign_source, kind="vespers") == [foreign_source]
    assert sections.parse_value([{"kind": "hymn", "ref": foreign_source}])[0]["ref"] == foreign_source
    assert sections.parse_value([{"kind": "hymn", "borrowed_volume": "test-hymnal", "borrowed_page": 1}])[0]["borrowed_volume"] == "test-hymnal"
    for value in (f"{last}-{foreign_source}", f"{foreign_source}-noh7/0002/001", "unregistered/0001/000-unregistered/0001/001"):
        with pytest.raises(corrections.CorrectionError):
            corrections.coerce("system_range", value)


def test_unknown_refs_fail_at_every_correction_seam():
    with pytest.raises(corrections.CorrectionError):
        corrections.coerce("refs", "unknown/0001/000", kind="vespers")
    with pytest.raises(sections.ReviewedError):
        sections.parse_value([{"kind": "hymn", "ref": "unknown/0001/000"}])
    with pytest.raises(sections.ReviewedError):
        sections.parse_value([{"kind": "hymn", "borrowed_volume": "noh9", "borrowed_page": 1}])


def test_hymn_pairing_ref_requires_registered_source_even_if_owned():
    row = {"ref": "unknown/0001/000", "slug": "fixture", "title": "Fixture", "status": "unresolved", "evidence": "Fixture", "sources": ["https://example.test/"]}
    catalog = {"pieces": [{"slug": "fixture", "genre": "hymn", "systems": [row["ref"]]}]}
    with pytest.raises(ValueError, match="source"):
        hymnpairings.compile_pairings([row], catalog, [])


def test_vespers_correction_keeps_target_source_ownership(foreign_source):
    other = "noh8/0077/000"
    data = corrections.VespersData({}, {"fixture": {"antiphons": [{"n": 1, "refs": [foreign_source]}]}},
                                  frozenset({foreign_source, other}))
    slot = corrections._vespers_slot("vespers:fixture/antiphon-1", "refs", data)
    assert slot.check([foreign_source]) is None
    assert slot.check([other]) is not None


def test_borrowed_ref_requires_its_registered_lending_source(foreign_source):
    entry = {"kind": "hymn", "borrowed_volume": "test-hymnal", "borrowed_page": 1}
    assert sections.parse_value([{**entry, "borrowed_ref": foreign_source}])[0]["borrowed_ref"] == foreign_source
    for ref in ("unknown/0001/000", "noh8/0077/000"):
        with pytest.raises(sections.ReviewedError):
            sections.parse_value([{**entry, "borrowed_ref": ref}])
