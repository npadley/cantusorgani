"""What a page is, and where to fix it: `noh where <page URL or words>`.

Given a page of the site (or a few words of a title), names the correction
target, the source file and line that hold it, the command to run after
changing it, and the narrower targets on the page (a Proper's parts, a Vespers
office's items)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

from pipeline.corrections import _pieces
from pipeline.volumes import DATA


@dataclass(frozen=True)
class Location:
    target: str
    label: str
    source: str
    command: str
    #: The narrower targets on the page: its Proper parts, a Vespers office's items.
    more: tuple[str, ...] = ()


def _line_of(path: Path, needle: str) -> int:
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if needle in line:
            return n
    return 0


def where(query: str, catalog: dict[str, Any], data: Path = DATA) -> list[Location]:
    """What a page URL (or a few words of a title) is, and where to fix it."""
    path = urlparse(query).path if "/" in query else ""
    parts = [p for p in path.split("/") if p]
    pieces = _pieces(catalog)
    if len(parts) >= 2 and parts[0] == "piece" and parts[1] in pieces:
        return [_piece_location(pieces[parts[1]], data)]
    if parts and parts[0] == "vespers" and len(parts) >= 2:
        vespers = "I" if len(parts) > 2 and parts[2] == "i" else "II"
        return [_vespers_location(parts[1], vespers, data)]
    if len(parts) >= 3 and parts[0] == "day":
        key = f"{parts[1]}:{parts[2]}"
        return [Location(f"day:{key}", f"the day {key}",
                         "data/rubrics-1962.yml (a day taking another day's Mass); data/index-noh*.yml "
                         "(the `days` a piece is sung on)", "uv run noh catalog --volume <vol>")]
    words = [w for w in re.split(r"[\s/-]+", query.lower()) if w]
    hits = [p for p in pieces.values()
            if words and all(w in f"{p['slug']} {p.get('title') or ''} {p.get('incipit') or ''}".lower()
                             for w in words)]
    return [_piece_location(p, data) for p in hits[:20]]


def _vespers_location(day: str, vespers: str, data: Path) -> Location:
    """The office a Vespers page is built from, and the line that holds it."""
    target = f"vespers:{day}/{vespers}"
    general = ("data/vespers/vespers-offices.yml (a feast's antiphons, tones, hymn); data/vespers/vespers-noh8.yml "
               "(the Sunday psalter, Magnificat antiphons, seasons, tone bank)")
    command = f"uv run noh vespers-lineup, then check: uv run noh vespers-lineup --day {day}"
    lineup_path = data / "vespers" / "vespers-lineup.json"
    if not lineup_path.exists():
        return Location(target, f"{vespers} Vespers of {day}", general, command)
    lineup = json.loads(lineup_path.read_text(encoding="utf-8"))
    entry = (lineup.get("first_vespers" if vespers == "I" else "days") or {}).get(day)
    if not entry:
        return Location(target, f"no {vespers} Vespers page for {day}", general, command)
    office = str(entry.get("office"))
    sung = str(entry.get("vespers", vespers))
    offices_path = data / "vespers" / "vespers-offices.yml"
    doc = yaml.safe_load(offices_path.read_text(encoding="utf-8")) if offices_path.exists() else {}
    for name, spec in ((doc or {}).get("offices") or {}).items():
        if office in (spec.get("keys") or []) and str(spec.get("vespers")) == sung:
            line = _line_of(offices_path, f"  {name}:")
            items = tuple(f"vespers:{name}/antiphon-{a['n']}  (tone {a.get('tone')}, chant {a.get('chant')})"
                          for a in spec.get("antiphons") or [] if isinstance(a, dict))
            mag = spec.get("magnificat")
            if isinstance(mag, dict):
                items += (f"vespers:{name}/magnificat  (tone {mag.get('tone')}, chant {mag.get('chant')})",)
            return Location(target, f"{sung} Vespers of {office} (office {name})",
                            f"data/vespers/vespers-offices.yml:{line}", command, items)
    noh8 = data / "vespers" / "vespers-noh8.yml"
    line = _line_of(noh8, f"{office}:") if noh8.exists() else 0
    source = (f"data/vespers/vespers-noh8.yml:{line} (this Sunday's Magnificat antiphon; the psalter and "
              "seasons are in the same file)") if line else general
    items = (f"vespers:sunday:{office}/magnificat",) if line else ()
    return Location(target, f"{sung} Vespers of {office}", source, command, items)


def _piece_location(piece: dict[str, Any], data: Path) -> Location:
    index = data / f"index-{piece['volume']}.yml"
    line = _line_of(index, f"slug: {piece['slug']}") if index.exists() else 0
    source = f"{index.relative_to(data.parent)}:{line}" if line else f"data/index-{piece['volume']}.yml"
    parts = tuple(
        f"part:{piece['slug']}/{p['part']}{':' + p['variant'] if p.get('variant') else ''}  "
        + (f"(system {p['system'] + 1}, chant {p.get('gregobase_id')})" if "system" in p
           else f"(printed in {p.get('borrowed_from', 'another volume')})")
        for p in piece.get("parts") or [])
    return Location(f"piece:{piece['slug']}", f"{piece.get('title')} ({piece['volume']}, pp. "
                    f"{'-'.join(str(n) for n in piece.get('printed_pages') or [])})",
                    source, f"uv run noh correct piece:{piece['slug']} <field> <value>", parts)




__all__ = ["Location", "where"]
