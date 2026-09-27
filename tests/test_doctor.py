"""Preflight checks. Every failure must name the exact fix.

External dependencies (the tesseract binary, subprocess, the environment) are
faked; the checks themselves run for real.
"""

import subprocess
import sys
from types import SimpleNamespace

import pytest

from pipeline import doctor
from pipeline.doctor import FAIL, OK, SKIP, Check


@pytest.fixture
def tesseract_with(monkeypatch):
    """Factory: pretend tesseract is installed with the given languages."""
    def install(langs: list[str] | None, *, raises: Exception | None = None):
        monkeypatch.setattr(doctor.shutil, "which",
                            lambda name: None if langs is None else f"/usr/bin/{name}")

        def fake_run(*_args, **_kwargs):
            if raises:
                raise raises
            return SimpleNamespace(stdout="List of available languages:\n" + "\n".join(langs or []))

        monkeypatch.setattr(doctor.subprocess, "run", fake_run)
    return install


def test_check_python_current_interpreter_passes():
    assert doctor.check_python().status == OK


def test_check_python_old_interpreter_fails_with_fix(monkeypatch):
    monkeypatch.setattr(sys, "version_info", SimpleNamespace(major=3, minor=9, micro=6))
    check = doctor.check_python()
    assert check.status == FAIL
    assert "uv sync" in check.detail


def test_check_tesseract_missing_binary_names_install_command(tesseract_with):
    tesseract_with(None)
    check = doctor.check_tesseract()
    assert check.failed
    assert "brew install tesseract" in check.detail


def test_check_tesseract_without_latin_fails_naming_the_language_pack(tesseract_with):
    tesseract_with(["eng", "osd"])
    check = doctor.check_tesseract()
    assert check.failed
    assert "tesseract-lang" in check.detail


def test_check_tesseract_with_latin_passes(tesseract_with):
    tesseract_with(["eng", "lat"])
    assert doctor.check_tesseract().status == OK


def test_check_tesseract_listing_error_is_reported_not_raised(tesseract_with):
    tesseract_with(["lat"], raises=subprocess.TimeoutExpired(cmd="tesseract", timeout=15))
    check = doctor.check_tesseract()
    assert check.failed
    assert "could not list" in check.label


def test_check_r2_missing_credentials_is_a_skip_not_a_failure():
    """Only `publish --upload` needs R2; every other stage must run without it."""
    check = doctor.check_r2({})
    assert check.status == SKIP
    assert not check.failed
    assert "R2_BUCKET" in check.label


def test_check_r2_all_present_passes():
    env = {name: "x" for name in doctor.R2_VARS}
    assert doctor.check_r2(env).status == OK


def test_check_reference_not_registered_current_registry_passes():
    """The CCW edition must never be a publication source."""
    assert doctor.check_reference_not_registered().status == OK


def test_check_reference_not_registered_detects_a_registered_reference(monkeypatch):
    monkeypatch.setattr(doctor, "reference_filenames",
                        lambda: {"NOH5 Kyriale.pdf"})   # pretend NOH5 were a reference
    check = doctor.check_reference_not_registered()
    assert check.failed
    assert "remove them from data/volumes.yml" in check.detail


def test_check_sources_missing_pdf_fails_pointing_at_the_readme(monkeypatch, tmp_path):
    monkeypatch.setattr(doctor, "load_volumes", lambda: {
        "noh5": SimpleNamespace(id="noh5", file="gone.pdf", path=tmp_path / "gone.pdf",
                                sha256="a" * 64)})
    [check] = doctor.check_sources()
    assert check.failed
    assert "Getting the source PDFs" in check.detail


def test_check_sources_unpinned_checksum_fails_with_the_command(monkeypatch, tmp_path):
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF")
    monkeypatch.setattr(doctor, "load_volumes", lambda: {
        "noh5": SimpleNamespace(id="noh5", file="x.pdf", path=pdf, sha256=None)})
    [check] = doctor.check_sources()
    assert check.failed
    assert "noh checksum --volume noh5" in check.detail


def test_report_any_failure_returns_nonzero(capsys):
    code = doctor.report([Check(OK, "fine"), Check(FAIL, "broken", "      Fix: do it")])
    out = capsys.readouterr().out
    assert code == 1
    assert "1 check(s) failed" in out
    assert "Fix: do it" in out


def test_report_skips_and_passes_return_zero():
    assert doctor.report([Check(OK, "fine"), Check(SKIP, "optional")]) == 0


def test_run_returns_one_check_per_concern(tesseract_with):
    tesseract_with(["lat"])
    labels = [c.label for c in doctor.run({})]
    assert any("python" in label for label in labels)
    assert any("tesseract" in label for label in labels)
    assert any("R2" in label for label in labels)
    assert any("GregoBase" in label for label in labels)
    assert any("jgabc" in label for label in labels)


def test_check_gregobase_dump_missing_fails_pointing_at_the_readme(tmp_path):
    check = doctor.check_gregobase_dump(tmp_path / "absent.sql", "0" * 64)
    assert check.status == FAIL
    assert "Vendored data" in check.detail


def test_check_gregobase_dump_wrong_checksum_fails(tmp_path):
    dump = tmp_path / "dump.sql"
    dump.write_text("not the pinned dump")
    check = doctor.check_gregobase_dump(dump, "0" * 64)
    assert check.status == FAIL
    assert "does not match" in check.detail


def test_check_gregobase_dump_pinned_file_passes(tmp_path):
    import hashlib
    dump = tmp_path / "dump.sql"
    dump.write_text("pinned")
    assert doctor.check_gregobase_dump(dump, hashlib.sha256(b"pinned").hexdigest()).status == OK


def test_check_jgabc_missing_fails_with_the_fetch_command(tmp_path):
    check = doctor.check_jgabc(tmp_path / "absent.json")
    assert check.status == FAIL
    assert "noh jgabc-fetch" in check.detail


def test_check_jgabc_hand_edited_fails(tmp_path):
    import json

    from pipeline.jgabc import write_vendored
    path = tmp_path / "j.json"
    write_vendored({"Oct3": {"inID": 59}}, commit="abc", source_sha256="0" * 64, path=path)
    doc = json.loads(path.read_text())
    doc["proprium"]["Oct3"]["inID"] = 1
    path.write_text(json.dumps(doc))
    assert doctor.check_jgabc(path).status == FAIL


def test_check_jgabc_vendored_file_passes():
    assert doctor.check_jgabc().status == OK
