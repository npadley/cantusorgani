"""Card O5: typeset-mei-revoke writes a revoked record, and a revoke/restore cycle is byte-exact."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from pipeline.cli import main
from pipeline.typeset.mei.cli import manifest_command, revoke_command, stale_command
from pipeline.typeset.mei.manifest import record_from_dict, record_to_dict
from tests.test_mei_publish import BOUNDARIES, INPUTS, MEI, make_record, sha

TARGET = "movement:x"
PARTS = {"parts": [{"target": TARGET, "file": "x.ly", "hash": "a" * 32}]}


def fixed_inputs(_record):  # a stand-in for current_inputs_from_files
    return INPUTS


@pytest.fixture
def world(tmp_path: Path) -> dict[str, Path]:
    """An approved record, its artifacts and a matched-parts file, all fixtures (no live data)."""
    records, artifacts = tmp_path / "records", tmp_path / "artifacts"
    (artifacts / sha(MEI)).mkdir(parents=True)
    (artifacts / sha(MEI) / "score.mei").write_bytes(MEI)
    (artifacts / sha(MEI) / "boundaries.json").write_bytes(BOUNDARIES)
    records.mkdir()
    record_path = records / "x.json"
    record_path.write_text(
        json.dumps(record_to_dict(make_record(sha(MEI))), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    matched = tmp_path / "matched.json"
    matched.write_text(json.dumps(PARTS), encoding="utf-8")
    return {
        "records": records, "artifacts": artifacts, "record": record_path, "matched": matched,
        "out": tmp_path / "m.json",
    }


def build(world: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> list[str]:
    monkeypatch.setattr("pipeline.typeset.mei.manifest.current_inputs_from_files", fixed_inputs)
    manifest_command(world["records"], world["out"], world["artifacts"], world["matched"])
    return [p["target"] for p in json.loads(world["out"].read_text(encoding="utf-8"))["parts"]]


def test_revoke_command_approved_record_becomes_revoked_with_reason(world: dict[str, Path], capsys) -> None:
    assert revoke_command(world["record"], "wrong rhythm in bar 3", now="2026-10-17T00:00:00Z") == 0
    record = record_from_dict(json.loads(world["record"].read_text(encoding="utf-8")))
    assert record.state == "revoked" and record.revocation is not None
    assert (record.revocation.reason, record.revocation.timestamp) == ("wrong rhythm in bar 3", "2026-10-17T00:00:00Z")
    assert "revoked" in capsys.readouterr().out


def test_revoke_command_keeps_the_rest_of_the_record_unchanged(world: dict[str, Path]) -> None:
    before = record_from_dict(json.loads(world["record"].read_text(encoding="utf-8")))
    revoke_command(world["record"], "r", now="2026-10-17T00:00:00Z")
    after = record_from_dict(json.loads(world["record"].read_text(encoding="utf-8")))
    assert dataclasses.replace(after, state="approved", revocation=None) == before


def test_revoke_command_empty_reason_is_refused_and_file_untouched(world: dict[str, Path], capsys) -> None:
    original = world["record"].read_bytes()
    assert revoke_command(world["record"], "  ") == 1
    assert world["record"].read_bytes() == original and "reason" in capsys.readouterr().out


def test_revoke_command_record_that_is_not_approved_is_refused(world: dict[str, Path], capsys) -> None:
    revoke_command(world["record"], "first", now="2026-10-17T00:00:00Z")
    once = world["record"].read_bytes()
    assert revoke_command(world["record"], "second") == 1
    assert world["record"].read_bytes() == once and "not approved" in capsys.readouterr().out


def test_revoke_command_missing_record_exits_one(tmp_path: Path, capsys) -> None:
    assert revoke_command(tmp_path / "nope.json", "r") == 1
    assert "error" in capsys.readouterr().out


def test_main_typeset_mei_revoke_is_registered(world: dict[str, Path]) -> None:
    assert main(["typeset-mei-revoke", str(world["record"]), "--reason", "bad"]) == 0
    assert json.loads(world["record"].read_text(encoding="utf-8"))["state"] == "revoked"


def test_revoke_drill_manifest_drops_the_record_and_restore_is_byte_identical(
    world: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The O5 drill on fixtures: revoke -> manifest and stale exclude it -> restore -> identical bytes."""
    original_record = world["record"].read_bytes()
    assert build(world, monkeypatch) == [TARGET]
    original_manifest = world["out"].read_bytes()

    assert revoke_command(world["record"], "drill", now="2026-10-17T00:00:00Z") == 0
    assert build(world, monkeypatch) == []
    report = world["out"].parent / "stale.json"
    assert stale_command(world["records"], True, True, report, fixed_inputs, world["matched"]) == 0
    assert json.loads(report.read_text(encoding="utf-8"))["stale"] == []

    world["record"].write_bytes(original_record)  # restore exactly what was committed
    assert build(world, monkeypatch) == [TARGET]
    assert world["record"].read_bytes() == original_record
    assert world["out"].read_bytes() == original_manifest
