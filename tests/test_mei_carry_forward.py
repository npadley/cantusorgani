"""Card C5 / D20: carrying an approval forward when nothing visible changed."""

from __future__ import annotations

import dataclasses
import json

import pytest

from pipeline.typeset.mei.manifest import record_from_dict, record_to_dict
from pipeline.typeset.mei.model import REQUIRED_MATRIX, CarriedFrom, ConversionRecord
from pipeline.typeset.mei.review import (
    EvidenceComparison,
    approval_is_current,
    carry_forward,
    state_for,
)
from tests.test_mei_publish import INPUTS, MEI, make_record, sha

NOW = "2026-10-12T01:02:03Z"
ALL_CASES = tuple(c.id for c in REQUIRED_MATRIX)
EQUAL = EvidenceComparison(semantic_equal=True, cases_compared=ALL_CASES, cases_differing=())


def prior_record() -> ConversionRecord:
    return make_record(sha(MEI))


def new_record(prior: ConversionRecord, **inputs: str) -> ConversionRecord:
    """A fresh, unreviewed conversion whose inputs differ from the prior's."""
    changed = dataclasses.replace(prior.inputs, **(inputs or {"include_sha256": "i2"}))
    fresh = dataclasses.replace(prior, inputs=changed, state="needs-review", review=None)
    return dataclasses.replace(fresh, state=state_for(fresh))


def test_carry_forward_equal_evidence_approves_with_carried_from() -> None:
    prior = prior_record()
    new = new_record(prior)
    carried = carry_forward(prior, new, EQUAL, now=NOW)
    assert carried.state == "approved"
    assert carried.review is not None and prior.review is not None
    assert carried.review.inputs_digest == new.inputs.digest()
    assert carried.review.artifact_sha256 == new.artifact_sha256
    assert carried.review.reviewer == prior.review.reviewer and carried.review.timestamp == prior.review.timestamp
    assert carried.review.matrix_results == prior.review.matrix_results
    assert carried.carried_from == CarriedFrom(
        prior_artifact_sha256=prior.artifact_sha256 or "", prior_inputs_digest=prior.inputs.digest(),
        reason=("include_sha256",), timestamp=NOW, attributed_to="ci",
    )
    assert approval_is_current(carried, new.inputs)


def test_carry_forward_reason_lists_every_changed_input_field_sorted() -> None:
    prior = prior_record()
    new = new_record(prior, source_sha256="s2", converter_version="c2")
    carried = carry_forward(prior, new, EQUAL, now=NOW)
    assert carried.carried_from is not None
    assert carried.carried_from.reason == ("converter_version", "source_sha256")


def test_carry_forward_semantic_difference_stays_needs_review() -> None:
    prior = prior_record()
    new = new_record(prior)
    unequal = dataclasses.replace(EQUAL, semantic_equal=False)
    assert carry_forward(prior, new, unequal, now=NOW) == new


def test_carry_forward_one_render_case_differs_stays_needs_review() -> None:
    prior = prior_record()
    new = new_record(prior)
    differing = dataclasses.replace(EQUAL, cases_differing=("a4-l-auto",))
    assert carry_forward(prior, new, differing, now=NOW) == new


def test_carry_forward_missing_render_case_stays_needs_review() -> None:
    prior = prior_record()
    new = new_record(prior)
    partial = dataclasses.replace(EQUAL, cases_compared=ALL_CASES[:-1])
    assert carry_forward(prior, new, partial, now=NOW) == new


@pytest.mark.parametrize(
    "patch",
    [{"target": "movement:other"}, {"source_path": "data/typeset/src/other.ly"}],
)
def test_carry_forward_changed_target_or_source_path_stays_needs_review(patch: dict[str, str]) -> None:
    prior = prior_record()
    new = dataclasses.replace(new_record(prior), **patch)
    assert carry_forward(prior, new, EQUAL, now=NOW).state == "needs-review"


def test_carry_forward_changed_profile_stays_needs_review() -> None:
    prior = prior_record()
    new = new_record(prior, profile_id="accompaniment-v2")
    assert carry_forward(prior, new, EQUAL, now=NOW).state == "needs-review"


def test_carry_forward_unapproved_prior_stays_needs_review() -> None:
    prior = dataclasses.replace(prior_record(), state="needs-review", review=None)
    new = new_record(prior)
    assert carry_forward(prior, new, EQUAL, now=NOW) == new


def test_carry_forward_failed_new_record_is_left_failed() -> None:
    prior = prior_record()
    failed = dataclasses.replace(new_record(prior), state="failed")
    assert carry_forward(prior, failed, EQUAL, now=NOW) == failed


def test_carry_forward_rejected_prior_review_stays_needs_review() -> None:
    prior = prior_record()
    assert prior.review is not None
    rejected = dataclasses.replace(prior, review=dataclasses.replace(prior.review, decision="reject"))
    new = new_record(prior)
    assert carry_forward(rejected, new, EQUAL, now=NOW) == new


def test_record_round_trip_keeps_carried_from_and_old_records_still_load() -> None:
    prior = prior_record()
    carried = carry_forward(prior, new_record(prior), EQUAL, now=NOW)
    again = record_from_dict(json.loads(json.dumps(record_to_dict(carried))))
    assert again == carried
    old = record_to_dict(prior)
    assert "carried_from" not in old
    assert record_from_dict(old).carried_from is None


def test_approval_is_current_malformed_carried_from_is_not_current() -> None:
    prior = prior_record()
    carried = carry_forward(prior, new_record(prior), EQUAL, now=NOW)
    assert carried.carried_from is not None
    for bad in (
        dataclasses.replace(carried.carried_from, attributed_to="human"),
        dataclasses.replace(carried.carried_from, prior_artifact_sha256="short"),
        dataclasses.replace(carried.carried_from, reason=()),
        dataclasses.replace(carried.carried_from, prior_inputs_digest=carried.inputs.digest()),
    ):
        assert not approval_is_current(dataclasses.replace(carried, carried_from=bad), carried.inputs)


def test_evidence_comparison_identical_requires_all_cases_and_no_differences() -> None:
    assert EQUAL.identical
    assert not dataclasses.replace(EQUAL, semantic_equal=False).identical
    assert not dataclasses.replace(EQUAL, cases_differing=("x",)).identical
    assert not dataclasses.replace(EQUAL, cases_compared=()).identical
    _ = INPUTS  # the shared fixture inputs are what make_record signs
