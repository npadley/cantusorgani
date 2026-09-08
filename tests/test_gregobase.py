import pytest

from pipeline.gregobase import DUMP, load_chants, match_score, normalise_incipit

needs_dump = pytest.mark.skipif(not DUMP.exists(), reason="GregoBase dump not vendored")


def test_normalise_strips_accents_and_case():
    assert normalise_incipit("Kýrie eléison") == "kyrie eleison"


def test_normalise_drops_punctuation_and_collapses_space():
    assert normalise_incipit("Kyrie  (ad lib.)  I. - Clemens Rector") == \
        "kyrie ad lib i clemens rector"


def test_match_score_rewards_exact_incipit():
    assert match_score("kyrie eleison", "kyrie eleison") == 1.0
    assert match_score("kyrie eleison", "gloria in excelsis deo") < 0.5


def test_match_score_handles_empty():
    assert match_score("", "kyrie") == 0.0


@needs_dump
def test_dump_parses_to_thousands_of_chants():
    chants = load_chants()
    assert len(chants) > 15000
    assert all(c.incipit.strip() for c in chants)


@needs_dump
def test_null_columns_become_none_not_the_string_NULL():
    """Unquoted NULL parsed as the four-character string "NULL" silently dropped
    every row on the first pass, because each then failed the duplicate check."""
    chants = load_chants()
    assert any(c.cantusid is None for c in chants)
    assert not any(c.cantusid == "NULL" for c in chants)


@needs_dump
def test_copyrighted_chants_are_excluded_by_default():
    """Rows flagged copyrighted are not ours to redistribute, whatever licence
    covers the surrounding database."""
    free = load_chants()
    everything = load_chants(include_copyrighted=True)
    assert len(everything) > len(free)


@needs_dump
def test_gabc_survives_parsing_with_its_commas_and_quotes():
    with_gabc = [c for c in load_chants() if c.gabc]
    assert len(with_gabc) > 15000
    assert any("(" in (c.gabc or "") for c in with_gabc)
