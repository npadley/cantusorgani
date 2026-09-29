"""The chant notation the site publishes beside each Proper part (and each
chant of a Vespers lineup).

`noh chants` writes data/chants.json: for every GregoBase chant a catalogued
part names (printed or borrowed), and every verified pairing of a Kyriale
movement, its GABC, mode and office part. GregoBase
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
    if isinstance(items, str):          # some chants are a JSON-quoted string (Kyrie I, 1143)
        return items or None
    if not isinstance(items, list):
        return None
    return next((str(x[1]) for x in items if isinstance(x, list) and len(x) > 1 and x[0] == "gabc"), None)


def referenced_ids(catalog: dict[str, object]) -> set[int]:
    """Every chant the site can show: each Proper part's, and each verified
    pairing of a Kyriale movement (Missa IX's Kyrie, Gloria ...)."""
    ids: set[int] = set()
    for piece in catalog["pieces"]:                                             # type: ignore[union-attr]
        ids |= {int(p["gregobase_id"]) for p in piece.get("sections", []) or []
                if isinstance(p.get("gregobase_id"), int)}
        ids |= {int(c["id"]) for c in piece.get("chant", []) or []
                if c.get("status") == "verified" and isinstance(c.get("id"), int)}
    return ids


def select_chants(catalog: dict[str, object], rows: list[tuple[Chant, bool]],
                  extra: set[int] | None = None) -> dict[int, dict[str, object]]:
    """Each referenced, publishable chant: {id: {part, mode, incipit, gabc}}.
    `rows` pairs each chant with its copyrighted flag; `extra` adds ids named
    elsewhere (the Vespers lineup)."""
    wanted = referenced_ids(catalog) | (extra or set())
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
    from pipeline.vespers import referenced_chants
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    rows = load_chant_rows(dump)
    vespers = referenced_chants()
    chosen = select_chants(catalog, rows, vespers)
    return write_chants(chosen, path), len(chosen), len((referenced_ids(catalog) | vespers) - set(chosen))


__all__ = ["build", "chant_body", "referenced_ids", "select_chants", "write_chants"]
