"""Approved-conversion manifest builder (card A6).

``build_manifest`` is the only way a conversion reaches the web: a record is included only when it
is approved, the approval is still current, its ``target`` and ``render_hash`` match an entry of
``data/typeset/manifest.json`` exactly (conversion never establishes a match), and its artifact is
intact. Nothing here reads or writes proofreading data.

Artifact layout (``artifact_dir``): one folder per MEI sha256, ``<artifact_dir>/<sha256>/`` with
``score.mei`` and ``boundaries.json`` (both written by ``typeset-mei-convert``). The published
object key is ``mei/<sha256>/score.mei``.

Manifest JSON: ``meiUrl`` is ``"/mei/<digest>/score.mei"``, relative to ``PUBLIC_ASSET_BASE``; the web
prefixes the asset base.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from collections.abc import Callable, Mapping, Sequence
from fractions import Fraction
from pathlib import Path
from typing import Any

from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.model import (
    BoundaryManifestEntry,
    ConversionInputs,
    ConversionManifest,
    ConversionRecord,
    ManifestPart,
    ReviewDecision,
    SemanticDifference,
    ValidationReport,
    rational_from_str,
    rational_to_str,
)
from pipeline.typeset.mei.review import approval_is_current

SCORE_NAME = "score.mei"
BOUNDARIES_NAME = "boundaries.json"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_RENDER_HASH = re.compile(r"^[0-9a-f]{32}$")
_DIVISIONS = ("finalis", "maxima", "maior", "minima")


def _diag(code: str, message: str) -> Diagnostic:
    return Diagnostic(code, "error", message)  # type: ignore[arg-type]


def _safe_name(name: str) -> bool:
    path = Path(name)
    return bool(name) and not path.is_absolute() and ".." not in path.parts and "\\" not in name


# --- artifact verification --------------------------------------------------------------------


def verify_artifact(record: ConversionRecord, directory: Path, name: str = SCORE_NAME) -> list[Diagnostic]:
    """Diagnostics (empty when intact): ``name`` exists in ``directory`` and hashes to the record's sha256."""
    digest = record.artifact_sha256
    if digest is None or not _SHA256.match(digest):
        return [_diag("HASH_MISMATCH", "record has no valid artifact sha256")]
    if not _safe_name(name):
        return [_diag("UNSAFE_PATH", f"unsafe artifact name {name!r}")]
    path = directory / name
    if not path.is_file():
        return [_diag("ASSET_MISSING", f"{path.name} is missing")]
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != digest:
        return [_diag("HASH_MISMATCH", f"{name} sha256 {actual} != record {digest}")]
    return []


def _read_boundaries(directory: Path, mei: bytes) -> tuple[tuple[BoundaryManifestEntry, ...], list[Diagnostic]]:
    path = directory / BOUNDARIES_NAME
    if not path.is_file():
        return (), [_diag("ASSET_MISSING", f"{BOUNDARIES_NAME} is missing")]
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        entries = tuple(
            BoundaryManifestEntry(
                boundary_id=str(b["id"]), onset=str(b["onset"]), measure_id=str(b["measureId"]), safe=True,
                source_break=bool(b["sourceBreak"]), division=b["division"], after_text=b["afterText"],
            )
            for b in raw
        )
    except (ValueError, KeyError, TypeError) as error:
        return (), [_diag("HASH_MISMATCH", f"{BOUNDARIES_NAME} is malformed: {error}")]
    measures = set(re.findall(rb'<measure\b[^>]*?\sxml:id="([^"]+)"', mei))
    unknown = sorted(e.measure_id for e in entries if e.measure_id.encode() not in measures)
    if unknown:
        return (), [_diag("HASH_MISMATCH", f"{BOUNDARIES_NAME} names measures not in the MEI: {unknown[:3]}")]
    return entries, []


# --- the builder ---------------------------------------------------------------------------------


def load_matched_parts(path: Path) -> list[dict[str, str]]:
    """The ``parts`` of data/typeset/manifest.json: ``{"target", "file", "hash"}``."""
    return list(json.loads(path.read_text(encoding="utf-8"))["parts"])


def build_manifest_report(
    records: Sequence[ConversionRecord],
    matched_parts: Sequence[Mapping[str, str]],
    artifact_dir: Path,
    current_inputs: Callable[[ConversionRecord], ConversionInputs],
) -> tuple[ConversionManifest, dict[str, str]]:
    """(manifest, {source_path: reason}) where the second maps every excluded record to why."""
    hashes: dict[str, set[str]] = {}
    for part in matched_parts:
        hashes.setdefault(part["target"], set()).add(part["hash"])
    excluded: dict[str, str] = {}
    built: list[ManifestPart] = []
    for record in records:
        key = record.source_path
        if record.state != "approved":
            excluded[key] = f"state is {record.state}"
            continue
        if not approval_is_current(record, current_inputs(record)):
            excluded[key] = "STALE_APPROVAL"
            continue
        if record.target is None or record.target not in hashes:
            excluded[key] = "UNMATCHED_TARGET"
            continue
        if record.render_hash is None or not _RENDER_HASH.match(record.render_hash) or record.render_hash not in hashes[record.target]:
            excluded[key] = "TARGET_HASH_MISMATCH"
            continue
        digest = record.artifact_sha256 or ""
        folder = artifact_dir / digest if _SHA256.match(digest) else artifact_dir
        problems = verify_artifact(record, folder)
        if not problems:
            entries, problems = _read_boundaries(folder, (folder / SCORE_NAME).read_bytes())
        if problems:
            excluded[key] = problems[0].code
            continue
        built.append(
            ManifestPart(
                target=record.target, render_hash=record.render_hash, digest=digest,
                mei_path=f"mei/{digest}/{SCORE_NAME}", mei_sha256=digest, source_revision=record.render_hash,
                profile=record.inputs.profile_id, verovio=record.inputs.verovio_version, boundaries=entries,
                capabilities={"manualBreaks": bool(entries)},
            )
        )
    keys = [(p.target, p.render_hash) for p in built]
    clashes = {k for k in keys if keys.count(k) > 1}
    if clashes:
        for part in built:
            if (part.target, part.render_hash) in clashes:
                excluded[f"{part.target}@{part.render_hash}"] = "KEY_COLLISION"
        built = [p for p in built if (p.target, p.render_hash) not in clashes]
    built.sort(key=lambda p: (p.target, p.render_hash))
    return ConversionManifest(schema_version=1, parts=tuple(built)), excluded


def build_manifest(
    records: Sequence[ConversionRecord],
    matched_parts: Sequence[Mapping[str, str]],
    artifact_dir: Path,
    current_inputs: Callable[[ConversionRecord], ConversionInputs],
) -> ConversionManifest:
    return build_manifest_report(records, matched_parts, artifact_dir, current_inputs)[0]


def manifest_to_dict(manifest: ConversionManifest) -> dict[str, Any]:
    """The TS ``ConversionManifest`` shape (camelCase)."""
    return {
        "schemaVersion": manifest.schema_version,
        "parts": [
            {
                "target": p.target,
                "renderHash": p.render_hash,
                "digest": p.digest,
                "meiUrl": "/" + p.mei_path,
                "meiSha256": p.mei_sha256,
                "sourceRevision": p.source_revision,
                "profile": p.profile,
                "verovio": p.verovio,
                "boundaries": [
                    {
                        "id": b.boundary_id, "onset": b.onset, "sourceBreak": b.source_break,
                        "division": b.division, "measureId": b.measure_id, "afterText": b.after_text,
                    }
                    for b in p.boundaries
                ],
                "capabilities": {"manualBreaks": bool(p.capabilities.get("manualBreaks", False))},
            }
            for p in manifest.parts
        ],
    }


def write_manifest(manifest: ConversionManifest, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest_to_dict(manifest), indent=2, sort_keys=True) + "\n", encoding="utf-8")


# --- current inputs from files ---------------------------------------------------------------------


def current_inputs_from_files(record: ConversionRecord) -> ConversionInputs:
    """Recompute the file-derived inputs now; tool versions and the font digest cannot be derived
    here and are taken from the record. ``source_sha256`` is the sha256 of the source file's bytes;
    ``include_sha256`` hashes every data/typeset/include/*.ily as ``name NUL text NUL`` in name order."""
    from pipeline.typeset import lilypond
    from pipeline.typeset.mei.cli import PROFILE_PATH
    from pipeline.typeset.mei.schema import load_schema_bundle
    from pipeline.typeset.mei.versions import converter_version, extractor_version

    source = lilypond.ROOT / record.source_path
    include = hashlib.sha256()
    for path in sorted(lilypond.INCLUDE.glob("*.ily")):
        include.update(f"{path.name}\0{path.read_text(encoding='utf-8')}\0".encode())
    return dataclasses.replace(
        record.inputs,
        source_sha256=hashlib.sha256(source.read_bytes()).hexdigest() if source.is_file() else "missing",
        include_sha256=include.hexdigest(),
        lilypond_version=lilypond.load_pin().version,
        extractor_version=extractor_version(),
        converter_version=converter_version(),
        profile_sha256=hashlib.sha256(PROFILE_PATH.read_bytes()).hexdigest(),
        schema_sha256=load_schema_bundle().sha256,
    )


# --- ConversionRecord <-> JSON ------------------------------------------------------------------------


def _loc_to(loc: SourceLocation | None) -> dict[str, Any] | None:
    return None if loc is None else {"filename": loc.filename, "line": loc.line, "column": loc.column}


def _loc_from(d: dict[str, Any] | None) -> SourceLocation | None:
    return None if d is None else SourceLocation(d["filename"], d["line"], d["column"])


def _diag_to(d: Diagnostic) -> dict[str, Any]:
    return {
        "code": d.code, "severity": d.severity, "message": d.message, "source_location": _loc_to(d.source_location),
        "event_ids": list(d.event_ids), "details": [[k, v] for k, v in d.details],
    }


def _diag_from(d: dict[str, Any]) -> Diagnostic:
    return Diagnostic(
        d["code"], d["severity"], d["message"], _loc_from(d["source_location"]), tuple(d["event_ids"]),
        tuple((k, v) for k, v in d["details"]),
    )


def record_to_dict(record: ConversionRecord) -> dict[str, Any]:
    validation = record.validation
    review = record.review
    return {
        "source_path": record.source_path, "target": record.target, "render_hash": record.render_hash,
        "state": record.state, "inputs": dataclasses.asdict(record.inputs),
        "artifact_sha256": record.artifact_sha256,
        "diagnostics": [_diag_to(d) for d in record.diagnostics],
        "validation": None if validation is None else {
            "schema_ok": validation.schema_ok,
            "schema_diagnostics": [_diag_to(d) for d in validation.schema_diagnostics],
            "semantic_differences": [
                {
                    "code": s.code, "layer_key": s.layer_key,
                    "onset": None if s.onset is None else rational_to_str(s.onset),
                    "source_event_ids": list(s.source_event_ids), "detail": s.detail,
                }
                for s in validation.semantic_differences
            ],
            "eligible": validation.eligible, "hashes": dict(validation.hashes),
            "tool_versions": dict(validation.tool_versions),
        },
        "review": None if review is None else {
            "reviewer": review.reviewer, "timestamp": review.timestamp, "inputs_digest": review.inputs_digest,
            "artifact_sha256": review.artifact_sha256, "matrix_results": dict(review.matrix_results),
            "accepted_differences": list(review.accepted_differences), "decision": review.decision,
        },
    }


def record_from_dict(d: dict[str, Any]) -> ConversionRecord:
    v = d["validation"]
    r = d["review"]
    return ConversionRecord(
        source_path=d["source_path"], target=d["target"], render_hash=d["render_hash"], state=d["state"],
        inputs=ConversionInputs(**d["inputs"]), artifact_sha256=d["artifact_sha256"],
        diagnostics=tuple(_diag_from(x) for x in d["diagnostics"]),
        validation=None if v is None else ValidationReport(
            schema_ok=v["schema_ok"],
            schema_diagnostics=tuple(_diag_from(x) for x in v["schema_diagnostics"]),
            semantic_differences=tuple(
                SemanticDifference(
                    s["code"], s["layer_key"], None if s["onset"] is None else _fraction(s["onset"]),
                    tuple(s["source_event_ids"]), s["detail"],
                )
                for s in v["semantic_differences"]
            ),
            eligible=v["eligible"], hashes=dict(v["hashes"]), tool_versions=dict(v["tool_versions"]),
        ),
        review=None if r is None else ReviewDecision(
            r["reviewer"], r["timestamp"], r["inputs_digest"], r["artifact_sha256"], dict(r["matrix_results"]),
            tuple(r["accepted_differences"]), r["decision"],
        ),
    )


def _fraction(text: str) -> Fraction:
    return rational_from_str(text)
