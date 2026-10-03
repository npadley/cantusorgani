"""Audit reports are local, input-bound and cannot silently accept missing evidence."""
import json
from fractions import Fraction
from pathlib import Path

import cv2
import numpy as np
import pytest

from pipeline.typeset.accompaniment_audit import audit, scan_digest, source_span
from pipeline.typeset.score_events import MusicalEvent, ScoreEvidence


def environment(tmp_path):
    root = tmp_path / "project"
    (root / "data/typeset/src/vol-1").mkdir(parents=True)
    (root / "data/typeset/src/vol-1/example.ly").write_text('\\version "2.26.0"')
    (root / "data/typeset/manifest.json").write_text(json.dumps({"parts": [
        {"file": "vol-1/example.ly", "target": "part:example/communion", "hash": "old"}]}))
    (root / "data/catalog.json").write_text(json.dumps({"pieces": [
        {"slug": "example", "systems": ["noh1/0033/004"],
         "sections": [{"kind": "communion", "system": 0, "ref": "noh1/0033/004",
                       "gregobase_id": None}]}]}))
    (root / "data/chants.json").write_text('{"chants": {}}')
    scans = tmp_path / "scans"
    (scans / "noh1/0033").mkdir(parents=True)
    cv2.imwrite(str(scans / "noh1/0033/004.png"), np.full((100, 200), 255, np.uint8))
    return root, scans


def test_audit_missing_or_broken_evidence_isolated_from_other_files(tmp_path):
    root, scans = environment(tmp_path)
    result = audit(["vol-1/example.ly", "vol-1/missing.ly"], tmp_path / "out", scans,
                   root=root, score_reader=lambda p: ScoreEvidence(flags=["compile failed"]))
    assert [r["status"] for r in result["files"]] == ["blocked", "blocked"]
    assert "compile failed" in result["files"][0]["flags"]
    assert result["full_proofread"] is False
    assert (tmp_path / "out/index.html").exists()


@pytest.mark.parametrize("filename", ["../escape.ly", "/tmp/evil.ly", "vol-1/../../bad.ly"])
def test_audit_refuses_source_path_traversal(tmp_path, filename):
    root, scans = environment(tmp_path)
    with pytest.raises(ValueError):
        audit([filename], tmp_path / "out", scans, root=root)


def test_audit_cache_changes_when_scan_source_or_annotations_change(tmp_path):
    root, scans = environment(tmp_path)
    def run():
        return audit(["vol-1/example.ly"], tmp_path / "out", scans, root=root,
                     score_reader=lambda p: ScoreEvidence(flags=["not compiled"]))["files"][0]
    first = run()
    image = scans / "noh1/0033/004.png"
    cv2.imwrite(str(image), np.zeros((100, 200), np.uint8))
    second = run()
    assert first["input_hash"] != second["input_hash"]
    assert first["scan_hash"] != second["scan_hash"]
    source = root / "data/typeset/src/vol-1/example.ly"
    source.write_text(source.read_text() + "\n% changed")
    assert run()["input_hash"] != second["input_hash"]


def test_report_escapes_source_names_and_errors(tmp_path):
    root, scans = environment(tmp_path)
    audit(["vol-1/example.ly"], tmp_path / "out", scans, root=root,
          score_reader=lambda p: ScoreEvidence(flags=['<script>alert("x")</script>']))
    html = (tmp_path / "out/index.html").read_text()
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_source_span_includes_last_system_and_stops_at_next_part():
    p = {"slug": "example", "systems": ["a", "b", "c", "d"], "sections": [
        {"kind": "introit", "system": 0, "ref": "a"},
        {"kind": "communion", "system": 2, "ref": "c"}]}
    assert source_span(p, "part:example/introit") == ["a", "b"]
    assert source_span(p, "part:example/communion") == ["c", "d"]


def test_scan_digest_binds_identity_order_and_content():
    assert scan_digest([("a", b"x"), ("b", b"y")]) != scan_digest([("b", b"y"), ("a", b"x")])
    assert scan_digest([("a", b"x")]) != scan_digest([("a", b"xx")])


def test_cli_accepts_bounded_local_files_and_review_annotations():
    from pipeline.cli import build_parser
    args = build_parser().parse_args([
        "typeset-accompaniment-check", "--file", "vol-1/example.ly",
        "--file", "vol-5/kyrie.ly", "--scan-root", "/tmp/scans",
        "--out", "/tmp/audit", "--annotations", "/tmp/reviews",
    ])
    assert args.file == ["vol-1/example.ly", "vol-5/kyrie.ly"]
    assert args.annotations == Path("/tmp/reviews")


def test_audit_recovers_missing_cached_picture_after_interruption(tmp_path):
    root, scans = environment(tmp_path)
    score = ScoreEvidence(events=[MusicalEvent(v, "note", Fraction(0), Fraction(1, 2),
                                              0, Fraction(0)) for v in ("alto", "tenor", "bass")])
    first = audit(["vol-1/example.ly"], tmp_path / "out", scans, root=root,
                  score_reader=lambda p: score)
    picture = tmp_path / "out" / first["files"][0]["pictures"][0]["overlay"]
    picture.unlink()
    audit(["vol-1/example.ly"], tmp_path / "out", scans, root=root,
          score_reader=lambda p: score)
    assert picture.exists()
