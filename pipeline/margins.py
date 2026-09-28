"""The label printed in each system's left margin ("Intr. III.", "Offert. I.").

The PDF's text layer misses most of these, but the print is clean: Tesseract on
a strip of the published slice reads them. Measured on St Therese's 61 systems
(2026-09-26): a strip 9% of the slice's width, below its top quarter (which
holds the chant text above the staff), scaled 2x, finds every label -- Intr.,
Grad., Tract., Offert., Comm. -- and reads the other systems as nothing.

Readings are cached per page under data/ocr/margins/, keyed by each slice's
content hash, so a re-sliced page is read again and nothing else is.
"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline.render import BUILD
from pipeline.volumes import DATA

# Committed (data/ocr/margins/): with it the catalogue rebuilds without the
# slices, and the same readings every time.
MARGINS = DATA / "ocr" / "margins"
SLICES = BUILD / "systems"
STRIP_WIDTH = 0.09
STRIP_TOP = 0.25


def read_margin(slice_png: Path) -> str:
    import pytesseract
    from PIL import Image

    with Image.open(slice_png) as image:
        grey = image.convert("L")
        strip = grey.crop((0, int(grey.height * STRIP_TOP), int(grey.width * STRIP_WIDTH), grey.height))
        strip = strip.resize((strip.width * 2, strip.height * 2))
        return " ".join(pytesseract.image_to_string(strip, config="--psm 6").split())


class MarginReader:
    """Margin text for systems, OCR'd lazily and cached per page."""

    def __init__(self, cache_dir: Path | None = MARGINS, slices: Path = SLICES) -> None:
        self.cache_dir, self.slices = cache_dir, slices
        self._pages: dict[str, dict[str, str]] = {}

    def _cache_path(self, volume: str, page: str) -> Path | None:
        return self.cache_dir / volume / f"{page}.json" if self.cache_dir else None

    def text(self, ref: str, asset: str = "") -> str:
        """`ref` is "noh3/0398/003"; `asset` the published key carrying the
        slice's hash, so a re-sliced system is read again."""
        volume, page, _ = ref.split("/")
        key = f"{ref}|{asset}"
        cached = self._pages.get(f"{volume}/{page}")
        if cached is None:
            path = self._cache_path(volume, page)
            cached = json.loads(path.read_text(encoding="utf-8")) if path and path.exists() else {}
            self._pages[f"{volume}/{page}"] = cached
        if key not in cached:
            png = self.slices / f"{ref}@2x.png"
            cached[key] = read_margin(png) if png.exists() else ""
            path = self._cache_path(volume, page)
            if path is not None:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(cached, ensure_ascii=False), encoding="utf-8")
        return cached[key]


__all__ = ["MarginReader", "read_margin"]
