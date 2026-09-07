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
