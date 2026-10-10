"""`noh typeset-mei-audit`: the catalogue audit written as JSON, over the real sources."""

import json
from pathlib import Path

import pytest

from pipeline.typeset.mei.cli import audit_command
from pipeline.typeset.mei.model import PILOT_FIXTURES


@pytest.fixture(scope="module")
def audit_doc(tmp_path_factory: pytest.TempPathFactory) -> dict:
    out = tmp_path_factory.mktemp("mei-audit") / "nested" / "audit.json"
    assert audit_command(out) == 0
    return json.loads(out.read_text(encoding="utf-8"))


def test_audit_command_real_catalogue_lists_859_sources(audit_doc):
    assert len(audit_doc["sources"]) == 859


def test_audit_command_real_catalogue_proposed_pilot_has_five_entries(audit_doc):
    assert audit_doc["proposed_pilot"] == list(PILOT_FIXTURES)
    assert len(audit_doc["proposed_pilot"]) == 5


def test_audit_command_missing_parent_directories_creates_them(audit_doc):
    # The fixture wrote to a path whose parent directories did not exist yet.
    assert audit_doc["sources"]


def test_audit_command_out_parent_is_file_raises_oserror(tmp_path: Path):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x", encoding="utf-8")
    with pytest.raises(OSError):
        audit_command(blocker / "audit.json")


# --- typeset-mei-extract ---------------------------------------------------------------

import shutil

from pipeline.typeset import lilypond
from pipeline.typeset.mei.cli import extract_command
from pipeline.typeset.mei.extract import extract_score

FIXTURE_TSV = Path(__file__).parent / "fixtures" / "mei" / "extraction" / "ite_Ib.tsv"
ITE_IB = lilypond.ROOT / "data" / "typeset" / "src" / "vol-5" / "missa-i" / "ite_Ib.ly"


class FakeRunner:
    version = "2.26.0"

    def __init__(self, ok: bool = True) -> None:
        self.ok = ok

    def run(self, args, cwd, includes, timeout):
        if self.ok:
            shutil.copy(FIXTURE_TSV, cwd / "out.listen.tsv")
        return self.ok, "" if self.ok else "boom"


def test_extract_command_fake_runner_writes_sorted_ir_and_evidence(tmp_path: Path):
    out = tmp_path / "out"
    assert extract_command(ITE_IB, out, FakeRunner(), tmp_path / "build") == 0
    text = (out / "ir.json").read_text(encoding="utf-8")
    doc = json.loads(text)
    assert text == json.dumps(doc, indent=2, sort_keys=True) + "\n"
    assert doc["sourcePath"] == "data/typeset/src/vol-5/missa-i/ite_Ib.ly"
    assert doc["totalDuration"] == "5/1"
    (evidence,) = (tmp_path / "build").glob("*/events.tsv")
    assert evidence.read_bytes() == FIXTURE_TSV.read_bytes()
    assert evidence.parent.name == doc["dependencyDigest"]


def test_extract_score_failed_runner_returns_error_diagnostic(tmp_path: Path):
    result = extract_score(ITE_IB, runner=FakeRunner(ok=False), build_root=tmp_path)
    assert result.ir is None
    assert [(d.code, d.severity) for d in result.diagnostics] == [("COMPILE_FAILED", "error")]


def test_extract_command_failed_runner_returns_one_and_writes_no_ir(tmp_path: Path):
    assert extract_command(ITE_IB, tmp_path / "out", FakeRunner(ok=False), tmp_path / "b") == 1
    assert not (tmp_path / "out").exists()


# --- typeset-mei-convert ---------------------------------------------------------------

from pipeline.typeset.mei.cli import convert_command
from pipeline.typeset.mei.schema import load_schema_bundle, validate_schema


def test_convert_command_fake_runner_writes_four_artifacts(tmp_path: Path):
    out = tmp_path / "out"
    assert convert_command(ITE_IB, out, FakeRunner(), tmp_path / "build") == 0
    assert sorted(p.name for p in out.iterdir()) == ["boundaries.json", "diagnostics.json", "ir.json", "score.mei"]
    assert validate_schema((out / "score.mei").read_bytes(), load_schema_bundle()) == []
    boundaries = json.loads((out / "boundaries.json").read_text(encoding="utf-8"))
    assert boundaries
    assert set(boundaries[0]) == {"id", "onset", "sourceBreak", "division", "measureId", "afterText"}
    assert boundaries[0]["measureId"] == "m001"
    assert json.loads((out / "diagnostics.json").read_text(encoding="utf-8")) == []
    assert json.loads((out / "ir.json").read_text(encoding="utf-8"))["totalDuration"] == "5/1"


def test_convert_command_is_deterministic(tmp_path: Path):
    convert_command(ITE_IB, tmp_path / "a", FakeRunner(), tmp_path / "b")
    convert_command(ITE_IB, tmp_path / "c", FakeRunner(), tmp_path / "b")
    for name in ("score.mei", "boundaries.json", "diagnostics.json", "ir.json"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "c" / name).read_bytes()


def test_convert_command_failed_runner_returns_one_with_diagnostics_only(tmp_path: Path):
    out = tmp_path / "out"
    assert convert_command(ITE_IB, out, FakeRunner(ok=False), tmp_path / "b") == 1
    assert [p.name for p in out.iterdir()] == ["diagnostics.json"]
    (diag,) = json.loads((out / "diagnostics.json").read_text(encoding="utf-8"))
    assert diag["code"] == "COMPILE_FAILED"


def test_convert_command_schema_failure_returns_one(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from pipeline.typeset.mei import cli
    from pipeline.typeset.mei.diagnostics import Diagnostic

    bad = Diagnostic("SCHEMA_INVALID", "error", "nope")
    monkeypatch.setattr(cli, "validate_schema", lambda xml, bundle: [bad])
    assert convert_command(ITE_IB, tmp_path / "out", FakeRunner(), tmp_path / "b") == 1
    codes = [d["code"] for d in json.loads((tmp_path / "out" / "diagnostics.json").read_text(encoding="utf-8"))]
    assert codes == ["SCHEMA_INVALID"]
