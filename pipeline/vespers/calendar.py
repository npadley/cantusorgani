"""The liturgical calendar Vespers keeps, 1962 rubrics: Easter and Advent, the
seasons, the Marian antiphon of the day, "Laus tibi" from Septuagesima, and the
calendar keys of data/calendar (one day's celebration, each key's class).

Split from pipeline.vespers, which re-exports every name here."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from pipeline.volumes import DATA

CALENDAR = DATA / "calendar"


def easter(year: int) -> date:
    """Easter Sunday (Gregorian), by the anonymous algorithm."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    return date(year, month, (h + l_ - 7 * m + 114) % 31 + 1)


def advent_start(year: int) -> date:
    """The first Sunday of Advent: the Sunday from 27 November to 3 December."""
    d = date(year, 11, 27)
    return date.fromordinal(d.toordinal() + (6 - d.weekday()) % 7)


def marian_for(day: date) -> str:
    """The final antiphon of Our Lady sung that day (1962): Alma from Advent to
    the Purification (2 February), Ave Regina from 3 February to Holy Week,
    Regina caeli from Easter to the Saturday after Pentecost, Salve Regina from
    Trinity to Advent."""
    e = easter(day.year)
    if day >= advent_start(day.year) or (day.month, day.day) <= (2, 2):
        return "alma"
    if day < date.fromordinal(e.toordinal() - 3):
        return "ave"
    if day <= date.fromordinal(e.toordinal() + 55):
        return "regina"
    return "salve"


def laus_tibi(day: date) -> bool:
    """From Septuagesima to Holy Saturday, "Laus tibi, Domine" replaces Alleluia."""
    e = easter(day.year).toordinal()
    return e - 63 <= day.toordinal() < e


def season_of(key: str) -> str | None:
    """The season whose hymn and versicle a Sunday takes, where its office has
    none of its own."""
    if key.startswith("tempora:Adv"):
        return "advent"
    if re.match(r"tempora:Quad[1-4]-0", key):
        return "lent"
    if re.match(r"tempora:Quad[56]-0", key):
        return "passiontide"
    if re.match(r"tempora:Pasc[1-5]-0", key):
        return "easter"
    if key.startswith("tempora:Pasc7"):
        return "pentecost"
    return None


def normal_key(key: str) -> str:
    """"tempora:Pent02-0r" -> "tempora:Pent02-0"; "sancti:12-25m3" -> "sancti:12-25"."""
    return re.sub(r"m\d$", "", key.removesuffix("r"))


def calendar_days(calendar_dir: Path = CALENDAR) -> list[tuple[date, dict[str, list[str]]]]:
    out: list[tuple[date, dict[str, list[str]]]] = []
    for f in sorted(calendar_dir.glob("[0-9][0-9][0-9][0-9].json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        for iso, entry in doc["days"].items():
            out.append((date.fromisoformat(iso), entry))
    return out


def ranks(calendar_dir: Path = CALENDAR) -> dict[str, int]:
    """Each calendar key's class (1 = I class), from data/calendar/days.json."""
    path = calendar_dir / "days.json"
    if not path.exists():
        return {}
    return {k: int(v.get("rank", 4)) for k, v in json.loads(path.read_text(encoding="utf-8")).items()}



__all__ = ["CALENDAR", "advent_start", "calendar_days", "easter", "laus_tibi", "marian_for", "normal_key", "ranks",
           "season_of"]
