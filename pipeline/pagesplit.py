"""Where on its first page a piece begins.

A Proper rarely starts at the top of a page: Feria VI of the Pentecost Ember
week begins below the last systems of Feria IV, and a feast of the saints below
the end of the one before. A page range cannot say that; the heading can. The
page's systems divide it into gaps -- above the first system, between each pair,
below the last -- and the piece begins with the system after the gap that holds
its heading.

Gap text comes from the PDF's text layer first, and from Tesseract on that gap
only where the text layer does not find the heading. Tesseract readings are
cached per page under build/gaps/.
"""

from __future__ import annotations

import json
from pathlib import Path

from pipeline.indexextract import (
    FOOT_BAND,
    PX_PER_PT,
    TOP_BAND,
    VERIFIED_AT,
    date_score,
    drop_running_head,
    embedded_words,
    heading_score,
)
from pipeline.render import BUILD

GAPS = BUILD / "gaps"
MIN_GAP_PX = 40


def gap_bounds(boxes: list[tuple[int, int]], height: int) -> list[tuple[int, int]]:
    """(top, bottom) in pixels of each gap: gap k lies directly above system k,
    and the last gap lies below the last system."""
    edges = [int(height * TOP_BAND)]
    for top, bottom in boxes:
        edges += [top, bottom]
    edges.append(int(height * (1 - FOOT_BAND)))
    return [(edges[i], max(edges[i], edges[i + 1])) for i in range(0, len(edges), 2)]


def embedded_gap_texts(vol_id: str, pdf_page: int, gaps: list[tuple[int, int]]) -> list[str]:
    lines: list[list[tuple[float, float, str]]] = [[] for _ in gaps]
    for w in embedded_words(vol_id, pdf_page):
        middle = (w.y0 + w.y1) / 2 * PX_PER_PT
        for k, (top, bottom) in enumerate(gaps):
            if top <= middle <= bottom:
                lines[k].append((w.y0, w.x0, w.text))
                break
    out: list[str] = []
    for words in lines:
        rows: list[list[tuple[float, float, str]]] = []
        for y, x, text in sorted(words):
            if rows and abs(rows[-1][0][0] - y) <= 4:
                rows[-1].append((y, x, text))
            else:
                rows.append([(y, x, text)])
        out.append("\n".join(" ".join(t for _, _, t in sorted(r, key=lambda r: r[1])) for r in rows))
    return out


class GapReader:
    """Gap texts for one page, OCR'd lazily and cached."""

    def __init__(self, vol_id: str, pdf_page: int, printed: int,
                 boxes: list[tuple[int, int]], height: int, cache_dir: Path | None = GAPS) -> None:
        self.vol_id, self.pdf_page, self.printed = vol_id, pdf_page, printed
        self.gaps = gap_bounds(boxes, height)
        self.cache = cache_dir / vol_id / f"{pdf_page:04d}.json" if cache_dir else None
        self._embedded: list[str] | None = None
        self._ocr: dict[str, str] = {}
        if self.cache is not None and self.cache.exists():
            self._ocr = json.loads(self.cache.read_text(encoding="utf-8"))

    def embedded(self, k: int) -> str:
        if self._embedded is None:
            self._embedded = embedded_gap_texts(self.vol_id, self.pdf_page, self.gaps)
        return self._tidy(k, self._embedded[k])

    def recognised(self, k: int) -> str:
        key = f"{k}:{self.gaps[k][0]}-{self.gaps[k][1]}"
        if key not in self._ocr:
            top, bottom = self.gaps[k]
            if bottom - top < MIN_GAP_PX:
                self._ocr[key] = ""
            else:
                import pytesseract
                from PIL import Image

                from pipeline.render import render_page

                image = Image.open(render_page(self.vol_id, self.pdf_page)).convert("L")
                self._ocr[key] = pytesseract.image_to_string(
                    image.crop((0, top, image.width, bottom)), lang="lat", config="--psm 6")
            if self.cache is not None:
                self.cache.parent.mkdir(parents=True, exist_ok=True)
                self.cache.write_text(json.dumps(self._ocr, ensure_ascii=False), encoding="utf-8")
        return self._tidy(k, self._ocr[key])

    def _tidy(self, k: int, text: str) -> str:
        # Only the first gap holds the running head.
        return drop_running_head(text, self.printed) if k == 0 else text


def gap_score(entry_text: str, text: str) -> float:
    return max(heading_score(entry_text, text), date_score(entry_text, text))


def first_system(reader: GapReader, entry_text: str) -> int:
    """Index of the first system that belongs to the entry on its first page.

    0 when the heading is above the first system -- or found nowhere, which
    keeps the old whole-page behaviour rather than guessing. The number of
    systems when the heading is below the last (the piece begins overleaf)."""
    scores: list[float] = []
    for k in range(len(reader.gaps)):
        score = gap_score(entry_text, reader.embedded(k))
        if score < VERIFIED_AT:
            score = max(score, gap_score(entry_text, f"{reader.embedded(k)}\n{reader.recognised(k)}"))
        scores.append(score)
    if not scores or max(scores) < VERIFIED_AT:
        return 0
    # The earliest gap that is nearly as good as the best: a heading comes before
    # the rubrics beneath it, which may name other days ("ut in Dominica IV").
    floor = max(VERIFIED_AT, max(scores) - 0.15)
    return next(k for k, score in enumerate(scores) if score >= floor)
