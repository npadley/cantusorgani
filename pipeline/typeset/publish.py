"""Render what is not published yet, upload it, and check it is all there.

CI runs these in three places (.github/workflows/site.yml):

    typeset-render   no secrets, no network for LilyPond (NOH_SANDBOX=1):
                     `noh typeset-render --missing-from $PUBLIC_ASSET_BASE`
                     draws every hash the committed manifest and review files
                     name that is not on R2 yet, into build/typeset/out/.
    typeset-upload   the R2 secrets, never LilyPond: `noh typeset-publish`
                     checks each file (svgcheck) and uploads it, write-if-absent.
    the build        `noh typeset-check --remote $PUBLIC_ASSET_BASE`: every file
                     the manifest names answers at its public address, so the
                     site never deploys a link to music that is not there.

A matched part that fails to render, or whose melody no longer matches its
chant (an edit went wrong), fails the render job. A file that is only on the
review list and fails is reported, and left for the admin screen.
"""

from __future__ import annotations

import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pipeline.typeset.manifest import MANIFEST, PREFIX, REVIEW, hashes
from pipeline.typeset.match import MATCHED, SRC, targets
from pipeline.typeset.render import FILES, render
from pipeline.typeset.svgcheck import WIDTHS, check_file, check_pdf
from pipeline.volumes import DATA

OUT = DATA.parent / "build" / "typeset" / "out"


def published(base: str, digest: str, timeout: int = 20) -> bool:
    """Whether every file of a render answers at its public address."""
    for name in FILES:
        request = urllib.request.Request(f"{base.rstrip('/')}/{PREFIX}/{digest}/{name}", method="HEAD",
                                         headers={"User-Agent": "cantusorgani-pipeline"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    return False
        except OSError:
            return False
    return True


def missing(base: str, wanted: dict[str, str], workers: int = 16) -> dict[str, str]:
    with ThreadPoolExecutor(max_workers=workers) as pool:
        there = dict(zip(wanted, pool.map(lambda h: published(base, h), wanted), strict=True))
    return {h: f for h, f in wanted.items() if not there[h]}


@dataclass
class RenderReport:
    rendered: list[str] = field(default_factory=list)
    failed_shown: list[str] = field(default_factory=list)
    failed_review: list[str] = field(default_factory=list)
    #: Each failed file's problems, by file.
    failures: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.failed_shown


def melody_problem(file: str, target: str, src: Path = SRC, data: Path = DATA) -> str | None:
    """A matched file whose melody no longer matches its part's chant."""
    from pipeline.typeset.events import read
    from pipeline.typeset.melody import compare, gabc_steps

    catalog = json.loads((data / "catalog.json").read_text(encoding="utf-8"))
    chants = json.loads((data / "chants.json").read_text(encoding="utf-8")).get("chants", {})
    found = next((t for t in targets(catalog, lambda ref: None) if t.target == target), None)
    gabc = (chants.get(str(found.chant)) or {}).get("gabc") if found and found.chant is not None else None
    if not gabc:
        return None
    events = read(src / file)
    score = compare(events.steps, gabc_steps(gabc)).score if events.ok else 0.0
    if score < MATCHED:
        return f"{file}: its melody now matches {target}'s chant only {score:.2f} (it needs {MATCHED}); check the edit"
    return None


def render_missing(base: str | None, out: Path = OUT, src: Path = SRC, workers: int = 4,
                   manifest_path: Path = MANIFEST, review_path: Path = REVIEW) -> RenderReport:
    shown = {r["hash"]: r for r in json.loads(manifest_path.read_text(encoding="utf-8"))["parts"]}
    wanted = hashes(manifest_path, review_path)
    todo = missing(base, wanted) if base else wanted
    report = RenderReport()

    def one(item: tuple[str, str]) -> tuple[str, str, list[str]]:
        digest, file = item
        result = render(src / file, out)
        problems = list(result.problems)
        if result.ok and result.hash != digest:
            problems.append(f"rendered as {result.hash}, but the manifest says {digest}: run `uv run noh typeset-manifest`")
        if result.ok and digest in shown:
            problem = melody_problem(file, shown[digest]["target"], src)
            if problem:
                problems.append(problem)
        return digest, file, problems

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for digest, file, problems in pool.map(one, sorted(todo.items())):
            if problems:
                report.failures[file] = "; ".join(problems)[:500]
            if not problems:
                report.rendered.append(digest)
            elif digest in shown:
                report.failed_shown.append(f"{file}: {'; '.join(problems)}")
            else:
                report.failed_review.append(f"{file}: {'; '.join(problems)}")
    return report


def publish(out: Path = OUT, creds: Any = None) -> tuple[int, int, list[str]]:
    """Check and upload every render in out/; returns (uploaded, already there, problems).
    Nothing of a render that fails a check is uploaded."""
    from pipeline.upload import UploadPlan, upload_all

    plans: list[UploadPlan] = []
    problems: list[str] = []
    for folder in sorted(p for p in out.iterdir() if p.is_dir()) if out.exists() else []:
        found = [f"{folder.name}/{n}: {p}" for n, w in WIDTHS.items() for p in check_file(folder / n, w)]
        found += [f"{folder.name}/score.pdf: {p}" for p in check_pdf((folder / "score.pdf").read_bytes())]
        if found:
            problems += found
            continue
        plans += [UploadPlan(key=f"{PREFIX}/{folder.name}/{n}", path=folder / n) for n in FILES]
    report = upload_all(plans, creds)
    problems += [f"{key}: {why}" for key, why in report.failed]
    return report.uploaded, report.skipped, problems


def remote_problems(base: str, manifest_path: Path = MANIFEST) -> list[str]:
    wanted = {r["hash"]: r["file"] for r in json.loads(manifest_path.read_text(encoding="utf-8"))["parts"]}
    return [f"{file}: typeset/{digest}/ is not at {base} (the typeset-upload job publishes it)"
            for digest, file in sorted(missing(base, wanted).items(), key=lambda x: x[1])]


__all__ = ["OUT", "RenderReport", "melody_problem", "missing", "publish", "published", "remote_problems",
           "render_missing"]
