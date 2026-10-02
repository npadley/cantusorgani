"""Untrusted source rendering and independent artifact-only preview publication."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from pipeline.typeset import render
from pipeline.typeset.source_check import check
from pipeline.typeset.svgcheck import WIDTHS, check_file
from pipeline.upload import UploadPlan, upload_all

HEX = re.compile(r"^[a-f0-9]{64}$")
FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./-]*\.ly$")


def preview_key(file: str, text: str, commit_sha: str) -> str:
    h = hashlib.sha256()
    for value in ("typeset-preview-v1", file, text, commit_sha):
        data = value.encode("utf-8")
        h.update(str(len(data)).encode() + b":" + data)
    return h.hexdigest()


def read_source_blob(repo: str, blob_sha: str) -> str:
    """Fetch bytes before rendering, without credentials, and verify Git's blob identity."""
    import base64
    import urllib.request

    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or not re.fullmatch(
        r"[a-f0-9]{40}", blob_sha
    ):
        raise ValueError("Invalid source blob location")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/git/blobs/{blob_sha}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "cantusorgani-preview"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(131073)
    if len(raw) > 131072:
        raise ValueError("Source blob response too large")
    body = json.loads(raw)
    if (
        body.get("encoding") != "base64"
        or body.get("sha") != blob_sha
        or not isinstance(body.get("content"), str)
    ):
        raise ValueError("Invalid source blob response")
    data = base64.b64decode(re.sub(r"\s", "", body["content"]), validate=True)
    if (
        len(data) > 61440
        or hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() != blob_sha
    ):
        raise ValueError("Source blob differs from its identity or exceeds the limit")
    return data.decode("utf-8")


def render_preview(payload_path: Path, out: Path, *, verify_context: bool = True) -> None:
    if payload_path.stat().st_size > 400000:
        raise ValueError("Preview payload too large")
    p = json.loads(payload_path.read_text(encoding="utf-8"))
    file, text, commit, key = (p.get(n) for n in ("file", "text", "commitSha", "key"))
    if (
        not isinstance(file, str)
        or not FILE.fullmatch(file)
        or any(s in (".", "..") for s in file.split("/"))
    ):
        raise ValueError("Invalid source file")
    if "sourceBlobSha" in p:
        import os

        if text is not None:
            raise ValueError("Ambiguous preview source")
        text = read_source_blob(os.environ.get("GITHUB_REPOSITORY", ""), p["sourceBlobSha"])
    if not isinstance(text, str) or len(text.encode("utf-8")) > 61440:
        raise ValueError("Source exceeds 60 KiB")
    if (
        not isinstance(commit, str)
        or not re.fullmatch("[a-f0-9]{40}", commit)
        or key != preview_key(file, text, commit)
    ):
        raise ValueError("Invalid preview context/key")
    if verify_context:
        if subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() != commit:
            raise ValueError("Preview checkout differs from context")
        from pipeline.typeset.manifest import effective

        if file not in {row["file"] for row in effective()}:
            raise ValueError("Unknown source file")
    if check(text, frozenset({"noh.ily", "noh2.ily"})):
        raise ValueError("Unsafe source")
    folder = out / key
    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / file
        source.parent.mkdir(parents=True)
        source.write_text(text, encoding="utf-8")
        result = render.render(source, root / "render")
        melody = None
        if verify_context and result.ok:
            from pipeline.typeset.manifest import effective
            from pipeline.typeset.publish import melody_problem, recorded_melodies

            row = next((r for r in effective() if r["file"] == file), {})
            if row.get("status") == "matched":
                melody = melody_problem(
                    file, row["target"], src=root, recorded=recorded_melodies().get(file)
                )
        problems = [str(p)[:1000] for p in result.problems[:20]]
        if melody:
            problems.append(melody[:1000])
        ok = result.ok and not melody
        if result.ok:
            svg = root / "render" / result.hash / "wide.svg"
            if check_file(svg, WIDTHS["wide.svg"]):
                raise ValueError("Unsafe preview SVG")
            if svg.stat().st_size > 8 * 1024 * 1024:
                raise ValueError("Preview SVG too large")
            shutil.copyfile(svg, folder / "wide.svg")
        (folder / "result.json").write_text(
            json.dumps(
                {
                    "key": key,
                    "ok": ok,
                    "drawing": result.ok,
                    "problems": problems,
                    "warnings": [w[:1000] for w in result.warnings[:20]],
                }
            ),
            encoding="utf-8",
        )


def publish_preview(out: Path, creds=None, *, expected_key: str):
    if not isinstance(expected_key, str) or not HEX.fullmatch(expected_key):
        raise ValueError("Invalid trusted preview key")
    folders = list(out.iterdir())
    if len(folders) != 1 or folders[0].name != expected_key:
        raise ValueError("Preview artifacts differ from the triggering request")
    plans = []
    for folder in folders:
        if folder.is_symlink() or not folder.is_dir() or not HEX.fullmatch(folder.name):
            raise ValueError("Invalid preview artifact directory")
        result = folder / "result.json"
        if result.is_symlink() or result.stat().st_size > 50000:
            raise ValueError("Invalid result artifact")
        p = json.loads(result.read_text(encoding="utf-8"))
        if (
            set(p) - {"key", "ok", "drawing", "problems", "warnings"}
            or p.get("key") != folder.name
            or not isinstance(p.get("ok"), bool)
        ):
            raise ValueError("Invalid preview result")
        for field in ("problems", "warnings"):
            if (
                not isinstance(p.get(field), list)
                or len(p[field]) > 21
                or any(not isinstance(s, str) or len(s) > 1000 for s in p[field])
            ):
                raise ValueError("Invalid preview diagnostics")
        drawing = p.get("drawing", p["ok"])
        if not isinstance(drawing, bool) or (p["ok"] and not drawing):
            raise ValueError("Invalid drawing flag")
        allowed = {"result.json", "wide.svg"} if drawing else {"result.json"}
        if {f.name for f in folder.iterdir()} != allowed:
            raise ValueError("Unexpected preview artifacts")
        if drawing:
            svg = folder / "wide.svg"
            if (
                svg.is_symlink()
                or svg.stat().st_size > 8 * 1024 * 1024
                or check_file(svg, WIDTHS["wide.svg"])
            ):
                raise ValueError("Unsafe preview SVG")
            plans.append(UploadPlan(f"typeset-preview/{folder.name}/wide.svg", svg))
        plans.append(UploadPlan(f"typeset-preview/{folder.name}/result.json", result))
    report = upload_all(plans, creds)
    if report is not None and report.failed:
        raise RuntimeError("Preview upload failed")
    return report
