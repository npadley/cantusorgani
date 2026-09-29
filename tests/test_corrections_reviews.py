"""`reviewed` corrections: an editor found a part or a review-queue item right.

A review changes no data. Its `was` is what was confirmed; when that changes the
review lapses (the item comes back to the admin screen) instead of stopping the
build as a stale correction would."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from pipeline import corrections
from pipeline.corrections import (
    CorrectionError,
    apply,
    correct_batch,
    hold_reasons,
    load,
    problems,
    review,
    reviews,
)
from pipeline.reviewkeys import with_keys
from tests.test_corrections import proper

DAY = date(2026, 9, 28)
ITEM = {"volume": "noh1", "piece": "dominica-ii", "kind": "part_by_order", "part": "gradual", "variant": "",
        "best_system": 2, "ref": "noh1/0034/002", "score": 0.55}


@pytest.fixture
def data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """A catalogue with one Proper, a review queue with one item, no corrections."""
    base, queue = tmp_path / "catalog.base.json", tmp_path / "review-queue.json"
    base.write_text(json.dumps(proper()))
    queue.write_text(json.dumps(with_keys([ITEM])))
    monkeypatch.setattr(corrections, "REVIEW_QUEUE", queue)
    return {"base": base, "queue": queue, "path": tmp_path / "corrections.yml"}


def key(data: dict[str, Path]) -> str:
    return json.loads(data["queue"].read_text())[0]["key"]


def fingerprint(data: dict[str, Path]) -> str:
    return json.loads(data["queue"].read_text())[0]["fingerprint"]


def requeue(data: dict[str, Path], item: dict) -> None:
    data["queue"].write_text(json.dumps(with_keys([item])))


def test_review_item_records_its_fingerprint_and_changes_no_data(data):
    entry, replaced = review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    assert (entry.field, entry.value, entry.was, replaced) == ("reviewed", "yes", fingerprint(data), False)
    assert apply(proper(), load(data["path"])) == apply(proper(), [])


def test_review_part_confirms_its_start_and_length(data):
    entry, _ = review("part:dominica-ii/gradual", today=DAY, base_path=data["base"], path=data["path"])
    # The gradual starts on system 3 and runs until the communion starts on 5.
    assert entry.was == "start 3, 2 systems"
    last, _ = review("part:dominica-ii/communion:2", today=DAY, base_path=data["base"], path=data["path"])
    assert last.was == "start 5, 1 systems"


def test_review_twice_keeps_one_entry(data):
    first, _ = review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    again, replaced = review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    assert replaced and again.id == first.id
    assert len(load(data["path"])) == 1


def test_review_refuses_what_the_editor_did_not_see(data):
    with pytest.raises(CorrectionError, match="has changed since it was shown"):
        review(key(data), seen="0" * 12, base_path=data["base"], path=data["path"])
    assert not data["path"].exists()


@pytest.mark.parametrize(("target", "message"), [
    ("review:noh1/part_by_order/ffffffff", "no longer in the review queue"),
    ("review:NOH1/x", "not of the form"),
    ("part:dominica-ii/offertory", "printed in another volume"),
    ("piece:dominica-ii", "cannot be marked reviewed"),
])
def test_review_bad_target_names_the_problem(data, target, message):
    with pytest.raises(CorrectionError, match=message):
        review(target, base_path=data["base"], path=data["path"])


def test_review_value_must_be_yes(data):
    with pytest.raises(CorrectionError, match="reviewed is yes"):
        review(key(data), value="maybe", base_path=data["base"], path=data["path"])


def test_reviews_lapse_when_the_item_changes_and_never_stop_the_build(data):
    review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    review("part:dominica-ii/gradual", today=DAY, base_path=data["base"], path=data["path"])
    entries = load(data["path"])
    current, lapsed = reviews(apply(proper(), entries), entries)
    assert [e.target for e in current] == [key(data), "part:dominica-ii/gradual"] and lapsed == []
    # A rebuild finds something new about the item, and the Communion moves.
    requeue(data, {**ITEM, "best_system": 3, "score": 0.6})
    moved = proper()
    moved["pieces"][2]["sections"][3].update(system=3, ref="noh1/0034/003")
    current, lapsed = reviews(apply(moved, entries), entries)
    assert current == [] and {e.target for e in lapsed} == {key(data), "part:dominica-ii/gradual"}
    assert problems(moved, entries) == []


def test_reviews_lapse_when_the_item_leaves_the_queue(data):
    review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    data["queue"].write_text("[]")
    entries = load(data["path"])
    assert reviews(apply(proper(), entries), entries)[1][0].target.startswith("review:")
    assert problems(proper(), entries) == []


def test_review_after_a_lapse_confirms_the_new_value(data):
    first, _ = review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    requeue(data, {**ITEM, "score": 0.9})
    again, replaced = review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    assert replaced and again.id == first.id and again.was == fingerprint(data) != first.was


def test_reviewed_text_lists_only_what_still_holds(data):
    review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    entries = load(data["path"])
    text = corrections.reviewed_text(reviews(apply(proper(), entries), entries)[0])
    assert json.loads(text) == {"schema_version": 1,
                                "reviewed": {key(data): {"was": fingerprint(data), "date": "2026-09-28"}}}


def test_log_text_leaves_reviews_out_of_the_public_log(data):
    review(key(data), today=DAY, base_path=data["base"], path=data["path"])
    assert json.loads(corrections.log_text(load(data["path"])))["corrections"] == []


def test_correct_batch_records_reviews_with_what_the_editor_saw(data):
    done = correct_batch({"batch": "b-20260928-abc123", "entries": [
        {"target": key(data), "field": "reviewed", "value": "yes", "seen": fingerprint(data),
         "editor_email": "ed@example.org"},
        {"target": "part:dominica-ii/gradual", "field": "reviewed", "value": "yes", "seen": "start 3, 2 systems"},
    ]}, today=DAY, base_path=data["base"], path=data["path"])
    assert [e.field for e in done] == ["reviewed", "reviewed"]
    assert done[0].editor_email == "ed@example.org"


def test_correct_batch_changed_since_seen_records_nothing(data):
    with pytest.raises(CorrectionError, match="nothing was recorded") as err:
        correct_batch({"batch": "b-20260928-abc123", "entries": [
            {"target": "part:dominica-ii/gradual", "field": "reviewed", "value": "yes", "seen": "start 2, 3 systems"},
        ]}, today=DAY, base_path=data["base"], path=data["path"])
    assert "has changed since it was shown" in str(err.value)
    assert not data["path"].exists()


def test_correct_batch_seen_must_be_short_text(data):
    with pytest.raises(CorrectionError, match="seen must be text"):
        correct_batch({"batch": "b-20260928-abc123", "entries": [
            {"target": key(data), "field": "reviewed", "value": "yes", "seen": ["x"]}]},
            base_path=data["base"], path=data["path"])


def test_hold_reasons_reviews_do_not_make_a_batch_large():
    reviewed = [corrections.Entry(id=f"c-{n:04d}", target=f"review:noh1/unpaired/{n:08x}", field="reviewed",
                                  was="x", value="yes") for n in range(40)]
    assert hold_reasons(reviewed) == []
