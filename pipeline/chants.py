"""The chant notation the site publishes beside each Proper part.

`noh chants` writes data/chants.json: for every GregoBase chant a catalogued
part names (printed or borrowed), its GABC, mode and office part. GregoBase
releases its transcriptions under CC0; the ones it flags `copyrighted` (taken
from modern editions still in copyright) are left out, and those parts keep a
link to GregoBase only. The site renders the GABC in the browser with Exsurge.
"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline.gregobase import DUMP, Chant, load_chant_rows
from pipeline.volumes import DATA

CHANTS = DATA / "chants.json"


def chant_body(gabc: str | None) -> str | None:
    """The notation itself: GregoBase stores a JSON list of [kind, content]
    items, of which "gabc" is the chant; plain GABC passes through."""
    if not gabc:
        return None
    try:
        items = json.loads(gabc)
    except json.JSONDecodeError:
        return gabc
    if not isinstance(items, list):
        return None
    return next((str(x[1]) for x in items if isinstance(x, list) and len(x) > 1 and x[0] == "gabc"), None)


def select_chants(catalog: dict[str, object],
                  rows: list[tuple[Chant, bool]]) -> dict[int, dict[str, object]]:
    """Each referenced, publishable chant: {id: {part, mode, incipit, gabc}}.
    `rows` pairs each chant with its copyrighted flag."""
    wanted = {int(part["gregobase_id"]) for piece in catalog["pieces"]          # type: ignore[union-attr]
              for part in piece.get("parts", []) or []
              if isinstance(part.get("gregobase_id"), int)}
    out: dict[int, dict[str, object]] = {}
    for chant, copyrighted in rows:
        if chant.id not in wanted or copyrighted:
            continue
        body = chant_body(chant.gabc)
        if body:
            out[chant.id] = {"part": chant.office_part, "mode": chant.mode,
                             "incipit": chant.incipit, "gabc": body}
    return out


def write_chants(chants: dict[int, dict[str, object]], path: Path = CHANTS) -> Path:
    doc = {
        "source": {"name": "GregoBase", "url": "https://gregobase.selapa.net", "licence": "CC0",
                   "note": "Transcriptions GregoBase flags copyrighted are not included."},
        "chants": {str(k): chants[k] for k in sorted(chants)},
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path


def build(catalog_path: Path = DATA / "catalog.json", path: Path = CHANTS,
          dump: Path = DUMP) -> tuple[Path, int, int]:
    """Write data/chants.json; returns (path, chants written, referenced but withheld)."""
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    rows = load_chant_rows(dump)
    chosen = select_chants(catalog, rows)
    referenced = {int(p["gregobase_id"]) for piece in catalog["pieces"]
                  for p in piece.get("parts", []) or [] if isinstance(p.get("gregobase_id"), int)}
    return write_chants(chosen, path), len(chosen), len(referenced - set(chosen))


__all__ = ["build", "chant_body", "select_chants", "write_chants"]
