"""Per-system Latin text, read from the PDF's embedded OCR layer.

NOH sets the chant text directly above each system, so clipping the text layer to
a system's bounding box recovers the words sung on that system. This is the only
signal that reveals movement boundaries *within* a Mass: the NOH5 index is
Mass-level (Missa I at printed page 5, Missa II at 11) and never says where the
Kyrie ends and the Gloria begins.

The OCR is poor -- "CIa _ri _ a III ex _ c~l _ SIS De _ o" for "Gloria in excelsis
Deo" -- so callers must fuzzy-match, never compare literally.
"""

from __future__ import annotations

import re
import unicodedata

import pymupdf

from pipeline.evaluate import analyse_page
from pipeline.volumes import load_volumes

RENDER_DPI = 300
PX_TO_PT = 72.0 / RENDER_DPI
_LETTERS = re.compile(r"[^a-z]+")


def condense(text: str) -> str:
    """Reduce OCR'd chant text to bare lowercase letters.

    NOH hyphenates every syllable ("Ky _ n _ e"), and the scanner adds specks and
    stray punctuation, so separators carry no information and only get in the way
    of matching.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    return _LETTERS.sub("", ascii_only.lower())


def system_texts(vol_id: str, pdf_page: int) -> list[str]:
    """Raw text under each system box, in reading order."""
    vol = load_volumes()[vol_id]
    boxes = analyse_page(vol_id, pdf_page).boxes
    if not boxes:
        return []
    with pymupdf.open(vol.path) as doc:
        page = doc[pdf_page - 1]
        out: list[str] = []
        for box in boxes:
            rect = pymupdf.Rect(box.left * PX_TO_PT, box.top * PX_TO_PT,
                                box.right * PX_TO_PT, box.bottom * PX_TO_PT)
            out.append(" ".join(page.get_text("text", clip=rect).split()))
    return out
