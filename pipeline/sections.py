"""A Proper's sections: what the book prints on it, in order.

A section is one entry of a piece's `sections` list in the catalogue:

    {"kind": "gradual", "n": 2, "variant": "", "system": 15, "ref": "noh1/0052/003",
     "gregobase_id": 1234, "placed": "label", "score": 1.0}

- `kind`: introit | gradual | alleluia | tract | sequence | hymn | offertory |
  communion | other.
- `n`: the 2nd (3rd ...) of its kind on the piece; absent when it is alone.
- `variant`: "paschal" (and other seasonal forms), or "".
- `system` / `ref`: its first system, counting from 0, as the piece's own list;
  a section printed elsewhere has `borrowed_*` fields instead.
- A section runs until the next one starts.

A section is named `part:<slug>/<kind>`, with `:<n>` or `:<variant>` -- the
names corrections, review keys and data/typeset/parts.yml have always used.
Everything that names a section goes through `suffix` and `target` here.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import yaml

from pipeline.volumes import DATA

#: Sections a person checked against the scans: data/sections/<volume>.yml.
REVIEWED = DATA / "sections"

KINDS = ("introit", "gradual", "alleluia", "tract", "sequence", "hymn", "offertory", "communion", "other")


def suffix(section: Mapping[str, Any]) -> str:
    """The part of a section's name after its kind: "" when it is alone,
    ":2" for the second of its kind, ":paschal" for a seasonal form."""
    n = section.get("n")
    variant = section.get("variant") or ""
    return f":{n}" if n else (f":{variant}" if variant else "")


def target(slug: str, section: Mapping[str, Any]) -> str:
    """The section's name: part:<slug>/<kind>[:<n>|:<variant>]."""
    return f"part:{slug}/{section['kind']}{suffix(section)}"


def named(section: Mapping[str, Any], kind: str, sub: str = "") -> bool:
    """Whether a section is the one `part:<slug>/<kind>[:<sub>]` names."""
    return section.get("kind") == kind and suffix(section)[1:] == sub


def of(piece: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A piece's sections, printed and borrowed."""
    return list(piece.get("sections") or [])


def printed(piece: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The sections printed on the piece itself, in order: each has a start."""
    return [s for s in of(piece) if "system" in s]


def split_variant(variant: str) -> tuple[int | None, str]:
    """A part's old variant as (n, variant): "2" is the 2nd of its kind,
    "paschal" a seasonal form."""
    return (int(variant), "") if variant.isdigit() else (None, variant)


def record(kind: str, variant: str = "", **fields: Any) -> dict[str, Any]:
    """A section record, with `n` split out of a numbered variant."""
    n, variant = split_variant(variant or "")
    out: dict[str, Any] = {"kind": kind}
    if n is not None:
        out["n"] = n
    out["variant"] = variant
    out.update(fields)
    return out


def from_part(part: Mapping[str, Any]) -> dict[str, Any]:
    """A schema-2 part record (`part`, variant "1"/"2"/"paschal") as a section."""
    rest = {k: v for k, v in part.items() if k not in ("part", "variant")}
    return record(str(part["part"]), str(part.get("variant") or ""), **rest)


# ------------------------------------------------------- reviewed sections ---

REVIEWED_HEADER = """\
# A Proper's sections, checked against the scans: when a piece is listed here,
# this list is the whole truth for it (the pipeline adds, drops and moves
# nothing), applied with the hand corrections by `noh apply-corrections`.
# See docs/EDITING.md, "Sections".
#
# Each piece is a list, in the order the book prints it:
#   kind:   introit gradual alleluia tract sequence hymn offertory communion other
#   n:      2 for the 2nd of its kind on the piece (1 for the first of several)
#   variant: paschal ...  (a seasonal form), or leave it out
#   label:  the margin label as printed ("2. Grad. I")
#   title:  its opening words
#   ref:    its first system ("noh1/0052/003"; every image on the site carries its ref)
#   chant:  a GregoBase id, or none; left out, the pipeline's chant for it is kept
# A section printed in another volume has borrowed_volume and borrowed_page
# (and borrowed_from, borrowed_ref) in place of ref.
# `uv run noh sections <slug> --review` writes a piece's current list here to start from.
"""


class ReviewedError(ValueError):
    """A reviewed list that cannot be applied; each line names the piece and the fix."""


def load_reviewed(folder: Path = REVIEWED) -> dict[str, tuple[str, list[dict[str, Any]]]]:
    """Every reviewed list, by slug: (the file it is in, its entries)."""
    out: dict[str, tuple[str, list[dict[str, Any]]]] = {}
    if not folder.exists():
        return out
    for path in sorted(folder.glob("*.yml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(doc, dict):
            raise ReviewedError(f"data/sections/{path.name}: expected pieces by slug, each a list of sections")
        for slug, entries in doc.items():
            if slug in out:
                raise ReviewedError(f"data/sections/{path.name}: {slug} is also listed in {out[slug][0]}; keep one")
            if not isinstance(entries, list):
                raise ReviewedError(f"data/sections/{path.name}: {slug} should be a list of sections")
            out[str(slug)] = (f"data/sections/{path.name}", [dict(e) for e in entries])
    return out


def reviewed_list(slug: str, piece: Mapping[str, Any], entries: list[dict[str, Any]], where: str
                  ) -> tuple[list[dict[str, Any]], list[str]]:
    """A reviewed list as the piece's sections, and every problem with it. The
    pipeline's chant for a section is kept where the list gives none."""
    systems = list(piece.get("systems") or [])
    proposed = {f"{s['kind']}{suffix(s)}": s for s in of(piece)}
    out: list[dict[str, Any]] = []
    problems: list[str] = []
    names: set[str] = set()
    last = -1
    for i, e in enumerate(entries, 1):
        at = f"{where}: {slug} section {i}"
        kind = str(e.get("kind", ""))
        if kind not in KINDS:
            problems.append(f"{at}: kind {kind!r} is not one of {', '.join(KINDS)}")
            continue
        n = e.get("n")
        if n is not None and (not isinstance(n, int) or n < 1):
            problems.append(f"{at}: n {n!r} should be 1, 2, 3 ...")
            continue
        section: dict[str, Any] = {"kind": kind}
        if n:
            section["n"] = n
        section["variant"] = str(e.get("variant") or "")
        name = f"{kind}{suffix(section)}"
        if name in names:
            problems.append(f"{at}: part:{slug}/{name} is listed twice; number them with n: 1, n: 2 ...")
            continue
        names.add(name)
        for key in ("label", "title"):
            if e.get(key):
                section[key] = str(e[key])
        chant = e.get("chant", proposed.get(name, {}).get("gregobase_id"))
        section["gregobase_id"] = None if chant in (None, "none") else chant
        if not (section["gregobase_id"] is None or isinstance(section["gregobase_id"], int)):
            problems.append(f"{at}: chant {chant!r} should be a GregoBase id or none")
            continue
        if "borrowed_page" in e:
            section.update({k: e.get(k) for k in ("borrowed_volume", "borrowed_page", "borrowed_from", "borrowed_ref")})
            out.append(section)
            continue
        ref = str(e.get("ref", ""))
        if ref not in systems:
            problems.append(f"{at} ({name}): {ref or 'no ref'} is not a system of {slug}, which runs "
                            f"{systems[0] if systems else '?'} to {systems[-1] if systems else '?'}; the piece's "
                            "systems changed since the list was checked (a re-slice or a new range): check it "
                            "against the scan again and correct its refs")
            continue
        system = systems.index(ref)
        if system <= last:
            problems.append(f"{at} ({name}): starts on {ref}, not after the section before; list the sections "
                            "in the order the book prints them")
            continue
        last = system
        section.update(system=system, ref=ref, placed="reviewed")
        out.append(section)
    return out, problems


def apply_reviewed(catalog: dict[str, Any], reviewed: Mapping[str, tuple[str, list[dict[str, Any]]]]) -> list[str]:
    """Replace each reviewed piece's sections with its list, in place; the
    problems, one line each (a list that has problems is not applied)."""
    pieces = {str(p["slug"]): p for p in catalog.get("pieces", [])}
    problems: list[str] = []
    for slug, (where, entries) in reviewed.items():
        piece = pieces.get(slug)
        if piece is None:
            problems.append(f"{where}: {slug} is not in the catalogue; run `uv run noh where \"{slug}\"` "
                            "for current slugs")
            continue
        listed, found = reviewed_list(slug, piece, entries, where)
        problems += found
        if not found:
            piece["sections"] = listed
    return problems


def _margin(ref: str, asset: str) -> str:
    """The margin OCR the catalogue build recorded for a system (data/ocr/margins),
    read only: "" where it has none."""
    import json as _json

    from pipeline.margins import MARGINS
    volume, page, _ = ref.split("/")
    path = MARGINS / volume / f"{page}.json"
    cached = _json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return " ".join(str(cached.get(f"{ref}|{asset}", "")).split())


def describe(piece: Mapping[str, Any]) -> str:
    """A piece's sections for a person checking them: each one's name, where it
    starts, how it was placed, what the book prints there, and its chant."""
    slug = str(piece["slug"])
    systems = list(piece.get("systems") or [])
    assets = list(piece.get("system_assets") or [])
    lines = [f"{slug} ({piece.get('volume')}, {len(systems)} systems"
             + (f", {systems[0]} to {systems[-1]}" if systems else "") + ")"]
    for i, s in enumerate(in_printed_order(piece), 1):
        name = target(slug, s)
        if "system" not in s:
            lines.append(f"  {i:>2}. {name}  printed elsewhere ({s.get('borrowed_volume')}, "
                         f"p. {s.get('borrowed_page')}; {s.get('borrowed_from') or 'unresolved'})")
            continue
        ref = str(s["ref"])
        margin = _margin(ref, assets[s["system"]] if s["system"] < len(assets) else "")
        said = "  ".join(x for x in (f"label {s['label']!r}" if s.get("label") else "",
                                     f"title {s['title']!r}" if s.get("title") else "") if x)
        lines.append(f"  {i:>2}. {name}  system {s['system'] + 1} ({ref})  placed {s.get('placed')}"
                     f"  chant {s.get('gregobase_id') if s.get('gregobase_id') is not None else 'none'}"
                     + (f"  {said}" if said else "") + (f"\n      margin: {margin!r}" if margin else ""))
    if not of(piece):
        lines.append("  no sections")
    return "\n".join(lines)


#: The order of Mass, for placing a section printed elsewhere among those printed here.
MASS_ORDER = ("introit", "gradual", "hymn", "alleluia", "tract", "alleluia/paschal", "sequence",
              "offertory", "communion", "other")


def in_printed_order(piece: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A piece's sections in the order the book prints them: those printed here
    by where they start, those printed elsewhere slotted in by their place in
    the order of Mass (as the site does)."""
    def mass(s: Mapping[str, Any]) -> int:
        key = f"{s['kind']}/paschal" if s.get("variant") == "paschal" else str(s["kind"])
        return MASS_ORDER.index(key) if key in MASS_ORDER else len(MASS_ORDER)

    out = sorted(printed(piece), key=lambda s: int(s["system"]))
    for b in sorted((s for s in of(piece) if "system" not in s), key=mass):
        at = next((i for i, s in enumerate(out) if "system" in s and mass(s) > mass(b)), len(out))
        out.insert(at, b)
    return out


def as_reviewed(piece: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A piece's current sections as reviewed-list entries, in printed order, to
    start a review from."""
    out = []
    for s in in_printed_order(piece):
        e: dict[str, Any] = {"kind": s["kind"]}
        if s.get("n"):
            e["n"] = s["n"]
        if s.get("variant"):
            e["variant"] = s["variant"]
        for key in ("label", "title"):
            if s.get(key):
                e[key] = s[key]
        if "system" in s:
            e["ref"] = s["ref"]
        else:
            e.update({k: s.get(k) for k in ("borrowed_volume", "borrowed_page", "borrowed_from", "borrowed_ref")})
        e["chant"] = s.get("gregobase_id") if s.get("gregobase_id") is not None else "none"
        out.append(e)
    return out


def save_reviewed(slug: str, volume: str, entries: list[dict[str, Any]], folder: Path = REVIEWED) -> Path:
    """Write (or replace) one piece's reviewed list in data/sections/<volume>.yml,
    keeping every other piece's list and the comments above it as they are."""
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{volume}.yml"
    block = yaml.safe_dump({slug: entries}, sort_keys=False, allow_unicode=True, width=110,
                           default_flow_style=None).rstrip().splitlines()
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else REVIEWED_HEADER.splitlines()
    start = next((i for i, line in enumerate(lines) if line == f"{slug}:"), None)
    if start is None:
        lines += block
    else:
        # Its list runs to the next piece, or to the comment written above it.
        end = next((i for i in range(start + 1, len(lines)) if lines[i] and not lines[i].startswith(("-", " "))),
                   len(lines))
        lines[start:end] = block
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


# ------------------------------------------- a list from the admin screen ---

#: What a list entry from the admin screen (or `noh correct`) may carry.
_ENTRY_KEYS = frozenset({"kind", "n", "variant", "label", "title", "ref", "system", "borrowed_volume",
                         "borrowed_page", "borrowed_from", "borrowed_ref", "chant"})
_TEXT = re.compile(r"^[^\x00-\x1f<>]{1,80}$")
_REF = re.compile(r"^noh\d/\d{4}/\d{3}$")
MAX_SECTIONS = 40


def parse_value(value: object) -> list[dict[str, Any]]:
    """A whole list of sections as a correction gives it (JSON text, or a list),
    checked for shape: each entry's keys and their types. Where it starts is
    checked against the piece by `with_refs` and `reviewed_list`."""
    import json as _json
    if isinstance(value, str):
        try:
            value = _json.loads(value)
        except ValueError:
            raise ReviewedError("the list of sections is not valid JSON") from None
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_SECTIONS:
        raise ReviewedError(f"the sections should be a list of 1 to {MAX_SECTIONS} entries")
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(value, 1):
        if not isinstance(raw, dict):
            raise ReviewedError(f"section {i} is not an object")
        extra = set(raw) - _ENTRY_KEYS
        if extra:
            raise ReviewedError(f"section {i} has {', '.join(sorted(extra))}, which a section does not take")
        kind = raw.get("kind")
        if kind not in KINDS:
            raise ReviewedError(f"section {i}: kind {kind!r} is not one of {', '.join(KINDS)}")
        e: dict[str, Any] = {"kind": kind}
        n = raw.get("n")
        if n not in (None, ""):
            if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 9:
                raise ReviewedError(f"section {i}: n {n!r} should be 1 to 9")
            e["n"] = n
        variant = raw.get("variant") or ""
        if variant:
            if variant != "paschal":
                raise ReviewedError(f"section {i}: variant {variant!r} should be paschal, or left out")
            e["variant"] = variant
        for key in ("label", "title"):
            text = " ".join(str(raw.get(key) or "").split())
            if text:
                if not _TEXT.fullmatch(text):
                    raise ReviewedError(f"section {i}: {key} {text!r} should be plain text of at most 80 characters, "
                                     "no < or >")
                e[key] = text
        if raw.get("borrowed_page") not in (None, ""):
            page, volume = raw.get("borrowed_page"), str(raw.get("borrowed_volume") or "")
            if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 999 \
                    or not re.fullmatch(r"noh\d", volume):
                raise ReviewedError(f"section {i}: printed elsewhere needs borrowed_volume (noh1 ...) and "
                                 "borrowed_page (a page number)")
            e.update(borrowed_volume=volume, borrowed_page=page)
            for key in ("borrowed_from", "borrowed_ref"):
                if raw.get(key):
                    e[key] = str(raw[key])
        elif raw.get("system") not in (None, ""):
            system = raw["system"]
            if not isinstance(system, int) or isinstance(system, bool) or not 1 <= system <= 999:
                raise ReviewedError(f"section {i}: system {system!r} should be a system of the piece, counting from 1")
            e["system"] = system
        elif _REF.fullmatch(str(raw.get("ref") or "")):
            e["ref"] = str(raw["ref"])
        else:
            raise ReviewedError(f"section {i}: say where it starts (system, counting from 1) or where it is "
                             "printed (borrowed_volume and borrowed_page)")
        chant = raw.get("chant", "none")
        if chant in (None, "", "none"):
            e["chant"] = "none"
        elif isinstance(chant, int) and not isinstance(chant, bool) and 1 <= chant <= 999_999:
            e["chant"] = chant
        elif isinstance(chant, str) and chant.isdigit() and len(chant) <= 6:
            e["chant"] = int(chant)
        else:
            raise ReviewedError(f"section {i}: chant {chant!r} should be a GregoBase id, or none")
        out.append(e)
    return out


def with_refs(entries: list[dict[str, Any]], piece: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The entries with each start as the system's ref, the form the data keeps
    (a system number would point elsewhere once the piece is re-sliced)."""
    systems = list(piece.get("systems") or [])
    out = []
    for i, e in enumerate(entries, 1):
        if "system" not in e:
            out.append(e)
            continue
        if e["system"] > len(systems):
            raise ReviewedError(f"section {i}: system {e['system']} is outside {piece.get('slug')}, which has "
                             f"{len(systems)} systems")
        rest = {k: v for k, v in e.items() if k not in ("system", "chant")}
        out.append({**rest, "ref": systems[e["system"] - 1], "chant": e["chant"]})
    return out


__all__ = [
    "KINDS",
    "MASS_ORDER",
    "MAX_SECTIONS",
    "REVIEWED",
    "ReviewedError",
    "apply_reviewed",
    "as_reviewed",
    "describe",
    "from_part",
    "in_printed_order",
    "load_reviewed",
    "named",
    "of",
    "parse_value",
    "printed",
    "record",
    "reviewed_list",
    "save_reviewed",
    "split_variant",
    "suffix",
    "target",
    "with_refs",
]
