"""The reviewed Vespers data: data/vespers/vespers-noh8.yml and vespers-offices.yml
as loaded and checked, with the hand corrections of data/corrections.yml that
name Vespers items applied, and the tones NOH8 prints."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from pipeline.volumes import DATA, VESPERS

REVIEWED = VESPERS / "vespers-noh8.yml"
PROPOSED = VESPERS / "vespers-noh8.proposed.yml"
LINEUP = VESPERS / "vespers-lineup.json"
# The generated catalogue. A hand correction can move a system from one piece
# to its neighbour (system_range), never remove one Vespers shows:
# `noh apply-corrections` checks.
CATALOG = DATA / "catalog.base.json"
SCHEMA_VERSION = 1

# The psalm-tone endings NOH8 prints (extended from the book, never by guessing).
# The tones NOH8 prints, from the corrections schema (one list, shared with the
# admin screen and `noh correct`).
TONES = frozenset(json.loads((DATA / "schema" / "corrections.json").read_text(encoding="utf-8"))["tones"])
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
    doc: dict[str, object]                  # data/vespers/vespers-noh8.yml
    offices: dict[str, dict[str, object]]   # data/vespers/vespers-offices.yml
    texts: dict[str, object]                # Divinum Officium's texts (the psalms)
    known: frozenset[str]                   # every system in the catalogue
    hymn_links: dict[str, list[str]] = field(default_factory=dict)

    def office_for(self, key: str, vespers: str) -> tuple[str, dict[str, object]] | None:
        for oid, o in self.offices.items():
            if o.get("vespers") == vespers and key in (o.get("keys") or []):
                return oid, o
        return None


def load_reviewed(path: Path = REVIEWED, catalog_path: Path = CATALOG, offices_path: Path | None = None,
                  texts_path: Path | None = None, corrections_path: Path | None = None) -> Reviewed:
    """The reviewed items, checked: every system they name is in the current
    catalogue, and every tone is one NOH8 prints. The hand corrections of
    data/corrections.yml that name Vespers items are applied first (for the
    real data files; `corrections_path` for others)."""
    from pipeline.corrections import CORRECTIONS, VespersData, apply_vespers
    from pipeline.corrections import load as load_corrections
    from pipeline.officium import VENDORED, OfficiumError, load

    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    op = offices_path or path.with_name("vespers-offices.yml")
    offices = (yaml.safe_load(op.read_text(encoding="utf-8")) or {}).get("offices", {}) if op.exists() else {}
    overlay = corrections_path or (CORRECTIONS if path == REVIEWED else None)
    if overlay is not None:
        corrected = apply_vespers(VespersData(doc, offices), load_corrections(overlay))
        doc, offices = corrected.doc, corrected.offices
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
    from pipeline.hymnlinks import load_hymn_links
    hymn_links = load_hymn_links(VESPERS / "hymns-noh7.yml", catalog) if path == REVIEWED else {}
    return Reviewed(doc, offices, texts, known, hymn_links)

