"""Every chant named for Good Friday is published and free of copyright flags."""

from __future__ import annotations

import json

import pytest

from pipeline.chants import CHANTS, good_friday_ids
from pipeline.gregobase import DUMP, load_chant_rows


def _assert_chants_publishable(ids: set[int], copyrighted: dict[int, bool]) -> None:
    missing = sorted(ids - copyrighted.keys())
    assert not missing, f"Missing GregoBase chant ids: {missing}"
    flagged = sorted(cid for cid in ids if copyrighted[cid] is not False)
    assert not flagged, f"Copyrighted GregoBase chant ids: {flagged}"


def test_good_friday_chants_all_referenced_ids_present_in_published_data():
    ids = good_friday_ids()
    assert ids, "Good Friday must name at least one chant"
    chants = json.loads(CHANTS.read_text(encoding="utf-8"))["chants"]
    missing = sorted(cid for cid in ids if str(cid) not in chants)
    assert not missing, f"Good Friday chant ids missing from chants.json: {missing}"


@pytest.mark.skipif(not DUMP.exists(), reason="GregoBase dump not vendored")
def test_good_friday_chants_all_referenced_ids_not_copyrighted():
    ids = good_friday_ids()
    assert ids, "Good Friday must name at least one chant"
    copyrighted = {chant.id: flag for chant, flag in load_chant_rows()}
    _assert_chants_publishable(ids, copyrighted)


@pytest.mark.parametrize(
    ("copyrighted", "message"),
    [
        ({602: False}, r"Missing GregoBase chant ids: \[157\]"),
        ({602: False, 157: True}, r"Copyrighted GregoBase chant ids: \[157\]"),
    ],
    ids=["missing-id", "copyrighted-id"],
)
def test_good_friday_chants_invalid_reference_check_fails(copyrighted, message):
    with pytest.raises(AssertionError, match=message):
        _assert_chants_publishable({602, 157}, copyrighted)
