"""Approval expires when the conversion code changes (versions.py)."""

from __future__ import annotations

import dataclasses
import re
import shutil
from pathlib import Path

from pipeline.typeset.mei import versions
from pipeline.typeset.mei.manifest import current_inputs_from_files
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    ReviewDecision,
    ValidationReport,
)
from pipeline.typeset.mei.review import apply_review, approval_is_current


def code_copy(tmp_path: Path) -> Path:
    for name in (*versions.EXTRACTOR_FILES, *versions.CONVERTER_FILES):
        shutil.copy(versions.MEI_DIR / name, tmp_path / name)
    return tmp_path


def test_versions_have_a_base_and_a_16_hex_code_digest() -> None:
    assert re.fullmatch(r"listen_full/1\+[0-9a-f]{16}", versions.extractor_version())
    assert re.fullmatch(r"mei-convert/1\+[0-9a-f]{16}", versions.converter_version())


def test_converter_version_changes_when_encode_bytes_change(tmp_path: Path) -> None:
    root = code_copy(tmp_path)
    before = versions.converter_version(root)
    assert before == versions.converter_version()
    (root / "encode.py").write_bytes((root / "encode.py").read_bytes() + b"\n# edit\n")
    assert versions.converter_version(root) != before
    assert versions.extractor_version(root) == versions.extractor_version()


def test_extractor_version_changes_when_listener_bytes_change(tmp_path: Path) -> None:
    root = code_copy(tmp_path)
    (root / "listen_full.ily").write_bytes((root / "listen_full.ily").read_bytes() + b"\n% edit\n")
    assert versions.extractor_version(root) != versions.extractor_version()


def test_approval_under_the_old_converter_version_is_no_longer_current() -> None:
    old = ConversionInputs("s", "i", "2.26.0", "listen_full/1+old", "mei-convert/1+old", "p", "pp", "x", "v", "f")
    record = ConversionRecord(
        "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly", "t", "a" * 32, "needs-review", old, "b" * 64, (),
        ValidationReport(True, (), (), True, {}, {}), None,
    )
    decision = ReviewDecision("R", "2026-10-10T00:00:00Z", old.digest(), "b" * 64,
                              {c.id: "pass" for c in REQUIRED_MATRIX}, (), "approve")
    approved = apply_review(record, decision, old)
    assert approval_is_current(approved, old)
    now = current_inputs_from_files(approved)
    assert now.converter_version == versions.converter_version() and now.extractor_version == versions.extractor_version()
    assert not approval_is_current(approved, now)
    assert not approval_is_current(approved, dataclasses.replace(now, source_sha256="s", include_sha256="i",
        lilypond_version="2.26.0", profile_sha256="pp", schema_sha256="x"))
