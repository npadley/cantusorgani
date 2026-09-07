"""Dual-source folio and running-head reading.

Every source PDF carries an embedded OCR text layer. It is 1990s-grade OCR over
1942 print, measured on NOH5 body pages (2026-09-07):

    correct folio recovered   155 / 185   (83.8%)
    no folio text on page      25 / 185   (13.5%)
    misread                     5 / 185   ( 2.7%)   e.g. 14->11, 46->16, 143->113

So it is a strong second opinion and a poor sole authority. Tesseract reads the
same pixels by a different route; agreement between the two counts as
verification, and disagreement is a review-queue entry -- never a coin flip. A
wrong folio poisons the derived page offset and therefore every reference in the
volume, which is the single most damaging failure available to this pipeline.
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from PIL import Image

from pipeline.render import render_page
from pipeline.volumes import load_volumes

_NUMERIC = re.compile(r"^\d{1,3}$")
TESS_PSM = 11               # sparse text: finds isolated folio digits
MIN_TESS_CONFIDENCE = 30.0  # below this Tesseract is guessing at scan speckle

# Folios sit in the top band, in the outer margin. Both are measured fractions of
# the page, calibrated against NOH5: headers sit ~9.3% down an 837pt page, and the
# folio's centre is >=0.28 of page width from the centreline.
HEAD_BAND = 0.12
MIN_CENTRE_OFFSET = 0.28


class TesseractUnavailable(RuntimeError):
    """Raised when the Tesseract cross-check cannot run."""


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def read_embedded(vol_id: str, pdf_page: int) -> tuple[str, int | None]:
    """Read the running head and folio from the PDF's own text layer.

    Free: no rasterisation. Returns (running_head_text, folio_or_None).
    """
    vol = load_volumes()[vol_id]
    with pymupdf.open(vol.path) as doc:
        page = doc[pdf_page - 1]
        width, height = page.rect.width, page.rect.height
        centre = width / 2
        head_parts: list[tuple[float, str]] = []
        best_folio: int | None = None
        best_offset = 0.0
        for x0, y0, x1, y1, text, *_ in page.get_text("words"):
            if y1 > height * HEAD_BAND:
                continue
            head_parts.append((x0, text))
            if not _NUMERIC.match(text):
                continue
            # The folio is the numeric word furthest from the centreline. A hard
            # margin fraction is too brittle: on NOH5 p229 the folio sits at
            # x/W = 0.798, which a 0.80 cutoff rejects by two thousandths.
            offset = abs((x0 + x1) / 2 - centre) / width
            if offset > best_offset:
                best_offset, best_folio = offset, int(text)
    head = " ".join(t for _, t in sorted(head_parts))
    folio = best_folio if best_offset >= MIN_CENTRE_OFFSET else None
    return head, folio


def read_folio(vol_id: str, pdf_page: int, work_dir: Path | None = None) -> int | None:
    """Read the printed folio with Tesseract, from the rendered page.

    Uses word-level output over the whole top band and picks the numeric word
    furthest from the centreline -- the same positional rule as `read_embedded`.
    Measured on 12 known folios (2026-09-07): this recovers 9/12, against 1/8 for
    the earlier approach of running --psm 7 over a fixed corner crop, which
    systematically dropped the leading digit (150 -> 50, 158 -> 58) because a thin
    leading '1' at the edge of a narrow crop is discarded as noise.
    """
    if not tesseract_available():
        raise TesseractUnavailable(
            "tesseract is not installed, so the folio cross-check cannot run.\n"
            "  Fix:  macOS   brew install tesseract tesseract-lang\n"
            "        Debian  sudo apt install tesseract-ocr tesseract-ocr-lat\n"
            "  Verify: tesseract --list-langs | grep lat"
        )
    import pytesseract

    img = Image.open(render_page(vol_id, pdf_page, work_dir))
    width, height = img.size
    band = img.crop((0, 0, width, int(height * HEAD_BAND)))
    data = pytesseract.image_to_data(
        band, config=f"--psm {TESS_PSM} -c tessedit_char_whitelist=0123456789",
        output_type=pytesseract.Output.DICT,
    )
    best: int | None = None
    best_offset = 0.0
    for i, raw in enumerate(data["text"]):
        text = raw.strip()
        if not _NUMERIC.match(text):
            continue
        try:
            confidence = float(data["conf"][i])
        except (TypeError, ValueError):
            continue
        if confidence < MIN_TESS_CONFIDENCE:
            continue
        centre_x = data["left"][i] + data["width"][i] / 2
        offset = abs(centre_x - width / 2) / width
        if offset > best_offset:
            best_offset, best = offset, int(text)
    return best if best_offset >= MIN_CENTRE_OFFSET else None


@dataclass(frozen=True)
class FolioReading:
    folio: int | None
    agreement: bool
    embedded: int | None
    tesseract: int | None
    running_head: str
    sources: tuple[str, ...]


def read_folio_dual(vol_id: str, pdf_page: int, work_dir: Path | None = None,
                    require_both: bool = True) -> FolioReading:
    """Combine both readings. Agreement is verification; disagreement yields None.

    `require_both=False` degrades to the embedded layer alone. That is a
    deliberate, recorded downgrade for environments without Tesseract -- it must
    never be the silent default, because the embedded layer alone is 83.8%
    accurate and its errors are confident ones.
    """
    head, embedded = read_embedded(vol_id, pdf_page)
    if not tesseract_available():
        if require_both:
            raise TesseractUnavailable(
                f"{vol_id} p{pdf_page}: dual-source reading requires tesseract. "
                "Install it, or pass require_both=False to accept a single "
                "unverified source (recorded in derived-offsets.json)."
            )
        return FolioReading(embedded, False, embedded, None, head, ("embedded",))

    tess = read_folio(vol_id, pdf_page, work_dir)
    agree = embedded is not None and embedded == tess
    return FolioReading(
        folio=embedded if agree else None,
        agreement=agree,
        embedded=embedded,
        tesseract=tess,
        running_head=head,
        sources=("embedded", "tesseract"),
    )
