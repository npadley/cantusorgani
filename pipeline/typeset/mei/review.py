"""Revision-bound review approval for MEI conversions (card A5a).

Pure state logic over ``ConversionRecord``: no I/O, no rendering, and nothing here reads or
writes proofreading or correction data. An approval is valid only for the exact inputs it was
made against (``ConversionInputs.digest``) and the exact artifact it saw.
"""

from __future__ import annotations

import dataclasses
import datetime
import re

from pipeline.typeset.mei.diagnostics import BLOCKING
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    CarriedFrom,
    ConversionInputs,
    ConversionRecord,
    ConversionState,
    ReviewBlocked,
    ReviewDecision,
)

__all__ = [
    "EvidenceComparison",
    "ReviewBlocked",
    "apply_review",
    "approval_is_current",
    "carry_forward",
    "changed_input_fields",
    "state_for",
]


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


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _carried_from_is_valid(carried: CarriedFrom, inputs: ConversionInputs) -> bool:
    return (
        carried.attributed_to == "ci"
        and bool(_SHA256.match(carried.prior_artifact_sha256))
        and bool(_SHA256.match(carried.prior_inputs_digest))
        and carried.prior_inputs_digest != inputs.digest()
        and bool(carried.reason)
        and bool(carried.timestamp)
    )


def approval_is_current(record: ConversionRecord, inputs: ConversionInputs) -> bool:
    """True only for an approved record whose inputs, and whose decision's digest, match ``inputs``.

    A carried-forward approval (``carried_from``) must also carry a well-formed, CI-attributed block."""
    return (
        record.state == "approved"
        and record.review is not None
        and record.inputs == inputs
        and record.review.inputs_digest == inputs.digest()
        and (record.carried_from is None or _carried_from_is_valid(record.carried_from, inputs))
    )


# --- carry-forward (D20) -------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class EvidenceComparison:
    """What ``carry.compare_conversions`` found when comparing a re-conversion with the approved one.

    ``semantic_equal``: the normalized semantic output (``normalize.py``) of the two artifacts is equal.
    ``cases_compared`` / ``cases_differing``: Contracts section 3 render case ids whose SVG pages were
    compared (after id normalization) and those that differed."""

    semantic_equal: bool
    cases_compared: tuple[str, ...]
    cases_differing: tuple[str, ...]

    @property
    def identical(self) -> bool:
        required = {case.id for case in REQUIRED_MATRIX}
        return self.semantic_equal and not self.cases_differing and required <= set(self.cases_compared)


def changed_input_fields(prior: ConversionInputs, new: ConversionInputs) -> tuple[str, ...]:
    """Names of the ConversionInputs fields whose values differ, sorted."""
    return tuple(
        sorted(f.name for f in dataclasses.fields(ConversionInputs) if getattr(prior, f.name) != getattr(new, f.name))
    )


def carry_forward(
    prior: ConversionRecord, new: ConversionRecord, evidence_equal: EvidenceComparison, now: str | None = None
) -> ConversionRecord:
    """The ``new`` record approved on ``prior``'s approval, or ``new`` unchanged (needs-review).

    Carried only when ``prior`` is a human-approved (``approve``) record, ``new`` is a clean
    ``needs-review`` conversion of the same ``source_path``, ``target`` and ``profile_id``, and the
    evidence is identical: equal normalized semantics and every Contracts section 3 render case
    identical after id normalization. The carried review keeps the human reviewer, timestamp, matrix
    results and accepted differences but is rebound to ``new``'s inputs digest and artifact."""
    review = prior.review
    if (
        prior.state != "approved"
        or review is None
        or review.decision != "approve"
        or new.state != "needs-review"
        or new.artifact_sha256 is None
        or prior.artifact_sha256 is None
        or prior.source_path != new.source_path
        or prior.target != new.target
        or prior.inputs.profile_id != new.inputs.profile_id
        or not evidence_equal.identical
    ):
        return new
    stamp = now or datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    carried_review = dataclasses.replace(
        review, inputs_digest=new.inputs.digest(), artifact_sha256=new.artifact_sha256
    )
    return dataclasses.replace(
        new,
        state="approved",
        review=carried_review,
        carried_from=CarriedFrom(
            prior_artifact_sha256=prior.artifact_sha256,
            prior_inputs_digest=prior.inputs.digest(),
            reason=changed_input_fields(prior.inputs, new.inputs),
            timestamp=stamp,
            attributed_to="ci",
        ),
    )
