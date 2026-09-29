"""Import the volunteers' LilyPond transcriptions from a pinned commit.

Source: github.com/joeegan2202/nova-organi-harmonia (Joe Egan and helpers),
Volumes 1, 2, 3 and 5. The music is public domain (NOH, 1942); the
transcriptions are credited on the About page and under every typeset part.

`noh typeset-import --commit <sha>`:

- downloads that commit (GitHub's tarball of it);
- copies `volume-N/...` to `data/typeset/src/vol-N/...` and the shared
  `noh.ily`/`noh2.ily` to `data/typeset/include/`, updating each to the pinned
  LilyPond with `convert-ly`; our include copy drops two debugging settings the
  source check refuses (`ly:set-option`, `debug-enable`);
- records the commit, the credit, and each file's upstream and imported sha256
  in `data/typeset/UPSTREAM.yml`.

Our copy is the one we edit from then on. A re-import adds new files and
updates files nobody has edited here; a file edited here is kept, and if it also
changed upstream it is reported as a conflict for a person to merge.
"""

from __future__ import annotations

import hashlib
import io
import re
import subprocess
import tarfile
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from pipeline.typeset.lilypond import INCLUDE, LilyPondError, tool
from pipeline.typeset.source_check import check
from pipeline.volumes import DATA

REPO = "joeegan2202/nova-organi-harmonia"
CREDIT = "Joe Egan (joeegan2202) and the nova-organi-harmonia volunteers"
TYPESET = DATA / "typeset"
SRC = TYPESET / "src"
UPSTREAM = TYPESET / "UPSTREAM.yml"
VOLUMES = ("volume-1", "volume-2", "volume-3", "volume-5")
INCLUDES = ("noh.ily", "noh2.ily")
#: Lines of upstream noh2.ily our copy leaves out: debugging settings that
#: change LilyPond's options, which the source check refuses in any file.
DROPPED_LINES = (re.compile(r"^\s*#\(ly:set-option\s+'compile-scheme-code\)\s*$"),
                 re.compile(r"^\s*#\(debug-enable\s+'backtrace\)\s*$"))
COMMIT = re.compile(r"^[0-9a-f]{40}$")
VERSION = re.compile(r"^\s*\\version\s", re.MULTILINE)
OLDEST = "2.18.0"


class UpstreamError(RuntimeError):
    """The import cannot go ahead; the message says why."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(commit: str, repo: str = REPO) -> bytes:
    """Exactly that commit of the upstream repository, as a tar archive. Fetched
    with git (by sha, so nothing else can arrive under that name)."""
    if not COMMIT.fullmatch(commit):
        raise UpstreamError(f"{commit!r} is not a full 40-character commit sha; pin a commit, never a branch")
    with tempfile.TemporaryDirectory() as tmp:
        def git(*args: str) -> bytes:
            done = subprocess.run(["git", "-C", tmp, *args], check=False, capture_output=True, timeout=600)
            if done.returncode != 0:
                raise UpstreamError(f"git {args[0]} failed: {done.stderr.decode(errors='replace').strip()}")
            return done.stdout

        git("init", "-q")
        git("fetch", "-q", "--depth", "1", f"https://github.com/{repo}.git", commit)
        got = git("rev-parse", "FETCH_HEAD").decode().strip()
        if got != commit:
            raise UpstreamError(f"asked for {commit}, got {got}")
        return git("archive", "--format=tar", "--prefix=upstream/", "FETCH_HEAD")


def unpack(tarball: bytes) -> dict[str, bytes]:
    """The files we import, by their path in the upstream repository."""
    files: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(tarball)) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            path = member.name.split("/", 1)[1] if "/" in member.name else member.name
            wanted = path in INCLUDES or (path.split("/", 1)[0] in VOLUMES and path.endswith(".ly"))
            if wanted and ".." not in path.split("/"):
                extracted = tar.extractfile(member)
                if extracted is not None:
                    files[path] = extracted.read()
    return files


def destination(path: str, src: Path = SRC, include: Path = INCLUDE) -> Path:
    """Where an upstream file lives in our tree."""
    if path in INCLUDES:
        return include / path
    volume, rest = path.split("/", 1)
    return src / volume.replace("volume-", "vol-") / rest


def our_include(text: str) -> str:
    return "".join(line for line in text.splitlines(keepends=True)
                   if not any(p.match(line.rstrip("\n")) for p in DROPPED_LINES))


def convert(text: str, convert_ly: Path) -> tuple[str, str | None]:
    """The file updated to the pinned LilyPond by convert-ly; (text, problem)."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "file.ly"
        path.write_text(text, encoding="utf-8")
        # A file with no \version is taken as the oldest the transcriptions use.
        start = [] if VERSION.search(text) else [f"--from={OLDEST}"]
        done = subprocess.run([str(convert_ly), "-e", *start, str(path)], check=False, capture_output=True, text=True,
                              timeout=120)
        converted = path.read_text(encoding="utf-8")
    if done.returncode != 0:
        return text, (done.stderr.strip().splitlines() or ["convert-ly failed"])[-1]
    return converted, None


@dataclass
class Report:
    commit: str
    added: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    kept: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    not_converted: dict[str, str] = field(default_factory=dict)
    refused: dict[str, list[str]] = field(default_factory=dict)
    #: Placeholders upstream (an empty file, for a piece nobody has transcribed yet).
    empty: list[str] = field(default_factory=list)

    def lines(self) -> list[str]:
        out = [(f"imported {REPO} at {self.commit[:12]}: {len(self.added)} added, {len(self.updated)} updated, "
                f"{len(self.unchanged)} unchanged, {len(self.kept)} edited here and kept")]
        out += [f"  conflict: {p} was edited here and changed upstream; merge by hand" for p in self.conflicts]
        out += [f"  not converted: {p}: {why}" for p, why in self.not_converted.items()]
        out += [f"  refused by the source check (never rendered): {p}: {'; '.join(why)}"
                for p, why in self.refused.items()]
        if self.empty:
            out.append(f"  {len(self.empty)} empty placeholder(s) upstream, not imported")
        return out


def load_record(path: Path = UPSTREAM) -> dict[str, Any]:
    if not path.exists():
        return {"repo": REPO, "credit": CREDIT, "files": {}}
    return dict(yaml.safe_load(path.read_text(encoding="utf-8")) or {})


RECORD_HEADER = """\
# Where data/typeset/ came from: the volunteers' LilyPond transcriptions of the
# Nova Organi Harmonia, imported by `uv run noh typeset-import --commit <sha>`
# (pipeline/typeset/importer.py). The music is public domain (NOH, 1942).
# The repository states no licence; the transcriptions are credited on the
# About page and under every typeset part.
#
# files: each file's sha256 upstream at the imported commit, and ours as
# imported (after convert-ly). When ours no longer matches `imported`, it has
# been edited here, and a re-import keeps it.
"""


def save_record(record: dict[str, Any], path: Path = UPSTREAM) -> None:
    order = ("repo", "commit", "credit", "files")
    ordered = {k: record[k] for k in order if k in record} | {k: v for k, v in record.items() if k not in order}
    body = yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=120)
    path.write_text(RECORD_HEADER + body, encoding="utf-8")


def import_files(files: dict[str, bytes], commit: str, convert_ly: Path | None, src: Path = SRC,
                 include: Path = INCLUDE, record_path: Path = UPSTREAM) -> Report:
    """Write the upstream files into our tree under the rules above."""
    record = load_record(record_path)
    known: dict[str, dict[str, str]] = record.get("files") or {}
    report = Report(commit)
    for path in sorted(files):
        raw = files[path]
        if not raw.strip():
            report.empty.append(path)
            continue
        dest = destination(path, src, include)
        before = known.get(path)
        ours = sha256(dest.read_bytes()) if dest.exists() else None
        # A file here that the record does not know was added by hand: ours too.
        edited = ours is not None and (before is None or ours != before.get("imported"))
        if edited:
            if sha256(raw) != (before or {}).get("upstream"):
                report.conflicts.append(path)
            report.kept.append(path)
            continue
        if before is not None and sha256(raw) == before.get("upstream") and ours is not None:
            report.unchanged.append(path)
            continue
        text = raw.decode("utf-8")
        if path in INCLUDES:
            text = our_include(text)
        if convert_ly is not None:
            text, problem = convert(text, convert_ly)
            if problem:
                report.not_converted[path] = problem
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        found = check(text, frozenset(INCLUDES))
        if found:
            report.refused[path] = [str(p) for p in found]
        (report.added if before is None else report.updated).append(path)
        known[path] = {"upstream": sha256(raw), "imported": sha256(text.encode("utf-8"))}
    record.update(repo=REPO, commit=commit, credit=CREDIT, files=dict(sorted(known.items())))
    save_record(record, record_path)
    return report


def run_import(commit: str) -> Report:
    try:
        convert_ly = tool("convert-ly")
    except LilyPondError as error:
        raise UpstreamError(f"convert-ly is needed to update the files: {error}") from None
    return import_files(unpack(fetch(commit)), commit, convert_ly)


__all__ = ["CREDIT", "INCLUDES", "REPO", "Report", "UpstreamError", "destination", "fetch", "import_files", "our_include",
           "run_import", "unpack"]
