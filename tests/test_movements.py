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


# ------------------------------------------------------- Mass segmentation ---

from pipeline.movements import (
    SystemFeature,
    expected_movements,
    movement_score,
    segment_mass,
)

GLORIA = "etinterrapaxhominibusbonaevoluntatis"
SANCTUS = "sanctussanctussanctusdominusdeus"
AGNUS = "agnusdeiquitollispeccatamundimiserere"


@pytest.fixture
def mass_systems() -> list[SystemFeature]:
    """Twenty systems: Kyrie 0-4, Gloria 5-12 (with its own 'Agnus Dei'), Sanctus
    13-15, Agnus 16-18, Ite 19."""
    texts = ["kyrieeleisonkyrie"] + ["eleisonchristeeleison"] * 4
    texts += [GLORIA, "laudamustebenedicimuste", "gratiasagimustibi", "dominedeusagnusdeifiliuspatris",
              "quitollispeccatamundi", "quisedesaddexteram", "quoniamtusolussanctus", "cumsanctospiritu"]
    texts += [SANCTUS, "plenisuntcaelietterra", "hosannainexcelsis"]
    texts += [AGNUS, "agnusdeiquitollispeccata", "donanobispacem", "itemissaestdeogratias"]
    return [SystemFeature(f"noh5/0100/{i:03d}", t) for i, t in enumerate(texts)]


def test_movement_score_opening_words_and_short_text():
    assert movement_score("sanctus", SANCTUS) > 0.9
    assert movement_score("sanctus", "xy") == 0.0


def test_expected_movements_no_gloria_in_ferial_masses():
    assert expected_movements("IX") == ("kyrie", "gloria", "sanctus", "agnus", "ite")
    assert expected_movements("XVII") == ("kyrie", "sanctus", "agnus", "ite")


def test_segment_mass_places_each_movement_in_order(mass_systems):
    placed = segment_mass(mass_systems, expected_movements("IX"))
    assert [(b.movement, b.index) for b in placed] == [
        ("kyrie", 0), ("gloria", 5), ("sanctus", 13), ("agnus", 16), ("ite", 19)]
    assert all(b.confident for b in placed)


def test_segment_mass_ignores_agnus_dei_sung_inside_the_gloria(mass_systems):
    placed = {b.movement: b.index for b in segment_mass(mass_systems, expected_movements("IX"))}
    assert placed["agnus"] == 16          # not system 8, "Domine Deus, Agnus Dei"


def test_segment_mass_places_a_damaged_movement_by_order(mass_systems):
    damaged = list(mass_systems)
    damaged[13] = SystemFeature(damaged[13].ref, "vellssanelusxxqqzz")       # OCR ruin
    sanctus = next(b for b in segment_mass(damaged, expected_movements("IX")) if b.movement == "sanctus")
    # Placed at the end of the Gloria at worst ("tu solus sanctus"), and flagged:
    # a weak placement is never published as confident.
    assert 11 <= sanctus.index <= 15
    assert not sanctus.confident


def test_segment_mass_mode_marker_raises_confidence():
    systems = [SystemFeature(f"r{i}", "eleisonxxxxxxxx") for i in range(8)]
    systems[5] = SystemFeature("r5", "sancxussanxtusdom", "IV")
    placed = segment_mass(systems, ("kyrie", "sanctus"))
    assert placed[1].index == 5 and placed[1].mode_marker == "IV" and placed[1].confident


def test_segment_mass_leaves_out_an_unmatched_dismissal(mass_systems):
    no_ite = mass_systems[:-1]
    assert [b.movement for b in segment_mass(no_ite, expected_movements("IX"))][-1] == "agnus"


def test_segment_mass_too_short_or_empty():
    assert segment_mass([], expected_movements("IX")) == []
    only = [SystemFeature("r0", "kyrieeleison")]
    assert [b.movement for b in segment_mass(only, expected_movements("IX"))] == ["kyrie"]


def test_kyrie_offset_skips_the_end_of_the_mass_before():
    from pipeline.movements import kyrie_offset
    systems = [SystemFeature("a", "aofiquitollispeccatamundi"),
               SystemFeature("b", "donanobispacemitemissaestvelbenedicamus"),
               SystemFeature("c", "cunctipotensgenitordeuskyrieeleison"),
               SystemFeature("d", "christeeleisonchristeeleison")]
    assert kyrie_offset(systems) == 2


def test_kyrie_offset_leaves_a_mass_that_starts_cleanly():
    from pipeline.movements import kyrie_offset
    systems = [SystemFeature("a", "cumiubilokyrieeleison"), SystemFeature("b", "christeeleison"),
               SystemFeature("c", "kyrieeleisonkyrie")]
    assert kyrie_offset(systems) == 0


def _mass(texts: list[str]) -> list[SystemFeature]:
    return [SystemFeature(f"r{i}", t) for i, t in enumerate(texts)]


KYRIE = ["kyrieeleisonkyrie", "eleisonchristeeleison", "christeeleisonkyrie", "kyrieeleisonxx"]


def test_segment_mass_sanctus_follows_the_glorias_last_line():
    """Mass II: the Gloria's "tu solus Sanctus" scores better than the real,
    OCR-ruined Sanctus, which follows "... in gloria Dei Patris. Amen"."""
    texts = KYRIE + [GLORIA, "laudamuste", "gratiasagimus", "dominedeus", "quitollispeccata",
                     "quisedesaddexterampatrismiserere", "quoniamtusolussanctustusolus",
                     "altissimusjesuchristecumsanctospiritu", "ingloriadeipatrisamen",
                     "silndllssilnetllssiln", "dominusdeussabaothpleni", "hosannainexcelsis",
                     AGNUS, "donanobispacem"]
    placed = {b.movement: b.index for b in segment_mass(_mass(texts), ("kyrie", "gloria", "sanctus", "agnus"))}
    assert placed["sanctus"] == 13
    assert placed["agnus"] == 16


def test_segment_mass_agnus_follows_the_last_hosanna():
    """Mass III: the Agnus's first line is lost to OCR ("ivpeed"); it is the
    system after the Sanctus's last "Hosanna in excelsis"."""
    texts = KYRIE + [SANCTUS, "dominusdeussabaothplenisunt", "gloriatuahosannainexcelsis",
                     "benedictusquivenit", "hosannainexcelsis", "ivpeed", "amundimiserere", "donanobis"]
    placed = {b.movement: b for b in segment_mass(_mass(texts), ("kyrie", "sanctus", "agnus"))}
    assert placed["agnus"].index == 9
    assert not placed["agnus"].confident


def test_segment_mass_sanctus_found_by_sabaoth_without_a_gloria():
    """Mass XVII: no Gloria; the Sanctus's first system is only a mode number,
    the next reads "Dominus Deus Sabaoth"."""
    texts = KYRIE + ["kyrieeleisonkyrie"] * 3 + ["v", "dominusdeussabaothplenisunt", "hosannainexcelsis",
                                                 AGNUS, "donanobis", "itemissaestdeogratias"]
    placed = {b.movement: b.index for b in segment_mass(_mass(texts), expected_movements("XVII"))}
    assert placed["sanctus"] == 7
    assert placed["agnus"] == 10


def test_segment_mass_sabaoth_does_not_step_back_from_a_real_sanctus():
    texts = KYRIE + ["", "sanctussanctussanctusdominusdeus", "plenisunt", "hosanna", AGNUS, "dona"]
    placed = {b.movement: b.index for b in segment_mass(_mass(texts), ("kyrie", "sanctus", "agnus"))}
    assert placed["sanctus"] == 5


def test_ends_a_mass_finds_the_dismissal_anywhere():
    from pipeline.movements import ends_a_mass
    assert ends_a_mass("iiroundlnonannfjspacerniivrjrdjhemissaestvelb")
    assert not ends_a_mass("kyrieeleisonchristeeleison")
