"""Card A5d: typeset-mei-review writes revision-bound review records."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from pipeline.typeset.mei.cli import convert_command, record_for_directory, review_command
from pipeline.typeset.mei.manifest import build_manifest, load_matched_parts, record_from_dict
from pipeline.typeset.mei.model import REQUIRED_MATRIX

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"
KYRIE_TSV = ROOT / "tests/fixtures/mei/extraction/kyrie_IX.tsv"
SITE_MANIFEST = ROOT / "data/typeset/manifest.json"


class _Runner:
    version = "2.26.0"

    def run(self, args, cwd, includes, timeout):
        shutil.copy(KYRIE_TSV, cwd / "out.listen.tsv")
        return True, ""


def fixed(record):  # fake "current inputs": the record's own, so nothing depends on the checkout's files
    return record.inputs


@pytest.fixture(scope="module")
def converted(tmp_path_factory: pytest.TempPathFactory) -> Path:
    base = tmp_path_factory.mktemp("convert")
    assert convert_command(SOURCE, base / "kyrie", _Runner(), base / "build") == 0
    return base / "kyrie"


def write_decision(path: Path, converted: Path, **patch: object) -> Path:
    record, current = record_for_directory(converted, fixed)
    decision = {
        "reviewer": "Test Reviewer", "timestamp": "2026-10-10T00:00:00Z", "inputs_digest": current.digest(),
        "artifact_sha256": record.artifact_sha256, "matrix_results": {c.id: "pass" for c in REQUIRED_MATRIX},
        "accepted_differences": [], "decision": "approve", **patch,
    }
    path.write_text(json.dumps(decision), encoding="utf-8")
    return path


def test_review_command_approve_writes_an_approved_record(converted: Path, tmp_path: Path) -> None:
    out = tmp_path / "record.json"
    assert review_command(converted, write_decision(tmp_path / "d.json", converted), out, fixed) == 0
    record = record_from_dict(json.loads(out.read_text(encoding="utf-8")))
    assert record.state == "approved" and record.review is not None
    assert record.target == "movement:ordinarium-missae-ix/kyrie" and len(record.render_hash or "") == 32
    assert record.inputs.verovio_version == "6.3.0-425dd7b" and len(record.inputs.font_digest) == 64


def test_review_command_stale_inputs_digest_is_blocked(converted: Path, tmp_path: Path, capsys) -> None:
    decision = write_decision(tmp_path / "d.json", converted, inputs_digest="0" * 64)
    out = tmp_path / "record.json"
    assert review_command(converted, decision, out, fixed) == 1
    assert "STALE_APPROVAL" in capsys.readouterr().out and not out.exists()


def test_review_command_missing_matrix_case_is_blocked(converted: Path, tmp_path: Path, capsys) -> None:
    matrix = {c.id: "pass" for c in REQUIRED_MATRIX[1:]}
    decision = write_decision(tmp_path / "d.json", converted, matrix_results=matrix)
    assert review_command(converted, decision, tmp_path / "record.json", fixed) == 1
    assert "MATRIX_INCOMPLETE" in capsys.readouterr().out


def test_review_command_record_round_trips_into_the_manifest(converted: Path, tmp_path: Path) -> None:
    out = tmp_path / "record.json"
    assert review_command(converted, write_decision(tmp_path / "d.json", converted), out, fixed) == 0
    record = record_from_dict(json.loads(out.read_text(encoding="utf-8")))
    artifacts = tmp_path / "artifacts" / (record.artifact_sha256 or "")
    artifacts.mkdir(parents=True)
    for name in ("score.mei", "boundaries.json"):
        shutil.copy(converted / name, artifacts / name)
    manifest = build_manifest([record], load_matched_parts(SITE_MANIFEST), tmp_path / "artifacts", fixed)
    (part,) = manifest.parts
    assert part.target == record.target and len(part.boundaries) == 81
