"""Task 9: staff-line detection."""

import numpy as np

from pipeline.segment import find_staff_lines


def _staff(spacing: int = 12, thickness: int = 2, x0: int = 200, x1: int = 1200) -> np.ndarray:
    img = np.full((600, 1400), 255, dtype=np.uint8)
    for i in range(5):
        y = 100 + i * spacing
        img[y:y + thickness, x0:x1] = 0
    return img


def test_finds_five_lines_of_a_synthetic_staff() -> None:
    lines = find_staff_lines(_staff())
    assert len(lines) == 5
    assert lines[0] < lines[-1]


def test_blank_page_has_no_staff_lines() -> None:
    assert find_staff_lines(np.full((600, 1400), 255, dtype=np.uint8)) == []


def test_short_horizontal_marks_are_not_staff_lines() -> None:
    """A rubric dash or a hyphen is far shorter than the page and must be ignored."""
    img = np.full((600, 1400), 255, dtype=np.uint8)
    for i in range(5):
        img[100 + i * 12: 102 + i * 12, 600:660] = 0
    assert find_staff_lines(img) == []


def test_indented_staff_is_still_found() -> None:
    """Short systems (e.g. `Deo gratias` on PDF 144) span far less than page width."""
    lines = find_staff_lines(_staff(x0=350, x1=900))
    assert len(lines) == 5


def test_merge_close_lines_joins_a_thick_line_read_twice() -> None:
    from pipeline.segment import merge_close_lines
    assert merge_close_lines([100, 104, 118, 136, 139, 154]) == [102, 118, 137, 154]


def test_tolerant_grouping_ignores_strays_and_a_missing_line() -> None:
    """Faint print (NOH3's addenda): a beam read as a line inside a staff, and a
    staff with a line lost, both still give their staff at the page's spacing."""
    from pipeline.segment import group_staves, group_staves_tolerant
    clean = [100, 118, 136, 154, 172]
    stray = [300, 318, 327, 336, 354, 372]                 # 327: a beam
    missing = [500, 518, 554, 572]                         # 536 lost
    lines = clean + stray + missing
    assert len(group_staves(lines)) == 1
    staves = group_staves_tolerant(lines)
    assert [(s.top, s.bottom) for s in staves] == [(100, 172), (300, 372), (500, 572)]


def test_tolerant_grouping_holds_to_the_pages_spacing() -> None:
    """Text baselines 31px apart are not a staff on a page whose staves are 18px."""
    from pipeline.segment import group_staves_tolerant
    staff = [100, 118, 136, 154, 172]
    text = [400, 431, 462, 493]
    assert [(s.top, s.bottom) for s in group_staves_tolerant(staff + text)] == [(100, 172)]
    assert group_staves_tolerant([]) == []
