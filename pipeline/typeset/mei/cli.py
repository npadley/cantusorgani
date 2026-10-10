"""`noh typeset-mei-audit` (catalogue audit, no LilyPond) and `noh typeset-mei-extract` (one source), `noh typeset-mei-convert`."""

from __future__ import annotations

import dataclasses
import json
from collections import Counter
from fractions import Fraction
from pathlib import Path
from typing import Any

from pipeline.typeset.lilypond import INCLUDE
from pipeline.typeset.match import PARTS_FILE, SRC, load
from pipeline.typeset.mei.audit import audit_sources
from pipeline.typeset.mei.diagnostics import Diagnostic
from pipeline.typeset.mei.encode import encode_score
from pipeline.typeset.mei.extract import BUILD_ROOT, PinnedLilyPondRunner, extract_score
from pipeline.typeset.mei.model import ConversionProfile, LilyPondRunnerAdapter
from pipeline.typeset.mei.schema import load_schema_bundle, validate_schema


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
    diagnostics.json and ir.json to OUT. No approval, review or publish side effects."""
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
    errors = [d for d in diagnostics if d.severity == "error"]
    for d in diagnostics:
        print(f"{d.severity}: {d.code}: {d.message}")
    print(
        f"converted {source.name}: {len(ir.events)} events, {len(encoded.boundaries)} safe boundaries, "
        f"sha256 {encoded.artifact_sha256}; wrote {out}"
    )
    return 1 if errors else 0
