import pytest

from pipeline.runninghead import normalise_head, read_running_head, vocabulary


def test_normalisation_keeps_digits():
    """Masses IV-VIII are all 'In Festis Duplicibus', separated only by a trailing
    digit. Dropping digits collapses five sections into one."""
    assert normalise_head("In Festis Duplicibus 3") == "IN FESTIS DUPLICIBUS 3"
    assert normalise_head("In Festis Duplicibus 1") != normalise_head("In Festis Duplicibus 3")


def test_normalisation_strips_accents_and_punctuation():
    assert normalise_head("Missae Praefationum, ad Pater") == "MISSAE PRAEFATIONUM AD PATER"


def test_folio_digits_are_dropped_when_requested():
    assert normalise_head("IN EXSEQUDS 183", drop_folio=True) == "IN EXSEQUDS"


def test_vocabulary_is_derived_from_the_index():
    v = vocabulary("noh5")
    assert "IN FESTIS DUPLICIBUS 3" in v
    assert v["IN FESTIS DUPLICIBUS 3"] == "VI"


@pytest.mark.source
@pytest.mark.parametrize("pdf_page,expected", [
    (51, "I"),          # 'I. TEMPORE PASCHALl'
    (63, "III"),        # 'm. IN FESTIS SOLEMNIBUS 2 17'
    (81, "VI"),         # 'VI. IN FESTIS DUPLICmUS 3 35'
    (144, "Credo I"),   # '98 CREDO I.'
    (229, "III"),       # 'IN EXSEQUDS 183' -- noisy OCR of IN EXSEQUIIS
    (200, "Credo V"),   # '151 CANTUS AD LIBITUM - CREDO V' -- entry beats section
])
def test_matches_noisy_running_heads(pdf_page, expected):
    assert read_running_head("noh5", pdf_page).matched == expected


@pytest.mark.source
@pytest.mark.parametrize("pdf_page", [57, 87, 170, 198])
def test_fragments_match_nothing(pdf_page):
    """Heads that survive as 'II', \"'11\", \"12'4\" or a bare folio carry too little
    to identify a section. Matching them would be a coin flip dressed as a result."""
    assert read_running_head("noh5", pdf_page).matched is None
