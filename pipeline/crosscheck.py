"""Check that every index entry lands on a real, correctly-offset body page.

What this verifies is the OFFSET, not the transcription. Every body page carries
its own folio, so an entry claiming page 58 lands on a page reading 58 -- and so
would a mistyped 53 or 83. A digit slip that stays inside the volume passes
untouched; only a wrong offset, or a page number outside the body, fails.

An earlier version of this docstring claimed it caught transcription slips. It
does not, and a report of "zero mismatches" here says the offset is right, not
that the index is. Verifying an entry needs evidence on the target page that a
piece STARTS there -- its printed heading, a mode number beside its first system.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pipeline.folio import read_folio_dual
from pipeline.index import load_index
from pipeline.offset import load_page_map


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
    page_map = load_page_map(vol_id)
    results: list[EntryCheck] = []
    for entry in load_index(vol_id):
        pdf_page = page_map.to_pdf(entry.page)
        if pdf_page is None:
            results.append(EntryCheck(entry.label, entry.title, entry.page, 0, None, None,
                                      "mismatch"))
            continue
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
