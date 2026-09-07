"""Stage 1: rasterise source PDF pages at 300 dpi.

Renders are cached under build/pages/<vol>/<pdf_page>.png so that folio and
running-head reads do not re-rasterise the same page on every call.
"""

from pathlib import Path

import pymupdf

from pipeline.volumes import ROOT, load_volumes

BUILD = ROOT / "build"


def render_page(vol_id: str, pdf_page: int, dest_dir: Path | None = None,
                dpi: int = 300, force: bool = False) -> Path:
    """Render one page. `pdf_page` is 1-indexed, matching human page references."""
    vol = load_volumes()[vol_id]
    if not 1 <= pdf_page <= vol.pdf_pages:
        raise ValueError(
            f"{vol_id}: page {pdf_page} out of range (volume has {vol.pdf_pages} pages)"
        )
    dest = dest_dir if dest_dir is not None else BUILD / "pages" / vol_id
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / f"{pdf_page:04d}.png"
    if out.exists() and not force:
        return out
    with pymupdf.open(vol.path) as doc:
        doc[pdf_page - 1].get_pixmap(dpi=dpi).save(out)
    return out
