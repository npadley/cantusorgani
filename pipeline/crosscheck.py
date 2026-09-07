"""Verify hand-transcribed index pages against the folios actually printed.

An index entry claiming page 98 must land on a PDF page whose printed folio reads
98. This is what catches a transcription slip or a wrong offset before either can
propagate into the catalog.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pipeline.folio import read_folio_dual
from pipeline.index import load_index
from pipeline.offset import load_offset


@dataclass(frozen=True)
class EntryCheck:
    label: str
    title: str
    printed_page: int
    pdf_page: int
    embedded: int | None
    tesseract: int | None
    status: str   # "confirmed" | "unconfirmed" | "mismatch"


def verify_entry_pages(vol_id: str, work_dir: Path | None = None) -> list[EntryCheck]:
    offset = load_offset(vol_id)
    results: list[EntryCheck] = []
    for entry in load_index(vol_id):
        pdf_page = entry.page + offset
        reading = read_folio_dual(vol_id, pdf_page, work_dir)
        if reading.folio == entry.page:
            status = "confirmed"
        elif reading.embedded == entry.page or reading.tesseract == entry.page:
            # One source agrees with the transcription and the other is silent or
            # wrong. Not a mismatch — a weaker confirmation.
            status = "unconfirmed"
        elif reading.embedded is None and reading.tesseract is None:
            status = "unconfirmed"
        else:
            status = "mismatch"
        results.append(EntryCheck(
            entry.label, entry.title, entry.page, pdf_page,
            reading.embedded, reading.tesseract, status,
        ))
    return results


def mismatches(checks: list[EntryCheck]) -> list[EntryCheck]:
    return [c for c in checks if c.status == "mismatch"]
