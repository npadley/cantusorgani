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


def validate_source_evidence(
    batch: dict, artifact: Path, *, parts: Path = match.PARTS_FILE, corrections=None
) -> None:
    """The credentialed job accepts evidence only for the approved files, preserving established targets."""
    if artifact.is_symlink() or artifact.stat().st_size > 8 * 1024 * 1024:
        raise CorrectionError("Invalid source evidence artifact")
    before = match.load(parts)
    after = yaml.safe_load(artifact.read_text(encoding="utf-8"))
    if not isinstance(after, list) or len(after) != len(before):
        raise CorrectionError("Source evidence changed the transcription inventory")
    edited = {s["file"] for s in batch.get("sources", [])}
    established = {r["file"]: r for r in effective(parts, corrections)}
    for old, new in zip(before, after):
        if not isinstance(new, dict) or new.get("file") != old["file"]:
            raise CorrectionError("Source evidence changed file identity/order")
        if old["file"] not in edited and new != old:
            raise CorrectionError("Source evidence changed an unrelated file")
        if old["file"] in edited:
            previous = established[old["file"]]
            if previous.get("status") == "matched" and (
                new.get("status") != "matched" or new.get("target") != previous.get("target")
            ):
                raise CorrectionError("Source evidence reassigned an established target")
            if (
                set(new) - {"file", "status", "target", "source", "evidence"}
                or new.get("status")
                not in {
                    "matched",
                    "proposed",
                    "melody-differs",
                    "broken",
                    "no-match",
                    "other-setting",
                }
                or not isinstance(new.get("evidence"), dict)
            ):
                raise CorrectionError("Invalid refreshed source evidence")
