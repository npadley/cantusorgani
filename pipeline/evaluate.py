"""Stage 4: run segmentation over a page and make the result inspectable.

`analyse_page` composes clean -> find_staff_lines -> group_staves ->
group_systems -> to_bboxes and returns everything the caller needs, including
the reason a page failed rather than a silent zero. `count_systems` is the thin
wrapper the Task 12 regression gate asserts against.

`write_overlay` and `write_contact_sheet` are the visible proof: the cleaned
page with each box stroked and numbered, and an HTML grid putting every fixture
page's detected count beside its hand label. Tuning the segmentation constants
without them is guesswork.
"""

from __future__ import annotations

import functools
import html
import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from pipeline.clean import clean_page, estimate_skew
from pipeline.render import BUILD, render_page
from pipeline.segment import (
    CLOSE_PX,
    FAINT_CLOSE_PX,
    FAINT_MIN_ROW_INK,
    BBox,
    Staff,
    System,
    composite_staves,
    find_staff_lines,
    group_staves,
    group_staves_tolerant,
    group_systems,
    group_systems_by_gap,
    merge_close_lines,
    recover_tilted_staves,
)
from pipeline.segment import to_bboxes as _to_bboxes

OVERLAY = BUILD / "overlay"
LABELS = Path(__file__).resolve().parent.parent / "tests" / "fixtures"

# Stroke colours cycled across boxes so adjacent boxes are always distinguishable.
_COLOURS: tuple[tuple[int, int, int], ...] = (
    (0, 122, 204),   # blue
    (0, 158, 96),    # green
    (196, 76, 0),    # orange
    (150, 60, 190),  # violet
    (200, 0, 80),    # magenta
    (0, 150, 160),   # teal
)


@dataclass(frozen=True)
class PageAnalysis:
    """Everything one page yielded, including why it failed if it did."""

    vol_id: str
    pdf_page: int
    page_width: int
    page_height: int
    skew: float
    lines: list[int] = field(default_factory=list)
    staves: list[Staff] = field(default_factory=list)
    systems: list[System] = field(default_factory=list)
    boxes: list[BBox] = field(default_factory=list)
    error: str | None = None
    warning: str | None = None      # segmented, but by the fallback: review the page

    @property
    def system_count(self) -> int:
        return len(self.systems)


@functools.cache
def faint_pages(vol_id: str) -> frozenset[int]:
    """Pages printed too faintly for the standard staff finder (data/volumes.yml)."""
    from pipeline.volumes import load_volumes
    vol = load_volumes().get(vol_id)
    return frozenset(p for a in (vol.addenda if vol else ()) if a.faint_staff_lines
                     for p in range(a.first_pdf, a.last_pdf + 1))


# A wider bridge than faint print's, for staff lines printed as dashes with gaps
# of up to ~40px (NOH2 p. 61): 25 found 6 of that page's 8 staves, 45 all 8.
DASHED_CLOSE_PX = 45


@functools.cache
def staff_finder(vol_id: str, pdf_page: int) -> str | None:
    """The setting data/volumes.yml names for a page (`staff_finder`), if any."""
    from pipeline.volumes import load_volumes
    vol = load_volumes().get(vol_id)
    return next((mode for mode, pages in (vol.staff_finder if vol else ()) if pdf_page in pages), None)


def load_page(vol_id: str, pdf_page: int) -> np.ndarray:
    """Render (or reuse the cached render of) one page as greyscale."""
    path = render_page(vol_id, pdf_page)
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise OSError(f"could not read the render at {path}")
    return image


@functools.lru_cache(maxsize=16)
def analyse_page(vol_id: str, pdf_page: int) -> PageAnalysis:
    """Segment one page. Grouping failures are captured in `.error`, not raised.

    A page that cannot be grouped is a review-queue entry, not a crash: callers
    that want the strict behaviour (the Task 12 gate) use `count_systems`.
    """
    gray = load_page(vol_id, pdf_page)
    skew = estimate_skew(gray)
    binary = clean_page(gray)
    height, width = binary.shape
    if pdf_page in faint_pages(vol_id) or staff_finder(vol_id, pdf_page) == "faint":
        lines = merge_close_lines(find_staff_lines(binary, close_px=FAINT_CLOSE_PX,
                                                   min_row_ink=FAINT_MIN_ROW_INK))
        staves = group_staves_tolerant(lines)
    elif staff_finder(vol_id, pdf_page) in ("refit", "dashed"):
        # Well printed, but a line read twice and one lost (refit: NOH2 p. 101,
        # NOH8 p. 15) or printed as dashes (dashed: NOH2 p. 61) break the strict
        # run of five: fit the staves as on faint print, strays ignored.
        close = DASHED_CLOSE_PX if staff_finder(vol_id, pdf_page) == "dashed" else CLOSE_PX
        lines = merge_close_lines(find_staff_lines(binary, close_px=close))
        staves = group_staves_tolerant(lines)
    elif staff_finder(vol_id, pdf_page) == "composite":
        lines = find_staff_lines(binary)
        staves = composite_staves(binary)
    elif staff_finder(vol_id, pdf_page) == "plain":
        # Tilt recovery splits a system on NOH8 p. 28 (a versicle's lone staff
        # above its response): the strict grouping reads that page as printed.
        lines = find_staff_lines(binary)
        staves = group_staves(lines)
    else:
        lines = find_staff_lines(binary)
        staves = recover_tilted_staves(binary, lines, group_staves(lines))
    ink = binary < 128
    base = {
        "vol_id": vol_id, "pdf_page": pdf_page, "page_width": width,
        "page_height": height, "skew": skew, "lines": lines, "staves": staves,
    }
    warning = None
    try:
        systems = group_systems(staves)
    except ValueError as exc:
        # Keep the page: pair what can be paired, and say so. A page that loses
        # all its systems for one missed staff is music silently gone.
        # The lower fragment of the reviewed composite scan has a 150px
        # brace gap; its inter-system gaps remain greater than 175px.
        systems = group_systems_by_gap(staves, brace_max=160 if staff_finder(vol_id, pdf_page) == "composite" else 140)
        warning = f"{exc}; paired by brace gap instead"
    try:
        # VII prints several hymn stanzas above a brace. Its words require
        # more space than the single chant line used by the other books.
        options = {"text_headroom": 1.0, "bottom_margin": 32} if vol_id == "noh7" else {}
        boxes = _to_bboxes(systems, page_height=height, page_width=width, ink=ink, **options)
    except ValueError as exc:
        return PageAnalysis(**base, error=str(exc))  # type: ignore[arg-type]
    return PageAnalysis(**base, systems=systems, boxes=boxes, warning=warning)  # type: ignore[arg-type]


def count_systems(vol_id: str, pdf_page: int) -> int:
    """Number of systems on a page. Raises if the page cannot be segmented."""
    result = analyse_page(vol_id, pdf_page)
    if result.error is not None:
        raise ValueError(f"{vol_id} pdf page {pdf_page}: {result.error}")
    return result.system_count


# --- overlays ---------------------------------------------------------------


def _annotate(binary: np.ndarray, result: PageAnalysis) -> np.ndarray:
    canvas = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    scale = max(binary.shape[1] / 2540.0, 0.5)
    for i, box in enumerate(result.boxes):
        colour = _COLOURS[i % len(_COLOURS)]
        cv2.rectangle(canvas, (box.left, box.top),
                      (box.right - 1, box.bottom - 1), colour, max(int(3 * scale), 2))
        cv2.putText(canvas, str(i + 1), (box.left + int(14 * scale), box.top + int(58 * scale)),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.8 * scale, colour, max(int(4 * scale), 2),
                    cv2.LINE_AA)
    for system in result.systems:
        cv2.line(canvas, (0, system.top), (binary.shape[1], system.top), (170, 170, 170), 1)
        cv2.line(canvas, (0, system.bottom), (binary.shape[1], system.bottom), (170, 170, 170), 1)

    caption = (
        f"{result.vol_id} pdf {result.pdf_page}  systems={result.system_count} "
        f"staves={len(result.staves)} lines={len(result.lines)} skew={result.skew:+.2f}deg"
    )
    if result.error:
        caption += "  ERROR"
    cv2.putText(canvas, caption, (int(24 * scale), int(48 * scale)),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0 * scale,
                (0, 0, 220) if result.error else (60, 60, 60), max(int(3 * scale), 2),
                cv2.LINE_AA)
    if result.error:
        cv2.putText(canvas, result.error[:110], (int(24 * scale), int(96 * scale)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8 * scale, (0, 0, 220),
                    max(int(2 * scale), 2), cv2.LINE_AA)
    return canvas


def _write_overlay(vol_id: str, pdf_page: int, dest: Path) -> tuple[Path, PageAnalysis]:
    result = analyse_page(vol_id, pdf_page)
    binary = clean_page(load_page(vol_id, pdf_page))
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / f"{pdf_page:04d}.png"
    cv2.imwrite(str(out), _annotate(binary, result))
    return out, result


def write_overlay(vol_id: str, pdf_page: int, dest_dir: Path | None = None) -> Path:
    """Write the cleaned page with every detected box stroked and numbered."""
    dest = dest_dir if dest_dir is not None else OVERLAY / vol_id
    return _write_overlay(vol_id, pdf_page, dest)[0]


def load_labels(vol_id: str) -> dict[int, dict[str, object]]:
    """Hand-labelled expected system counts, keyed by PDF page."""
    path = LABELS / f"{vol_id}-systems.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {int(k): v for k, v in raw.items()}


def write_contact_sheet(vol_id: str, pages: list[int] | None = None,
                        dest_dir: Path | None = None) -> Path:
    """Write an HTML grid of overlays, detected count beside the hand label.

    Mismatches are highlighted. This turns the Task 12 gate from "12 passed"
    into something you can look at and believe.
    """
    labels = load_labels(vol_id)
    targets = sorted(pages) if pages is not None else sorted(labels)
    dest = dest_dir if dest_dir is not None else OVERLAY / vol_id
    dest.mkdir(parents=True, exist_ok=True)

    cards: list[str] = []
    mismatches = 0
    for page in targets:
        image, result = _write_overlay(vol_id, page, dest)
        label = labels.get(page)
        expected = int(label["systems"]) if label else None  # type: ignore[arg-type]
        note = str(label["note"]) if label else "not hand-labelled"
        bad = result.error is not None or expected is None or expected != result.system_count
        mismatches += bad
        cards.append(
            f'<figure class="{"bad" if bad else "ok"}">'
            f'<img src="{html.escape(image.name)}" alt="overlay for PDF page {page}">'
            f"<figcaption><b>PDF {page}</b>"
            f'<span class="n">detected {result.system_count}'
            f"{'' if expected is None else f' / labelled {expected}'}</span>"
            f'<span class="note">{html.escape(note)}</span>'
            + (f'<span class="err">{html.escape(result.error)}</span>' if result.error else "")
            + "</figcaption></figure>"
        )

    summary = (
        f"{len(targets) - mismatches}/{len(targets)} pages match their hand label"
        if targets else "no pages"
    )
    out = dest / "contact-sheet.html"
    out.write_text(_SHEET.format(
        vol=html.escape(vol_id), summary=html.escape(summary),
        state="bad" if mismatches else "ok", cards="\n".join(cards),
    ), encoding="utf-8")
    return out


_SHEET = """<!doctype html>
<meta charset="utf-8">
<title>{vol} segmentation contact sheet</title>
<style>
 body {{ font: 14px/1.5 system-ui, sans-serif; margin: 2rem; background: #fafaf8; color: #222; }}
 h1 {{ font-size: 1.2rem; margin: 0 0 .25rem; }}
 .summary {{ font-weight: 600; margin-bottom: 1.5rem; }}
 .summary.ok {{ color: #0a7a3f; }}
 .summary.bad {{ color: #b00020; }}
 .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1.5rem; }}
 figure {{ margin: 0; background: #fff; border: 2px solid #ddd; border-radius: 6px; padding: .5rem; }}
 figure.bad {{ border-color: #b00020; }}
 figure.ok {{ border-color: #cfe6d8; }}
 img {{ width: 100%; height: auto; display: block; }}
 figcaption {{ display: flex; flex-direction: column; gap: .2rem; padding-top: .5rem; }}
 .n {{ font-variant-numeric: tabular-nums; }}
 figure.bad .n {{ color: #b00020; font-weight: 700; }}
 .note {{ color: #666; font-size: .85em; }}
 .err {{ color: #b00020; font-size: .85em; font-family: ui-monospace, monospace; }}
</style>
<h1>{vol} — segmentation contact sheet</h1>
<p class="summary {state}">{summary}</p>
<div class="grid">
{cards}
</div>
"""
