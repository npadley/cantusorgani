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


def test_audit_cache_changes_when_scan_or_source_changes(tmp_path):
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


def test_audit_changed_review_invalidates_cached_result(tmp_path):
    root, scans = environment(tmp_path)
    review = tmp_path / "review.json"
    packet = {"schema_version": 1, "scan_hash": scan_digest([
        ("noh1/0033/004", (scans / "noh1/0033/004.png").read_bytes())]),
        "systems": ["noh1/0033/004"], "reviewer": "independent reader",
        "basis": "source-scan", "complete": False, "events": [{
            "voice": "alto", "kind": "note", "step": 0, "alteration": "0",
            "onset": "0", "box": [10, 10, 20, 20], "system": "noh1/0033/004"}]}
    score = ScoreEvidence(events=[MusicalEvent(v, "note", Fraction(0), Fraction(1, 2),
                                              0, Fraction(0)) for v in ("alto", "tenor", "bass")])
    def run():
        review.write_text(json.dumps(packet))
        return audit(["vol-1/example.ly"], tmp_path / "out", scans, review, root=root,
                     score_reader=lambda p: score)["files"][0]
    first = run()
    assert first["status"] == "needs-review"
    assert (tmp_path / "out/cache" / first["input_hash"] / "result.json").is_file()
    packet["scan_hash"] = "0" * 64
    second = run()
    assert second["input_hash"] != first["input_hash"]
    assert second["annotation_hash"] != first["annotation_hash"]
    assert second["status"] == "blocked"


def test_audit_effective_movement_chant_and_render_identity_invalidate_cache(tmp_path):
    root, scans = environment(tmp_path)
    catalogue_path = root / "data/catalog.json"
    piece = json.loads(catalogue_path.read_text())["pieces"][0]
    piece.update(volume="noh1", genre="mass_ordinary", sections=[],
                 movements=[{"movement": "kyrie", "ref": "noh1/0033/004"}],
                 chant=[{"movement": "kyrie", "id": 123}])
    catalogue_path.write_text(json.dumps({"pieces": [piece]}))
    manifest_path = root / "data/typeset/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["parts"][0]["target"] = "movement:example/kyrie"
    manifest_path.write_text(json.dumps(manifest))
    chants_path = root / "data/chants.json"
    chants_path.write_text(json.dumps({"chants": {"123": {"gabc": "A"}}}))
    def run():
        return audit(["vol-1/example.ly"], tmp_path / "out", scans, root=root,
                     score_reader=lambda p: ScoreEvidence(flags=["not compiled"]))["files"][0]
    first = run()
    assert first["gabc_hash"] is not None
    chants_path.write_text(json.dumps({"chants": {"123": {"gabc": "B"}}}))
    second = run()
    assert first["input_hash"] != second["input_hash"]
    manifest["parts"][0]["hash"] = "new-reference"
    manifest_path.write_text(json.dumps(manifest))
    third = run()
    assert third["input_hash"] != second["input_hash"]
    assert third["manifest_render_hash"] == "new-reference"
    assert third["render_hash"] == second["render_hash"]


def test_audit_algorithm_dependency_changes_invalidate_cache(tmp_path, monkeypatch):
    from pipeline.typeset import accompaniment_audit
    root, scans = environment(tmp_path)
    dependency = tmp_path / "geometry.py"
    dependency.write_text("version1")
    monkeypatch.setattr(accompaniment_audit, "DEPENDENCIES", (dependency,), raising=False)
    def run():
        return audit(["vol-1/example.ly"], tmp_path / "out", scans, root=root,
                     score_reader=lambda p: ScoreEvidence(flags=["not compiled"]))["files"][0]
    first = run()
    dependency.write_text("version2")
    assert run()["input_hash"] != first["input_hash"]


def test_audit_render_identity_is_current_and_manifest_reference_is_separate(tmp_path):
    from pipeline.typeset.render import source_hash
    root, scans = environment(tmp_path)
    row = audit(["vol-1/example.ly"], tmp_path / "out", scans, root=root,
                score_reader=lambda p: ScoreEvidence(flags=["not compiled"]))["files"][0]
    assert row["render_hash"] == source_hash(
        (root / "data/typeset/src/vol-1/example.ly").read_text())
    assert row["manifest_render_hash"] == "old"


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


def test_source_span_uses_reviewed_movement_start_not_superseded_raw_start():
    p = next(p for p in json.loads(Path("data/catalog.json").read_text())["pieces"]
             if p["slug"] == "ordinarium-missae-ix")
    assert source_span(p, "part:ordinarium-missae-ix/other:gloria") == p["systems"][6:19]


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
