"""Resumable, digest-keyed MEI conversion batches (card C4a).

``run_batch`` converts a list of sources with the existing extractor, encoder, validator and evidence
packet; it is not a second converter. Conversion never approves: every requested non-empty source ends
in exactly one of ``unsupported``, ``failed`` or ``needs-review`` (``approved`` is always 0 here; only a
signed review record approves).

Layout under ``output``::

    <inputs digest>/            one finished build per ConversionInputs digest: score.mei, ir.json,
                                diagnostics.json, ..., evidence/index.html and batch-result.json
    .tmp-<digest>-<token>/      a build in progress; renamed into place only when complete
    reports/report-<list hash>-<n>.json   one report per run, created exclusively (never overwritten)

The digest covers the source, every include file, the extractor and converter code digests, the
profile, the schema and the tool versions (``manifest.current_inputs_from_files``), so a changed
input is a new key and a cached success is reused only while every input is identical. A final
directory without ``batch-result.json`` is treated as absent. A finished directory is never rewritten:
another agent's or an earlier run's output stays as it is.

Compiler concurrency is bounded by ``workers``.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import shutil
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from pipeline.typeset import lilypond
from pipeline.typeset.mei.diagnostics import BLOCKING
from pipeline.typeset.mei.model import (
    BatchReport,
    ConversionInputs,
    ConversionProfile,
    ConversionRecord,
    ConversionState,
)

__all__ = ["DEFAULT_WORKERS", "run_batch"]

DEFAULT_WORKERS = 2
RESULT = "batch-result.json"
STATES: tuple[ConversionState, ...] = ("unsupported", "failed", "needs-review", "approved")

RecordFn = Callable[[Path, Path], Any]  # (convert dir, source) -> ConversionRecord
PrecheckFn = Callable[[Path, Path], dict[str, list[str]]]
CasesFn = Callable[[Path], dict[str, Any]]
ConvertFn = Callable[[Path, Path], None]
InputsFn = Callable[[Path], ConversionInputs]
EvidenceFn = Callable[[Path, Path], None]


def _display(source: Path) -> str:
    """Repo-relative POSIX path for a source inside the repository, else the path as given."""
    try:
        return source.resolve().relative_to(lilypond.ROOT).as_posix()
    except ValueError:
        return str(source)


def _default_inputs(profile: ConversionProfile) -> InputsFn:
    from pipeline.typeset.mei.cli import VEROVIO_VERSION, font_digest
    from pipeline.typeset.mei.manifest import current_inputs_from_files

    def inputs(source: Path) -> ConversionInputs:
        resolved = source.resolve()
        try:
            relative = resolved.relative_to(lilypond.ROOT).as_posix()
        except ValueError:
            relative = str(resolved)
        skeleton = ConversionRecord(
            source_path=relative, target=None, render_hash=None, state="needs-review",
            inputs=ConversionInputs(
                source_sha256="", include_sha256="", lilypond_version=lilypond.load_pin().version,
                extractor_version="", converter_version="", profile_id=profile.id, profile_sha256="",
                schema_sha256="", verovio_version=VEROVIO_VERSION, font_digest=font_digest(),
            ),
            artifact_sha256=None, diagnostics=(), validation=None, review=None,
        )
        return current_inputs_from_files(skeleton)

    return inputs


def _default_convert(source: Path, out: Path) -> None:
    from pipeline.typeset.mei.cli import convert_command

    if convert_command(source, out) != 0:
        raise RuntimeError("conversion reported errors")


def _default_evidence(convert_dir: Path, out: Path) -> None:
    from pipeline.typeset.mei.evidence import build_evidence

    build_evidence(convert_dir, None, out)


def _diagnostics(directory: Path) -> list[dict[str, Any]]:
    path = directory / "diagnostics.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return []
    return [d for d in data if isinstance(d, dict)]


def _state(directory: Path) -> tuple[ConversionState, str | None]:
    """The state of a finished conversion, with a reason when there is one. Never ``approved``."""
    diagnostics = _diagnostics(directory)
    codes = {d.get("code") for d in diagnostics}
    if "UNSUPPORTED_FEATURE" in codes:
        return "unsupported", None
    if any(d.get("severity") == "error" and d.get("code") in BLOCKING for d in diagnostics):
        return "failed", None
    if any(d.get("severity") == "error" for d in diagnostics):
        return "failed", None
    if (directory / "ir.json").is_file() and (directory / "provenance.json").is_file():
        from pipeline.typeset.mei.cli import validation_for_directory

        if not validation_for_directory(directory).eligible:
            return "failed", None
    return "needs-review", None


def _read_result(directory: Path) -> dict[str, Any] | None:
    path = directory / RESULT
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None
    return data if isinstance(data, dict) and data.get("state") in STATES else None


def _write_result(
    directory: Path, source: Path, digest: str, state: ConversionState, message: str | None, seconds: float = 0.0
) -> None:
    codes = sorted({str(d.get("code")) for d in _diagnostics(directory)})
    (directory / RESULT).write_text(
        json.dumps(
            {"source": _display(source), "digest": digest, "state": state, "diagnostics": codes, "message": message,
             "seconds": round(seconds, 1)},
            indent=2, sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _build(
    source: Path, digest: str, output: Path, convert_fn: ConvertFn, evidence_fn: EvidenceFn | None
) -> dict[str, Any]:
    """Convert into a temporary directory and rename it into place when finished."""
    tmp = output / f".tmp-{digest}-{uuid.uuid4().hex[:8]}"
    final = output / digest
    message: str | None = None
    started = time.monotonic()
    try:
        try:
            convert_fn(source, tmp)
            state, message = _state(tmp)
        except Exception as error:  # noqa: BLE001  one bad score must not abort the others
            state, message = "failed", f"{type(error).__name__}: {error}"
            tmp.mkdir(parents=True, exist_ok=True)
        if state == "needs-review" and evidence_fn is not None:
            try:
                evidence_fn(tmp, tmp / "evidence")
            except Exception as error:  # noqa: BLE001
                state, message = "failed", f"evidence: {type(error).__name__}: {error}"
        _write_result(tmp, source, digest, state, message, time.monotonic() - started)
        if final.exists() and _read_result(final) is None:
            shutil.rmtree(final, ignore_errors=True)  # a leftover without a result is an interrupted build
        try:
            os.rename(tmp, final)
        except OSError:
            # Someone else finished this digest first; keep theirs untouched.
            existing = _read_result(final)
            if existing is not None:
                return {**existing, "decision": "kept-existing"}
            raise
        return {"source": _display(source), "digest": digest, "state": state, "message": message, "decision": "converted",
                "seconds": round(time.monotonic() - started, 1)}
    finally:
        with contextlib.suppress(OSError):
            shutil.rmtree(tmp, ignore_errors=True)


def run_batch(
    sources: list[Path],
    profile: ConversionProfile,
    output: Path,
    *,
    workers: int = DEFAULT_WORKERS,
    convert_fn: ConvertFn | None = None,
    inputs_fn: InputsFn | None = None,
    evidence_fn: EvidenceFn | None = _default_evidence,
    auto_approve: bool = False,
    record_fn: RecordFn | None = None,
    precheck_fn: PrecheckFn | None = None,
    cases_fn: CasesFn | None = None,
) -> BatchReport:
    """Convert ``sources`` into digest-keyed folders under ``output`` and report every one of them.

    Empty sources and repeated entries are not counted; each remaining source appears once in
    ``results`` and in ``counts``. ``workers`` bounds how many conversions (LilyPond runs) are in
    flight. ``cached`` lists sources whose finished build for the current digest already existed.

    With ``auto_approve`` (D22) each clean ``needs-review`` conversion is judged by ``review.auto_approve``
    (record, precheck and the packet's cases). The judged record is kept in ``<digest>/record.json`` and an
    approved one is also copied into ``<output>/records/``; nothing is ever written into the repository's
    ``data/typeset/mei/records/``. The result state of an approved piece is ``approved``."""
    output.mkdir(parents=True, exist_ok=True)
    convert = convert_fn or _default_convert
    inputs = inputs_fn or _default_inputs(profile)
    requested: list[Path] = []
    seen: set[str] = set()
    for source in sources:
        key = _display(source)
        if key in seen or not source.is_file() or not source.read_text(encoding="utf-8").strip():
            continue
        seen.add(key)
        requested.append(source)

    def one(source: Path) -> dict[str, Any]:
        try:
            digest = inputs(source).digest()
        except Exception as error:  # noqa: BLE001
            return {"source": _display(source), "digest": None, "state": "failed", "message": f"inputs: {error}", "decision": "failed"}
        cached = _read_result(output / digest)
        entry = {**cached, "decision": "cached"} if cached is not None else _build(source, digest, output, convert, evidence_fn)
        if auto_approve and entry["state"] in ("needs-review", "approved"):
            try:
                entry = {**entry, **_judge(source, digest, output, entry, record_fn, precheck_fn, cases_fn, profile.version)}
            except Exception as error:  # noqa: BLE001  a judging error leaves the piece in review
                entry = {**entry, "message": f"auto-approve: {type(error).__name__}: {error}"}
        return entry

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        entries = list(pool.map(one, requested))

    results: dict[str, ConversionState] = {}
    evidence: dict[str, Path] = {}
    cached: list[str] = []
    scores: list[dict[str, Any]] = []
    for entry in entries:
        name = entry["source"]
        state: ConversionState = entry["state"]
        results[name] = state
        digest = entry.get("digest")
        packet = output / str(digest) / "evidence"
        if digest and state in ("needs-review", "approved") and (packet / "index.html").is_file():
            evidence[name] = packet
        if entry.get("decision") == "cached":
            cached.append(name)
        directory = output / str(digest) if digest else None
        scores.append(
            {
                "source": name, "digest": digest, "state": state, "decision": entry.get("decision"),
                "message": entry.get("message"), "seconds": entry.get("seconds"),
                "criteria_failed": entry.get("criteria_failed"), "diagnostics": entry.get("diagnostics")
                or ([d.get("code") for d in _diagnostics(directory)] if directory else []),
                "evidence": str(evidence[name]) if name in evidence else None,
            }
        )
    counts = {state: sum(1 for s in results.values() if s == state) for state in STATES}
    report = BatchReport(
        requested=tuple(_display(s) for s in requested), results=results, counts=counts,
        cached=tuple(cached), evidence=evidence,
    )
    _write_report(output, report, scores)
    return report


def _flat(name: str) -> str:
    """A flat file stem: ``vol-5/missa-ix/kyrie_IX.ly`` -> ``vol-5__missa-ix__kyrie_IX``; a path outside the repo -> its name."""
    if name.startswith("/"):
        name = Path(name).name
    return re.sub(r"[^A-Za-z0-9._-]+", "__", name.removesuffix(".ly").removeprefix("data/typeset/src/"))


def _judge(
    source: Path, digest: str, output: Path, entry: dict[str, Any], record_fn: RecordFn | None,
    precheck_fn: PrecheckFn | None, cases_fn: CasesFn | None, profile_version: int,
) -> dict[str, Any]:
    """Auto-approve (D22) the finished build ``output/<digest>``; reuse an earlier judgement of it."""
    from pipeline.typeset.mei.manifest import record_from_dict, record_to_dict
    from pipeline.typeset.mei.review import auto_approve

    directory = output / digest
    saved = directory / "record.json"
    if saved.is_file():
        record = record_from_dict(json.loads(saved.read_text(encoding="utf-8")))
    else:
        if record_fn is None:
            from pipeline.typeset.mei.cli import record_for_directory

            def record_fn(d: Path, _s: Path) -> Any:
                return record_for_directory(d)[0]
        if precheck_fn is None:
            from pipeline.typeset.mei.precheck import precheck_packet

            def precheck_fn(d: Path, _s: Path) -> dict[str, list[str]]:
                return precheck_packet(d)
        cases = (cases_fn or _default_cases)(directory)
        record = auto_approve(
            record_fn(directory, source), precheck_fn(directory, source), cases, profile_version=profile_version
        )
        _atomic_write(saved, json.dumps(record_to_dict(record), indent=2, sort_keys=True) + "\n")
    if record.state == "approved":
        records = output / "records"
        records.mkdir(exist_ok=True)
        target = records / f"{_flat(_display(source))}.json"
        if target.exists() and json.loads(target.read_text(encoding="utf-8")).get("artifact_sha256") != record.artifact_sha256:
            target = records / f"{_flat(_display(source))}-{digest[:8]}.json"
        if not target.exists():
            _atomic_write(target, json.dumps(record_to_dict(record), indent=2, sort_keys=True) + "\n")
    failed = list(record.auto_review.criteria_failed) if record.auto_review else []
    return {"state": record.state, "criteria_failed": failed}


def _default_cases(directory: Path) -> dict[str, Any]:
    path = directory / "evidence" / "cases" / "cases.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"cases": []}


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _write_report(output: Path, report: BatchReport, scores: list[dict[str, Any]]) -> Path:
    """Write reports/report-<list hash>-<n>.json, creating it exclusively so no run overwrites another's."""
    folder = output / "reports"
    folder.mkdir(exist_ok=True)
    list_hash = hashlib.sha256("\n".join(sorted(report.requested)).encode()).hexdigest()[:12]
    body = json.dumps(
        {"requested": list(report.requested), "counts": report.counts, "cached": list(report.cached), "scores": scores},
        indent=2, sort_keys=True,
    ) + "\n"
    n = 1
    while True:
        path = folder / f"report-{list_hash}-{n}.json"
        try:
            with path.open("x", encoding="utf-8") as handle:
                handle.write(body)
            return path
        except FileExistsError:
            n += 1
