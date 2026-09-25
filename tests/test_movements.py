"""Movement detection and per-system text. Pure functions run on synthetic OCR
strings modelled on real NOH5 output; page-reading functions run on the source."""

import pytest

from pipeline.movements import MIN_SCORE, MovementHit, best_match, mode_marker
from pipeline.systemtext import condense, system_texts

# Real OCR strings captured from NOH5, used as fixtures.
KYRIE_WITH_LEADING_JUNK = ", I, VHf. ~ 4V, Ky _ ri _ e e _ le _ i _ son. Ky _ ri _ e"
GLORIA = "Glo _ ri _ a in ex _ cel _ sis De _ o. Et in ter _ ra pax"
SANCTUS = "San _ ctus. San _ ctus. San _ ctus Do _ mi _ nus De _ us"
AGNUS = "A _ gnus De _ i, qui tol _ lis pec _ ca _ ta mun _ di"


def test_condense_hyphenated_ocr_becomes_bare_letters():
    assert condense("Ky _ ri _ e e _ lé _ i _ son.") == "kyrieeleison"


def test_condense_strips_digits_and_punctuation():
    assert condense("12'4 • ~~ ---") == ""


@pytest.mark.parametrize("text,expected", [
    (KYRIE_WITH_LEADING_JUNK, "kyrie"),
    (GLORIA, "gloria"),
    (SANCTUS, "sanctus"),
    (AGNUS, "agnus"),
])
def test_best_match_known_incipits_are_identified(text, expected):
    hit = best_match(text)
    assert hit is not None
    assert hit.movement == expected


def test_best_match_tolerates_leading_junk_before_the_incipit():
    """Missa I's Kyrie carries twelve characters of noise first; anchoring at
    position 0 missed it entirely."""
    hit = best_match(KYRIE_WITH_LEADING_JUNK)
    assert hit is not None and hit.offset > 0


def test_best_match_text_too_short_returns_none():
    assert best_match("Ky _ e") is None


def test_best_match_unrelated_text_returns_none():
    assert best_match("quon _ dam pau _ pe _ re ae _ ter _ nam ha _ be _ as") is None


def test_best_match_carries_the_left_margin_mode_marker():
    hit = best_match(GLORIA, left_margin="IV.")
    assert hit is not None and hit.mode_marker == "IV"


@pytest.mark.parametrize("score,marker,expected", [
    (0.90, None, True),      # strong text alone is enough
    (0.70, "II", True),      # borderline text corroborated by a mode number
    (0.70, None, False),     # borderline text alone is not
    (MIN_SCORE - 0.01, "II", False),
])
def test_movement_hit_confident_combines_text_and_mode(score, marker, expected):
    assert MovementHit("kyrie", score, "kyrieeleison", 0, marker).confident is expected


@pytest.mark.parametrize("margin,expected", [
    ("VHf.", "VIII"),   # real OCR of "VIII." on NOH5 p51
    ("II", "II"),
    ("Intr. VI", "VI"),
    ("", None),
    ("~ @ ,", None),
])
def test_mode_marker_reads_roman_numerals_through_ocr_damage(margin, expected):
    assert mode_marker(margin) == expected


@pytest.mark.xfail(strict=True, reason=(
    "Known false positive: a lone 'I' from brace/staff noise reads as mode I and can "
    "promote a borderline match to confident. Seen on NOH5 p51 system 4. Needs a "
    "measured fix, not a guess; strict so this fails loudly once corrected."))
def test_mode_marker_stray_noise_is_not_a_mode():
    assert mode_marker('" I, @) f') is None


@pytest.mark.source
def test_system_texts_one_string_per_system():
    texts = system_texts("noh5", 229)
    assert len(texts) == 5
    assert "EXSEQU" not in " ".join(texts).upper(), "running head must not leak into a system"


@pytest.mark.source
def test_system_texts_page_without_music_is_empty():
    assert system_texts("noh5", 231) == []
