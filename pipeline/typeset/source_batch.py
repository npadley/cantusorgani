"""Refresh only edited source evidence, in the no-secret LilyPond job."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import yaml

from pipeline.corrections import CorrectionError, validate_batch_sources
from pipeline.typeset import match, render
from pipeline.typeset.events import read
from pipeline.typeset.manifest import effective
from pipeline.typeset.publish import melody_problem, recorded_melodies
from pipeline.volumes import DATA


def refresh_sources(batch: dict, out: Path) -> None:
    sources = validate_batch_sources(batch)
    rows = match.load()
    known = {row["file"] for row in rows}
    if any(s["file"] not in known for s in sources):
        raise CorrectionError("Unknown transcription source")
    shown = {r["file"]: r for r in effective()}
    scores = recorded_melodies()
    catalog = json.loads((DATA / "catalog.json").read_text())
    chants = json.loads((DATA / "chants.json").read_text()).get("chants", {})
    maps = {}

    def printed(ref):
        from pipeline.offset import load_page_map

        volume, page = ref.split("/")[:2]
        if volume not in maps:
            maps[volume] = load_page_map(volume)
        return maps[volume].to_printed(int(page))

    targets = match.targets(catalog, printed)
    with tempfile.TemporaryDirectory() as tmp:
        for source in sources:
            file = source["file"]
            path = match.SRC / file
            events = read(path)
            if not events.ok:
                raise CorrectionError(f"{file}: source events cannot be read")
            rendered = render.render(path, Path(tmp))
            if not rendered.ok:
                raise CorrectionError(f"{file}: render failed: {str(rendered.problems[:3])[:3000]}")
            previous = shown.get(file, {})
            if previous.get("status") == "matched":
                problem = melody_problem(file, previous["target"], recorded=scores.get(file))
                if problem:
                    raise CorrectionError(problem)
            for i, row in enumerate(rows):
                if row["file"] != file:
                    continue
                # Preserve an established target; correcting notes cannot silently reassign it.
                if previous.get("status") == "matched":
                    row["status"] = "matched"
                    row["target"] = previous["target"]
                    row.setdefault("evidence", {}).pop("error", None)
                    row["evidence"]["incipit"] = events.incipit
                    if row.get("source") == "render":
                        row.pop("source", None)
                elif row.get("source") != "editor":
                    rows[i] = match.decide(
                        file, path.read_text(), events, targets, chants
                    ).as_dict()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        match.HEADER + yaml.safe_dump(rows, sort_keys=False, allow_unicode=True, width=120),
        encoding="utf-8",
    )
