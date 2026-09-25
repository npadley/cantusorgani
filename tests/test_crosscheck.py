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
    """Every index entry lands on a real body page under the derived offset.

    This verifies the OFFSET. It cannot catch a transcription slip that stays in
    range -- see test_folio_check_cannot_detect_an_in_range_typo.
    """
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


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
def test_folio_check_cannot_detect_an_in_range_typo():
    """Pins down the limitation so nobody relies on this check for transcription.

    Missa X truly begins at printed 58. A mistyped 53 or 83 also lands on a page
    whose own folio matches, so the folio check confirms all three. If this test
    ever fails, the check has gained real transcription-verifying power and the
    docstrings above should be revised.
    """
    from pipeline.folio import read_folio_dual
    from pipeline.offset import load_offset

    offset = load_offset("noh5")
    for claimed in (58, 53, 83):
        assert read_folio_dual("noh5", claimed + offset).folio == claimed
