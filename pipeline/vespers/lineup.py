"""The lineup: each date's Vespers, item by item in the order sung, written to
data/vespers/vespers-lineup.json, and the one-day view of `noh vespers-lineup --day`."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import Path

from pipeline.vespers.calendar import (
    CALENDAR,
    calendar_days,
    laus_tibi,
    marian_for,
    normal_key,
    ranks,
    season_of,
)
from pipeline.vespers.music import (
    PSALM_TITLES,
    _item,
    _music,
    _note,
    _psalm_verses,
    _source,
    magnificat_music,
    psalm_music,
)
from pipeline.vespers.reviewed import (
    CATALOG,
    GREEN,
    LINEUP,
    REVIEWED,
    SCHEMA_VERSION,
    Reviewed,
    load_reviewed,
    tone_label,
)


def build_office(day: date, key: str, vespers: str, reviewed: Reviewed,
                 commemorations: list[str] | None = None
                 ) -> tuple[list[dict[str, object]] | None, str | None]:
    """One Vespers, item by item, in the order sung; or (None, why)."""
    doc = reviewed.doc
    so = doc["sunday_office"]                               # type: ignore[index]
    k = normal_key(key)
    base = f"{day.isoformat()}/{k}/{vespers}"
    green = bool(GREEN.match(k)) and vespers == "II"
    found = None if green else reviewed.office_for(k, vespers)
    if not green and found is None:
        return None, f"NOH VIII prints no {vespers} Vespers for {k}"
    office: dict[str, object] = found[1] if found else {}
    oid = str(found[0]) if found else None
    season = season_of(k)
    easter_octave = k == "tempora:Pasc0-0"
    paschal = office.get("antiphons") == "sunday" and season == "easter"

    items: list[dict[str, object]] = [
        _item(f"{base}/initium/1", "initium", "initium", "Deus in adjutorium", _source(so["initium"]["refs"])),
    ]
    if laus_tibi(day):
        items.append(_item(f"{base}/initium/2", "initium", "initium", "Laus tibi, Domine",
                           _source(["noh8/0032/000"], text="From Septuagesima to Easter, “Laus tibi, Domine, Rex "
                                                          "aeternae gloriae” is sung in place of Alleluia.")))

    # The psalms, each under its antiphon.
    if green or office.get("antiphons") == "sunday" and not paschal:
        rows = [{"n": n, "incipit": ps["antiphon"]["incipit"], "psalm": ps["number"], "tone": ps["tone"],
                 "refs": ps["antiphon"]["refs"], "chant": ps["antiphon"].get("chant")}
                for n, ps in enumerate(so["psalms"], start=1)]
    elif paschal:
        pa = doc["seasons"]["easter"]["antiphon"]            # type: ignore[index]
        rows = [{"n": n, "incipit": pa["incipit"], "psalm": p, "tone": pa["tone"], "refs": pa["refs"],
                 "chant": pa.get("chant"), "single": True} for n, p in enumerate((109, 110, 111, 112, 113), start=1)]
    else:
        rows = [dict(r, target=f"vespers:{oid}/antiphon-{r.get('n')}")
                for r in office["antiphons"]]                  # type: ignore[union-attr]
    for n, row in enumerate(rows, start=1):
        group = f"psalm-{n}"
        psalm = row.get("psalm") or (108 + n)
        tone = row.get("tone")
        single = row.get("single")
        title = PSALM_TITLES.get(int(psalm), f"Psalm {psalm}")
        if not single or n == 1:
            if row.get("refs") or row.get("note"):
                items.append(_item(f"{base}/antiphon/{n}", group, "antiphon", str(row["incipit"]),
                                   _music(row), tone, row.get("chant"), n, target=row.get("target")))
            else:
                items.append(_item(f"{base}/antiphon/{n}", group, "antiphon", str(row["incipit"]),
                                   _note("This antiphon is not printed in NOH VIII."), None, None, n))
        music, with_text = psalm_music(reviewed, int(psalm), tone, row.get("opening"))
        items.append(_item(f"{base}/psalm/{n}", group, "psalm", f"Psalm {psalm}: {title}", music, tone, None,
                           int(psalm), psalm_text=_psalm_verses(reviewed, int(psalm)) if with_text else None))
        if (not single or n == len(rows)) and row.get("refs") and not row.get("note"):
                items.append(_item(f"{base}/antiphon/{n}r", group, "antiphon", str(row["incipit"]),
                                   _source(row["refs"]), tone, row.get("chant"), n, repeat=True))

    if easter_octave:
        hd = doc["seasons"]["easter_octave"]["haec_dies"]    # type: ignore[index]
        items.append(_item(f"{base}/chapter/1", "chapter", "chapter", "Haec dies",
                           _source(hd["refs"], text="In the Easter octave “Haec dies” takes the place of the "
                                                    "chapter, hymn and versicle.")))
    else:
        chapter = office.get("chapter") or so["chapter"]["text"]
        items.append(_item(f"{base}/chapter/1", "chapter", "chapter", "Chapter",
                           _source(so["chapter"]["refs"], text=chapter)))
        seasonal = (doc.get("seasons") or {}).get(season or "", {})     # type: ignore[union-attr]
        hymn = office.get("hymn") if isinstance(office.get("hymn"), dict) else None
        if hymn and hymn.get("refs"):
            items.append(_item(f"{base}/hymn/1", "hymn", "hymn", str(hymn["title"]), _source(hymn["refs"]),
                               hymn.get("tone"), hymn.get("chant")))
        elif hymn:
            items.append(_item(f"{base}/hymn/1", "hymn", "hymn", str(hymn["title"]).rstrip(","),
                               _note(f"NOH VIII prints no accompaniment for this hymn ({hymn['title']}).")))
        elif seasonal.get("hymn"):
            h = seasonal["hymn"]
            items.append(_item(f"{base}/hymn/1", "hymn", "hymn", h["title"], _source(h["refs"]), h.get("tone")))
        else:
            items.append(_item(f"{base}/hymn/1", "hymn", "hymn", so["hymn"]["title"], _source(so["hymn"]["refs"]),
                               so["hymn"]["tone"], so["hymn"].get("chant")))
        if office.get("versicle"):
            items.append(_item(f"{base}/versicle/1", "hymn", "versicle", "Versicle", _source(office["versicle"])))
        elif seasonal.get("versicle"):
            v = seasonal["versicle"]
            items.append(_item(f"{base}/versicle/1", "hymn", "versicle", "Versicle",
                               _source(v["refs"], text=v.get("text"))))
        elif green or office.get("antiphons") == "sunday":
            items.append(_item(f"{base}/versicle/1", "hymn", "versicle", "Versicle",
                               _source(so["versicle"]["refs"], text=so["versicle"]["text"])))
        else:
            items.append(_item(f"{base}/versicle/1", "hymn", "versicle", "Versicle",
                               _note("The versicle of the feast; NOH VIII does not print it here.")))

    # The Magnificat: an O antiphon from 17 to 23 December.
    o_days = (doc.get("o_antiphons") or {}).get("days", {})      # type: ignore[union-attr]
    mag: dict[str, object] | None
    mag_target: str | None = None
    if f"{day.month:02d}-{day.day:02d}" in o_days and k.startswith("tempora:Adv"):
        o = o_days[f"{day.month:02d}-{day.day:02d}"]
        mag = {"incipit": o["incipit"], "tone": doc["o_antiphons"]["tone"], "refs": o["refs"], "chant": o.get("chant")}
    elif green:
        mag = doc["magnificat_antiphons"].get(k)             # type: ignore[union-attr]
        mag_target = f"vespers:sunday:{k}/magnificat"
    else:
        mag = office.get("magnificat") if isinstance(office.get("magnificat"), dict) else None
        mag_target = f"vespers:{oid}/magnificat" if oid else None
    if mag is None:
        return None, f"{k}: no Magnificat antiphon for {vespers} Vespers"
    mag_tone = mag.get("tone")
    mag_source = _music(mag)
    items += [
        _item(f"{base}/magnificat-antiphon/1", "magnificat", "magnificat-antiphon", str(mag["incipit"]),
              mag_source, mag_tone, mag.get("chant"), target=mag_target),
        _item(f"{base}/magnificat/1", "magnificat", "magnificat", "Magnificat",
              magnificat_music(reviewed, mag_tone), mag_tone),
    ]
    if mag.get("refs") and not mag.get("note"):
        items.append(_item(f"{base}/magnificat-antiphon/1r", "magnificat", "magnificat-antiphon",
                           str(mag["incipit"]), mag_source, mag_tone, mag.get("chant"), repeat=True))
    items.append(_item(f"{base}/oration/1", "oration", "oration", "Collect",
                       _note("The collect of the day, as at Mass.")))
    for c in commemorations or []:
        items.append(_item(f"{base}/commemoration/{c}", "oration", "commemoration", "Commemoration", _note(c)))
    bene = doc["seasons"]["easter_octave"]["benedicamus"]["refs"] if easter_octave else so["benedicamus"]["refs"]
    items.append(_item(f"{base}/benedicamus/1", "benedicamus", "benedicamus", "Benedicamus Domino", _source(bene)))
    marian = doc["marian_antiphons"]                        # type: ignore[index]
    which = marian_for(day)
    m = marian[which]
    versicle = m["versicle_advent"] if which == "alma" and season == "advent" and m.get("versicle_advent") \
        else m["versicle"]
    items += [
        _item(f"{base}/marian-antiphon/1", "marian", "marian-antiphon", m["title"], _source(m["refs"]), None,
              m.get("chant")),
        _item(f"{base}/versicle/2", "marian", "versicle", "Versicle and prayer", _source(versicle)),
    ]
    return items, None


def sunday_lineup(day: date, office: str, reviewed: Reviewed, commemorations: list[str] | None = None
                  ) -> tuple[list[dict[str, object]] | None, str | None]:
    """II Vespers of a Sunday (kept for callers of release 1)."""
    return build_office(day, office, "II", reviewed, commemorations)


def catalog_sha256(catalog_path: Path = CATALOG) -> str:
    return hashlib.sha256(catalog_path.read_bytes()).hexdigest()


def build_lineup(reviewed: Reviewed, days: list[tuple[date, dict[str, list[str]]]],
                 catalog_digest: str, rank: dict[str, int] | None = None
                 ) -> tuple[dict[str, object], list[dict[str, object]]]:
    """The lineup document and its review entries.

    Every Sunday, and every feast NOH8 prints, gets its II Vespers (on the
    Vigil of Christmas, I Vespers of Christmas: that evening's office). A I
    class feast also gets I Vespers, sung the evening before, at
    /vespers/<feast date>/i/."""
    rank = rank or {}
    known = set(rank)

    def observance(raw: str, office: str) -> str:
        """The calendar's key that names the day on the site: the office's own,
        as a Sunday "r"esumed, or Christmas's Mass of the day (m3: Vespers take
        its title, not the Midnight Mass's), else the celebration as given."""
        for candidate in (office, f"{office}r", f"{office}m3", raw):
            if candidate in known:
                return candidate
        return office

    out: dict[str, object] = {}
    first: dict[str, object] = {}
    held: dict[str, str] = {}
    review: list[dict[str, object]] = []
    for i, (day, entry) in enumerate(days):
        celebration = entry.get("celebration") or []
        if not celebration:
            continue
        key = normal_key(celebration[0])
        commemorations = list(entry.get("commemoration") or [])
        if key == "sancti:12-24":
            items, why = build_office(day, "sancti:12-25", "I", reviewed, commemorations)
            if items:
                out[day.isoformat()] = {"office": "sancti:12-25", "observance": observance("", "sancti:12-25"),
                                        "vespers": "I", "items": items}
            continue
        wanted = day.weekday() == 6 or reviewed.office_for(key, "II") is not None
        if wanted:
            items, why = build_office(day, key, "II", reviewed, commemorations)
            if items is None:
                if day.weekday() == 6:
                    held[day.isoformat()] = why or ""
            else:
                out[day.isoformat()] = {"office": key, "observance": observance(celebration[0], key),
                                        "vespers": "II", "items": items}
        # I Vespers of tomorrow's I class feast, sung this evening.
        if i + 1 < len(days):
            tomorrow, t_entry = days[i + 1]
            t_key = normal_key((t_entry.get("celebration") or [""])[0])
            if t_key != "sancti:12-25" and rank.get((t_entry.get("celebration") or [""])[0], rank.get(t_key, 4)) == 1:
                items, _ = build_office(tomorrow, t_key, "I", reviewed, [])
                if items:
                    first[tomorrow.isoformat()] = {
                        "office": t_key, "observance": observance((t_entry.get("celebration") or [""])[0], t_key),
                        "vespers": "I", "evening_of": day.isoformat(), "items": items}
    for why in sorted(set(held.values())):
        review.append({"piece": "vespers", "kind": "office_unprinted", "why": f"{why}; those Sundays have no page",
                       "fix": "NOH VIII has no section for this office: nothing to add unless another volume prints it"})
    unprinted = sorted({i["tone"] for d in out.values() for i in d["items"]           # type: ignore[union-attr]
                        if i["kind"] == "magnificat" and i["source"]["type"] == "note" and i["tone"]})
    if unprinted:
        review.append({"piece": "vespers", "kind": "tone_unprinted",
                       "why": "Magnificat tones NOH VIII prints no accompaniment for (the page shows a note): "
                              + ", ".join(unprinted),
                       "fix": "add a psalm_formulas or magnificats entry from a printed accompaniment in that "
                              "exact tone and ending"})
    doc = {"schema_version": SCHEMA_VERSION, "catalog_sha256": catalog_digest,
           "days": out, "first_vespers": first, "held_back": held}
    return doc, review


def tone_disagreements(reviewed: Reviewed, vesperale: dict[str, dict[str, str]]) -> list[dict[str, object]]:
    """Magnificat tones where NOH8's margin and vesperale's table differ. NOH8's
    label is used; each difference is queued for a look at the scan."""
    from pipeline.vesperale import tone_of
    out: list[dict[str, object]] = []
    for key, entry in reviewed.doc["magnificat_antiphons"].items():   # type: ignore[union-attr]
        theirs = vesperale.get(key)
        if theirs is None:
            continue
        other = tone_of(theirs["tone"])
        if other != entry["tone"]:
            out.append({"piece": "vespers", "kind": "tone_disagreement", "office": key,
                        "why": (f"Magnificat antiphon {entry['incipit']!r} ({entry['refs'][0]}): NOH8 margin "
                                f"reads {entry['tone']}, vesperale says {other or theirs['tone']} "
                                f"({theirs['antiphon']}). The NOH8 label is used; confirm against the scan.")})
    return out


# The site publishes a rolling window of years: the last one, and five ahead.
YEARS_BEHIND, YEARS_AHEAD = 1, 5


def window(days: list[tuple[date, dict[str, list[str]]]], today: date | None = None
           ) -> list[tuple[date, dict[str, list[str]]]]:
    from datetime import UTC, datetime
    year = (today or datetime.now(UTC).date()).year
    return [(d, e) for d, e in days if year - YEARS_BEHIND <= d.year <= year + YEARS_AHEAD]


def lineup_anchor(path: Path = LINEUP) -> date | None:
    """The `today` an existing lineup was built for, from its own dates: a
    rebuild for a correction keeps the window it already covers, whatever the
    year is now."""
    if not path.exists():
        return None
    doc = json.loads(path.read_text(encoding="utf-8"))
    years = [int(d[:4]) for d in doc.get("days", {})]
    return date(min(years) + YEARS_BEHIND, 7, 1) if years else None


def lineup_text(reviewed_path: Path = REVIEWED, catalog_path: Path = CATALOG, calendar_dir: Path = CALENDAR,
                today: date | None = None) -> str:
    """The lineup file as write_lineup would write it."""
    return dump_lineup(_lineup(reviewed_path, catalog_path, calendar_dir, today)[0])


def write_lineup(path: Path = LINEUP, reviewed_path: Path = REVIEWED,
                 catalog_path: Path = CATALOG, calendar_dir: Path = CALENDAR, today: date | None = None
                 ) -> tuple[Path, dict[str, object], list[dict[str, object]]]:
    doc, review = _lineup(reviewed_path, catalog_path, calendar_dir, today)
    path.write_text(dump_lineup(doc), encoding="utf-8")
    return path, doc, review


def _lineup(reviewed_path: Path, catalog_path: Path, calendar_dir: Path, today: date | None
            ) -> tuple[dict[str, object], list[dict[str, object]]]:
    reviewed = load_reviewed(reviewed_path, catalog_path)
    doc, review = build_lineup(reviewed, window(calendar_days(calendar_dir), today), catalog_sha256(catalog_path),
                               ranks(calendar_dir))
    from pipeline.vesperale import VesperaleIntegrityError, load_magnificat
    try:
        review += tone_disagreements(reviewed, load_magnificat())
    except VesperaleIntegrityError as exc:
        # A cross-check only: the lineup stands on NOH8's labels without it.
        review.append({"piece": "vespers", "kind": "vesperale_unavailable", "why": str(exc)})
    doc["review"] = review
    return doc, review


def dump_lineup(doc: dict[str, object]) -> str:
    """JSON with one day per line: a rebuild's diff shows the days that changed."""
    def one(value: object) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    days: dict[str, object] = doc["days"]      # type: ignore[assignment]
    head = {k: v for k, v in doc.items() if k != "days"}
    body = ",\n".join(f"  {one(k)}:{one(v)}" for k, v in days.items())
    rest = ",\n".join(f" {one(k)}:{one(v)}" for k, v in head.items())
    return "{\n" + rest + ',\n "days":{\n' + body + "\n }\n}\n"


def check_lineup(path: Path = LINEUP, catalog_path: Path = CATALOG) -> str | None:
    """None when the lineup is current, else what is wrong: a ref the catalogue
    no longer has, or a catalogue rebuilt since the lineup was written."""
    if not path.exists():
        return f"{path.name} is missing"
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("schema_version") != SCHEMA_VERSION:
        return f"{path.name} schema_version {doc.get('schema_version')}, expected {SCHEMA_VERSION}"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    known = {r for p in catalog["pieces"] for r in p["systems"]}
    missing = sorted({r for d in doc["days"].values() for i in d["items"]
                      for r in i["source"].get("refs") or [] if r not in known})
    if missing:
        return f"{len(missing)} system(s) the catalogue no longer has, e.g. {missing[0]}"
    if doc.get("catalog_sha256") != catalog_sha256(catalog_path):
        return "data/catalog.base.json has changed since the lineup was written"
    return None


def referenced_chants(path: Path = LINEUP) -> set[int]:
    """Every GregoBase id the lineup shows, for data/chants.json."""
    if not path.exists():
        return set()
    doc = json.loads(path.read_text(encoding="utf-8"))
    return {int(i["chant"]) for d in doc["days"].values() for i in d["items"]
            if isinstance(i.get("chant"), int)}


# ------------------------------------------------------------ one-day view ---

def resolve_day(arg: str, days: list[tuple[date, dict[str, list[str]]]]) -> list[str]:
    """Dates ("2026-09-06") for --day: a date as given, or every date a key such
    as tempora:Pent15-0 falls on. Raises ValueError with the fix."""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", arg):
        if not any(d.isoformat() == arg for d, _ in days):
            raise ValueError(f"{arg} has no entry in data/calendar; pass a date the calendar covers "
                             f"or a key such as tempora:Pent15-0")
        return [arg]
    found = [d.isoformat() for d, e in days if arg in (e.get("celebration") or [])
             or f"{arg}r" in (e.get("celebration") or [])]
    if not found:
        raise ValueError(f"{arg} is not a celebration in data/calendar; pass a date such as "
                         f"2026-09-06 or a key such as tempora:Pent15-0")
    return found


def describe(day_iso: str, doc: dict[str, object], owner_page: dict[str, int] | None = None) -> str:
    """That day's lineup, one line per item, for checking against the book."""
    days: dict[str, dict[str, object]] = doc["days"]      # type: ignore[assignment]
    held: dict[str, str] = doc.get("held_back") or {}      # type: ignore[assignment]
    if day_iso not in days:
        if day_iso in held:
            return f"{day_iso}: held back -- {held[day_iso]}"
        return f"{day_iso}: no Vespers lineup (not a green Sunday, or displaced by a feast)"
    day = days[day_iso]
    lines = [f"{day_iso}  {day['office']}  {day['vespers']} Vespers"]
    for n, item in enumerate(day["items"], start=1):      # type: ignore[arg-type]
        src = item["source"]
        refs = src.get("refs") or []
        if src["type"] == "note":
            where = "note"
        else:
            pages = sorted({int(r.split("/")[1]) - 30 for r in refs})
            span = f"p. {pages[0]}" + (f"-{pages[-1]}" if len(pages) > 1 else "")
            where = f"NOH8 {span}, {len(refs)} system{'s' if len(refs) != 1 else ''}"
            if src["type"] == "bank":
                where = f"tone bank: {src['bank_label']} ({src['borrowed_from']})"
        chant = f"chant {item['chant']}" if item.get("chant") else "no chant"
        tone = tone_label(item["tone"]) if item.get("tone") else ""
        label = item["label"] + (" (repeated)" if item.get("repeat") else "")
        lines.append(f"{n:>3}  {item['kind']:<20} {label:<34} {tone:<16} {where:<44} {chant}")
    return "\n".join(lines)


