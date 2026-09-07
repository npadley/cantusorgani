"""Stage 3: find staff lines, group them into staves and systems, and box them.

Every constant below is a measurement taken from the twelve NOH5 fixture pages
rendered at 300dpi (~2540x3490) on 2026-09-07, not a guess. The measurements are
quoted inline; `pipeline.evaluate.write_contact_sheet` is the tool for re-taking
them if the source ever changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

import cv2
import numpy as np

# --- find_staff_lines -------------------------------------------------------
#
# NOH is organ accompaniment: note heads, stems and slurs interrupt every staff
# line, so a plain long-run opening deletes most of them. Measured on the cleaned
# fixtures, thresholding the *longest contiguous run* per row recovered only
# 31/50 lines on PDF 47 and 9/50 on PDF 185. Closing small horizontal gaps first
# fixes that.
#
# CLOSE_PX bridges the gap a note head or stem punches in a staff line. Sampled
# widths of those interruptions are 4-13px at 300dpi; 15 covers them without
# joining separate glyphs into a false line.
CLOSE_PX = 15
# OPEN_RATIO deletes anything not staff-long. The shortest real system in the
# fixture set is the second system of PDF 185, spanning x=240..925 of a 2525px
# page = 0.27 W, and it is broken into pieces by its notes. 0.08 W (~200px)
# survives that; 0.25 W erased it entirely and cost the page two staves.
OPEN_RATIO = 0.08
# Fraction of page width a row must retain after the opening to count as a line.
# Measured: staff-line rows hold 0.27-0.70 W of surviving ink; the index page's
# heading rule and the title page's ornamental border produce a handful of rows
# above this, which `group_staves` then rejects on spacing. Detection is
# deliberately biased towards over-detection: a spurious line is filtered later,
# a missing line is unrecoverable.
MIN_ROW_INK = 0.10


def find_staff_lines(binary: np.ndarray, close_px: int = CLOSE_PX,
                     open_ratio: float = OPEN_RATIO,
                     min_row_ink: float = MIN_ROW_INK) -> list[int]:
    """Row indices of staff lines in a cleaned (binarised) page."""
    inv = (binary < 128).astype(np.uint8)
    height, width = binary.shape
    if width == 0 or height == 0:
        return []
    inv = cv2.morphologyEx(
        inv, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (close_px, 1))
    )
    kernel_w = max(int(width * open_ratio), 1)
    horiz = cv2.morphologyEx(
        inv, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_w, 1))
    )
    profile = horiz.sum(axis=1)
    threshold = width * min_row_ink

    lines: list[int] = []
    run: list[int] = []
    for y, value in enumerate(profile):
        if value >= threshold:
            run.append(y)
        elif run:
            lines.append(int(np.mean(run)))
            run = []
    if run:
        lines.append(int(np.mean(run)))
    return lines


# --- grouping ---------------------------------------------------------------


@dataclass(frozen=True)
class Staff:
    top: int
    bottom: int


@dataclass(frozen=True)
class System:
    top: int
    bottom: int
    staff_count: int


@dataclass(frozen=True)
class BBox:
    left: int
    top: int
    right: int
    bottom: int


# Staff-line spacing measured across all ten music fixtures: 15-23px, median 19.
# The band below is generous on both sides while still excluding rubric
# baselines (~40px apart on PDF 226/229) and the 86-116px gap between the two
# staves of one system.
MIN_STAFF_GAP = 10.0
MAX_STAFF_GAP = 34.0
# Within one staff the five gaps vary by up to 4px around a mean of ~19 (PDF 57
# has 15,19,18,20; PDF 144 has 18,19,23,18), i.e. 21% deviation. The plan's 0.15
# rejected both of those staves and cost PDF 57 and PDF 144 one system each.
# 0.25 accepts every observed staff with room to spare and still rejects the
# unevenly spaced rubric and border rows.
STAFF_SLACK = 0.25


def group_staves(lines: list[int], slack: float = STAFF_SLACK,
                 min_gap: float = MIN_STAFF_GAP,
                 max_gap: float = MAX_STAFF_GAP) -> list[Staff]:
    """Consecutive runs of 5 evenly spaced lines form one staff.

    min_gap/max_gap bound staff-line spacing at 300dpi; without them five evenly
    spaced rubric baselines (see fixture page 229) are accepted as a staff. A
    plain `mean_gap / tolerance` rule permitted 50% deviation -- a rubber stamp,
    not a tolerance.
    """
    staves: list[Staff] = []
    i = 0
    while i + 4 < len(lines):
        window = lines[i:i + 5]
        gaps = [b - a for a, b in pairwise(window)]
        mean_gap = sum(gaps) / len(gaps)
        if (min_gap <= mean_gap <= max_gap
                and all(abs(g - mean_gap) <= mean_gap * slack for g in gaps)):
            staves.append(Staff(top=window[0], bottom=window[-1]))
            i += 5
        else:
            i += 1
    return staves


def group_systems(staves: list[Staff], expected_staves: int = 2) -> list[System]:
    """NOH systems are exactly `expected_staves` braced staves.

    Group positionally and assert the intra-system gap is strictly smaller than
    the gap to the next system -- the only property that makes the grouping
    defensible. Measured: intra-system gap 86-116px, inter-system gap 171-667px,
    so the assertion has a wide margin on real pages. A gap-*ratio* rule cannot
    work here: the inter-system gap holds the Latin text line, so any ratio loose
    enough to join a brace also merges neighbouring systems.
    """
    if not staves:
        return []
    if len(staves) % expected_staves != 0:
        raise ValueError(
            f"{len(staves)} staves is not a multiple of {expected_staves}; "
            "staff detection dropped or invented a staff — send this page to review"
        )
    systems: list[System] = []
    for i in range(0, len(staves), expected_staves):
        group = staves[i:i + expected_staves]
        inner = max(b.top - a.bottom for a, b in pairwise(group))
        if i + expected_staves < len(staves):
            outer = staves[i + expected_staves].top - group[-1].bottom
            if inner >= outer:
                raise ValueError(
                    f"system {i // expected_staves}: intra-system gap {inner}px is not "
                    f"smaller than inter-system gap {outer}px — grouping is unsafe"
                )
        systems.append(_close(group))
    return systems


def _close(group: list[Staff]) -> System:
    return System(top=group[0].top, bottom=group[-1].bottom, staff_count=len(group))


# --- boxing -----------------------------------------------------------------
#
# NOH sets its Latin text ABOVE each system and mode numbers to its LEFT. A box
# drawn on the staff lines alone crops the words off and makes every export
# useless.
#
# Measured over all 52 systems in the ten music fixtures, the distance from the
# top of the topmost ink of the text block to the top staff line, as a fraction
# of system height:  min 0.216, median 0.266, p90 0.286, max 0.502 (the max is a
# system that carries a section heading as well as its text line).
# 0.55 clears the worst observed case with ~10% margin, and still fits: system
# heights are 224-270px, so 0.55 reserves 123-149px inside an inter-system gap
# that is never smaller than 171px.
TEXT_HEADROOM = 0.55
# Fallback only, used when no ink map is supplied. The bottom of a system is not a
# fixed fraction of its height: bass notes on ledger lines below the staff, and
# slurs, run well past the last staff line. Measured over the 52 fixture systems,
# ink extends below the last staff line by median 0.022 of system height, p90
# 0.192, max 0.793 -- so a fixed 0.08 pad clipped music on 13 of 52 systems (25%).
# Pass `ink` to get the correct, adaptive behaviour.
TAIL_PADDING = 0.08

# --- adaptive bottom edge ---------------------------------------------------
# A row holding at least this many ink pixels counts as musical content rather
# than scanner speckle. Measured: speckle rows carry 0-3px, real content >= 10.
INK_ROW_MIN = 4
# Sustained clear rows that mark the true end of a system. Intra-system gaps
# (between the two braced staves) never exceed 116px of which the clear portion is
# far shorter; inter-system gaps are >= 171px. 30 ends a system without walking
# across the brace.
CLEAR_RUN_PX = 30
# Breathing room below the last ink row, so a slur's outermost pixel is not the
# literal edge of the crop.
BOTTOM_MARGIN_PX = 8


def _content_bottom(ink: np.ndarray, staff_bottom: int, ceiling: int) -> int:
    """Last row of this system's ink, scanning down to `ceiling`."""
    band = ink[staff_bottom:max(staff_bottom, ceiling)]
    if band.size == 0:
        return staff_bottom
    rows = band.sum(axis=1)
    last = 0
    clear = 0
    for y, value in enumerate(rows):
        if value >= INK_ROW_MIN:
            last, clear = y, 0
        else:
            clear += 1
            if clear >= CLEAR_RUN_PX and last:
                break
    return staff_bottom + last


def to_bboxes(systems: list[System], page_height: int, page_width: int,
              ink: np.ndarray | None = None) -> list[BBox]:
    """Boxes including the Latin text above and the mode number to the left.

    When `ink` (a boolean page mask) is given, the bottom edge follows the actual
    end of the music instead of a fixed pad. Without it the fixed pad is used,
    which is correct for synthetic geometry tests but clips real pages.
    """
    boxes: list[BBox] = []
    for i, sys_ in enumerate(systems):
        height = sys_.bottom - sys_.top
        want_top = sys_.top - int(height * TEXT_HEADROOM)
        floor = 0 if i == 0 else boxes[-1].bottom
        top = max(want_top, floor)

        if i + 1 < len(systems):
            nxt = systems[i + 1]
            # Stop above the *next* system's text line, not above its staff, or the
            # next system's Latin text is cut in half across two slices -- the exact
            # failure this module exists to prevent.
            ceiling = nxt.top - int((nxt.bottom - nxt.top) * TEXT_HEADROOM)
        else:
            ceiling = page_height
        ceiling = min(ceiling, page_height)

        if ink is None:
            bottom = sys_.bottom + int(height * TAIL_PADDING)
        else:
            bottom = _content_bottom(ink, sys_.bottom, ceiling) + BOTTOM_MARGIN_PX
        bottom = min(bottom, ceiling)

        if bottom <= sys_.bottom:
            raise ValueError(
                f"system {i}: no clean cut below the staff (bottom={bottom}, "
                f"staff_bottom={sys_.bottom}); systems too close — send page to review"
            )
        boxes.append(BBox(left=0, top=top, right=page_width, bottom=bottom))
    return boxes
