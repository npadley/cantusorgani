"""System boxes must contain all of their music.

The Task 12 gate asserts the system COUNT per page. A count can be perfectly
right while every box clips the bottom of its music -- which is exactly what
happened: a fixed TAIL_PADDING of 0.08 of system height cut through the bass
staff on 13 of 52 fixture systems, because bass notes on ledger lines and slurs
run past the last staff line (measured overhang: median 0.022, p90 0.192, max
0.793 of system height).

That defect would have shipped as PDFs missing bass notes. This suite is the
content-level check the count gate cannot provide.
"""

import json
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from pipeline.clean import clean_page
from pipeline.evaluate import analyse_page
from pipeline.render import render_page
from pipeline.segment import INK_ROW_MIN

FIXTURES = json.loads(
    Path("tests/fixtures/noh5-systems.json").read_text(encoding="utf-8")
)
MUSIC_PAGES = [int(p) for p, meta in FIXTURES.items() if meta["systems"] > 0]
PROBE_PX = 25


def _ink(vol_id: str, pdf_page: int) -> np.ndarray:
    gray = np.array(Image.open(render_page(vol_id, pdf_page)).convert("L"))
    return clean_page(gray) < 128


@pytest.mark.source
@pytest.mark.slow
@pytest.mark.parametrize("pdf_page", MUSIC_PAGES)
def test_no_system_is_clipped_at_its_bottom_edge(pdf_page):
    """No content-bearing ink may sit just below a box's bottom edge."""
    analysis = analyse_page("noh5", pdf_page)
    ink = _ink("noh5", pdf_page)
    offenders = []
    for i, box in enumerate(analysis.boxes, 1):
        below = ink[box.bottom:min(box.bottom + PROBE_PX, ink.shape[0])]
        if below.size and below.sum(axis=1).max() >= INK_ROW_MIN:
            offenders.append(f"system {i} (bottom={box.bottom})")
    assert not offenders, f"pdf {pdf_page}: music clipped below {', '.join(offenders)}"


@pytest.mark.source
@pytest.mark.slow
@pytest.mark.parametrize("pdf_page", MUSIC_PAGES)
def test_boxes_do_not_overlap_and_run_in_reading_order(pdf_page):
    boxes = analyse_page("noh5", pdf_page).boxes
    for upper, lower in pairwise(boxes):
        assert upper.bottom <= lower.top, f"pdf {pdf_page}: boxes overlap"


@pytest.mark.source
@pytest.mark.slow
@pytest.mark.parametrize("pdf_page", MUSIC_PAGES)
def test_every_box_contains_its_whole_staff_span(pdf_page):
    analysis = analyse_page("noh5", pdf_page)
    for i, (system, box) in enumerate(zip(analysis.systems, analysis.boxes), 1):
        assert box.top <= system.top, f"pdf {pdf_page} system {i}: top staff cut"
        assert box.bottom >= system.bottom, f"pdf {pdf_page} system {i}: bottom staff cut"
