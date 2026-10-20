"""Export the 1962 calendar from Missalemeum as plain JSON.

Runs INSIDE Missalemeum's own environment (see pipeline/litcal.py, which invokes
it), so none of its dependencies leak into this project. Writes one file per
year plus a vocabulary of every observance seen, keyed by a stable
"flexibility:name" string such as "tempora:Adv1-0" or "sancti:12-26".

Missalemeum (https://github.com/mmolenda/missalemeum) is MIT-licensed. Its
precedence rules are used as-is: reimplementing 1962 precedence from memory is
exactly the kind of invented data this project avoids.
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

from api.kalendar.factory import MissalFactory


def key(observance) -> str:
    return f"{observance.flexibility}:{observance.name}"


def record(vocabulary: dict[str, dict[str, object]], o_en, o_la) -> None:
    k = key(o_en)
    vocabulary.setdefault(k, {
        "key": k,
        "flexibility": o_en.flexibility,
        "name": o_en.name,
        "rank": o_en.rank,
        "colors": list(o_en.colors),
        "title_en": o_en.title,
        "title_la": o_la.title,
    })


def export(first: int, last: int, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    vocabulary: dict[str, dict[str, object]] = {}

    for year in range(first, last + 1):
        calendars = {lang: MissalFactory().create(year, lang) for lang in ("en", "la")}
        days: dict[str, dict[str, object]] = {}
        current = date(year, 1, 1)
        while current.year == year:
            entry: dict[str, object] = {}
            day_en, day_la = (calendars[lang].get_day(current) for lang in ("en", "la"))
            for role in ("celebration", "commemoration"):
                en = getattr(day_en, role)
                la = getattr(day_la, role)
                entry[role] = [key(o) for o in en]
                for o_en, o_la in zip(en, la):
                    record(vocabulary, o_en, o_la)
            # A feria with no Mass of its own takes the Mass of the Sunday
            # before (1960 rubrics); Missalemeum works out which, including
            # Holy Family, Trinity and a Sunday displaced by a feast.
            if not (day_en.celebration and all(o.has_proper() for o in day_en.celebration)):
                borrowed_en, borrowed_la = day_en._infer_observance(), day_la._infer_observance()
                entry["proper_from"] = key(borrowed_en)
                record(vocabulary, borrowed_en, borrowed_la)
            days[current.isoformat()] = entry
            current += timedelta(days=1)
        (out / f"{year}.json").write_text(
            json.dumps({"year": year, "days": days}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )

    (out / "days.json").write_text(
        json.dumps(dict(sorted(vocabulary.items())), ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    export(int(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3]))
