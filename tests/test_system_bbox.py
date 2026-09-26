"""Task 11: system boxes must capture the Latin text line and the mode number."""

import pytest

from pipeline.segment import TEXT_HEADROOM, BBox, System, to_bboxes


def test_box_extends_above_first_staff_for_text() -> None:
    systems = [System(top=400, bottom=520, staff_count=2)]
    boxes = to_bboxes(systems, page_height=3400, page_width=2540)
    assert boxes[0].top < 400, "must include the Latin text line above the staff"
    assert boxes[0].left == 0, "must include mode numbers printed left of the system"
    assert boxes[0].right == 2540


def test_boxes_never_overlap() -> None:
    systems = [System(400, 520, 2), System(760, 880, 2)]
    boxes = to_bboxes(systems, page_height=3400, page_width=2540)
    assert boxes[0].bottom <= boxes[1].top


def test_box_reserves_the_measured_headroom_for_real_geometry() -> None:
    """Real systems are 224-270px tall and the text needs up to 0.502 of that."""
    systems = [System(600, 852, 2), System(1064, 1316, 2)]
    boxes = to_bboxes(systems, page_height=3490, page_width=2540)
    assert 600 - boxes[0].top >= int(252 * 0.502), "crops the worst observed text block"
    assert boxes[0].bottom <= 1064 - int(252 * TEXT_HEADROOM), (
        "must stop above the next system's text, not above its staff"
    )


def test_first_box_is_clamped_to_the_page() -> None:
    boxes = to_bboxes([System(40, 292, 2)], page_height=3490, page_width=2540)
    assert boxes[0].top == 0


def test_systems_too_close_are_an_error_not_a_bad_crop() -> None:
    with pytest.raises(ValueError, match="no clean cut"):
        to_bboxes([System(400, 520, 2), System(530, 650, 2)], 3400, 2540)


def test_no_systems_means_no_boxes() -> None:
    assert to_bboxes([], 3400, 2540) == []


def test_bbox_is_hashable_and_frozen() -> None:
    box = BBox(0, 1, 2, 3)
    assert hash(box) == hash(BBox(0, 1, 2, 3))


def test_to_bboxes_tightly_set_page_splits_the_gap():
    """NOH8 p. 130: systems so close that the text headroom of the next would
    cut above this system's own staff. The gap is split instead."""
    from pipeline.segment import System, to_bboxes
    systems = [System(469, 710, 2), System(836, 1100, 2)]
    boxes = to_bboxes(systems, page_height=3300, page_width=2500)
    assert boxes[0].bottom > 710                      # this system's tail kept
    assert boxes[0].bottom <= 710 + int((836 - 710) * 0.4)
    assert boxes[1].top >= boxes[0].bottom            # no overlap
