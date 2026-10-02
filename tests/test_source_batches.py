import hashlib

import pytest

from pipeline.corrections import CorrectionError, batch_summary, correct_batch, hold_reasons


def batch(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "x.ly").write_text("Kýrie", encoding="utf-8")
    return {
        "batch": "b-123456",
        "branch": "corrections/b-123456",
        "entries": [],
        "sources": [
            {
                "correctionId": 1,
                "file": "x.ly",
                "baseBlobSha": "a" * 40,
                "contentHash": hashlib.sha256("Kýrie".encode()).hexdigest(),
            }
        ],
    }, src


def test_source_only_validates_committed_bytes_without_catalogue_fields(tmp_path):
    b, src = batch(tmp_path)
    assert correct_batch(b, source_root=src, path=tmp_path / "corrections.yml") == []
    assert not (tmp_path / "corrections.yml").exists()
    summary = batch_summary(b["batch"], [], sources=b["sources"])
    assert "x.ly" in summary and b["sources"][0]["contentHash"] in summary


def test_source_descriptor_refuses_changed_bytes_traversal_and_duplicate(tmp_path):
    b, src = batch(tmp_path)
    (src / "x.ly").write_text("changed")
    with pytest.raises(CorrectionError):
        correct_batch(b, source_root=src)
    b["sources"][0]["file"] = "../x.ly"
    with pytest.raises(CorrectionError):
        correct_batch(b, source_root=src)


def test_source_edits_count_toward_large_batch_hold(tmp_path):
    b, _ = batch(tmp_path)
    assert hold_reasons([], sources=b["sources"] * 25)
    assert not hold_reasons([], sources=b["sources"] * 24)


@pytest.mark.lilypond
def test_refresh_source_batch_repairs_metadata_and_checks_render(tmp_path):
    import yaml

    from pipeline.typeset.match import SRC
    from pipeline.typeset.source_batch import refresh_sources

    file = "vol-5/missa-ix/kyrie_IX.ly"
    text = (SRC / file).read_text()
    b = {
        "batch": "b-123456",
        "branch": "corrections/b-123456",
        "entries": [],
        "sources": [
            {
                "correctionId": 1,
                "file": file,
                "baseBlobSha": "a" * 40,
                "contentHash": hashlib.sha256(text.encode()).hexdigest(),
            }
        ],
    }
    out = tmp_path / "parts.yml"
    refresh_sources(b, out)
    rows = yaml.safe_load(out.read_text())
    assert next(r for r in rows if r["file"] == file)["status"] == "matched"


def test_mixed_batch_keeps_normal_entries_and_source_descriptors_separate(tmp_path):
    import json

    from tests.test_corrections import base

    b, src = batch(tmp_path)
    base_path = tmp_path / "base.json"
    base_path.write_text(json.dumps(base()))
    b["entries"] = [
        {
            "target": "piece:kyrie-i",
            "field": "mode",
            "value": "VII",
            "source": "editor",
            "editor_email": "ed@example.org",
            "note": "Checked printed scan",
        }
    ]
    recorded = correct_batch(
        b, source_root=src, base_path=base_path, path=tmp_path / "corrections.yml"
    )
    assert len(recorded) == 1 and recorded[0].field == "mode"
    assert "x.ly" in batch_summary(b["batch"], recorded, sources=b["sources"])


def test_source_summary_publishes_only_explicit_editor_reasons(tmp_path):
    b, _ = batch(tmp_path)
    b["sourceReasons"] = [
        {
            "correctionId": 1,
            "reason": "Corrected against printed scan",
            "editorEmail": "ed@example.org",
        }
    ]
    summary = batch_summary(b["batch"], [], sources=b["sources"], source_reasons=b["sourceReasons"])
    assert "Corrected against printed scan" in summary and "ed@example.org" in summary


def test_credentialed_job_refuses_unrelated_or_reassigned_source_evidence(tmp_path):
    import yaml

    from pipeline.typeset.source_batch import validate_source_evidence

    rows = [
        {"file": "x.ly", "status": "matched", "target": "piece:original", "evidence": {}},
        {"file": "y.ly", "status": "proposed", "target": None, "evidence": {}},
    ]
    parts = tmp_path / "parts.yml"
    parts.write_text(yaml.safe_dump(rows))
    artifact = tmp_path / "artifact.yml"
    b = {"sources": [{"file": "x.ly"}]}
    rows[1]["target"] = "piece:unrelated"
    artifact.write_text(yaml.safe_dump(rows))
    with pytest.raises(CorrectionError):
        validate_source_evidence(b, artifact, parts=parts, corrections=[])
    rows[1]["target"] = None
    rows[0]["target"] = "piece:reassigned"
    artifact.write_text(yaml.safe_dump(rows))
    with pytest.raises(CorrectionError):
        validate_source_evidence(b, artifact, parts=parts, corrections=[])
