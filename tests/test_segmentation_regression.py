"""Task 12: the segmentation gate.

Every one of the twelve NOH5 fixture pages is hand-labelled in
`tests/fixtures/noh5-systems.json` and checked here. Do not loosen this suite to
make it pass; tune detection, or send the page to review.

These tests rasterise the source PDF, so they carry both `source` and `slow`.
CI runs `-m "not source"` and skips them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.evaluate import analyse_page, count_systems

FIXTURE_FILE = Path(__file__).parent / "fixtures" / "noh5-systems.json"
FIXTURES: dict[str, dict[str, object]] = json.loads(FIXTURE_FILE.read_text(encoding="utf-8"))
CASES = sorted((int(k), int(v["systems"])) for k, v in FIXTURES.items())  # type: ignore[arg-type]


def test_every_fixture_page_is_hand_labelled() -> None:
    """An unlabelled page is silently outside the gate."""
    expected = {1, 47, 51, 57, 144, 170, 185, 198, 209, 226, 229, 231}
    assert {int(k) for k in FIXTURES} == expected
    assert all(str(v["note"]).strip() for v in FIXTURES.values())


@pytest.mark.source
@pytest.mark.slow
@pytest.mark.parametrize("page,expected", CASES)
def test_system_count_matches_hand_label(page: int, expected: int) -> None:
    assert count_systems("noh5", page) == expected


@pytest.mark.source
@pytest.mark.slow
@pytest.mark.parametrize("page,expected", [c for c in CASES if c[1]])
def test_every_box_reaches_above_its_staff_and_stays_on_page(page: int, expected: int) -> None:
    """Task 11's whole point: a box on staff lines alone crops the Latin text off."""
    result = analyse_page("noh5", page)
    assert result.error is None
    assert len(result.boxes) == expected
    for system, box in zip(result.systems, result.boxes, strict=True):
        assert box.top < system.top, "box must open above the staff for the text line"
        assert box.left == 0, "box must include the mode number printed left of the staff"
        assert box.bottom > system.bottom
        assert 0 <= box.top < box.bottom <= result.page_height
