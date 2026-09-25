"""Invariants over the generated 1962 calendar.

These are independent checks, not Missalemeum agreeing with itself: Easter is
computed here with the Meeus/Jones/Butcher algorithm (Missalemeum uses dateutil),
and every movable feast is checked against its fixed offset from that Easter.
Pure data, so this runs in CI without the source PDFs.
"""

import json
from calendar import isleap
from datetime import date, timedelta

import pytest

from pipeline.litcal import CALENDAR_DIR, export_command, load_vocabulary, load_year

SOURCE = json.loads((CALENDAR_DIR / "source.json").read_text(encoding="utf-8"))
YEARS = list(range(SOURCE["years"][0], SOURCE["years"][1] + 1))
VOCAB = load_vocabulary()


def meeus_easter(year: int) -> date:
    """Anonymous Gregorian algorithm (Meeus, Jones, Butcher)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    ell = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ell) // 451
    month = (h + ell - 7 * m + 114) // 31
    day = (h + ell - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def celebrations(year: int, day: date) -> list[str]:
    return load_year(year)[day.isoformat()]["celebration"]


def test_meeus_easter_matches_known_dates():
    """Guards the independent check itself."""
    assert meeus_easter(2025) == date(2025, 4, 20)
    assert meeus_easter(2026) == date(2026, 4, 5)
    assert meeus_easter(2038) == date(2038, 4, 25)   # latest possible in range


def test_source_json_records_provenance():
    assert SOURCE["source"] == "Missalemeum"
    assert SOURCE["licence"] == "MIT"
    assert SOURCE["rubrics"] == "1962"
    assert SOURCE["commit"]


@pytest.mark.parametrize("year", YEARS)
def test_load_year_every_day_present_including_leap_days(year):
    assert len(load_year(year)) == (366 if isleap(year) else 365)


@pytest.mark.parametrize("year", YEARS)
def test_load_year_every_day_has_a_celebration(year):
    empty = [d for d, v in load_year(year).items() if not v["celebration"]]
    assert empty == []


@pytest.mark.parametrize("year", YEARS)
def test_load_year_every_key_is_in_the_vocabulary(year):
    keys = {k for v in load_year(year).values() for k in v["celebration"] + v["commemoration"]}
    assert keys - set(VOCAB) == set()


@pytest.mark.parametrize("year", YEARS)
def test_easter_sunday_falls_on_the_independently_computed_date(year):
    assert "tempora:Pasc0-0" in celebrations(year, meeus_easter(year))


# Keys verified against Missalemeum's own output, not guessed: Palm Sunday and
# Trinity Sunday carry an "r" suffix for their special forms (Quad6-0r, Pent01-0r).
# The first draft of this test guessed Quad6-0 and Pent01-0 and failed 54 times --
# which is the case for using the reference implementation rather than memory.
@pytest.mark.parametrize("year", YEARS)
@pytest.mark.parametrize("offset,key", [
    (-46, "tempora:Quadp3-3"),   # Ash Wednesday
    (-7, "tempora:Quad6-0r"),    # Palm Sunday
    (39, "tempora:Pasc5-4"),     # Ascension
    (49, "tempora:Pasc7-0"),     # Pentecost
    (56, "tempora:Pent01-0r"),   # Trinity Sunday
])
def test_movable_feast_sits_at_its_fixed_offset_from_easter(year, offset, key):
    day = meeus_easter(year) + timedelta(days=offset)
    assert key in celebrations(year, day), f"{key} not on {day}"


@pytest.mark.parametrize("year", YEARS)
def test_septuagesima_is_celebrated_unless_the_purification_displaces_it(year):
    """Septuagesima (Easter - 63) is a II-class Sunday. When it falls on 2 February
    the Purification, a II-class feast of the Lord, takes precedence under the 1962
    rubrics -- as in 2042 and 2048. Any other displacement would be a bug."""
    day = meeus_easter(year) - timedelta(days=63)
    found = celebrations(year, day)
    if day == date(year, 2, 2):
        assert found == ["sancti:02-02"]
    else:
        assert "tempora:Quadp1-0" in found


@pytest.mark.parametrize("year", YEARS)
def test_first_sunday_of_advent_is_the_sunday_nearest_st_andrew(year):
    candidates = [date(year, 11, 27) + timedelta(days=n) for n in range(7)]
    advent1 = next(d for d in candidates if d.weekday() == 6)
    assert "tempora:Adv1-0" in celebrations(year, advent1)


@pytest.mark.parametrize("year", YEARS)
def test_christ_the_king_is_the_last_sunday_of_october(year):
    last = date(year, 10, 31)
    while last.weekday() != 6:
        last -= timedelta(days=1)
    assert "sancti:10-DU" in celebrations(year, last)


@pytest.mark.parametrize("year", YEARS)
def test_christmas_has_three_masses(year):
    """NOH1's own index lists the three Christmas Masses separately; the calendar
    must too, or the date lookup cannot link each to its music."""
    assert celebrations(year, date(year, 12, 25)) == [
        "sancti:12-25m1", "sancti:12-25m2", "sancti:12-25m3"]


def test_vocabulary_every_entry_has_both_titles_and_a_class():
    for key, entry in VOCAB.items():
        assert entry["title_en"] and entry["title_la"], key
        assert entry["rank"] in (1, 2, 3, 4), key
        assert key == f"{entry['flexibility']}:{entry['name']}"


def test_vocabulary_latin_titles_match_the_noh_printed_index():
    """Missalemeum's Latin is the vocabulary index-extract will snap OCR onto, so
    it has to read like NOH's own index. These three are verbatim from INDEX PARTIS I."""
    assert VOCAB["sancti:12-26"]["title_la"] == "S. Stephani Protomartyris"
    assert "Joannis" in VOCAB["sancti:12-27"]["title_la"]
    assert "Innocentium" in VOCAB["sancti:12-28"]["title_la"]


def test_load_year_outside_the_generated_range_names_the_fix():
    with pytest.raises(FileNotFoundError, match="noh calendar --from 1999"):
        load_year(1999)


def test_export_command_runs_isolated_without_trans():
    command = export_command(2026, 2026, CALENDAR_DIR)
    assert "--isolated" in command and "--no-project" in command
    assert not any("trans" in part for part in command)
