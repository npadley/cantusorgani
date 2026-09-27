"""The full music of Sunday Vespers, item by item, in the order it is sung.

Release 1 covers the green Sundays (after Epiphany and after Pentecost). Their
office is the Sunday psalter of NOH8 pp. 1-27 -- five antiphons and psalms,
the chapter's response, *Lucis Creator*, the versicle, the Benedicamus -- plus
the day's Magnificat antiphon and the Magnificat in its tone. Each Sunday ends
with the Marian antiphon of the season.

- data/vespers-noh8.yml holds every item's systems, reviewed by hand against the
  scans; `noh vespers-items` proposes the Magnificat antiphons and their tones
  (data/vespers-noh8.proposed.yml) from the headings and a wide margin crop.
- The site's 1962 calendar (data/calendar/<year>.json) alone decides which office
  a date keeps. A green Sunday displaced by a feast (Christ the King, All Saints)
  gets no green lineup.
- NOH8 prints the Magnificat itself only in VIII G. For another tone the psalm
  formula in the same tone and ending serves (the tone bank). A tone the bank
  lacks is never guessed from a neighbour: that Sunday is held back and queued
  (`tone_unprinted`).

`noh vespers-lineup` writes data/vespers-lineup.json, keyed by civil date.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

from pipeline.volumes import DATA

REVIEWED = DATA / "vespers-noh8.yml"
PROPOSED = DATA / "vespers-noh8.proposed.yml"
LINEUP = DATA / "vespers-lineup.json"
CALENDAR = DATA / "calendar"
# The generated catalogue: hand corrections change titles, never systems, so
# they do not make the lineup stale.
CATALOG = DATA / "catalog.base.json"
SCHEMA_VERSION = 1

# The psalm-tone endings NOH8 prints (extended from the book, never by guessing).
TONES = frozenset({
    "I.D", "I.D2", "I.f", "I.g", "I.g2", "I.g3", "I.a", "I.a2", "I.a3", "II.D",
    "III.a", "III.a2", "III.b", "III.g", "IV.E", "IV.A", "IV.A*", "IV.g", "V.a",
    "VI.F", "VI.C", "VII.a", "VII.b", "VII.c", "VII.c2", "VII.d", "VII.e", "VII.e2",
    "VIII.G", "VIII.G*", "VIII.c", "II.A", "peregrinus",
})
_ROMANS = ("VIII", "VII", "VI", "IV", "V", "III", "II", "I")
# OCR's common readings of a roman mode ("VIILG" = VIII.G, "Vil" = VII).
_OCR_ROMAN = {"VIIL": "VIII", "VHI": "VIII", "VIIl": "VIII", "VIIi": "VIII", "VHL": "VIII",
              "Vil": "VII", "VIl": "VII", "VU": "VII", "VIL": "VII", "Vll": "VII",
              "lil": "III", "Iil": "III", "IIl": "III", "Ill": "III", "Il": "II", "ll": "II",
              "W": "IV", "IN": "IV", "l": "I", "1": "I"}

GREEN = re.compile(r"^tempora:(Epi[2-6]|Pent(?:0[2-9]|1\d|2[0-4]))-0r?$")


def normalise_tone(raw: str) -> str | None:
    """A printed tone label in NOH's notation, or None when it is not one NOH8
    prints: "VIII. G" -> "VIII.G", "VIILG" -> "VIII.G", "I. g 2" -> "I.g2",
    "IV.A*" -> "IV.A*", "T. pereg." -> "peregrinus"."""
    text = raw.strip()
    if re.search(r"\bT\.?\s*pere", text, re.IGNORECASE):
        return "peregrinus"
    text = re.sub(r"^.*?Ant\.?\s*", "", text)             # "Ad Magnif. Ant. VII. b"
    m = re.match(r"([IVXLHNUWil1]{1,5})[\s.,]*([A-Ga-g])?\s*(\d)?\s*(\*)?", text)
    if m is None:
        return None
    roman, ending, digit, star = m.groups()
    for ocr, fixed in sorted(_OCR_ROMAN.items(), key=lambda kv: -len(kv[0])):
        if roman.startswith(ocr) and roman not in _ROMANS:
            rest = roman[len(ocr):]
            roman = fixed
            if not ending and rest[:1] in ("G",):          # "VIILG": the G was the ending
                ending = rest[:1]
            break
    if roman not in _ROMANS:
        return None
    tone = roman + (f".{ending}{digit or ''}" if ending else "") + (star or "")
    return tone if tone in TONES else None


def tone_label(tone: str) -> str:
    """For headings: "VII.c2" -> "VII c2", "peregrinus" -> "tonus peregrinus"."""
    return "tonus peregrinus" if tone == "peregrinus" else tone.replace(".", " ")


# ------------------------------------------------------------ reviewed data ---

class VespersDataError(ValueError):
    """The reviewed items name a system the catalogue lacks, or a tone NOH8 does not print."""


@dataclass(frozen=True)
class Reviewed:
    doc: dict[str, object]                  # data/vespers-noh8.yml
    offices: dict[str, dict[str, object]]   # data/vespers-offices.yml
    texts: dict[str, object]                # Divinum Officium's texts (the psalms)
    known: frozenset[str]                   # every system in the catalogue

    def office_for(self, key: str, vespers: str) -> tuple[str, dict[str, object]] | None:
        for oid, o in self.offices.items():
            if o.get("vespers") == vespers and key in (o.get("keys") or []):
                return oid, o
        return None


def load_reviewed(path: Path = REVIEWED, catalog_path: Path = CATALOG, offices_path: Path | None = None,
                  texts_path: Path | None = None) -> Reviewed:
    """The reviewed items, checked: every system they name is in the current
    catalogue, and every tone is one NOH8 prints."""
    from pipeline.officium import VENDORED, OfficiumError, load

    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    op = offices_path or path.with_name("vespers-offices.yml")
    offices = (yaml.safe_load(op.read_text(encoding="utf-8")) or {}).get("offices", {}) if op.exists() else {}
    try:
        texts = load(texts_path or VENDORED)
    except OfficiumError:
        texts = {"psalms": {}}
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    known = frozenset(r for p in catalog["pieces"] for r in p["systems"])
    problems: list[str] = []

    def check(refs: list[str] | None, where: str) -> None:
        for r in refs or []:
            if r not in known:
                problems.append(f"{where}: {r} is not in the catalogue")

    def tone(value: str | None, where: str) -> None:
        if value is not None and value not in TONES:
            problems.append(f"{where}: tone {value!r} is not one NOH8 prints (pipeline/vespers.py TONES)")

    so = doc["sunday_office"]
    check(so["initium"]["refs"], "sunday_office.initium")
    for ps in so["psalms"]:
        tone(ps["tone"], f"psalm {ps['number']}")
        check(ps["antiphon"]["refs"] + ps["psalm"], f"psalm {ps['number']}")
    for name in ("chapter", "hymn", "versicle", "benedicamus"):
        check(so[name]["refs"], f"sunday_office.{name}")
    for name in ("alma", "ave", "regina", "salve"):
        m = doc["marian_antiphons"][name]
        check(m["refs"] + m["versicle"] + m.get("versicle_advent", []), f"marian_antiphons.{name}")
    for key, entry in doc["magnificat_antiphons"].items():
        tone(entry["tone"], key)
        check(entry["refs"], key)
    for entry in doc.get("magnificats", []) + doc.get("psalm_formulas", []):
        tone(entry["tone"], f"tone bank {entry['tone']}")
        check(entry["refs"], f"tone bank {entry['tone']}")
    for season, parts in (doc.get("seasons") or {}).items():
        for name, entry in parts.items():
            check(entry.get("refs"), f"seasons.{season}.{name}")
    for day, entry in (doc.get("o_antiphons") or {}).get("days", {}).items():
        check(entry["refs"], f"o_antiphons.{day}")
    for oid, o in offices.items():
        for a in o.get("antiphons") if isinstance(o.get("antiphons"), list) else []:
            tone(a.get("tone"), f"{oid} antiphon {a.get('n')}")
            check(a.get("refs"), f"{oid} antiphon {a.get('n')}")
            check(a.get("opening"), f"{oid} antiphon {a.get('n')} opening")
        for name in ("magnificat", "hymn"):
            if isinstance(o.get(name), dict):
                tone(o[name].get("tone") if name == "magnificat" else None, f"{oid} {name}")
                check(o[name].get("refs"), f"{oid} {name}")
        check(o.get("versicle"), f"{oid} versicle")
    if problems:
        raise VespersDataError(f"{path.name} / {op.name}:\n  " + "\n  ".join(problems)
                               + "\n  Fix the entry against the scan, or re-run noh catalog if the "
                                 "catalogue is out of date.")
    return Reviewed(doc, offices, texts, known)


# ---------------------------------------------------------------- calendar ---

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


# --------------------------------------------------------------- the lineup ---

def _source(refs: list[str], **extra: object) -> dict[str, object]:
    return {"type": "printed", "refs": list(refs), **extra}


def _note(text: str) -> dict[str, object]:
    return {"type": "note", "text": text}


def _item(key: str, group: str, kind: str, label: str, source: dict[str, object],
          tone: str | None = None, chant: int | None = None, number: int | None = None,
          repeat: bool = False, psalm_text: list[str] | None = None) -> dict[str, object]:
    item: dict[str, object] = {"item_key": key, "group": group, "kind": kind, "number": number, "label": label,
                               "tone": tone, "source": source, "chant": chant, "repeat": repeat}
    if psalm_text:
        item["psalm_text"] = psalm_text
    return item


PSALM_TITLES = {109: "Dixit Dominus", 110: "Confitebor tibi", 111: "Beatus vir", 112: "Laudate pueri",
                113: "In exitu Israel", 115: "Credidi", 116: "Laudate Dominum", 121: "Laetatus sum",
                125: "In convertendo", 126: "Nisi Dominus", 127: "Beati omnes", 129: "De profundis",
                131: "Memento Domine", 138: "Domine probasti me", 147: "Lauda Jerusalem"}


def psalm_music(reviewed: Reviewed, psalm: int, tone: str | None, opening: list[str] | None
                ) -> tuple[dict[str, object], bool]:
    """The accompaniment a psalm is played from, and whether its text should be
    printed beside it: the Sunday psalter's full psalm when NOH8 prints this
    psalm in this tone; the office's own printed opening; a printed formula in
    the same tone and ending (the same psalm first); otherwise a note."""
    for ps in reviewed.doc["sunday_office"]["psalms"]:      # type: ignore[index]
        if ps["number"] == psalm and ps["tone"] == tone:
            return _source(ps["psalm"]), False
    if opening:
        return _source(opening, opening_only=True), True
    if tone:
        formulas = [f for f in reviewed.doc.get("psalm_formulas", []) if f["tone"] == tone]   # type: ignore[union-attr]
        formulas.sort(key=lambda f: f["psalm"] != psalm)
        if formulas:
            f = formulas[0]
            return ({"type": "bank", "refs": list(f["refs"]), "bank_kind": "psalm",
                     "bank_label": f"Psalm {f['psalm']} in {tone_label(tone)}",
                     "borrowed_from": f"{f['source']}, p. {f['page']}"}, True)
        return _note(f"No accompaniment in {tone_label(tone)} is printed in NOH VIII; "
                     f"the psalm is sung in that tone."), True
    return _note("The tone of this psalm is not printed."), True


def magnificat_music(reviewed: Reviewed, tone: str | None) -> dict[str, object]:
    doc = reviewed.doc
    for m in doc.get("magnificats", []):                   # type: ignore[union-attr]
        if m["tone"] == tone:
            return {"type": "bank", "refs": list(m["refs"]), "bank_kind": "magnificat", "bank_label": m["label"],
                    "borrowed_from": f"{m['source']}, p. {m['page']}"}
    if tone:
        formulas = [f for f in doc.get("psalm_formulas", []) if f["tone"] == tone]   # type: ignore[union-attr]
        if formulas:
            f = formulas[0]
            return {"type": "bank", "refs": list(f["refs"]), "bank_kind": "psalm",
                    "bank_label": f"Psalm {f['psalm']} in {tone_label(tone)}",
                    "borrowed_from": f"{f['source']}, p. {f['page']}"}
        return _note(f"No accompaniment for the Magnificat in {tone_label(tone)} is printed in NOH VIII; "
                     f"sing it unaccompanied or improvise in {tone_label(tone)}.")
    return _note("The tone of the Magnificat is not printed.")


def _psalm_verses(reviewed: Reviewed, psalm: int) -> list[str]:
    return list(reviewed.texts.get("psalms", {}).get(str(psalm), []))      # type: ignore[union-attr]


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
        rows = [dict(r) for r in office["antiphons"]]        # type: ignore[union-attr]
    for n, row in enumerate(rows, start=1):
        group = f"psalm-{n}"
        psalm = row.get("psalm") or (108 + n)
        tone = row.get("tone")
        single = row.get("single")
        title = PSALM_TITLES.get(int(psalm), f"Psalm {psalm}")
        if not single or n == 1:
            if row.get("refs"):
                items.append(_item(f"{base}/antiphon/{n}", group, "antiphon", str(row["incipit"]),
                                   _source(row["refs"]), tone, row.get("chant"), n))
            else:
                items.append(_item(f"{base}/antiphon/{n}", group, "antiphon", str(row["incipit"]),
                                   _note("This antiphon is not printed in NOH VIII."), None, None, n))
        music, with_text = psalm_music(reviewed, int(psalm), tone, row.get("opening"))
        items.append(_item(f"{base}/psalm/{n}", group, "psalm", f"Psalm {psalm}: {title}", music, tone, None,
                           int(psalm), psalm_text=_psalm_verses(reviewed, int(psalm)) if with_text else None))
        if (not single or n == len(rows)) and row.get("refs"):
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
    if f"{day.month:02d}-{day.day:02d}" in o_days and k.startswith("tempora:Adv"):
        o = o_days[f"{day.month:02d}-{day.day:02d}"]
        mag = {"incipit": o["incipit"], "tone": doc["o_antiphons"]["tone"], "refs": o["refs"], "chant": o.get("chant")}
    elif green:
        mag = doc["magnificat_antiphons"].get(k)             # type: ignore[union-attr]
    else:
        mag = office.get("magnificat") if isinstance(office.get("magnificat"), dict) else None
    if mag is None:
        return None, f"{k}: no Magnificat antiphon for {vespers} Vespers"
    mag_tone = mag.get("tone")
    mag_source = _source(mag["refs"]) if mag.get("refs") else _note("This antiphon is not printed in NOH VIII.")
    items += [
        _item(f"{base}/magnificat-antiphon/1", "magnificat", "magnificat-antiphon", str(mag["incipit"]),
              mag_source, mag_tone, mag.get("chant")),
        _item(f"{base}/magnificat/1", "magnificat", "magnificat", "Magnificat",
              magnificat_music(reviewed, mag_tone), mag_tone),
    ]
    if mag.get("refs"):
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
                out[day.isoformat()] = {"office": "sancti:12-25", "vespers": "I", "items": items}
            continue
        wanted = day.weekday() == 6 or reviewed.office_for(key, "II") is not None
        if wanted:
            items, why = build_office(day, key, "II", reviewed, commemorations)
            if items is None:
                if day.weekday() == 6:
                    held[day.isoformat()] = why or ""
            else:
                out[day.isoformat()] = {"office": key, "vespers": "II", "items": items}
        # I Vespers of tomorrow's I class feast, sung this evening.
        if i + 1 < len(days):
            tomorrow, t_entry = days[i + 1]
            t_key = normal_key((t_entry.get("celebration") or [""])[0])
            if t_key != "sancti:12-25" and rank.get((t_entry.get("celebration") or [""])[0], rank.get(t_key, 4)) == 1:
                items, _ = build_office(tomorrow, t_key, "I", reviewed, [])
                if items:
                    first[tomorrow.isoformat()] = {"office": t_key, "vespers": "I", "evening_of": day.isoformat(),
                                                   "items": items}
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


def write_lineup(path: Path = LINEUP, reviewed_path: Path = REVIEWED,
                 catalog_path: Path = CATALOG, calendar_dir: Path = CALENDAR, today: date | None = None
                 ) -> tuple[Path, dict[str, object], list[dict[str, object]]]:
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
    path.write_text(dump_lineup(doc), encoding="utf-8")
    return path, doc, review


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


# ------------------------------------------------------------ proposals ---

WIDE_STRIP = 0.16


def read_tone_margin(slice_png: Path) -> str:
    """A wide crop of a system's margin: "Ad Magnif. Ant. VII. b" is wider than
    the 9% strip Proper labels fit in."""
    import pytesseract
    from PIL import Image

    with Image.open(slice_png) as image:
        grey = image.convert("L")
        strip = grey.crop((0, int(grey.height * 0.15), int(grey.width * WIDE_STRIP), grey.height))
        return " ".join(pytesseract.image_to_string(strip, config="--psm 6").split())


_HEADING = re.compile(r"DOMINICA\s+([IVXL]+)\.?\s+(?:QU\w+\s+SUPERFUIT\s+)?POST\s+(PENTECOSTEN|EPIPHANIAM)")
_ROMAN_VALUE = {"I": 1, "V": 5, "X": 10, "L": 50}


def sunday_heading(text: str) -> str | None:
    """The calendar key a system's heading names: "DOMINICA XIV. POST
    PENTECOSTEN." -> "tempora:Pent14-0"; None when it names no green Sunday."""
    m = _HEADING.search(text)
    if m is None:
        return None
    digits = m.group(1)
    n = 0
    for a, b in zip(digits, digits[1:] + " ", strict=True):
        v = _ROMAN_VALUE[a]
        n += -v if b in _ROMAN_VALUE and _ROMAN_VALUE[b] > v else v
    key = f"tempora:Pent{n:02d}-0" if m.group(2).startswith("PENT") else f"tempora:Epi{n}-0"
    return key if GREEN.match(key) else None


def propose(catalog_path: Path = CATALOG, slices: Path | None = None,
            path: Path = PROPOSED) -> tuple[Path, int]:
    """Propose each green Sunday's Magnificat antiphon from NOH8's headings
    ("DOMINICA XIV. POST PENTECOSTEN.") and its tone from a wide margin crop.
    The proposal is reviewed against the scans into data/vespers-noh8.yml."""
    import pymupdf

    from pipeline.catalog import scan_page
    from pipeline.margins import SLICES
    from pipeline.volumes import load_volumes

    slices = slices or SLICES
    vol = load_volumes()["noh8"]
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    sections = [p for p in catalog["pieces"] if p["slug"] in (
        "vesperae-dominicae-ii-vi-post-epiphaniam", "vesperae-dominicae-iv-xxiv-post-pentecosten")]
    found: dict[str, dict[str, object]] = {}
    with pymupdf.open(vol.path) as doc:
        for piece in sections:
            texts: dict[str, str] = {}
            for page in sorted({int(r.split("/")[1]) for r in piece["systems"]}):
                refs, _, _ = scan_page("noh8", page, doc[page - 1])
                texts.update({r.ref: r.text for r in refs})
            starts: list[tuple[int, str]] = []
            for i, ref in enumerate(piece["systems"]):
                key = sunday_heading(texts.get(ref, ""))
                if key:
                    starts.append((i, key))
            for (i, key), nxt in zip(starts, starts[1:] + [(len(piece["systems"]), "")], strict=True):
                ref = piece["systems"][i]
                png = slices / "noh8" / f"{ref.split('/', 1)[1]}@2x.png"
                raw = read_tone_margin(png) if png.exists() else ""
                found[key] = {"piece": piece["slug"], "refs": piece["systems"][i:nxt[0]],
                              "tone": normalise_tone(raw), "margin": raw}
    header = ("# PROPOSED by `noh vespers-items` -- not reviewed. Check each against the scan\n"
              "# and copy it into data/vespers-noh8.yml. A tone of null was not readable.\n")
    path.write_text(header + yaml.safe_dump({"magnificat_antiphons": found}, sort_keys=True,
                                            allow_unicode=True, width=110), encoding="utf-8")
    return path, len(found)


__all__ = ["LINEUP", "REVIEWED", "TONES", "Reviewed", "VespersDataError", "build_lineup",
           "calendar_days", "check_lineup", "describe", "load_reviewed", "marian_for", "normalise_tone", "propose",
           "read_tone_margin", "referenced_chants", "resolve_day", "sunday_heading", "sunday_lineup", "tone_disagreements",
           "tone_label", "write_lineup"]
