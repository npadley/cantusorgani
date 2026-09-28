"""Reading a page: the PDF text layer, Tesseract on a number column, and the
headings printed outside the music systems (HeadingReader)."""

from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

from pipeline.indexextract.matching import LABEL_MATCH, VERIFIED_AT, feast_date, fold, heading_score
from pipeline.indexextract.table import (
    Column,
    Row,
    Word,
    find_number_columns,
    merge_second_source,
    rows_from_columns,
)
from pipeline.offset import PageMap

# ----------------------------------------------------------- page reading ---

PX_PER_PT = 300 / 72
# Headings are read from just below the page edge: a piece's title can sit at
# 9% of the height, inside what a folio reader treats as the running head. The
# running head itself is removed by line -- the line carrying the page's folio.
TOP_BAND, FOOT_BAND = 0.03, 0.08


def drop_running_head(text: str, printed: int) -> str:
    """Remove lines that carry this page's folio: the running head, which on a
    continuation page repeats the piece's heading ("XIII. IN FESTIS
    SEMIDUPLICIBUS 2  77") and would verify the wrong page."""
    folio = str(printed)
    return "\n".join(line for line in text.splitlines()
                     if folio not in re.split(r"[^0-9]+", line))


def embedded_words(vol_id: str, pdf_page: int) -> list[Word]:
    import pymupdf

    from pipeline.volumes import load_volumes

    with pymupdf.open(load_volumes()[vol_id].path) as doc:
        raw = doc[pdf_page - 1].get_text("words")
    return [Word(w[0], w[1], w[2], w[3], w[4]) for w in raw]


def tesseract_column_words(vol_id: str, pdf_page: int, columns: list[Column]) -> list[Word]:
    """Tesseract, digits only, down each number column: the second source, and the
    only one for rows the embedded layer never captured."""
    import pytesseract
    from PIL import Image

    from pipeline.render import render_page

    image = Image.open(render_page(vol_id, pdf_page)).convert("L")
    found: list[Word] = []
    for column in columns:
        left, right = int((column.right - 30) * PX_PER_PT), int((column.right + 6) * PX_PER_PT)
        data = pytesseract.image_to_data(
            image.crop((left, 0, right, image.height)),
            config="--psm 6 -c tessedit_char_whitelist=0123456789-",
            output_type=pytesseract.Output.DICT)
        for text, top in zip(data["text"], data["top"], strict=True):
            text = text.strip()
            if text and any(c.isdigit() for c in text):
                y = top / PX_PER_PT
                found.append(Word(column.right - 12, y, column.right, y + 8, text, "tesseract"))
    return found


def read_index_rows(vol_id: str, pdf_page: int, ordered: bool = True,
                    second_source: bool = True) -> list[Row]:
    words = embedded_words(vol_id, pdf_page)
    columns = find_number_columns(words, min_increasing=0.7 if ordered else 0.0)
    if second_source and columns:
        merge_second_source(columns, tesseract_column_words(vol_id, pdf_page, columns),
                            ordered=ordered)
    return tidy_rows(rows_from_columns(words, columns))


def tidy_rows(rows: list[Row]) -> list[Row]:
    """Drop the index page's own folio (it heads a column, beside "INDEX PARTIS
    III"), and restore ditto entries: the index prints "- secunda, 28 Januarii"
    under "Agnetis ..." for St Agnes's second feast."""
    out: list[Row] = []
    parent: Row | None = None
    for row in rows:
        if re.match(r"\s*index\b", fold(row.title)):
            continue
        variant = re.match(r"\s*\(", row.title) is not None      # "(Alius tonus)"
        if (row.dashed or variant) and parent is not None and parent.head:
            # "In Nativitate Domini. 69" / "— Dominica infra Octavam 80": the
            # sub-entry is named by the entry it hangs from.
            row = replace(row, title=f"{parent.head.rstrip()} {row.title}")
        else:
            first = re.match(r"\s*[-–—]?\s*([a-z])", row.title)
            if first and out and out[-1].title:
                row = replace(row, title=f"{out[-1].title.split()[0]} {row.title.lstrip('-–— ')}")
            parent = row
        out.append(row)
    return out


class HeadingReader:
    """Text a page prints OUTSIDE its music: the headings that open a piece.

    The embedded layer is read first. Where it scores an entry below the verified
    line -- it lost some headings entirely -- Tesseract reads the gaps between the
    systems. The same rule applies to every page, so neighbours compete fairly."""

    def __init__(self, vol_id: str, page_map: PageMap, pdf_pages: int, ocr: bool = True,
                 cache_dir: Path | None = None, excluded: frozenset[int] = frozenset()) -> None:
        self.vol_id, self.page_map, self.pdf_pages, self.ocr = vol_id, page_map, pdf_pages, ocr
        # The index pages themselves print every title: they would verify anything.
        self.cache_dir, self.excluded = cache_dir, excluded
        self._embedded: dict[int, str] = {}
        self._ocr: dict[int, str] = {}

    def _boxes(self, pdf_page: int) -> list[tuple[int, int]]:
        from pipeline.evaluate import analyse_page

        return [(b.top, b.bottom) for b in analyse_page(self.vol_id, pdf_page).boxes]

    def embedded(self, printed: int) -> str:
        pdf = self.page_map.to_pdf(printed) or 0
        if pdf not in self._embedded:
            if not 1 <= pdf <= self.pdf_pages or pdf in self.excluded:
                self._embedded[pdf] = ""
            else:
                boxes = [(t / PX_PER_PT, b / PX_PER_PT) for t, b in self._boxes(pdf)]
                words = embedded_words(self.vol_id, pdf)
                height = max((w.y1 for w in words), default=1.0) / (1 - FOOT_BAND / 2)
                kept = [w for w in words
                        if TOP_BAND * height < w.y0 < (1 - FOOT_BAND) * height
                        # By the word's TOP: a heading's tall capitals dip into the
                        # headroom a system box keeps for the text line above it.
                        and not any(top <= w.y0 + 2 <= bottom for top, bottom in boxes)]
                lines: list[list[Word]] = []
                for w in sorted(kept, key=lambda w: (w.y0, w.x0)):
                    if lines and abs(lines[-1][0].y0 - w.y0) <= 4:
                        lines[-1].append(w)
                    else:
                        lines.append([w])
                self._embedded[pdf] = drop_running_head("\n".join(
                    " ".join(w.text for w in sorted(line, key=lambda w: w.x0)) for line in lines),
                    printed)
        return self._embedded[pdf]

    def recognised(self, printed: int) -> str:
        pdf = self.page_map.to_pdf(printed) or 0
        cache = self.cache_dir / f"{pdf:04d}.txt" if self.cache_dir else None
        if pdf not in self._ocr and cache is not None and cache.exists():
            self._ocr[pdf] = cache.read_text(encoding="utf-8")
        if pdf not in self._ocr:
            if not self.ocr or not 1 <= pdf <= self.pdf_pages or pdf in self.excluded:
                self._ocr[pdf] = ""
            else:
                import pytesseract
                from PIL import Image

                from pipeline.render import render_page

                image = Image.open(render_page(self.vol_id, pdf)).convert("L")
                width, height = image.size
                edges = [int(height * TOP_BAND)] + [y for box in self._boxes(pdf) for y in box]
                edges.append(int(height * (1 - FOOT_BAND)))
                gaps = [(edges[i], edges[i + 1]) for i in range(0, len(edges) - 1, 2)
                        if edges[i + 1] - edges[i] > 40]
                self._ocr[pdf] = "\n".join(
                    pytesseract.image_to_string(image.crop((0, a, width, b)), lang="lat",
                                                config="--psm 6")
                    for a, b in gaps)
                if cache is not None:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(self._ocr[pdf], encoding="utf-8")
        return drop_running_head(self._ocr[pdf], printed)

    def score(self, entry_text: str, printed: int) -> float:
        first = heading_score(entry_text, self.embedded(printed))
        if first >= VERIFIED_AT:
            return first
        text = f"{self.embedded(printed)}\n{self.recognised(printed)}"
        return max(first, heading_score(entry_text, text), date_score(entry_text, text))


def date_score(entry_text: str, heading_text: str) -> float:
    """The Proper of Saints heads each feast with its date ("16. SEPTEMBRIS."):
    a page whose heading carries the entry's date is evidence even when the
    index's OCR has left nothing of the saint's name."""
    wanted = feast_date(entry_text)
    if wanted is None:
        return 0.0
    for line in heading_text.splitlines():
        if feast_date(line.replace(".", " ")) == wanted:
            return LABEL_MATCH
    return 0.0


