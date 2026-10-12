"""Card A7 (D22): automatic approval, revocation, and the batch's --auto-approve."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest

from pipeline.typeset.mei.batch import run_batch
from pipeline.typeset.mei.diagnostics import Diagnostic
from pipeline.typeset.mei.manifest import build_manifest_report, record_from_dict, record_to_dict
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionProfile,
    ConversionRecord,
    SemanticDifference,
    ValidationReport,
)
from pipeline.typeset.mei.review import (
    AUTO_REVIEWER,
    EvidenceComparison,
    approval_is_current,
    auto_approve,
    carry_forward,
    revoke,
)

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ConversionProfile.load(ROOT / "data/typeset/mei/profiles/accompaniment-v1.json")
ARTIFACT = "a" * 64
CASES = [c.id for c in REQUIRED_MATRIX]
NOW = "2026-10-11T12:00:00Z"


def inputs(**patch: str) -> ConversionInputs:
    base = ConversionInputs("s1", "i1", "2.26.0", "e1", "c1", "accompaniment-v1", "p1", "x1", "6.3.0", "f1")
    return dataclasses.replace(base, **patch)


def record(**patch: object) -> ConversionRecord:
    base = ConversionRecord(
        source_path="data/typeset/src/x.ly", target="movement:x", render_hash="r" * 32, state="needs-review",
        inputs=inputs(), artifact_sha256=ARTIFACT, diagnostics=(),
        validation=ValidationReport(True, (), (), True, {"mei": ARTIFACT}, {"comparer": "cmp/1", "normalizer": "norm/1"}),
        review=None,
    )
    return dataclasses.replace(base, **patch)


def precheck(**findings: list[str]) -> dict[str, list[str]]:
    report: dict[str, list[str]] = {"piece": [], **{c: [] for c in CASES}}
    report.update(findings)
    return report


def evidence(**overrides: dict) -> dict:
    cases = {c: {"id": c, "pageCount": 1, "diagnostics": []} for c in CASES}
    cases.update(overrides)
    return {"cases": list(cases.values())}


def judge(rec: ConversionRecord | None = None, pre: dict | None = None, ev: dict | None = None) -> ConversionRecord:
    return auto_approve(rec or record(), pre if pre is not None else precheck(), ev if ev is not None else evidence(),
                        profile_version=2, now=NOW)


def test_auto_approve_clean_piece_is_approved_by_the_auto_reviewer_and_current() -> None:
    result = judge()
    assert result.state == "approved" and result.review is not None
    assert result.review.reviewer == AUTO_REVIEWER == "auto (D22)"
    assert result.review.inputs_digest == inputs().digest() and result.review.artifact_sha256 == ARTIFACT
    assert set(result.review.matrix_results) == set(CASES)
    assert result.auto_review is not None and result.auto_review.criteria_failed == ()
    assert (result.auto_review.profile_version, result.auto_review.oracle_version) == (2, "cmp/1+norm/1")
    assert result.auto_review.precheck_version.startswith("precheck/")
    assert approval_is_current(result, inputs())


@pytest.mark.parametrize(
    ("name", "rec", "pre", "ev"),
    [
        ("unsupported", record(diagnostics=(Diagnostic("UNSUPPORTED_FEATURE", "error", "x"),)), None, None),
        ("unsupported", record(diagnostics=(Diagnostic("UNKNOWN_FEATURE", "warning", "ordinary glissando"),)), None, None),
        ("schema", record(validation=ValidationReport(False, (), (), False, {}, {})), None, None),
        ("oracle", record(validation=ValidationReport(
            True, (), (SemanticDifference("PITCH_MISMATCH", "1.1", None, ("e1",), "x"),), False, {}, {})), None, None),
        ("layout", None, None, evidence(**{"a4-p-orig": {"id": "a4-p-orig", "pageCount": 0,
                                                         "diagnostics": [{"severity": "error", "code": "UNSATISFIABLE_LAYOUT"}]}})),
        ("layout", None, None, {"cases": evidence()["cases"][:12]}),  # a case that was never laid out
        ("precheck", None, precheck(**{"letter-p-orig": ["tie tev1: no piece ends on the head of ev2"]}), None),
        ("precheck", None, precheck(piece=["head type: 1e0001 is dur=4"]), None),
        ("precheck", None, {k: v for k, v in precheck().items() if k != "a5-l-orig"}, None),  # a case the precheck skipped
    ],
)
def test_auto_approve_each_criterion_failing_alone_blocks_approval_and_is_listed(name, rec, pre, ev) -> None:
    result = judge(rec, pre, ev)
    assert result.state == "needs-review" and result.review is None
    assert result.auto_review is not None and name in result.auto_review.criteria_failed


def test_auto_approve_precheck_info_lines_do_not_block_but_notes_do() -> None:
    info = precheck(**{"a4-p-orig": ["info: 2 extra syllable piece(s) drawn at system breaks"]})
    assert judge(pre=info).state == "approved"
    note = precheck(**{"a4-p-orig": ["note: 1 automatic system(s) start in the middle of a word"]})
    assert judge(pre=note).state == "needs-review"


def test_auto_approve_never_overrides_a_failed_or_unsupported_record() -> None:
    failed = record(state="failed")
    assert judge(failed).state == "failed"


def test_revoked_record_is_not_current_and_the_manifest_excludes_it() -> None:
    approved = judge()
    revoked = revoke(approved, "wrong accidental in bar 12", now=NOW)
    assert revoked.state == "revoked" and not approval_is_current(revoked, inputs())
    manifest, excluded = build_manifest_report([revoked], [{"target": "movement:x", "file": "x.ly", "hash": "r" * 32}],
                                              Path("/nonexistent"), lambda r: r.inputs)
    assert manifest.parts == () and excluded[revoked.source_path] == "state is revoked"


def test_auto_approved_record_round_trips_through_json() -> None:
    result = judge()
    again = record_from_dict(json.loads(json.dumps(record_to_dict(result))))
    assert again == result and again.auto_review is not None
    revoked = revoke(result, "r", now=NOW)
    assert record_from_dict(json.loads(json.dumps(record_to_dict(revoked)))) == revoked


def test_carry_forward_works_on_an_auto_approved_record() -> None:
    prior = judge()
    new = record(inputs=inputs(converter_version="c2"), artifact_sha256="b" * 64)
    carried = carry_forward(prior, new, EvidenceComparison(True, tuple(CASES), ()), now=NOW)
    assert carried.state == "approved" and carried.carried_from is not None
    assert carried.review is not None and carried.review.reviewer == AUTO_REVIEWER
    assert approval_is_current(carried, new.inputs)


# --- the batch ---------------------------------------------------------------------------------------


def make_sources(tmp_path: Path, names: list[str]) -> list[Path]:
    paths = []
    for name in names:
        path = tmp_path / "src" / name
        path.parent.mkdir(exist_ok=True)
        path.write_text(f"\\relative c' {{ {name} }}\n", encoding="utf-8")
        paths.append(path)
    return paths


def batch(tmp_path: Path, sources: list[Path], dirty: set[str], **kw):
    def convert(source: Path, out: Path) -> None:
        out.mkdir(parents=True, exist_ok=True)
        (out / "score.mei").write_text(f"<mei>{source.name}</mei>", encoding="utf-8")
        (out / "diagnostics.json").write_text("[]", encoding="utf-8")

    def evidence_fn(convert_dir: Path, out: Path) -> None:
        out.mkdir(parents=True, exist_ok=True)
        (out / "index.html").write_text("<html/>", encoding="utf-8")

    def record_fn(convert_dir: Path, source: Path) -> ConversionRecord:
        return record(source_path=source.name, inputs=inputs(source_sha256=source.name))

    def precheck_fn(convert_dir: Path, source: Path) -> dict[str, list[str]]:
        return precheck(**({"piece": ["head type: bad"]} if source.name in dirty else {}))

    return run_batch(
        sources, PROFILE, tmp_path / "out", convert_fn=convert, evidence_fn=evidence_fn,
        inputs_fn=lambda s: inputs(source_sha256=s.name), auto_approve=True,
        record_fn=record_fn, precheck_fn=precheck_fn, cases_fn=lambda d: evidence(), **kw,
    )


def test_run_batch_auto_approve_writes_only_approved_records_into_the_output_records_dir(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["clean.ly", "dirty.ly"])
    report = batch(tmp_path, sources, {"dirty.ly"})
    assert report.results == {str(sources[0]): "approved", str(sources[1]): "needs-review"}
    assert report.counts == {"unsupported": 0, "failed": 0, "needs-review": 1, "approved": 1}
    written = sorted(p.name for p in (tmp_path / "out" / "records").glob("*.json"))
    assert written == ["clean.json"]
    data = json.loads((tmp_path / "out" / "records" / "clean.json").read_text(encoding="utf-8"))
    assert data["state"] == "approved" and data["review"]["reviewer"] == "auto (D22)"
    dirty = next(p for p in (tmp_path / "out").glob("*/record.json") if "dirty" in p.read_text(encoding="utf-8"))
    assert "precheck" in json.loads(dirty.read_text(encoding="utf-8"))["auto_review"]["criteria_failed"]


def test_run_batch_auto_approve_never_writes_into_the_repository_records_dir(tmp_path: Path) -> None:
    repo_records = ROOT / "data" / "typeset" / "mei" / "records"
    before = sorted(p.name for p in repo_records.glob("*.json"))
    batch(tmp_path, make_sources(tmp_path, ["clean.ly"]), set())
    assert sorted(p.name for p in repo_records.glob("*.json")) == before


def test_run_batch_auto_approve_resume_reuses_the_judged_record(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["clean.ly"])
    batch(tmp_path, sources, set())
    second = batch(tmp_path, sources, set())
    assert second.cached == (str(sources[0]),) and second.results[str(sources[0])] == "approved"
