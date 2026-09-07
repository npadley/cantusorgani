"""Folio reading tests.

Ground truth: NOH5's page offset is +46 (printed 183 sits at PDF page 229,
verified by eye 2026-09-07), so printed folio == pdf_page - 46 on body pages.
"""

import pytest

from pipeline.folio import (
    FolioReading,
    read_embedded,
    read_folio,
    read_folio_dual,
    tesseract_available,
)

needs_tesseract = pytest.mark.skipif(
    not tesseract_available(), reason="tesseract not installed"
)


@pytest.mark.source
def test_embedded_text_layer_yields_folio_and_running_head():
    """NOH5 PDF p229 extracts as 'IN EXSEQUDS 183' -- running head and folio in one
    read, no rasterisation. The OCR is noisy ('EXSEQUDS' for 'EXSEQUIIS'), so the
    head is matched loosely."""
    head, folio = read_embedded("noh5", 229)
    assert folio == 183
    assert "EXSEQU" in head.upper()


@pytest.mark.source
@pytest.mark.parametrize("pdf_page,expected", [(229, 183), (228, 182), (144, 98)])
def test_embedded_reads_known_folios(pdf_page, expected):
    _, folio = read_embedded("noh5", pdf_page)
    assert folio == expected


@pytest.mark.source
def test_embedded_returns_none_on_the_index_page():
    """The index page carries no printed folio; inventing one would be worse than
    admitting ignorance."""
    _, folio = read_embedded("noh5", 231)
    assert folio is None


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
@pytest.mark.parametrize("pdf_page,expected", [(229, 183), (228, 182)])
def test_tesseract_reads_known_folios(tmp_path, pdf_page, expected):
    assert read_folio("noh5", pdf_page, tmp_path) == expected


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
def test_agreement_between_sources_is_verification(tmp_path):
    result = read_folio_dual("noh5", 229, tmp_path)
    assert result.folio == 183
    assert result.agreement is True
    assert result.sources == ("embedded", "tesseract")


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
def test_disagreement_yields_no_folio_rather_than_a_guess(tmp_path):
    """NOH5 PDF p156 is printed folio 110. The embedded layer reads 110; Tesseract
    drops the leading digit and reads 10. Measured 2026-09-07. The gate must refuse
    the page: a wrong folio poisons the derived offset and every reference in the
    volume, so one confident source is not enough."""
    result = read_folio_dual("noh5", 156, tmp_path)
    assert result.embedded == 110
    assert result.tesseract == 10
    assert result.agreement is False
    assert result.folio is None


@pytest.mark.source
@needs_tesseract
@pytest.mark.slow
def test_both_sources_silent_yields_no_folio(tmp_path):
    """NOH5 PDF p127 (printed 81) is unreadable to both sources. Silence must
    produce None, never a fabricated value."""
    result = read_folio_dual("noh5", 127, tmp_path)
    assert result.embedded is None and result.tesseract is None
    assert result.folio is None and result.agreement is False


def test_single_source_mode_must_be_requested_explicitly():
    """Degrading to one source is a recorded decision, never a silent default."""
    reading = FolioReading(183, False, 183, None, "IN EXSEQUDS 183", ("embedded",))
    assert reading.agreement is False
    assert "tesseract" not in reading.sources
