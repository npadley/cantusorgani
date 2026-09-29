"""What the site and the admin screen read about the typeset music, written from
the sources alone (no LilyPond needed), so it can be committed with any change
to them and checked in CI:

data/typeset/manifest.json   the parts the site shows typeset: each `matched`
                             entry's target, file and render hash
data/typeset/review.json     everything else, for the admin screen's queues:
                             status, candidate target, render hash (when it
                             compiles), LilyPond's error (when it does not)

A render hash names typeset/<hash>/{narrow.svg, wide.svg, score.pdf} on R2
(pipeline/typeset/render.py). `noh typeset-render` draws the ones not published
yet, `noh typeset-publish` uploads them, and `noh typeset-check --remote`
checks every one the manifest names is there.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pipeline.typeset.importer import CREDIT, REPO
from pipeline.typeset.lilypond import INCLUDE, load_pin
from pipeline.typeset.match import PARTS_FILE, SRC, load
from pipeline.typeset.render import FILES, source_hash
from pipeline.volumes import DATA

MANIFEST = DATA / "typeset" / "manifest.json"
REVIEW = DATA / "typeset" / "review.json"
PREFIX = "typeset"


def build(src: Path = SRC, parts: Path = PARTS_FILE, include: Path = INCLUDE) -> tuple[dict[str, Any], dict[str, Any]]:
    version = load_pin().version
    shown: list[dict[str, Any]] = []
    others: list[dict[str, Any]] = []
    for entry in load(parts):
        path = src / entry["file"]
        digest = source_hash(path.read_text(encoding="utf-8"), include, version) \
            if entry["status"] != "broken" else None
        if entry["status"] == "matched":
            shown.append({"target": entry["target"], "file": entry["file"], "hash": digest})
            continue
        row: dict[str, Any] = {"file": entry["file"], "status": entry["status"], "target": entry.get("target")}
        if digest:
            row["hash"] = digest
        evidence = entry.get("evidence") or {}
        for key in ("error", "melody", "incipit", "page", "note"):
            if evidence.get(key) is not None:
                row[key] = evidence[key]
        if evidence.get("candidates"):
            row["candidates"] = evidence["candidates"]
        others.append(row)
    head = {"schema_version": 1, "lilypond": version, "prefix": PREFIX, "files": list(FILES),
            "credit": CREDIT, "source": f"https://github.com/{REPO}"}
    manifest = {**head, "parts": sorted(shown, key=lambda r: r["target"])}
    review = {**head, "files": list(FILES), "items": others}
    return manifest, review


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


__all__ = ["MANIFEST", "PREFIX", "REVIEW", "build", "hashes", "stale", "text", "write"]
