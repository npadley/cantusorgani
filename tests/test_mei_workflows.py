"""Card C1b: the MEI conversion workflow keeps untrusted source away from secrets."""

from __future__ import annotations

import dataclasses
import hashlib
import json
from pathlib import Path

import yaml

from pipeline.typeset.mei.cli import publish_command
from pipeline.typeset.mei.manifest import record_to_dict
from tests.test_mei_publish import BOUNDARIES, INPUTS, MEI, make_record

WORKFLOW = Path(".github/workflows/mei-conversion.yml")


def load() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def jobs() -> tuple[dict, dict]:
    data = load()["jobs"]
    return data["convert"], data["publish"]


def text(job: dict) -> str:
    return yaml.safe_dump(job)


def test_convert_job_has_no_permissions_secrets_or_persisted_credentials() -> None:
    convert, _ = jobs()
    assert convert["permissions"] == {}
    assert "secrets." not in text(convert)
    checkouts = [s for s in convert["steps"] if s.get("uses", "").startswith("actions/checkout")]
    assert checkouts and all(s.get("with", {}).get("persist-credentials") is False for s in checkouts)
    assert "NOH_SANDBOX" in text(convert) and "ulimit" in text(convert) and "unshare" in text(convert)


def test_publish_job_does_not_install_or_run_the_compiler() -> None:
    _, publish = jobs()
    commands = "\n".join(s.get("run", "") for s in publish["steps"])
    assert "typeset-mei-publish" in commands
    for banned in ("lilypond", "typeset-mei-convert", "extract"):
        assert banned not in text(publish).replace("typeset-mei-publish", "")
    assert publish["needs"] == "convert"


def test_publish_job_is_guarded_to_manual_default_branch_publish() -> None:
    _, publish = jobs()
    guard = " ".join(str(publish["if"]).split())
    assert "inputs.publish == true" in guard
    assert "github.event_name == 'workflow_dispatch'" in guard
    assert "github.event.repository.default_branch" in guard and "github.ref" in guard
    assert publish["environment"] == "mei-publish"
    on = load()[True] if True in load() else load()["on"]
    assert set(on) == {"workflow_dispatch"} and on["workflow_dispatch"]["inputs"]["publish"]["default"] is False


def test_secrets_appear_only_in_the_publish_job() -> None:
    convert, publish = jobs()
    assert "secrets." not in text(convert)
    assert "secrets.R2_ACCESS_KEY_ID" in text(publish)
    assert "secrets." not in yaml.safe_dump({k: v for k, v in load().items() if k != "jobs"})


def test_inputs_never_interpolated_into_run_scripts() -> None:
    for job in jobs():
        for step in job["steps"]:
            assert "${{" not in step.get("run", ""), step
    convert, _ = jobs()
    validate = next(s for s in convert["steps"] if s.get("name", "").startswith("Validate"))
    assert validate["env"]["SOURCES"] == "${{ inputs.sources }}"
    assert "data/typeset/src/" in validate["run"] and "*..*" in validate["run"]


def _publishable(tmp_path: Path) -> tuple[Path, Path, str]:
    digest = hashlib.sha256(MEI).hexdigest()
    artifacts = tmp_path / "artifacts"
    (artifacts / digest).mkdir(parents=True)
    (artifacts / digest / "score.mei").write_bytes(MEI)
    (artifacts / digest / "boundaries.json").write_bytes(BOUNDARIES)
    records = tmp_path / "records"
    records.mkdir()
    (records / "a.json").write_text(json.dumps(record_to_dict(make_record(digest))))
    return artifacts, records, digest


def test_publish_command_dry_run_lists_expected_keys(tmp_path, capsys) -> None:
    artifacts, records, digest = _publishable(tmp_path)
    assert publish_command(artifacts, records, dry_run=True, current_inputs=lambda _r: INPUTS) == 0
    out = capsys.readouterr().out
    assert f"would upload mei/{digest}/score.mei" in out and f"would upload mei/{digest}/boundaries.json" in out


def test_publish_command_stale_record_exits_nonzero(tmp_path, capsys) -> None:
    artifacts, records, _ = _publishable(tmp_path)
    changed = dataclasses.replace(INPUTS, include_sha256="other")
    assert publish_command(artifacts, records, dry_run=True, current_inputs=lambda _r: changed) == 1
    assert "STALE_APPROVAL" in capsys.readouterr().out
