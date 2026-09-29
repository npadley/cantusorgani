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



def _tilted_page(tilts: list[float], spacing: int = 19, width: int = 2540) -> np.ndarray:
    """A page with a staff every 260px, each drawn at its own angle across 70% of
    the width, its top line at 200 + 260k in the middle of the page."""
    import cv2
    img = np.full((200 + 260 * len(tilts), width), 255, dtype=np.uint8)
    x0, x1 = int(width * 0.15), int(width * 0.85)
    for k, degrees in enumerate(tilts):
        rise = np.tan(np.radians(degrees)) * (x1 - x0)
        for i in range(5):
            y = 200 + 260 * k + i * spacing
            cv2.line(img, (x0, round(y + rise / 2)), (x1, round(y - rise / 2)), 0, 2)
    return img


def test_a_tilted_staff_lost_by_the_first_pass_is_found_again() -> None:
    """NOH1 PDF 373-378: systems pasted up at +-0.4-0.85 degrees on a page that
    is level overall. The first pass reads each tilted line as several rows
    (these are PDF 375's first staff) and loses the staff; the band of rows it
    leaves unexplained is levelled and searched again. The staff found spans
    the rows its tilted lines cross, and the level staves are left as they were."""
    from pipeline.segment import Staff, recover_tilted_staves
    image = _tilted_page([0.0, 0.7, 0.0])
    scattered = [456, 460, 463, 471, 477, 491, 499, 505, 516, 534]
    lines = [200, 219, 238, 257, 276, *scattered, 720, 739, 758, 777, 796]
    first = [Staff(200, 276), Staff(720, 796)]
    staves = recover_tilted_staves(image, lines, first)
    assert staves[0] == first[0] and staves[2] == first[1]
    ink = np.flatnonzero((image[380:640] < 128).any(axis=1)) + 380
    assert abs(staves[1].top - ink[0]) <= 2 and abs(staves[1].bottom - ink[-1]) <= 2


def test_a_false_staff_made_of_scattered_rows_is_replaced() -> None:
    """PDF 374: five of a tilted staff's rows fitted a 10px spacing on a 19px
    page and made a false staff 40px tall, which sliced as an empty strip."""
    from pipeline.segment import Staff, recover_tilted_staves
    image = _tilted_page([0.0, -0.7, 0.0, 0.0])
    level = [Staff(200 + 260 * k, 276 + 260 * k) for k in (0, 2, 3)]
    lines = [200, 219, 238, 257, 276, 452, 460, 470, 480, 490, 500, 512, 530,
             720, 739, 758, 777, 796, 980, 999, 1018, 1037, 1056]
    staves = recover_tilted_staves(image, lines, [level[0], Staff(460, 500), *level[1:]])
    assert len(staves) == 4 and staves[1].bottom - staves[1].top > 90


def test_a_level_page_is_left_as_the_first_pass_read_it() -> None:
    from pipeline.segment import group_staves, recover_tilted_staves
    image = _tilted_page([0.0, 0.0, 0.0])
    lines = find_staff_lines(image)
    first = group_staves(lines)
    assert len(first) == 3
    assert recover_tilted_staves(image, lines, first) == first
    assert recover_tilted_staves(image, [], []) == []
