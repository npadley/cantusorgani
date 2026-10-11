"""Revision-bound review approval for MEI conversions (card A5a).

Pure state logic over ``ConversionRecord``: no I/O, no rendering, and nothing here reads or
writes proofreading or correction data. An approval is valid only for the exact inputs it was
made against (``ConversionInputs.digest``) and the exact artifact it saw.
"""

from __future__ import annotations

import dataclasses

from pipeline.typeset.mei.diagnostics import BLOCKING
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    ConversionState,
    ReviewBlocked,
    ReviewDecision,
)

__all__ = ["ReviewBlocked", "apply_review", "approval_is_current", "state_for"]


def state_for(record: ConversionRecord) -> ConversionState:
    """State of a record that has no review yet.

    ``unsupported`` for any UNSUPPORTED_FEATURE; ``failed`` for any other blocking diagnostic,
    a missing validation, a failed schema or any semantic difference; otherwise ``needs-review``.
    """
    if any(d.code == "UNSUPPORTED_FEATURE" for d in record.diagnostics):
        return "unsupported"
    if any(d.code in BLOCKING for d in record.diagnostics):
        return "failed"
    validation = record.validation
    if validation is None or not validation.schema_ok or validation.semantic_differences:
        return "failed"
    return "needs-review"


def _content_blocks(record: ConversionRecord, decision: ReviewDecision) -> list[str]:
    codes: list[str] = []
    codes.extend(sorted({d.code for d in record.diagnostics if d.code in BLOCKING}))
    validation = record.validation
    if validation is None:
        codes.append("NOT_APPROVED")
    else:
        if not validation.schema_ok:
            codes.append("SCHEMA_INVALID")
        codes.extend(sorted({d.code for d in validation.semantic_differences}))
    results = decision.matrix_results
    missing = [case.id for case in REQUIRED_MATRIX if case.id not in results]
    failed = [case_id for case_id, result in results.items() if result == "fail"]
    unexplained = any(r == "accepted-difference" for r in results.values()) and not decision.accepted_differences
    if missing or failed or unexplained:
        codes.append("MATRIX_INCOMPLETE")
    return codes


def apply_review(
    record: ConversionRecord, decision: ReviewDecision, current: ConversionInputs
) -> ConversionRecord:
    """Record a reviewer's decision, or raise ReviewBlocked.

    A decision is bound to the record's own inputs, the current inputs and the artifact hash for
    both outcomes. Approving also needs no blocking diagnostic, a passing validation and every
    required matrix case passed (or accepted with a stated difference). Rejecting is allowed
    whatever the content and yields ``failed``.
    """
    codes: list[str] = []
    digest = decision.inputs_digest
    if digest != current.digest() or digest != record.inputs.digest():
        codes.append("STALE_APPROVAL")
    if record.artifact_sha256 is None or decision.artifact_sha256 != record.artifact_sha256:
        codes.append("HASH_MISMATCH")
    if decision.decision == "approve":
        codes.extend(_content_blocks(record, decision))
    if codes:
        unique = tuple(dict.fromkeys(codes))
        raise ReviewBlocked(unique, f"review blocked: {', '.join(unique)}")
    state: ConversionState = "approved" if decision.decision == "approve" else "failed"
    return dataclasses.replace(record, state=state, review=decision)


def approval_is_current(record: ConversionRecord, inputs: ConversionInputs) -> bool:
    """True only for an approved record whose inputs, and whose decision's digest, match ``inputs``."""
    return (
        record.state == "approved"
        and record.review is not None
        and record.inputs == inputs
        and record.review.inputs_digest == inputs.digest()
    )
