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
import shutil
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

ConvertFn = Callable[[Path, Path], None]
InputsFn = Callable[[Path], ConversionInputs]
EvidenceFn = Callable[[Path, Path], None]


def _display(source: Path) -> str:
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


def _state(directory: Path) -> ConversionState:
    """The state of a finished conversion: never ``approved``."""
    diagnostics = _diagnostics(directory)
    codes = {d.get("code") for d in diagnostics}
    if "UNSUPPORTED_FEATURE" in codes:
        return "unsupported"
    if any(d.get("severity") == "error" and d.get("code") in BLOCKING for d in diagnostics):
        return "failed"
    if any(d.get("severity") == "error" for d in diagnostics):
        return "failed"
    if (directory / "ir.json").is_file() and (directory / "provenance.json").is_file():
        from pipeline.typeset.mei.cli import validation_for_directory

        if not validation_for_directory(directory).eligible:
            return "failed"
    return "needs-review"


def _read_result(directory: Path) -> dict[str, Any] | None:
    path = directory / RESULT
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None
    return data if isinstance(data, dict) and data.get("state") in STATES else None


def _write_result(directory: Path, source: Path, digest: str, state: ConversionState, message: str | None) -> None:
    codes = sorted({str(d.get("code")) for d in _diagnostics(directory)})
    (directory / RESULT).write_text(
        json.dumps(
            {"source": _display(source), "digest": digest, "state": state, "diagnostics": codes, "message": message},
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
    try:
        try:
            convert_fn(source, tmp)
            state = _state(tmp)
        except Exception as error:  # noqa: BLE001  one bad score must not abort the others
            state, message = "failed", f"{type(error).__name__}: {error}"
            tmp.mkdir(parents=True, exist_ok=True)
        if state == "needs-review" and evidence_fn is not None:
            try:
                evidence_fn(tmp, tmp / "evidence")
            except Exception as error:  # noqa: BLE001
                state, message = "failed", f"evidence: {type(error).__name__}: {error}"
        _write_result(tmp, source, digest, state, message)
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
        return {"source": _display(source), "digest": digest, "state": state, "message": message, "decision": "converted"}
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
) -> BatchReport:
    """Convert ``sources`` into digest-keyed folders under ``output`` and report every one of them.

    Empty sources and repeated entries are not counted; each remaining source appears once in
    ``results`` and in ``counts``. ``workers`` bounds how many conversions (LilyPond runs) are in
    flight. ``cached`` lists sources whose finished build for the current digest already existed."""
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
        if cached is not None:
            return {**cached, "decision": "cached"}
        return _build(source, digest, output, convert, evidence_fn)

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
        if digest and state == "needs-review" and (packet / "index.html").is_file():
            evidence[name] = packet
        if entry.get("decision") == "cached":
            cached.append(name)
        directory = output / str(digest) if digest else None
        scores.append(
            {
                "source": name, "digest": digest, "state": state, "decision": entry.get("decision"),
                "message": entry.get("message"), "diagnostics": entry.get("diagnostics")
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
