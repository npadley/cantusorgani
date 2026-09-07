"""Task 10: grouping staff lines into staves and systems."""

import pytest

from pipeline.segment import Staff, group_staves, group_systems


def test_groups_ten_lines_into_two_staves() -> None:
    lines = [100, 112, 124, 136, 148, 300, 312, 324, 336, 348]
    staves = group_staves(lines)
    assert len(staves) == 2
    assert staves[0].top == 100 and staves[0].bottom == 148


def test_pairs_staves_into_one_system() -> None:
    lines = [100, 112, 124, 136, 148, 300, 312, 324, 336, 348]
    systems = group_systems(group_staves(lines))
    assert len(systems) == 1
    assert systems[0].staff_count == 2


def test_rejects_evenly_spaced_rubric_baselines() -> None:
    """Five text baselines ~45px apart are wider than any 300dpi staff."""
    assert group_staves([100, 145, 190, 235, 280]) == []


def test_tolerates_the_worst_observed_real_staff() -> None:
    """PDF 57 has gaps 15,19,18,20; PDF 144 has 18,19,23,18 (measured)."""
    assert len(group_staves([0, 15, 34, 52, 72])) == 1
    assert len(group_staves([0, 18, 37, 60, 78])) == 1


def test_odd_stave_count_is_an_error_not_a_guess() -> None:
    staves = [Staff(0, 76), Staff(160, 236), Staff(400, 476)]
    with pytest.raises(ValueError, match="not a multiple"):
        group_systems(staves)


def test_grouping_refuses_when_intra_gap_exceeds_inter_gap() -> None:
    # Staves 0/1 are 200px apart but staff 2 begins only 20px after staff 1.
    staves = [Staff(0, 76), Staff(276, 352), Staff(372, 448), Staff(600, 676)]
    with pytest.raises(ValueError, match="grouping is unsafe"):
        group_systems(staves)


def test_no_staves_means_no_systems() -> None:
    assert group_systems([]) == []
