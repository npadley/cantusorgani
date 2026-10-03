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


def test_group_systems_by_gap_keeps_a_page_with_a_lost_staff():
    """NOH5 p. 57: the bass staff of a short system is missed, leaving 11 staves.
    Strict pairing drops the page; pairing by the brace gap keeps all six systems."""
    from pipeline.segment import Staff, group_systems, group_systems_by_gap
    tops = [511, 960, 1425, 1883, 2329, 2841]
    staves: list[Staff] = []
    for k, top in enumerate(tops):
        staves.append(Staff(top, top + 72))
        if k != 4:                                   # the fifth system lost its bass staff
            staves.append(Staff(top + 175, top + 247))
    with pytest.raises(ValueError):
        group_systems(staves)
    systems = group_systems_by_gap(staves)
    assert [s.staff_count for s in systems] == [2, 2, 2, 2, 1, 2]
    assert systems[4].top == 2329


@pytest.mark.source
@pytest.mark.slow
def test_analyse_page_noh5_p57_keeps_all_six_systems():
    """Regression: 11 staves (one bass staff missed) dropped the whole page, and
    with it the Agnus Dei of Missa IX, without a trace in the review queue. The
    brace-gap pairing kept it; the missed staff is now found again as a tilted
    one, so the page no longer needs the fallback."""
    from pipeline.evaluate import analyse_page
    result = analyse_page("noh5", 103)
    assert result.error is None
    assert result.system_count == 6
    assert len(result.staves) == 12 and result.warning is None


@pytest.mark.source
@pytest.mark.slow
@pytest.mark.parametrize("page,expected", [(373, 6), (374, 5), (375, 6), (376, 6), (377, 6), (378, 6)])
def test_analyse_page_noh1_holy_saturday_lauds_keeps_its_tilted_systems(page, expected):
    """Regression: these pages' systems are printed tilted by up to 0.85 degrees
    either way. 12 of their 35 systems were lost; PDF 374 sliced an empty strip instead of
    the Lauds antiphon and Psalm 150, and PDF 375 lost the Benedictus's first staff."""
    from pipeline.evaluate import analyse_page
    result = analyse_page("noh1", page)
    assert result.error is None and result.warning is None
    assert result.system_count == expected


@pytest.mark.source
@pytest.mark.slow
def test_analyse_page_noh1_p126_keeps_the_introits_treble_staff():
    """Regression: a slur read as a line inside the Introit's treble staff hid
    it, and the first system was sliced as its bass staff alone."""
    from pipeline.evaluate import analyse_page
    result = analyse_page("noh1", 153)
    assert result.warning is None
    assert [s.staff_count for s in result.systems] == [2] * 6
    assert result.boxes[0].top < result.systems[0].top - 100    # "Adorate Deum" above it


@pytest.mark.source
@pytest.mark.slow
def test_refit_page_finds_staves_read_twice_or_lost():
    """NOH2 p. 101: lines read twice and a top line lost hid four staves, and the
    page was cut into three slices: two systems in one, and one not cut at all."""
    from pipeline.evaluate import analyse_page
    result = analyse_page("noh2", 133)
    assert result.warning is None
    assert [s.staff_count for s in result.systems] == [2] * 5


@pytest.mark.source
@pytest.mark.slow
@pytest.mark.parametrize("vol,page,expected", [("noh2", 93, 4), ("noh8", 45, 6), ("noh8", 58, 6),
                                               ("noh2", 69, 6), ("noh3", 140, 6), ("noh8", 75, 5), ("noh8", 173, 6),
                                               ("noh5", 197, 5)])
def test_staff_finder_pages_keep_every_system(vol, page, expected):
    """NOH2 p. 61 prints its staff lines as dashes (dashed); NOH8 p. 15 loses
    three staves to broken lines (refit); on NOH8 p. 28 tilt recovery split the
    response below a versicle's lone staff (plain). On five pages one treble
    staff loses lines and was sliced as a lone bass staff: four refit, and
    NOH5 p. 151 (faint), whose staff's outer lines print too faintly."""
    from pipeline.evaluate import analyse_page
    result = analyse_page(vol, page)
    assert result.error is None and result.warning is None
    assert [s.staff_count for s in result.systems] == [2] * expected
