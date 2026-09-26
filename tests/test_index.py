import pytest

from pipeline.index import load_index, resolve_ranges

GENRES = {"asperges", "mass_ordinary", "credo", "tonus", "kyrie", "gloria",
          "sanctus", "agnus", "requiem", "absolutio", "exsequiis"}


def test_index_has_all_transcribed_entries():
    entries = load_index("noh5")
    assert len(entries) == 46


def test_pages_are_monotonic():
    """The printed index runs in page order; a transcription slip usually shows up
    as an entry that goes backwards."""
    pages = [e.page for e in load_index("noh5")]
    assert pages == sorted(pages)


def test_all_eighteen_ordinary_masses_present():
    labels = {e.label for e in load_index("noh5") if e.genre == "mass_ordinary"}
    roman = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
             "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"}
    assert labels == roman


def test_genres_are_from_the_controlled_set():
    assert {e.genre for e in load_index("noh5")} <= GENRES


def test_credo_i_is_98_not_the_scanned_S8():
    """The scan prints 98 as 'S8'. It is bracketed by XVIII at 96 and Credo II at
    102, so only 98 is possible -- the reasoning OCR cannot do."""
    credo_i = next(e for e in load_index("noh5") if e.label == "Credo I")
    assert credo_i.page == 98


def test_explicit_ranges_are_preserved():
    gloria = next(e for e in load_index("noh5") if e.label == "Gloria I-III")
    assert gloria.printed_pages == (139, 144)


def test_slugs_are_unique():
    """Labels are not unique: 'I'/'II'/'III' occur in both Ordinarium Missae and
    Missa pro Defunctis, and 'Asperges' three times in one section. Keying by label
    alone silently overwrites entries -- Missa I was replaced by the Requiem."""
    slugs = [e.slug for e in load_index("noh5")]
    assert len(slugs) == len(set(slugs)) == 46


def test_colliding_labels_get_distinct_slugs():
    by_slug = {e.slug: e for e in load_index("noh5")}
    assert by_slug["ordinarium-missae-i"].page == 5
    assert by_slug["missa-pro-defunctis-i"].page == 163
    asperges = sorted(e.page for e in load_index("noh5") if e.label == "Asperges")
    assert asperges == [1, 2, 4]


def test_implicit_ranges_run_to_the_next_entry():
    resolved = {e.slug: (lo, hi) for e, lo, hi in resolve_ranges(load_index("noh5"))}
    assert resolved["ordinarium-missae-i"] == (5, 10)   # Missa II starts at 11
    assert resolved["ordinarium-missae-credo-i"] == (98, 101)


@pytest.mark.parametrize("label,page", [
    ("I", 5), ("VIII", 47), ("XVIII", 96), ("Credo IV", 110), ("Kyrie I", 124),
])
def test_spot_checked_pages(label, page):
    entry = next(e for e in load_index("noh5") if e.label == label)
    assert entry.page == page


def test_load_index_sections_declare_their_division():
    divisions = {e.division for e in load_index("noh5")}
    assert divisions == {"kyriale", "defunctorum"}


def test_load_index_requiem_section_is_the_masses_for_the_dead():
    requiem = [e for e in load_index("noh5") if e.section == "Missa pro Defunctis"]
    assert requiem and all(e.division == "defunctorum" for e in requiem)


def test_load_index_unknown_division_is_rejected(tmp_path):
    import yaml
    path = tmp_path / "bad.yml"
    path.write_text(yaml.safe_dump({"sections": [{"name": "S", "division": "motets", "entries": [
        {"label": "A", "title": "t", "genre": "kyrie", "page": 3}]}]}))
    with pytest.raises(ValueError, match="unknown division 'motets'"):
        load_index("x", path)


def test_load_index_days_pass_through_as_calendar_keys(tmp_path):
    import yaml
    path = tmp_path / "days.yml"
    path.write_text(yaml.safe_dump({"sections": [{"name": "S", "division": "temporale", "entries": [
        {"label": "Adv1", "title": "Dominica I Adventus", "genre": "mass_ordinary", "page": 3,
         "days": ["tempora:Adv1-0"]}]}]}))
    [entry] = load_index("x", path)
    assert entry.days == ("tempora:Adv1-0",)
    assert entry.division == "temporale"
