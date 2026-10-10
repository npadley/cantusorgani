"""Card A5a: the revision-bound review state machine."""

from __future__ import annotations

import ast
import dataclasses
from pathlib import Path

import pytest

from pipeline.typeset.mei import review as review_module
from pipeline.typeset.mei.diagnostics import Diagnostic
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    ReviewBlocked,
    ReviewDecision,
    SemanticDifference,
    ValidationReport,
)
from pipeline.typeset.mei.review import apply_review, approval_is_current, state_for

ARTIFACT = "a" * 64


def inputs() -> ConversionInputs:
    return ConversionInputs(
        source_sha256="s1", include_sha256="i1", lilypond_version="2.26.0", extractor_version="listen_full/1",
        converter_version="c1", profile_id="accompaniment-v1", profile_sha256="p1", schema_sha256="x1",
        verovio_version="6.3.0-425dd7b", font_digest="f1",
    )


def validation(*, schema_ok: bool = True, differences: tuple[SemanticDifference, ...] = ()) -> ValidationReport:
    return ValidationReport(
        schema_ok=schema_ok, schema_diagnostics=(), semantic_differences=differences,
        eligible=schema_ok and not differences, hashes={}, tool_versions={},
    )


def record(**patch: object) -> ConversionRecord:
    base = ConversionRecord(
        source_path="data/typeset/src/x.ly", target="movement:x", render_hash="r" * 32, state="needs-review",
        inputs=inputs(), artifact_sha256=ARTIFACT, diagnostics=(), validation=validation(), review=None,
    )
    return dataclasses.replace(base, **patch)


def decision(**patch: object) -> ReviewDecision:
    base = ReviewDecision(
        reviewer="Nick", timestamp="2026-10-10T00:00:00Z", inputs_digest=inputs().digest(),
        artifact_sha256=ARTIFACT, matrix_results={c.id: "pass" for c in REQUIRED_MATRIX},
        accepted_differences=(), decision="approve",
    )
    return dataclasses.replace(base, **patch)


def blocked_codes(rec: ConversionRecord, dec: ReviewDecision, current: ConversionInputs | None = None) -> tuple[str, ...]:
    with pytest.raises(ReviewBlocked) as info:
        apply_review(rec, dec, current or inputs())
    return info.value.codes


def diag(code: str) -> Diagnostic:
    return Diagnostic(code, "error", "x")  # type: ignore[arg-type]


# --- REQUIRED_MATRIX ----------------------------------------------------------------------------

CONTRACT_IDS = [
    "letter-p-orig", "letter-p-auto", "letter-l-orig", "a4-p-orig", "a4-l-auto", "a5-p-auto", "a5-l-orig",
    "letter-p-large-auto", "letter-p-small-cap2", "ipad11-p-auto", "ipad11-l-large-auto", "ipadmini-p-auto",
    "custom-160x230-auto",
]


def test_required_matrix_has_the_thirteen_contract_cases_in_order() -> None:
    assert [c.id for c in REQUIRED_MATRIX] == CONTRACT_IDS
    assert len({c.id for c in REQUIRED_MATRIX}) == 13


def test_required_matrix_fields_match_the_contract_table() -> None:
    by_id = {c.id: c for c in REQUIRED_MATRIX}
    assert (by_id["letter-p-small-cap2"].staff, by_id["letter-p-small-cap2"].max_systems) == ("small", 2)
    assert by_id["custom-160x230-auto"].page == "custom:160x230"
    assert by_id["ipad11-l-large-auto"].orientation == "landscape" and by_id["ipad11-l-large-auto"].staff == "large"
    assert by_id["a5-l-orig"].line_policy == "original" and by_id["a4-l-auto"].line_policy == "automatic"
    assert sum(1 for c in REQUIRED_MATRIX if c.max_systems is not None) == 1


# --- ConversionInputs.digest --------------------------------------------------------------------


def test_digest_is_stable_hex_sha256_of_all_fields() -> None:
    assert inputs().digest() == inputs().digest()
    assert len(inputs().digest()) == 64


def test_conversion_inputs_has_ten_fields() -> None:
    assert len(dataclasses.fields(ConversionInputs)) == 10


@pytest.mark.parametrize("field", [f.name for f in dataclasses.fields(ConversionInputs)])
def test_digest_changes_when_any_field_changes(field: str) -> None:
    changed = dataclasses.replace(inputs(), **{field: "changed"})
    assert changed.digest() != inputs().digest()


# --- apply_review: blocks -----------------------------------------------------------------------


def test_apply_review_unsupported_feature_raises_with_code() -> None:
    rec = record(diagnostics=(diag("UNSUPPORTED_FEATURE"),))
    with pytest.raises(ReviewBlocked, match="UNSUPPORTED_FEATURE"):
        apply_review(rec, decision(), inputs())


def test_apply_review_other_blocking_diagnostic_raises() -> None:
    assert "UNSAFE_BOUNDARY" in blocked_codes(record(diagnostics=(diag("UNSAFE_BOUNDARY"),)), decision())


def test_apply_review_missing_validation_raises_not_approved() -> None:
    assert "NOT_APPROVED" in blocked_codes(record(validation=None), decision())


def test_apply_review_failed_schema_raises() -> None:
    assert "SCHEMA_INVALID" in blocked_codes(record(validation=validation(schema_ok=False)), decision())


def test_apply_review_semantic_difference_raises_with_its_code() -> None:
    difference = SemanticDifference("PITCH_MISMATCH", "1.1", None, ("e1",), "x")
    assert "PITCH_MISMATCH" in blocked_codes(record(validation=validation(differences=(difference,))), decision())


def test_apply_review_missing_matrix_case_raises() -> None:
    results = {c.id: "pass" for c in REQUIRED_MATRIX[:-1]}
    assert blocked_codes(record(), decision(matrix_results=results)) == ("MATRIX_INCOMPLETE",)


def test_apply_review_failed_matrix_case_raises() -> None:
    results = {c.id: "pass" for c in REQUIRED_MATRIX} | {"a4-p-orig": "fail"}
    assert blocked_codes(record(), decision(matrix_results=results)) == ("MATRIX_INCOMPLETE",)


def test_apply_review_accepted_difference_without_explanation_raises() -> None:
    results = {c.id: "pass" for c in REQUIRED_MATRIX} | {"a4-p-orig": "accepted-difference"}
    assert blocked_codes(record(), decision(matrix_results=results)) == ("MATRIX_INCOMPLETE",)


def test_apply_review_accepted_difference_with_explanation_approves() -> None:
    results = {c.id: "pass" for c in REQUIRED_MATRIX} | {"a4-p-orig": "accepted-difference"}
    done = apply_review(record(), decision(matrix_results=results, accepted_differences=("maior bar not centred",)), inputs())
    assert done.state == "approved"


def test_apply_review_decision_for_other_inputs_is_stale() -> None:
    other = dataclasses.replace(inputs(), include_sha256="i2")
    assert blocked_codes(record(), decision(inputs_digest=other.digest())) == ("STALE_APPROVAL",)


def test_apply_review_current_inputs_changed_since_the_decision_is_stale() -> None:
    other = dataclasses.replace(inputs(), font_digest="f2")
    assert blocked_codes(record(), decision(), other) == ("STALE_APPROVAL",)


def test_apply_review_changed_artifact_rejects_the_old_decision() -> None:
    assert blocked_codes(record(artifact_sha256="b" * 64), decision()) == ("HASH_MISMATCH",)


def test_apply_review_record_without_artifact_raises_hash_mismatch() -> None:
    assert "HASH_MISMATCH" in blocked_codes(record(artifact_sha256=None), decision())


def test_apply_review_reports_every_block_at_once() -> None:
    codes = blocked_codes(record(validation=None, artifact_sha256="b" * 64), decision(matrix_results={}))
    assert set(codes) == {"HASH_MISMATCH", "NOT_APPROVED", "MATRIX_INCOMPLETE"}


# --- apply_review: outcomes -----------------------------------------------------------------------


def test_apply_review_valid_approve_gives_approved_and_stores_the_decision() -> None:
    dec = decision()
    done = apply_review(record(), dec, inputs())
    assert (done.state, done.review) == ("approved", dec)
    assert approval_is_current(done, inputs())


def test_apply_review_reject_gives_failed_with_the_decision_stored() -> None:
    dec = decision(decision="reject", matrix_results={})
    done = apply_review(record(), dec, inputs())
    assert (done.state, done.review) == ("failed", dec)
    assert not approval_is_current(done, inputs())


def test_apply_review_reject_of_unsupported_record_is_allowed() -> None:
    done = apply_review(record(diagnostics=(diag("UNSUPPORTED_FEATURE"),)), decision(decision="reject"), inputs())
    assert done.state == "failed"


def test_apply_review_reject_with_stale_inputs_still_raises() -> None:
    other = dataclasses.replace(inputs(), source_sha256="s2")
    assert blocked_codes(record(), decision(decision="reject", inputs_digest=other.digest())) == ("STALE_APPROVAL",)


def test_apply_review_does_not_mutate_the_original_record() -> None:
    rec = record()
    apply_review(rec, decision(), inputs())
    assert rec.state == "needs-review" and rec.review is None


# --- approval_is_current ----------------------------------------------------------------------------


@pytest.mark.parametrize("field", [f.name for f in dataclasses.fields(ConversionInputs)])
def test_approval_is_current_false_when_any_input_field_changes(field: str) -> None:
    approved = apply_review(record(), decision(), inputs())
    assert approval_is_current(approved, inputs())
    assert not approval_is_current(approved, dataclasses.replace(inputs(), **{field: "changed"}))


def test_approval_is_current_false_for_unapproved_state() -> None:
    assert not approval_is_current(record(), inputs())


def test_approval_is_current_false_when_the_stored_digest_does_not_match() -> None:
    approved = apply_review(record(), decision(), inputs())
    forged = dataclasses.replace(approved, review=dataclasses.replace(approved.review, inputs_digest="0" * 64))
    assert not approval_is_current(forged, inputs())


# --- state_for -----------------------------------------------------------------------------------------


def test_state_for_unsupported_feature_is_unsupported() -> None:
    assert state_for(record(diagnostics=(diag("UNSUPPORTED_FEATURE"),))) == "unsupported"


@pytest.mark.parametrize(
    "patch",
    [
        {"validation": validation(schema_ok=False)},
        {"validation": validation(differences=(SemanticDifference("ONSET_MISMATCH", None, None, (), "x"),))},
        {"validation": None},
        {"diagnostics": (diag("COMPILE_FAILED"),)},
    ],
)
def test_state_for_failed_validation_or_blocking_diagnostic_is_failed(patch: dict[str, object]) -> None:
    assert state_for(record(**patch)) == "failed"


def test_state_for_clean_record_needs_review() -> None:
    assert state_for(record()) == "needs-review"


def test_state_for_unsupported_wins_over_failed_schema() -> None:
    rec = record(diagnostics=(diag("UNSUPPORTED_FEATURE"),), validation=validation(schema_ok=False))
    assert state_for(rec) == "unsupported"


# --- isolation ---------------------------------------------------------------------------------------------


def test_review_module_imports_nothing_from_proofreading_or_corrections() -> None:
    tree = ast.parse(Path(review_module.__file__).read_text(encoding="utf-8"))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            imported.append(node.module or "")
    assert imported
    forbidden = ("proofread", "correction", "review_queue", "queue")
    assert not [m for m in imported if any(word in m for word in forbidden)]
    assert all(m.startswith(("pipeline.typeset.mei", "__future__", "dataclasses")) for m in imported)
