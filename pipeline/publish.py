"""Stage 6: slice systems to the derivatives the site and the exporter consume.

Three files per system:

  {n}.webp      display, half of native width, LOSSLESS
  {n}@2x.webp   display on high-density screens, native width, LOSSLESS
  {n}@2x.png    PDF export -- pdf-lib cannot embed WebP, and decoding WebP via
                canvas in the browser fails silently on older Safari on iPad,
                which is the exact device this is for

Lossless, not lossy, and encoded from a bilevel source. Measured over 16 fixture
systems at native size:

    webp lossless from 1-bit    7.2 KB/system    ~7 MB for the volume
    png 1-bit                   9.4 KB
    png 8-bit grey             22.5 KB
    webp lossy q82             43.0 KB          ~44 MB, AND lossy

These are bitonal scans, so lossy compression is six times larger than lossless
*and* smears the noteheads. The export PNG stays 8-bit grey because pdf-lib's
decoder is not guaranteed to accept 1-bit PNGs, and a silent export failure at a
console is worse than 13 KB.

Slices are cut from the CLEANED page, not the raw render: box coordinates are
computed on the cleaned image, so cropping the raw one would misplace every
slice on any page that needed deskewing.

Keys are content-addressed. The pipeline is re-run whenever segmentation
improves, and with positional keys a re-run that changes one slice would serve
different music at the same URL to readers holding a cached copy, with no way
back. A content hash makes catalog.json the single revert point.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline.clean import clean_page
from pipeline.evaluate import analyse_page
from pipeline.render import render_page
from pipeline.volumes import ROOT

BUILD = ROOT / "build"
# Ink margin kept around a trimmed slice, in native pixels.
TRIM_PAD = 24
# Deliberately low. Measured on PDF 229: raising it from 8 to 12 moves the
# first-ink column from ~106 to ~295 -- which is the brace, not the margin. A
# tighter threshold amputates the left edge of the system to remove a few
# scanner specks that the pad would swallow anyway. Cosmetics are not worth
# cutting music.
INK_COL_MIN = 2


@dataclass(frozen=True)
class Slice:
    ref: str
    sha256: str
    width: int
    height: int
    paths: tuple[Path, ...]

    @property
    def key_stem(self) -> str:
        return f"{self.ref}-{self.sha256[:12]}"


def r2_key(vol_id: str, pdf_page: int, index: int, sha256: str,
           variant: str = "", suffix: str = "webp") -> str:
    """Content-addressed object key. Never positional."""
    if len(sha256) < 12:
        raise ValueError("sha256 must be a full hex digest")
    return f"systems/{vol_id}/{pdf_page:04d}/{index:03d}-{sha256[:12]}{variant}.{suffix}"


def _trim_columns(ink: np.ndarray, left: int, right: int) -> tuple[int, int]:
    """Horizontal ink extent within a box, padded. Keeps mode numbers, drops the
    dead paper margin that would otherwise dominate a phone screen."""
    cols = ink[:, left:right].sum(axis=0)
    occupied = np.flatnonzero(cols >= INK_COL_MIN)
    if occupied.size == 0:
        return left, right
    return (max(left, left + int(occupied[0]) - TRIM_PAD),
            min(right, left + int(occupied[-1]) + TRIM_PAD))


def trimmed_boxes(vol_id: str, pdf_page: int, trim: bool = True
                  ) -> list[tuple[int, int, int, int]]:
    """Final (left, top, right, bottom) of each published slice.

    Shared with pipeline.catalog so the recorded aspect ratio always describes the
    image that is actually served. Recording the pre-trim box instead letterboxes
    every system in a slot that is wider than its own picture.
    """
    analysis = analyse_page(vol_id, pdf_page)
    if not analysis.boxes:
        return []
    ink = clean_page(np.array(Image.open(render_page(vol_id, pdf_page)).convert("L"))) < 128
    out: list[tuple[int, int, int, int]] = []
    for box in analysis.boxes:
        left, right = (_trim_columns(ink[box.top:box.bottom], box.left, box.right)
                       if trim else (box.left, box.right))
        out.append((left, box.top, right, box.bottom))
    return out


def slice_systems(vol_id: str, pdf_page: int, dest: Path | None = None,
                  trim: bool = True) -> list[Slice]:
    analysis = analyse_page(vol_id, pdf_page)
    if not analysis.boxes:
        return []
    raw = np.array(Image.open(render_page(vol_id, pdf_page)).convert("L"))
    cleaned = clean_page(raw)
    ink = cleaned < 128
    # Publish the cleaned page: the boxes were measured on it.
    page = Image.fromarray(cleaned).convert("L")
    out_dir = (dest if dest is not None else BUILD / "systems" / vol_id) / f"{pdf_page:04d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    slices: list[Slice] = []
    for index, box in enumerate(analysis.boxes):
        left, right = (_trim_columns(ink[box.top:box.bottom], box.left, box.right)
                       if trim else (box.left, box.right))
        crop = page.crop((left, box.top, right, box.bottom))
        digest = hashlib.sha256(crop.tobytes()).hexdigest()
        ref = f"{vol_id}/{pdf_page:04d}/{index:03d}"

        bilevel = crop.point(lambda v: 255 if v > 127 else 0, mode="1")
        half = crop.resize((max(1, crop.width // 2), max(1, crop.height // 2)),
                           Image.LANCZOS).point(lambda v: 255 if v > 127 else 0, mode="1")
        paths: list[Path] = []
        for image, name, saver in (
            (half, f"{index:03d}.webp", "webp"),
            (bilevel, f"{index:03d}@2x.webp", "webp"),
            (crop, f"{index:03d}@2x.png", "png"),
        ):
            path = out_dir / name
            if saver == "webp":
                image.convert("L").save(path, "WEBP", lossless=True, method=6)
            else:
                image.save(path, "PNG", optimize=True)
            paths.append(path)

        slices.append(Slice(ref=ref, sha256=digest, width=crop.width,
                            height=crop.height, paths=tuple(paths)))
    return slices
