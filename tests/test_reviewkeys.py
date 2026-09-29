"""Stable names for review-queue items: the key survives a rebuild that changes
only what the pipeline found; the fingerprint does not."""

import json
from pathlib import Path

from pipeline.reviewkeys import KEY, fingerprint, with_keys

QUEUE = Path("data/review-queue.json")


def by_order() -> dict:
    return {"volume": "noh1", "piece": "dominica-i-adventus", "kind": "part_by_order", "part": "alleluia",
            "variant": "", "expected_incipit": "alleluiaijvostendenobisd", "best_system": 16,
            "ref": "noh1/0032/000", "score": 0.553}


def unpaired_page(page: int) -> dict:
    return {"volume": "noh1", "piece": None, "kind": "segmentation_fallback", "pdf_page": page,
            "why": "9 staves is not a multiple of 2"}


def test_with_keys_same_item_gives_the_same_key_and_fingerprint():
    first, second = with_keys([by_order()])[0], with_keys([by_order()])[0]
    assert first["key"] == second["key"]
    assert first["fingerprint"] == second["fingerprint"]
    assert KEY.fullmatch(first["key"])
    assert first["key"].startswith("review:noh1/part_by_order/")


def test_with_keys_field_order_changes_nothing():
    reordered = dict(reversed(list(by_order().items())))
    assert with_keys([reordered])[0]["key"] == with_keys([by_order()])[0]["key"]
    assert with_keys([reordered])[0]["fingerprint"] == with_keys([by_order()])[0]["fingerprint"]


def test_with_keys_new_details_keep_the_key_but_change_the_fingerprint():
    moved = {**by_order(), "best_system": 17, "ref": "noh1/0032/001", "score": 0.61}
    old, new = with_keys([by_order()])[0], with_keys([moved])[0]
    assert new["key"] == old["key"]
    assert new["fingerprint"] != old["fingerprint"]


def test_with_keys_page_names_an_item_only_without_a_piece():
    a, b = with_keys([unpaired_page(96), unpaired_page(139)])
    assert a["key"] != b["key"]


def test_with_keys_uncertain_movement_is_named_by_its_system():
    item = {"volume": "noh5", "piece": "cantus-ad-libitum-kyrie-vi", "kind": "uncertain_movement",
            "movement": "kyrie", "score": 0.68, "ref": "noh5/0178/000"}
    a, b = with_keys([item, {**item, "ref": "noh5/0178/002"}])
    assert a["key"] != b["key"]
    assert not b["key"][-2:].startswith("-")


def test_with_keys_two_items_about_the_same_thing_get_a_suffix():
    a, b = with_keys([by_order(), {**by_order(), "score": 0.2}])
    assert b["key"] == f"{a['key']}-2"


def test_with_keys_recomputes_rather_than_trusting_old_keys():
    stale = {**by_order(), "key": "review:noh1/part_by_order/00000000", "fingerprint": "0" * 12}
    out = with_keys([stale])[0]
    assert out["key"] != stale["key"]
    assert out["fingerprint"] == fingerprint(by_order())


def test_committed_review_queue_keys_are_current_and_unique():
    queue = json.loads(QUEUE.read_text(encoding="utf-8"))
    assert queue == with_keys(queue), "data/review-queue.json keys are stale: re-run `uv run noh catalog`"
    keys = [item["key"] for item in queue]
    assert len(keys) == len(set(keys))
