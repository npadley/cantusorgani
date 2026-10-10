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
