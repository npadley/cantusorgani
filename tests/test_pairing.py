import pytest

from pipeline.gregobase import DUMP, load_chants
from pipeline.index import load_index
from pipeline.pairing import pair_chant, roman_of, status_for

needs_dump = pytest.mark.skipif(not DUMP.exists(), reason="GregoBase dump not vendored")


def test_high_score_is_verified():
    assert pair_chant(score=0.95)["status"] == "verified"


def test_low_score_is_unverified_not_hidden():
    result = pair_chant(score=0.55)
    assert result["status"] == "unverified"
    assert result["display"] is True, "show it, but labelled — never silently drop"


def test_very_low_score_is_not_paired():
    result = pair_chant(score=0.2)
    assert result["status"] == "unpaired"
    assert result["display"] is False


@pytest.mark.parametrize("score,expected", [
    (1.0, "verified"), (0.85, "verified"), (0.84, "unverified"),
    (0.45, "unverified"), (0.44, "unpaired"), (0.0, "unpaired"),
])
def test_threshold_boundaries(score, expected):
    assert status_for(score) == expected


@pytest.mark.parametrize("text,expected", [
    ("Gloria III", "III"), ("Agnus Dei IV", "IV"), ("Kyrie XVIII", "XVIII"),
    ("Kyrie (ad lib.) IX. - O Pater excelse", "IX"), ("Clemens Rector", None),
])
def test_roman_of(text, expected):
    assert roman_of(text) == expected


@pytest.fixture(scope="module")
def paired():
    from pipeline.pairing import pair_entry
    chants = load_chants()
    return {e.slug: pair_entry(e, chants) for e in load_index("noh5")}


@needs_dump
def test_missa_i_pairs_to_the_plain_ordinary_movements(paired):
    got = {p.movement: p.chant_incipit for p in paired["ordinarium-missae-i"]}
    assert got["kyrie"] == "Kyrie I"
    assert got["gloria"] == "Gloria I"
    assert got["agnus"] == "Agnus Dei I"


@needs_dump
def test_missa_regia_never_pairs_to_a_numbered_ordinary(paired):
    """Du Mont's Missa Regia shares the Kyriale's movement names and numbering.
    Pairing 'Sanctus (Missa Regia I)' to NOH5's Missa I and calling it verified
    is exactly what makes a confidence label worthless."""
    for pairing in paired["ordinarium-missae-i"]:
        assert "Missa Regia" not in pairing.chant_incipit


@needs_dump
def test_ambrosian_gloria_does_not_capture_mass_iii(paired):
    for pairing in paired["ordinarium-missae-iii"]:
        assert "ambrosiano" not in pairing.chant_incipit.lower()


@needs_dump
def test_requiem_does_not_pair_to_kyriale_ordinaries(paired):
    """The 'I' in 'Missa pro Defunctis I' is a section ordinal, not a Kyriale
    number, and the Requiem has no Gloria at all. A one-directional repertoire
    check paired it to Kyrie/Gloria/Sanctus I at 0.85 'verified'."""
    assert paired["missa-pro-defunctis-i"] == []


@needs_dump
def test_ad_libitum_kyrie_pairs_by_its_latin_title(paired):
    pairings = paired["cantus-ad-libitum-kyrie-i"]
    assert len(pairings) == 1
    assert "Clemens Rector" in pairings[0].chant_incipit
    assert pairings[0].status == "verified"


@needs_dump
def test_numbered_ordinary_never_matches_an_ad_libitum_chant(paired):
    for pairing in paired["ordinarium-missae-iii"]:
        assert "ad lib" not in pairing.chant_incipit.lower()


@needs_dump
def test_most_pieces_are_paired(paired):
    assert sum(1 for v in paired.values() if v) >= 35
