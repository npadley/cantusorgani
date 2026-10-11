"""`noh typeset-mei-audit` (catalogue audit, no LilyPond) and `noh typeset-mei-extract` (one source), `noh typeset-mei-convert`."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import tempfile
from collections import Counter
from fractions import Fraction
from pathlib import Path
from typing import Any

from pipeline.typeset.lilypond import INCLUDE
from pipeline.typeset.match import PARTS_FILE, SRC, load
from pipeline.typeset.mei.audit import audit_sources
from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.encode import encode_score
from pipeline.typeset.mei.extract import BUILD_ROOT, PinnedLilyPondRunner, extract_score
from pipeline.typeset.mei.model import (
    ConversionInputs,
    ConversionProfile,
    ConversionRecord,
    EncodedScore,
    LilyPondRunnerAdapter,
    ReviewDecision,
    ScoreIR,
    ValidationReport,
)
from pipeline.typeset.mei.schema import load_schema_bundle, validate_schema
from pipeline.typeset.mei.validate import validate_conversion


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, Fraction):
        return str(value)
    raise TypeError(f"not JSON serialisable: {type(value).__name__}")


def audit_command(out: Path) -> int:
    report = audit_sources(SRC, load(PARTS_FILE), INCLUDE)
    text = json.dumps(dataclasses.asdict(report), indent=2, sort_keys=True, default=_json_default)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8")
    classes = Counter(source.classification for source in report.sources)
    summary = ", ".join(f"{n} {name}" for name, n in sorted(classes.items()))
    print(f"audited {len(report.sources)} sources ({summary}); "
          f"{len(report.absent_targets)} absent targets; wrote {out}")
    return 0


def extract_command(
    source: Path,
    out: Path,
    runner: LilyPondRunnerAdapter | None = None,
    build_root: Path = BUILD_ROOT,
) -> int:
    """Extract one source: raw TSV under build_root/<digest>/events.tsv, IR as OUT/ir.json."""
    result = extract_score(source, runner=runner or PinnedLilyPondRunner(), build_root=build_root)
    for diagnostic in result.diagnostics:
        print(f"{diagnostic.severity}: {diagnostic.code}: {diagnostic.message}")
    if result.ir is None:
        return 1
    out.mkdir(parents=True, exist_ok=True)
    (out / "ir.json").write_text(
        json.dumps(result.ir.to_dict(), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"extracted {source.name}: {len(result.ir.events)} events; wrote {out / 'ir.json'}")
    return 1 if any(d.severity == "error" for d in result.diagnostics) else 0


# --- typeset-mei-convert ---------------------------------------------------------------

PROFILE_PATH = Path(__file__).resolve().parents[3] / "data" / "typeset" / "mei" / "profiles" / "accompaniment-v1.json"


def _diagnostic_dict(diagnostic: Diagnostic) -> dict[str, Any]:
    location = diagnostic.source_location
    return {
        "code": diagnostic.code,
        "severity": diagnostic.severity,
        "message": diagnostic.message,
        "sourceLocation": None
        if location is None
        else {"filename": location.filename, "line": location.line, "column": location.column},
        "eventIds": list(diagnostic.event_ids),
        "details": [[k, v] for k, v in diagnostic.details],
    }


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def convert_command(
    source: Path,
    out: Path,
    runner: LilyPondRunnerAdapter | None = None,
    build_root: Path = BUILD_ROOT,
    profile_path: Path = PROFILE_PATH,
) -> int:
    """Extract, encode and schema-validate one source. Writes score.mei, boundaries.json,
    diagnostics.json, provenance.json and ir.json to OUT. No approval, review or publish side effects."""
    profile = ConversionProfile.load(profile_path)
    result = extract_score(source, runner=runner or PinnedLilyPondRunner(), build_root=build_root)
    diagnostics: list[Diagnostic] = list(result.diagnostics)
    out.mkdir(parents=True, exist_ok=True)
    if result.ir is None:
        _write_json(out / "diagnostics.json", [_diagnostic_dict(d) for d in diagnostics])
        for d in diagnostics:
            print(f"{d.severity}: {d.code}: {d.message}")
        return 1
    ir = result.ir
    encoded = encode_score(ir, profile)
    diagnostics.extend(encoded.diagnostics)
    diagnostics.extend(validate_schema(encoded.xml, load_schema_bundle()))
    (out / "score.mei").write_bytes(encoded.xml)
    _write_json(
        out / "boundaries.json",
        [
            {
                "id": b.boundary_id,
                "onset": b.onset,
                "sourceBreak": b.source_break,
                "division": b.division,
                "measureId": b.measure_id,
                "afterText": b.after_text,
            }
            for b in encoded.boundaries
        ],
    )
    _write_json(out / "diagnostics.json", [_diagnostic_dict(d) for d in diagnostics])
    _write_json(out / "ir.json", ir.to_dict())
    _write_json(out / "provenance.json", encoded.provenance)
    errors = [d for d in diagnostics if d.severity == "error"]
    for d in diagnostics:
        print(f"{d.severity}: {d.code}: {d.message}")
    print(
        f"converted {source.name}: {len(ir.events)} events, {len(encoded.boundaries)} safe boundaries, "
        f"sha256 {encoded.artifact_sha256}; wrote {out}"
    )
    return 1 if errors else 0


# --- typeset-mei-manifest --------------------------------------------------------------


def manifest_command(
    records_dir: Path, out: Path, artifacts: Path | None = None, matched: Path | None = None
) -> int:
    """Build the approved-conversion manifest from ConversionRecord JSON files in RECORDS_DIR."""
    from pipeline.typeset.mei.manifest import (
        build_manifest_report,
        current_inputs_from_files,
        load_matched_parts,
        record_from_dict,
        write_manifest,
    )

    records = [
        record_from_dict(json.loads(path.read_text(encoding="utf-8"))) for path in sorted(records_dir.glob("*.json"))
    ]
    parts = load_matched_parts(matched or Path(__file__).resolve().parents[3] / "data" / "typeset" / "manifest.json")
    manifest, excluded = build_manifest_report(records, parts, artifacts or records_dir, current_inputs_from_files)
    write_manifest(manifest, out)
    for key, reason in sorted(excluded.items()):
        print(f"excluded {key}: {reason}")
    print(f"wrote {len(manifest.parts)} approved conversion(s) to {out}")
    return 0


class _MemoryStore:
    """Dry-run store: nothing leaves the machine; remembers what it was asked to write."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def exists(self, key: str) -> bool:
        return key in self.objects

    def put_if_absent(self, key: str, data: bytes, content_type: str) -> bool:
        if key in self.objects:
            return False
        self.objects[key] = data
        return True

    def content_sha256(self, key: str) -> str:
        import hashlib

        return hashlib.sha256(self.objects[key]).hexdigest()


def publish_command(
    artifacts: Path,
    records_dir: Path,
    dry_run: bool = False,
    store: Any = None,
    current_inputs: Any = None,
) -> int:
    """Verify every ConversionRecord JSON in RECORDS_DIR against ARTIFACTS, then upload write-once.

    Reads bytes only; never runs a compiler. Every record in RECORDS_DIR must be publishable, so the
    directory holds approved records only. Exit 1 on PublishBlocked (codes printed)."""
    from pipeline.typeset.mei.manifest import current_inputs_from_files, record_from_dict
    from pipeline.typeset.mei.publish import (
        PublishBlocked,
        R2AssetStore,
        publish_verified,
        verify_publish_bundle,
    )

    records = [
        record_from_dict(json.loads(path.read_text(encoding="utf-8"))) for path in sorted(records_dir.glob("*.json"))
    ]
    try:
        bundle = verify_publish_bundle(artifacts, records, current_inputs or current_inputs_from_files)
        if dry_run:
            memory = _MemoryStore()
            report = publish_verified(bundle, memory)
            for key in sorted(report.uploaded):
                print(f"would upload {key}")
            return 0
        report = publish_verified(bundle, store or R2AssetStore.from_environment())
    except PublishBlocked as blocked:
        print(f"publish blocked: {', '.join(blocked.codes)}: {blocked}")
        return 1
    for key in report.uploaded:
        print(f"uploaded {key}")
    for key in report.skipped_existing:
        print(f"skipped existing {key}")
    return 0

# --- typeset-mei-validate --------------------------------------------------------------


def _diagnostic_from_dict(raw: dict[str, Any]) -> Diagnostic:
    loc = raw.get("sourceLocation")
    return Diagnostic(
        code=raw["code"],
        severity=raw["severity"],
        message=raw["message"],
        source_location=None if loc is None else SourceLocation(loc["filename"], loc["line"], loc["column"]),
        event_ids=tuple(raw.get("eventIds", [])),
        details=tuple((k, v) for k, v in raw.get("details", [])),
    )


def validation_for_directory(directory: Path) -> ValidationReport:
    """Validate a converter output directory (ir.json, score.mei, provenance.json, diagnostics.json).
    Shared by typeset-mei-validate and the evidence packet so they never disagree."""
    ir = ScoreIR.from_dict(json.loads((directory / "ir.json").read_text(encoding="utf-8")))
    xml = (directory / "score.mei").read_bytes()
    provenance = json.loads((directory / "provenance.json").read_text(encoding="utf-8"))
    diagnostics_path = directory / "diagnostics.json"
    recorded = (
        [_diagnostic_from_dict(d) for d in json.loads(diagnostics_path.read_text(encoding="utf-8"))]
        if diagnostics_path.exists()
        else []
    )
    encoded = EncodedScore(
        xml=xml,
        artifact_sha256=hashlib.sha256(xml).hexdigest(),
        boundaries=(),
        feature_decisions=(),
        provenance=provenance,
        diagnostics=tuple(recorded),
    )
    return validate_conversion(ir, encoded, load_schema_bundle())


def validate_command(directory: Path) -> int:
    """Validate a converter output directory. Writes validation.json; exit 1 when not eligible."""
    report = validation_for_directory(directory)
    _write_json(
        directory / "validation.json",
        json.loads(json.dumps(dataclasses.asdict(report), default=_json_default)),
    )
    for difference in report.semantic_differences:
        print(f"{difference.code}: {difference.detail}")
    for d in report.schema_diagnostics:
        print(f"{d.code}: {d.message}")
    print(
        f"{'eligible' if report.eligible else 'NOT eligible'}: {len(report.semantic_differences)} "
        f"semantic differences; wrote {directory / 'validation.json'}"
    )
    return 0 if report.eligible else 1

# --- typeset-mei-evidence ------------------------------------------------------------------


def evidence_command(
    convert_dir: Path,
    out: Path | None = None,
    node_runner: Any = None,
    lilypond_svg: Any = None,
    scan_images: Any = None,
) -> int:
    """Build the review evidence packet for a ``typeset-mei-convert`` output directory and print the
    path of its ``index.html``. The packet is written to OUT, default
    ``build/typeset/mei/<inputs digest>/evidence``."""
    from pipeline.typeset.mei import evidence

    try:
        packet = evidence.build_evidence(
            convert_dir,
            None,
            out,
            node_runner=node_runner or evidence.run_node_renderer,
            lilypond_svg=lilypond_svg or evidence.default_lilypond_svg,
            scan_images=scan_images or evidence.default_scan_images,
        )
    except evidence.EvidenceError as error:
        print(f"error: {error}")
        return 1
    counts = Counter(f.code for f in packet.geometry_findings)
    flags = ", ".join(f"{n} {code}" for code, n in sorted(counts.items())) or "none"
    print(f"geometry flags (flags only): {flags}")
    print(packet.index_html)
    return 0


# --- typeset-mei-review ----------------------------------------------------------------------

VEROVIO_VERSION = "6.3.0-425dd7b"
FONTS_DIR = Path(__file__).resolve().parents[3] / "web" / "public" / "fonts" / "export"


def font_digest(fonts: Path = FONTS_DIR) -> str:
    """sha256 over the bundled export fonts (``name NUL bytes NUL`` in name order)."""
    digest = hashlib.sha256()
    for path in sorted(fonts.glob("*.ttf")):
        digest.update(path.name.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def record_for_directory(
    convert_dir: Path, inputs_fn: Any = None, fonts: Path = FONTS_DIR
) -> tuple[ConversionRecord, ConversionInputs]:
    """The unreviewed ConversionRecord for a convert directory and its current inputs.

    Inputs come from ``manifest.current_inputs_from_files`` (the single definition) plus the tool
    versions; target and render_hash are looked up in data/typeset/manifest.json, never inferred."""
    from pipeline.typeset.mei.evidence import _manifest_entry
    from pipeline.typeset.mei.manifest import current_inputs_from_files
    from pipeline.typeset.mei.review import state_for
    from pipeline.typeset.mei.versions import converter_version, extractor_version

    ir = json.loads((convert_dir / "ir.json").read_text(encoding="utf-8"))
    xml = (convert_dir / "score.mei").read_bytes()
    entry = _manifest_entry(str(ir["sourcePath"]))
    profile = ConversionProfile.load(PROFILE_PATH)
    skeleton = ConversionInputs(
        source_sha256="", include_sha256="", lilypond_version=str(ir["lilypondVersion"]),
        extractor_version=extractor_version(), converter_version=converter_version(), profile_id=profile.id,
        profile_sha256="", schema_sha256="", verovio_version=VEROVIO_VERSION, font_digest=font_digest(fonts),
    )
    base = ConversionRecord(
        source_path=str(ir["sourcePath"]), target=entry["target"] if entry else None,
        render_hash=entry["hash"] if entry else None, state="needs-review", inputs=skeleton,
        artifact_sha256=hashlib.sha256(xml).hexdigest(),
        diagnostics=tuple(_diagnostic_from_dict(d) for d in json.loads((convert_dir / "diagnostics.json").read_text(encoding="utf-8"))),
        validation=validation_for_directory(convert_dir), review=None,
    )
    current = (inputs_fn or current_inputs_from_files)(base)
    record = dataclasses.replace(base, inputs=current)
    return dataclasses.replace(record, state=state_for(record)), current


def _decision_from_dict(raw: dict[str, Any]) -> ReviewDecision:
    return ReviewDecision(
        reviewer=raw["reviewer"], timestamp=raw["timestamp"], inputs_digest=raw["inputs_digest"],
        artifact_sha256=raw["artifact_sha256"], matrix_results=dict(raw["matrix_results"]),
        accepted_differences=tuple(raw.get("accepted_differences", [])), decision=raw["decision"],
    )


def review_command(convert_dir: Path, decision_path: Path, out: Path, inputs_fn: Any = None) -> int:
    """Apply a reviewer's decision to the convert directory's record and write the record JSON.
    Exit 1 (printing the codes) when the review is blocked."""
    from pipeline.typeset.mei.manifest import record_to_dict
    from pipeline.typeset.mei.review import ReviewBlocked, apply_review

    record, current = record_for_directory(convert_dir, inputs_fn)
    decision = _decision_from_dict(json.loads(decision_path.read_text(encoding="utf-8")))
    try:
        reviewed = apply_review(record, decision, current)
    except ReviewBlocked as blocked:
        print(f"review blocked: {', '.join(blocked.codes)}")
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    _write_json(out, record_to_dict(reviewed))
    print(f"{reviewed.state}: inputs {current.digest()} artifact {reviewed.artifact_sha256}; wrote {out}")
    return 0


# --- typeset-mei-carry -----------------------------------------------------------------------


def carry_command(
    convert_dir: Path,
    prior_record: Path,
    out: Path,
    prior_dir: Path | None = None,
    node_runner: Any = None,
    inputs_fn: Any = None,
    now: str | None = None,
) -> int:
    """Try to carry the approval in PRIOR_RECORD forward onto the re-conversion in CONVERT_DIR (D20).

    ``prior_dir`` is a convert directory holding the artifact that approval was made on (its
    ``score.mei`` must hash to the prior record's ``artifact_sha256``); it may be omitted when
    CONVERT_DIR itself is byte-identical to that artifact. Both are laid out for the 13 required
    cases and compared. Writes the new record to OUT: approved with a ``carried_from`` block when
    the evidence is identical, otherwise the plain ``needs-review`` record, with the differing cases
    named on stdout and in OUT's sibling ``<name>.carry.json``. Exit 1 only when the comparison
    cannot be made; a record left in needs-review is still exit 0. Never publishes or commits."""
    from pipeline.typeset.mei import carry, evidence
    from pipeline.typeset.mei.manifest import record_from_dict, record_to_dict
    from pipeline.typeset.mei.review import carry_forward

    prior = record_from_dict(json.loads(prior_record.read_text(encoding="utf-8")))
    if prior.state != "approved" or prior.artifact_sha256 is None:
        print(f"error: {prior_record} is not an approved record")
        return 1
    if prior_dir is None:
        if carry.sha256_of(convert_dir / "score.mei") != prior.artifact_sha256:
            print("error: the conversion differs from the approved artifact; pass --prior-dir, a convert directory "
                  f"of artifact {prior.artifact_sha256}")
            return 1
        prior_dir = convert_dir
    elif not (prior_dir / "score.mei").is_file() or carry.sha256_of(prior_dir / "score.mei") != prior.artifact_sha256:
        print(f"error: {prior_dir / 'score.mei'} is not the approved artifact {prior.artifact_sha256}")
        return 1
    new, _current = record_for_directory(convert_dir, inputs_fn)
    runner = node_runner or evidence.run_node_renderer
    try:
        with tempfile.TemporaryDirectory(prefix="mei-carry-") as work:
            comparison = carry.compare_conversions(prior_dir, convert_dir, runner, Path(work))
    except evidence.EvidenceError as error:
        print(f"error: {error}")
        return 1
    result = carry_forward(prior, new, comparison, now)
    out.parent.mkdir(parents=True, exist_ok=True)
    _write_json(out, record_to_dict(result))
    carried = result.carried_from is not None
    _write_json(
        out.with_name(out.stem + ".carry.json"),
        {
            "sourcePath": new.source_path, "carried": carried, "state": result.state,
            "semanticEqual": comparison.semantic_equal, "casesDiffering": list(comparison.cases_differing),
            "changedInputs": [] if result.carried_from is None else list(result.carried_from.reason),
            "priorArtifact": prior.artifact_sha256, "newArtifact": new.artifact_sha256,
        },
    )
    if carried:
        print(f"carried {new.source_path}: approval of {prior.artifact_sha256} now covers inputs "
              f"{result.inputs.digest()} (artifact {result.artifact_sha256}); wrote {out}")
    else:
        why = []
        if not comparison.semantic_equal:
            why.append("normalized semantics differ")
        if comparison.cases_differing:
            why.append(f"renders differ in {', '.join(comparison.cases_differing)}")
        if not why:
            why.append(f"record is {new.state} or its target, source or profile changed")
        print(f"needs-review {new.source_path}: {'; '.join(why)}; wrote {out}")
    return 0


# --- typeset-mei-stale -----------------------------------------------------------------------


def stale_command(
    records_dir: Path,
    as_json: bool = False,
    fail_on_stale: bool = False,
    out: Path | None = None,
    current_inputs: Any = None,
    matched: Path | None = None,
) -> int:
    """List approved ConversionRecords in RECORDS_DIR whose current inputs no longer match the signed
    ones (per-field reasons, plus a moved render hash). Read-only; exit 0 unless ``fail_on_stale``
    and something is stale. ``out`` also writes the JSON report to a file."""
    from pipeline.typeset.mei.manifest import (
        current_inputs_from_files,
        load_matched_parts,
        record_from_dict,
    )
    from pipeline.typeset.mei.stale import report_dict, report_table, stale_entries

    files = sorted(records_dir.glob("*.json"))
    records = [record_from_dict(json.loads(path.read_text(encoding="utf-8"))) for path in files]
    parts = load_matched_parts(matched or Path(__file__).resolve().parents[3] / "data" / "typeset" / "manifest.json")
    entries = stale_entries(records, current_inputs or current_inputs_from_files, parts)
    checked = sum(1 for record in records if record.state == "approved")
    report = report_dict(entries, checked, {r.source_path: p.as_posix() for r, p in zip(records, files, strict=True)})
    text = json.dumps(report, indent=2, sort_keys=True)
    if out is not None:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")
    print(text if as_json else report_table(entries, checked))
    return 1 if fail_on_stale and entries else 0
