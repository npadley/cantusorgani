import pytest

from pipeline.crosscheck import mismatches, verify_entry_pages
from pipeline.folio import tesseract_available

needs_tesseract = pytest.mark.skipif(
    not tesseract_available(), reason="tesseract not installed"
)


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
def test_no_index_entry_contradicts_the_printed_folio():
    """Every hand-transcribed page must land on a page whose printed folio agrees.
    A mismatch means either the transcription or the derived offset is wrong, and
    both would corrupt every downstream reference."""
    failures = mismatches(verify_entry_pages("noh5"))
    assert failures == [], (
        "index/folio mismatches: "
        + "; ".join(f"{f.label} printed {f.printed_page} -> pdf {f.pdf_page} "
                    f"(embedded={f.embedded} tesseract={f.tesseract})" for f in failures)
    )


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
def test_most_entries_are_positively_confirmed():
    """Measured 2026-09-07: 34/46 confirmed by both sources agreeing. The rest are
    pages where one or both sources read nothing -- weaker, but not contradictory."""
    checks = verify_entry_pages("noh5")
    confirmed = sum(1 for c in checks if c.status == "confirmed")
    assert confirmed >= 30, f"only {confirmed}/46 confirmed; folio reading regressed"
