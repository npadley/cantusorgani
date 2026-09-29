"""What the site and the admin screen read about the typeset music, written from
the sources alone (no LilyPond needed), so it can be committed with any change
to them and checked in CI:

data/typeset/manifest.json   the parts the site shows typeset: each `matched`
                             entry's target, file and render hash
data/typeset/review.json     everything else, for the admin screen's queues:
                             status, candidate target, render hash (when it
                             compiles), LilyPond's error (when it does not)

Both are written from parts.yml with the editors' choices applied: a `match`
correction on typeset:<file> in data/corrections.yml says which part a file is,
or that it is none, or another setting (pipeline/typeset/match.py with_choices).
`noh apply-corrections` writes them too, so a batch of corrections carries them.

A render hash names typeset/<hash>/{narrow.svg, wide.svg, letter.pdf, a4.pdf} on R2
(pipeline/typeset/render.py). `noh typeset-render` draws the ones not published
yet, `noh typeset-publish` uploads them, and `noh typeset-check --remote`
checks every one the manifest names is there.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pipeline.typeset.importer import CREDIT, REPO
from pipeline.typeset.lilypond import INCLUDE, load_pin
from pipeline.typeset.match import PARTS_FILE, SRC, load, with_choices
from pipeline.typeset.render import FILES, source_hash
from pipeline.volumes import DATA

MANIFEST = DATA / "typeset" / "manifest.json"
REVIEW = DATA / "typeset" / "review.json"
PREFIX = "typeset"

if TYPE_CHECKING:
    from pipeline.corrections import Entry


def effective(parts: Path = PARTS_FILE, corrections: list[Entry] | None = None) -> list[dict[str, Any]]:
    """parts.yml as the site and the admin screen see it: with the editors' choices."""
    from pipeline.corrections import load as load_corrections
    from pipeline.corrections import typeset_choices
    return with_choices(load(parts), typeset_choices(load_corrections() if corrections is None else corrections))


def build(src: Path = SRC, parts: Path = PARTS_FILE, include: Path = INCLUDE,
          corrections: list[Entry] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """`corrections`: data/corrections.yml's entries (read from the file when not given)."""
    version = load_pin().version
    shown: list[dict[str, Any]] = []
    others: list[dict[str, Any]] = []
    for entry in effective(parts, corrections):
        path = src / entry["file"]
        digest = source_hash(path.read_text(encoding="utf-8"), include, version) \
            if entry["status"] != "broken" else None
        if entry["status"] == "matched":
            shown.append({"target": entry["target"], "file": entry["file"], "hash": digest})
            continue
        row: dict[str, Any] = {"file": entry["file"], "status": entry["status"], "target": entry.get("target")}
        if entry.get("source") == "editor":
            row["source"] = "editor"
        if digest:
            row["hash"] = digest
        evidence = entry.get("evidence") or {}
        for key in ("error", "melody", "incipit", "page", "note"):
            if evidence.get(key) is not None:
                row[key] = evidence[key]
        if evidence.get("candidates"):
            row["candidates"] = evidence["candidates"]
        if entry["status"] == "broken" and isinstance(evidence.get("error"), str):
            around = excerpt(path, evidence["error"])
            if around:
                row["excerpt"] = around
        others.append(row)
    head = {"schema_version": 1, "lilypond": version, "prefix": PREFIX, "files": list(FILES),
            "credit": CREDIT, "source": f"https://github.com/{REPO}"}
    manifest = {**head, "parts": sorted(shown, key=lambda r: r["target"])}
    review = {**head, "files": list(FILES), "items": others}
    return manifest, review


#: Lines shown either side of the one LilyPond stopped at.
CONTEXT = 3
_LINE = re.compile(r"^line (\d+)")


def excerpt(path: Path, error: str) -> dict[str, Any] | None:
    """The source lines around the line an error names ("line 86:34: ..."), for
    the admin screen's Typeset errors queue."""
    m = _LINE.match(error)
    if not m or not path.exists():
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    at = int(m.group(1))
    if not 1 <= at <= len(lines):
        return None
    first = max(1, at - CONTEXT)
    return {"first": first, "line": at, "lines": [ln[:200] for ln in lines[first - 1:at + CONTEXT]]}


def text(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def write(manifest_path: Path = MANIFEST, review_path: Path = REVIEW) -> list[str]:
    """Write both; returns the names of those that changed."""
    manifest, review = build()
    changed = []
    for path, doc in ((manifest_path, manifest), (review_path, review)):
        body = text(doc)
        if not path.exists() or path.read_text(encoding="utf-8") != body:
            path.write_text(body, encoding="utf-8")
            changed.append(path.name)
    return changed


def stale(manifest_path: Path = MANIFEST, review_path: Path = REVIEW) -> list[str]:
    manifest, review = build()
    return [p.name for p, d in ((manifest_path, manifest), (review_path, review))
            if not p.exists() or p.read_text(encoding="utf-8") != text(d)]


def hashes(manifest_path: Path = MANIFEST, review_path: Path = REVIEW,
           include_review: bool = True) -> dict[str, str]:
    """Every render hash the committed files name, with a source file for each."""
    out = {r["hash"]: r["file"] for r in json.loads(manifest_path.read_text(encoding="utf-8"))["parts"]}
    if include_review:
        for r in json.loads(review_path.read_text(encoding="utf-8"))["items"]:
            if r.get("hash"):
                out.setdefault(r["hash"], r["file"])
    return out


__all__ = ["MANIFEST", "PREFIX", "REVIEW", "build", "effective", "excerpt", "hashes", "stale", "text", "write"]
