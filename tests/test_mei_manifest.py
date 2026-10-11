"""Card A6: the approved-conversion manifest builder."""

from __future__ import annotations

import ast
import dataclasses
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline.typeset.mei import manifest as manifest_module
from pipeline.typeset.mei.cli import convert_command, manifest_command
from pipeline.typeset.mei.diagnostics import Diagnostic
from pipeline.typeset.mei.manifest import (
    build_manifest,
    build_manifest_report,
    load_matched_parts,
    manifest_to_dict,
    record_from_dict,
    record_to_dict,
    verify_artifact,
    write_manifest,
)
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    ReviewDecision,
    SemanticDifference,
    ValidationReport,
)
from pipeline.typeset.mei.review import apply_review

ROOT = Path(__file__).resolve().parents[1]
KYRIE_SOURCE = ROOT / "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"
KYRIE_TSV = ROOT / "tests/fixtures/mei/extraction/kyrie_IX.tsv"
SITE_MANIFEST = ROOT / "data/typeset/manifest.json"
TARGET = "movement:ordinarium-missae-ix/kyrie"
WEB = ROOT / "web"


class _Runner:
    version = "2.26.0"

    def run(self, args, cwd, includes, timeout):
        shutil.copy(KYRIE_TSV, cwd / "out.listen.tsv")
        return True, ""


def matched() -> list[dict[str, str]]:
    return load_matched_parts(SITE_MANIFEST)


def kyrie_hash() -> str:
    return next(p["hash"] for p in matched() if p["target"] == TARGET)


INPUTS = ConversionInputs(
    source_sha256="s", include_sha256="i", lilypond_version="2.26.0", extractor_version="listen_full/1",
    converter_version="c1", profile_id="accompaniment-v1", profile_sha256="p", schema_sha256="x",
    verovio_version="6.3.0-425dd7b", font_digest="f",
)


@pytest.fixture(scope="module")
def converted(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("convert")
    assert convert_command(KYRIE_SOURCE, out / "kyrie", _Runner(), out / "build") == 0
    return out / "kyrie"


def approved_record(sha: str, **patch: object) -> ConversionRecord:
    base = ConversionRecord(
        source_path="data/typeset/src/vol-5/missa-ix/kyrie_IX.ly", target=TARGET, render_hash=kyrie_hash(),
        state="needs-review", inputs=INPUTS, artifact_sha256=sha, diagnostics=(),
        validation=ValidationReport(True, (), (), True, {}, {}), review=None,
    )
    decision = ReviewDecision(
        "Nick", "2026-10-10T00:00:00Z", INPUTS.digest(), sha, {c.id: "pass" for c in REQUIRED_MATRIX}, (), "approve"
    )
    return dataclasses.replace(apply_review(base, decision, INPUTS), **patch)


@pytest.fixture
def world(tmp_path: Path, converted: Path) -> tuple[Path, ConversionRecord]:
    sha = hashlib.sha256((converted / "score.mei").read_bytes()).hexdigest()
    folder = tmp_path / "artifacts" / sha
    shutil.copytree(converted, folder)
    return tmp_path / "artifacts", approved_record(sha)


def current(_: ConversionRecord) -> ConversionInputs:
    return INPUTS


# --- inclusion ----------------------------------------------------------------------------------------


def test_build_manifest_approved_kyrie_is_included_with_all_81_boundaries(world) -> None:
    artifacts, record = world
    manifest = build_manifest([record], matched(), artifacts, current)
    (part,) = manifest.parts
    assert (part.target, part.render_hash, part.source_revision) == (TARGET, kyrie_hash(), kyrie_hash())
    assert part.digest == part.mei_sha256 == record.artifact_sha256
    assert part.mei_path == f"mei/{part.digest}/score.mei"
    assert len(part.boundaries) == 81 and part.capabilities == {"manualBreaks": True}
    assert (part.profile, part.verovio) == ("accompaniment-v1", "6.3.0-425dd7b")
    assert part.boundaries[0].after_text == "Ky" and part.boundaries[0].measure_id == "m001"


def _excluded(world, record: ConversionRecord, current_fn=current, parts=None) -> str:
    artifacts, _ = world
    manifest, excluded = build_manifest_report([record], parts or matched(), artifacts, current_fn)
    assert manifest.parts == ()
    (reason,) = excluded.values()
    return reason


def test_build_manifest_stale_approval_is_excluded(world) -> None:
    _, record = world
    changed = dataclasses.replace(INPUTS, include_sha256="other")
    assert _excluded(world, record, lambda _r: changed) == "STALE_APPROVAL"


def test_build_manifest_unapproved_record_is_excluded(world) -> None:
    _, record = world
    assert "needs-review" in _excluded(world, dataclasses.replace(record, state="needs-review", review=None))


def test_build_manifest_unsupported_record_is_excluded(world) -> None:
    _, record = world
    assert "unsupported" in _excluded(world, dataclasses.replace(record, state="unsupported", review=None))


def test_build_manifest_unmatched_target_is_excluded(world) -> None:
    _, record = world
    assert _excluded(world, dataclasses.replace(record, target="movement:nope/none")) == "UNMATCHED_TARGET"
    assert _excluded(world, dataclasses.replace(record, target=None)) == "UNMATCHED_TARGET"


def test_build_manifest_target_hash_mismatch_is_excluded(world) -> None:
    _, record = world
    assert _excluded(world, dataclasses.replace(record, render_hash="0" * 32)) == "TARGET_HASH_MISMATCH"


def test_build_manifest_corrupted_artifact_is_excluded(world) -> None:
    artifacts, record = world
    (artifacts / record.artifact_sha256 / "score.mei").write_bytes(b"<mei/>")
    assert _excluded(world, record) == "HASH_MISMATCH"


def test_build_manifest_missing_artifact_is_excluded(world) -> None:
    artifacts, record = world
    shutil.rmtree(artifacts / record.artifact_sha256)
    assert _excluded(world, record) == "ASSET_MISSING"


def test_build_manifest_boundaries_naming_unknown_measures_are_excluded(world) -> None:
    artifacts, record = world
    path = artifacts / record.artifact_sha256 / "boundaries.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data[0]["measureId"] = "m999"
    path.write_text(json.dumps(data), encoding="utf-8")
    assert _excluded(world, record) == "HASH_MISMATCH"


def test_build_manifest_duplicate_target_and_hash_is_a_key_collision(world) -> None:
    artifacts, record = world
    manifest, excluded = build_manifest_report([record, record], matched(), artifacts, current)
    assert manifest.parts == () and set(excluded.values()) == {"KEY_COLLISION"}


# --- verify_artifact -----------------------------------------------------------------------------------


def test_verify_artifact_intact_folder_has_no_diagnostics(world) -> None:
    artifacts, record = world
    assert verify_artifact(record, artifacts / record.artifact_sha256) == []


@pytest.mark.parametrize("name", ["../score.mei", "/etc/passwd", "a/../b"])
def test_verify_artifact_unsafe_name_is_rejected(world, name: str) -> None:
    artifacts, record = world
    (diag,) = verify_artifact(record, artifacts / record.artifact_sha256, name)
    assert diag.code == "UNSAFE_PATH"


def test_verify_artifact_record_without_hash_is_rejected(world) -> None:
    artifacts, record = world
    (diag,) = verify_artifact(dataclasses.replace(record, artifact_sha256="../x"), artifacts)
    assert diag.code == "HASH_MISMATCH"


# --- JSON ------------------------------------------------------------------------------------------------------


def test_record_round_trips_through_json(world) -> None:
    _, record = world
    rich = dataclasses.replace(
        record,
        diagnostics=(Diagnostic("UNSAFE_BOUNDARY", "error", "m", None, ("e1",), (("k", "v"),)),),
        validation=ValidationReport(
            False, (Diagnostic("SCHEMA_INVALID", "error", "x"),),
            (SemanticDifference("PITCH_MISMATCH", "1.1", None, ("e",), "d"),), False, {"a": "b"}, {"t": "1"}
        ),
    )
    text = json.dumps(record_to_dict(rich), sort_keys=True)
    assert record_from_dict(json.loads(text)) == rich
    assert record_from_dict(json.loads(json.dumps(record_to_dict(record)))) == record


def parse_manifest_py(value: object) -> list[dict]:
    """Python re-implementation of the web parseManifest checks (web/src/lib/mei.ts)."""
    assert isinstance(value, dict) and value["schemaVersion"] == 1 and isinstance(value["parts"], list)
    hexn = lambda v, n: isinstance(v, str) and re.fullmatch(f"[0-9a-f]{{{n}}}", v) is not None
    for p in value["parts"]:
        assert isinstance(p["target"], str) and p["target"]
        assert hexn(p["renderHash"], 32) and hexn(p["digest"], 64) and hexn(p["meiSha256"], 64)
        for key in ("meiUrl", "sourceRevision", "profile", "verovio"):
            assert isinstance(p[key], str) and p[key]
        assert isinstance(p["capabilities"]["manualBreaks"], bool)
        for b in p["boundaries"]:
            assert set(b) == {"id", "onset", "sourceBreak", "division", "measureId", "afterText"}
            assert all(isinstance(b[k], str) and b[k] for k in ("id", "onset", "measureId"))
            assert isinstance(b["sourceBreak"], bool)
            assert b["division"] in (None, "finalis", "maxima", "maior", "minima")
            assert b["afterText"] is None or isinstance(b["afterText"], str)
    return value["parts"]


def test_write_manifest_json_passes_the_parse_manifest_checks(world, tmp_path: Path) -> None:
    artifacts, record = world
    out = tmp_path / "nested" / "manifest.json"
    write_manifest(build_manifest([record], matched(), artifacts, current), out)
    text = out.read_text(encoding="utf-8")
    doc = json.loads(text)
    assert text == json.dumps(doc, indent=2, sort_keys=True) + "\n"
    (part,) = parse_manifest_py(doc)
    assert part["meiUrl"] == f"/mei/{part['digest']}/score.mei" and len(part["boundaries"]) == 81
    assert part["sourceRevision"] == part["renderHash"] == kyrie_hash()


def test_write_manifest_is_deterministic(world, tmp_path: Path) -> None:
    artifacts, record = world
    m = build_manifest([record], matched(), artifacts, current)
    write_manifest(m, tmp_path / "a.json")
    write_manifest(m, tmp_path / "b.json")
    assert (tmp_path / "a.json").read_bytes() == (tmp_path / "b.json").read_bytes()
    assert manifest_to_dict(m)["schemaVersion"] == 1


XCHECK = """import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseManifest } from './mei';
it('web parseManifest accepts the python manifest', () => {
  const value = JSON.parse(readFileSync(process.env.NOH_MANIFEST_JSON as string, 'utf8'));
  const m = parseManifest(value);
  expect(m.parts).toHaveLength(value.parts.length);
  expect(m.parts[0]?.boundaries).toHaveLength(Number(process.env.NOH_EXPECT_BOUNDARIES));
});
"""


def test_write_manifest_output_is_accepted_by_the_real_web_parse_manifest(world, tmp_path: Path) -> None:
    pnpm = shutil.which("pnpm")
    if pnpm is None or not (WEB / "node_modules/.bin/vitest").exists():
        pytest.skip("pnpm or web/node_modules (vitest) is missing; tsx/vite-node are not installed either")
    artifacts, record = world
    out = tmp_path / "manifest.json"
    write_manifest(build_manifest([record], matched(), artifacts, current), out)
    spec = WEB / "src/lib/zz-manifest-xcheck.test.ts"
    spec.write_text(XCHECK, encoding="utf-8")
    try:
        done = subprocess.run(
            [pnpm, "exec", "vitest", "run", "src/lib/zz-manifest-xcheck.test.ts"],
            cwd=WEB, capture_output=True, text=True, timeout=240, check=False,
            env={**__import__("os").environ, "NOH_MANIFEST_JSON": str(out), "NOH_EXPECT_BOUNDARIES": "81"},
        )
    finally:
        spec.unlink(missing_ok=True)
    assert done.returncode == 0, done.stdout[-1500:] + done.stderr[-500:]


# --- CLI -----------------------------------------------------------------------------------------------------


def test_manifest_command_builds_from_record_files(world, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts, record = world
    records = tmp_path / "records"
    records.mkdir()
    (records / "kyrie.json").write_text(json.dumps(record_to_dict(record)), encoding="utf-8")
    monkeypatch.setattr(manifest_module, "current_inputs_from_files", current)
    out = tmp_path / "out" / "manifest.json"
    assert manifest_command(records, out, artifacts) == 0
    assert len(json.loads(out.read_text(encoding="utf-8"))["parts"]) == 1


# --- isolation --------------------------------------------------------------------------------------------------


def test_manifest_module_imports_nothing_from_proofreading() -> None:
    tree = ast.parse(Path(manifest_module.__file__).read_text(encoding="utf-8"))
    imported = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            imported.append(node.module or "")
        elif isinstance(node, ast.Import):
            imported += [a.name for a in node.names]
    assert imported
    assert not [m for m in imported if any(w in m for w in ("proofread", "correction", "queue"))]


def test_current_inputs_from_files_recomputes_file_hashes_and_keeps_tool_versions(world) -> None:
    from pipeline.typeset.mei.manifest import current_inputs_from_files

    _, record = world
    now = current_inputs_from_files(record)
    assert re.fullmatch("[0-9a-f]{64}", now.source_sha256) and re.fullmatch("[0-9a-f]{64}", now.schema_sha256)
    from pipeline.typeset.mei import versions

    assert (now.extractor_version, now.converter_version) == (versions.extractor_version(), versions.converter_version())
    assert (now.verovio_version, now.font_digest) == (INPUTS.verovio_version, INPUTS.font_digest)
    assert now != INPUTS  # the placeholder file hashes in INPUTS are stale, so such a record is excluded
