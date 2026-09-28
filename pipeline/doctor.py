"""Preflight checks. Every failure names the exact fix.

A missing dependency must fail in under a second with instructions, not as a
library traceback forty minutes into a 2,445-page run.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from pipeline.references import load_references, reference_filenames
from pipeline.volumes import load_volumes

OK, FAIL, SKIP = "ok", "FAIL", "skip"

R2_VARS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")


@dataclass(frozen=True)
class Check:
    status: str
    label: str
    detail: str = ""

    @property
    def failed(self) -> bool:
        return self.status == FAIL


def check_python() -> Check:
    v = sys.version_info
    if (v.major, v.minor) < (3, 12):
        return Check(FAIL, f"python {v.major}.{v.minor}",
                     "Python 3.12+ required.\n      Fix: uv sync")
    return Check(OK, f"python {v.major}.{v.minor}.{v.micro}")


def check_tesseract() -> Check:
    if shutil.which("tesseract") is None:
        return Check(FAIL, "tesseract: not installed",
                     "Required by folio cross-check, running heads and index OCR.\n"
                     "      Fix:  macOS   brew install tesseract tesseract-lang\n"
                     "            Debian  sudo apt install tesseract-ocr tesseract-ocr-lat")
    try:
        langs = subprocess.run(["tesseract", "--list-langs"], capture_output=True,
                               text=True, timeout=15, check=False).stdout.split()
    except (subprocess.SubprocessError, OSError) as exc:
        return Check(FAIL, "tesseract: could not list languages", str(exc))
    if "lat" not in langs:
        return Check(FAIL, "tesseract: Latin language data missing",
                     "`lat` is required by index OCR and running heads.\n"
                     "      Fix:  macOS   brew install tesseract-lang\n"
                     "            Debian  sudo apt install tesseract-ocr-lat\n"
                     "      Verify: tesseract --list-langs | grep lat")
    return Check(OK, "tesseract with Latin data")


def check_sources() -> list[Check]:
    checks: list[Check] = []
    for vol in load_volumes().values():
        if not vol.path.exists():
            checks.append(Check(
                FAIL, f"{vol.file} not found",
                "Source PDFs are not tracked in git (230 MB). See README\n"
                "      \"Getting the source PDFs\"; sha256 is pinned in data/volumes.yml."))
        elif vol.sha256 is None:
            checks.append(Check(FAIL, f"{vol.file}: sha256 not pinned",
                                "Fix: uv run noh checksum --volume " + vol.id))
        else:
            checks.append(Check(OK, f"{vol.file} present"))
    return checks


def check_reference_not_registered() -> Check:
    """Reference editions must never become publication sources.

    pdf-source/ holds the Corpus Christi Watershed edition beside the real
    sources. It carries burned-in branding and a copyrighted modern preface, so
    registering it in volumes.yml would republish both.
    """
    registered = {v.file for v in load_volumes().values()}
    strays = sorted(registered & reference_filenames())
    if strays:
        return Check(
            FAIL, f"reference edition registered as a source volume: {strays}",
            "These are reconciliation input only -- see data/reference-editions.yml.\n"
            "      Fix: remove them from data/volumes.yml.")
    n = len(load_references())
    return Check(OK, f"{n} reference edition(s) excluded from publication")


def check_r2(env: dict[str, str]) -> Check:
    missing = [v for v in R2_VARS if not env.get(v)]
    if missing:
        return Check(SKIP, f"R2 credentials ({', '.join(missing)}): unset",
                     "Only `noh publish --upload` needs these.\n"
                     "      Fix: copy .dev.vars.example to .dev.vars, or export them.")
    return Check(OK, "R2 credentials present")


def check_gregobase_dump(path: Path | None = None, pinned: str | None = None) -> Check:
    """The GregoBase dump: Proper parts are found by their chant texts, which
    come only from it. It is not in git."""
    import hashlib

    from pipeline.gregobase import DUMP, DUMP_SHA256
    path, pinned = path or DUMP, pinned or DUMP_SHA256
    if not path.exists():
        return Check(FAIL, "GregoBase dump: missing",
                     f"Proper parts need {path.name} (not in git).\n"
                     "      Fix: uv run noh gregobase-fetch")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    if digest.hexdigest() != pinned:
        return Check(FAIL, "GregoBase dump: checksum",
                     f"{path.name} sha256 {digest.hexdigest()[:12]} does not match the pinned "
                     f"{pinned[:12]}.\n"
                     "      Fix: restore the pinned dump (README \"Vendored data\"), or re-pin\n"
                     "      DUMP_SHA256 in pipeline/gregobase.py after checking the new one.")
    return Check(OK, "GregoBase dump present and pinned")


def check_jgabc(path: Path | None = None) -> Check:
    """jgabc's per-day chant ids, vendored in data/jgabc-propers.json."""
    from pipeline.jgabc import VENDORED, JgabcIntegrityError, load_proprium
    try:
        count = len(load_proprium(path or VENDORED))
    except JgabcIntegrityError as exc:
        return Check(FAIL, "jgabc chant ids", f"{exc}\n      Fix: uv run noh jgabc-fetch")
    return Check(OK, f"jgabc chant ids for {count} Propers")


def check_officium(path: Path | None = None) -> Check:
    """Divinum Officium's Vespers texts, vendored in data/divinum-officium-vespers.json."""
    from pipeline.officium import VENDORED, OfficiumError, load
    try:
        count = len(load(path or VENDORED)["offices"])      # type: ignore[arg-type]
    except OfficiumError as exc:
        return Check(FAIL, "Divinum Officium Vespers texts", f"{exc}\n      Fix: uv run noh officium-fetch")
    return Check(OK, f"Divinum Officium Vespers texts for {count} offices")


def check_vesperale(path: Path | None = None) -> Check:
    """jsrjenkins/vesperale's Sunday table, vendored in data/vesperale-lineup.json."""
    from pipeline.vesperale import VENDORED, VesperaleIntegrityError, load_magnificat
    try:
        count = len(load_magnificat(path or VENDORED))
    except VesperaleIntegrityError as exc:
        return Check(FAIL, "vesperale Sunday table", f"{exc}\n      Fix: uv run noh vesperale-fetch")
    return Check(OK, f"vesperale Sunday table for {count} Sundays")


def check_vespers_lineup(path: Path | None = None) -> Check:
    """data/vespers-lineup.json: present, and current with the catalogue."""
    from pipeline.vespers import LINEUP, check_lineup
    problem = check_lineup(path or LINEUP)
    if problem:
        return Check(FAIL, "Vespers lineup", f"{problem}\n      Fix: uv run noh vespers-lineup")
    return Check(OK, "Vespers lineup current with the catalogue")


def check_corrections() -> Check:
    """data/corrections.yml applies cleanly, and the files it changes are current."""
    from pipeline import corrections as c
    try:
        base, entries, vespers = c.load_base(), c.load(), c.load_vespers()
        found = c.problems(base, entries, vespers)
        if found:
            return Check(FAIL, "hand corrections", "\n".join(found))
        stale = c.stale_outputs()
    except c.CorrectionError as exc:
        return Check(FAIL, "hand corrections", str(exc))
    if stale:
        return Check(FAIL, "hand corrections", f"{', '.join(stale)} not current with corrections.yml\n"
                     "      Fix: uv run noh apply-corrections")
    notes = []
    idle = c.no_ops(base, entries, vespers)
    if idle:
        notes.append("now fixed at the source, safe to drop: " + ", ".join(e.id for e in idle)
                     + "\n      Fix: uv run noh corrections --drop <id>")
    chants_path = c.DATA / "chants.json"
    have = set(json.loads(chants_path.read_text(encoding="utf-8")).get("chants", {})) if chants_path.exists() else set()
    missing = sorted({str(e.value) for e in entries if e.field == "chant" and e.value is not None} - have)
    if missing:
        notes.append(f"chant(s) {', '.join(missing)} are linked but their notation is not in data/chants.json\n"
                     "      Fix: uv run noh chants (needs the GregoBase dump; the links work meanwhile)")
    return Check(OK, f"{len(entries)} hand correction(s) applied", "\n".join(notes))


def run(env: dict[str, str] | None = None) -> list[Check]:
    import os
    env = os.environ if env is None else env
    return [check_python(), check_tesseract(), check_reference_not_registered(),
            *check_sources(), check_gregobase_dump(), check_jgabc(), check_officium(), check_vesperale(),
            check_vespers_lineup(), check_corrections(), check_r2(dict(env))]


def report(checks: list[Check]) -> int:
    for c in checks:
        print(f"{c.status:<5} {c.label}")
        if c.detail:
            for line in c.detail.splitlines():
                print(f"      {line}" if not line.startswith("      ") else line)
    failures = sum(1 for c in checks if c.failed)
    if failures:
        print(f"\n{failures} check(s) failed.")
    return 1 if failures else 0
