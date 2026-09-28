"""Proposing the Magnificat antiphons and their tones from the scans (the headings
and a wide margin crop), for review: `noh vespers-items`."""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from pipeline.vespers.reviewed import CATALOG, GREEN, PROPOSED, normalise_tone

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
    The proposal is reviewed against the scans into data/vespers/vespers-noh8.yml."""
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
              "# and copy it into data/vespers/vespers-noh8.yml. A tone of null was not readable.\n")
    path.write_text(header + yaml.safe_dump({"magnificat_antiphons": found}, sort_keys=True,
                                            allow_unicode=True, width=110), encoding="utf-8")
    return path, len(found)

