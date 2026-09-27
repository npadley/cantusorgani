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
CATALOG = DATA / "catalog.json"
SCHEMA_VERSION = 1

# The psalm-tone endings NOH8 prints (extended from the book, never by guessing).
TONES = frozenset({
    "I.D", "I.D2", "I.f", "I.g", "I.g2", "I.g3", "I.a", "I.a2", "I.a3", "II.D",
    "III.a", "III.a2", "III.b", "III.g", "IV.E", "IV.A", "IV.A*", "IV.g", "V.a",
    "VI.F", "VI.C", "VII.a", "VII.b", "VII.c", "VII.c2", "VII.d", "VII.e", "VII.e2",
    "VIII.G", "VIII.G*", "VIII.c", "peregrinus",
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
    """data/vespers-noh8.yml names a system the catalogue lacks, or a tone NOH8 does not print."""


@dataclass(frozen=True)
class Reviewed:
    doc: dict[str, object]
    owner: dict[str, str]        # ref -> piece slug


def load_reviewed(path: Path = REVIEWED, catalog_path: Path = CATALOG) -> Reviewed:
    """The reviewed items, checked: every ref belongs to the piece it names in
    the current catalogue, and every tone is in TONES."""
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    owner = {r: p["slug"] for p in catalog["pieces"] for r in p["systems"]}
    problems: list[str] = []

    def check(piece: str, refs: list[str], where: str) -> None:
        for r in refs:
            if owner.get(r) != piece:
                problems.append(f"{where}: {r} is {'not in the catalogue' if r not in owner else 'in ' + owner[r]}, "
                                f"not {piece}")

    def tone(value: str, where: str) -> None:
        if value not in TONES:
            problems.append(f"{where}: tone {value!r} is not one NOH8 prints (pipeline/vespers.py TONES)")

    so = doc["sunday_office"]
    piece = so["piece"]
    check(piece, so["initium"]["refs"], "sunday_office.initium")
    for ps in so["psalms"]:
        tone(ps["tone"], f"psalm {ps['number']}")
        check(piece, ps["antiphon"]["refs"] + ps["psalm"], f"psalm {ps['number']}")
    for name in ("chapter", "hymn", "versicle", "benedicamus"):
        check(piece, so[name]["refs"], f"sunday_office.{name}")
    ma = doc["marian_antiphons"]
    for name in ("alma", "ave", "regina", "salve"):
        check(ma["piece"], ma[name]["refs"] + ma[name]["versicle"], f"marian_antiphons.{name}")
    for key, entry in doc["magnificat_antiphons"].items():
        tone(entry["tone"], key)
        check(entry["piece"], entry["refs"], key)
    for key, entry in doc["tone_bank"].items():
        tone(key, f"tone_bank.{key}")
        check(entry["piece"], entry["refs"], f"tone_bank.{key}")
    if problems:
        raise VespersDataError(f"{path.name}:\n  " + "\n  ".join(problems)
                               + "\n  Fix the entry against the scan, or re-run noh catalog if the "
                                 "catalogue is out of date.")
    return Reviewed(doc, owner)


# --------------------------------------------------------------- the lineup ---

def marian_for(day: date) -> str:
    """The final antiphon of Our Lady sung that day (1962): Alma from Advent to
    the Purification (2 February), Ave Regina to Holy Week, Regina caeli in
    Eastertide, Salve Regina from Trinity to Advent. Green Sundays only need the
    first, second and fourth."""
    if day.month == 1 or (day.month == 2 and day.day <= 2):
        return "alma"
    if day.month in (2, 3):
        return "ave"
    return "salve"


def _source(piece: str, refs: list[str], **extra: object) -> dict[str, object]:
    return {"type": "printed", "piece": piece, "refs": list(refs), **extra}


def _item(key: str, group: str, kind: str, label: str, source: dict[str, object],
          tone: str | None = None, chant: int | None = None, number: int | None = None,
          repeat: bool = False) -> dict[str, object]:
    return {"item_key": key, "group": group, "kind": kind, "number": number, "label": label,
            "tone": tone, "source": source, "chant": chant, "repeat": repeat}


def sunday_lineup(day: date, office: str, reviewed: Reviewed,
                  commemorations: list[str] | None = None
                  ) -> tuple[list[dict[str, object]] | None, str | None]:
    """II Vespers of a green Sunday, item by item; or (None, why) when it is held back."""
    doc = reviewed.doc
    key = office.removesuffix("r")
    antiphon = doc["magnificat_antiphons"].get(key)   # type: ignore[union-attr]
    if antiphon is None:
        return None, f"{key}: no Magnificat antiphon in data/vespers-noh8.yml"
    bank = doc["tone_bank"].get(antiphon["tone"])    # type: ignore[union-attr]
    if bank is None:
        return None, (f"Magnificat in {tone_label(antiphon['tone'])} ({key}) has no printed "
                      f"Magnificat or psalm formula in that tone in NOH8")
    so = doc["sunday_office"]
    piece = so["piece"]
    base = f"{day.isoformat()}/{key}"
    items: list[dict[str, object]] = [
        _item(f"{base}/initium/1", "initium", "initium", "Deus in adjutorium",
              _source(piece, so["initium"]["refs"])),
    ]
    for n, ps in enumerate(so["psalms"], start=1):
        group = f"psalm-{n}"
        ant = _source(piece, ps["antiphon"]["refs"])
        items += [
            _item(f"{base}/antiphon/{n}", group, "antiphon", ps["antiphon"]["incipit"], ant,
                  ps["tone"], ps["antiphon"].get("chant"), n),
            _item(f"{base}/psalm/{n}", group, "psalm", f"Psalm {ps['number']}: {ps['title']}",
                  _source(piece, ps["psalm"]), ps["tone"], None, ps["number"]),
            _item(f"{base}/antiphon/{n}r", group, "antiphon", ps["antiphon"]["incipit"], ant,
                  ps["tone"], ps["antiphon"].get("chant"), n, repeat=True),
        ]
    items += [
        _item(f"{base}/chapter/1", "chapter", "chapter", "Chapter",
              _source(piece, so["chapter"]["refs"], text=so["chapter"]["text"])),
        _item(f"{base}/hymn/1", "hymn", "hymn", so["hymn"]["title"],
              _source(piece, so["hymn"]["refs"]), so["hymn"]["tone"], so["hymn"].get("chant")),
        _item(f"{base}/versicle/1", "hymn", "versicle", "Versicle",
              _source(piece, so["versicle"]["refs"], text=so["versicle"]["text"])),
    ]
    mag = _source(antiphon["piece"], antiphon["refs"])
    items += [
        _item(f"{base}/magnificat-antiphon/1", "magnificat", "magnificat-antiphon", antiphon["incipit"],
              mag, antiphon["tone"], antiphon.get("chant")),
        _item(f"{base}/magnificat/1", "magnificat", "magnificat", "Magnificat",
              {"type": "bank", "piece": bank["piece"], "refs": list(bank["refs"]),
               "bank_kind": bank["kind"], "bank_label": bank["label"],
               "borrowed_from": f"{bank['source']}, p. {bank['page']}"},
              antiphon["tone"]),
        _item(f"{base}/magnificat-antiphon/1r", "magnificat", "magnificat-antiphon", antiphon["incipit"],
              mag, antiphon["tone"], antiphon.get("chant"), repeat=True),
        _item(f"{base}/oration/1", "oration", "oration", "Collect",
              {"type": "note", "text": "The collect of the Sunday, as at Mass."}),
    ]
    for c in commemorations or []:
        items.append(_item(f"{base}/commemoration/{c}", "oration", "commemoration", "Commemoration",
                           {"type": "note", "text": c}))
    items.append(_item(f"{base}/benedicamus/1", "benedicamus", "benedicamus", "Benedicamus Domino",
                       _source(piece, so["benedicamus"]["refs"])))
    marian = doc["marian_antiphons"]
    which = marian_for(day)
    m = marian[which]   # type: ignore[index]
    items += [
        _item(f"{base}/marian-antiphon/1", "marian", "marian-antiphon", m["title"],
              _source(marian["piece"], m["refs"]), None, m.get("chant")),   # type: ignore[index]
        _item(f"{base}/versicle/2", "marian", "versicle", "Versicle and prayer",
              _source(marian["piece"], m["versicle"])),   # type: ignore[index]
    ]
    return items, None


def calendar_days(calendar_dir: Path = CALENDAR) -> list[tuple[date, dict[str, list[str]]]]:
    out: list[tuple[date, dict[str, list[str]]]] = []
    for f in sorted(calendar_dir.glob("[0-9][0-9][0-9][0-9].json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        for iso, entry in doc["days"].items():
            out.append((date.fromisoformat(iso), entry))
    return out


def catalog_sha256(catalog_path: Path = CATALOG) -> str:
    return hashlib.sha256(catalog_path.read_bytes()).hexdigest()


def build_lineup(reviewed: Reviewed, days: list[tuple[date, dict[str, list[str]]]],
                 catalog_digest: str) -> tuple[dict[str, object], list[dict[str, object]]]:
    """The lineup document and the review entries (held-back Sundays)."""
    out: dict[str, object] = {}
    held: dict[str, str] = {}
    review: list[dict[str, object]] = []
    for day, entry in days:
        celebration = entry.get("celebration") or []
        office = next((c for c in celebration if GREEN.match(c)), None)
        if office is None or day.weekday() != 6:
            continue
        items, why = sunday_lineup(day, office, reviewed, list(entry.get("commemoration") or []))
        if items is None:
            held[day.isoformat()] = why or ""
            continue
        out[day.isoformat()] = {"office": office, "vespers": "II", "items": items}
    for why in sorted(set(held.values())):
        review.append({"piece": "vespers", "kind": "tone_unprinted",
                       "why": f"{why}; those Sundays have no Vespers page",
                       "fix": "add a bank entry in data/vespers-noh8.yml tone_bank from a printed "
                              "accompaniment in that exact tone and ending, or leave the Sunday held back"})
    doc = {"schema_version": SCHEMA_VERSION, "catalog_sha256": catalog_digest,
           "days": out, "held_back": held}
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


def write_lineup(path: Path = LINEUP, reviewed_path: Path = REVIEWED,
                 catalog_path: Path = CATALOG, calendar_dir: Path = CALENDAR
                 ) -> tuple[Path, dict[str, object], list[dict[str, object]]]:
    reviewed = load_reviewed(reviewed_path, catalog_path)
    doc, review = build_lineup(reviewed, calendar_days(calendar_dir), catalog_sha256(catalog_path))
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
        return "data/catalog.json has changed since the lineup was written"
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
