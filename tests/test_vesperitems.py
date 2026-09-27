"""Dividing NOH8's office sections into Vespers items (pipeline.vesperitems).

Segmentation runs on synthetic systems -- text layer, margin OCR, the lines
printed above -- so each rule is tested on its own."""

from __future__ import annotations

import pytest

from pipeline.vesperitems import (
    Item,
    OfficeSystem,
    antiphon_number,
    best_item,
    heading_of,
    match_score,
    propose_offices,
    segment,
    tone_of,
)


def s(ref: str, text: str = "", margin: str = "", above: str = "", hymn: str | None = None) -> OfficeSystem:
    return OfficeSystem(f"noh8/0100/{ref}", text, margin, above, hymn)


@pytest.mark.parametrize(("margin", "text", "n"), [
    ("3. Ant. IV. g", "", 3), ("]. Ant. VIILG", "", None), ("I. Ant. Vil.c 2", "", 1),
    ("", "5. Ant. IV.A* Ec _ ce", 5), ("4. Anc. VI. a", "", 4), ("Ad Magnif. Ant. I. g", "", None),
])
def test_antiphon_number_reads_the_label(margin, text, n):
    assert antiphon_number(margin, text) == n


def test_tone_of_first_source_with_a_tone():
    assert tone_of("2. Ant. lil. b") == "III.b"
    assert tone_of("f\\ 4 a a", "3. Ant. VII. b tum est") == "VII.b"
    assert tone_of("nothing here") is None


@pytest.mark.parametrize(("text", "heading"), [
    ("Oralio. Excita Domine... DOMINICA III. ADVENTUS", "DOMINICA III. ADVENTUS"),
    ("IN II. VESPERIS Antiphonae", "IN II. VESPERIS"),
    ("IN I VESPERIS", "IN I. VESPERIS"),
    ("Capitulum. Apparuit", None),
])
def test_heading_of_normalises_vespers_headings(text, heading):
    assert heading_of(text) == heading


def test_segment_antiphons_psalm_openings_hymn_versicle_and_magnificat():
    systems = [
        s("000", "In il_la di _ e", "1. Ant. VIII. G"),
        s("001", "et col_les flu_ent lac et mel. al_le_lu_ia. E u o u a e."),
        s("002", "Ps. Di_xit Do_mi_nus Do_mi_no me_o"),
        s("003", "Ju _ cun _ da re", "2. Ant. VIII.G*"),
        s("004", "al_le_lu_ia. E u o u a e."),
        s("005", "1. Cre_a_tor al_me si_de_rum", above="HYMNUS", hymn="Creator alme siderum"),
        s("006", "In sae_cu_lo_rum sae_cu_la. A_men."),
        s("007", "Y. Ro_ra_te cae_li de_su_per"),
        s("008", "R. A_pe_ri_a_tur ter_ra"),
        s("009", "Ne ti_me_as Ma_ri_a", "VIII.G", above="Ad Magnificat, Antiphona."),
        s("010", "al_le_lu_ia. E u o u a e."),
    ]
    blocks = segment(systems)
    assert len(blocks) == 1
    kinds = [(i.kind, i.number, i.tone, len(i.refs)) for i in blocks[0].items]
    assert kinds == [("antiphon", 1, "VIII.G", 2), ("psalm-opening", 1, "VIII.G", 1),
                     ("antiphon", 2, "VIII.G*", 2), ("hymn", None, None, 2), ("versicle", None, None, 2),
                     ("magnificat-antiphon", None, "VIII.G", 2)]


def test_segment_second_vespers_starts_a_new_block_at_its_heading():
    systems = [s("000", "Rex pa_ci_fi_cus. E u o u a e.", "1. Ant. VIII.G"),
               s("001", "Cum or_tus. E u o u a e.", above="Ad Magnificat, Antiphona."),
               s("002", "Te_cum prin_ci_pi_um. E u o u a e.", "1. Ant. I.g", above="IN II. VESPERIS")]
    blocks = segment(systems)
    assert [b.heading for b in blocks] == [None, "IN II. VESPERIS"]


def test_segment_a_labelled_antiphon_wins_over_a_misplaced_hymn_index():
    """Epiphany p. 93: the hymn index points at "Stella ista"; the hymn starts
    under "HYMNUS" two systems later."""
    systems = [s("000", "Stel_la i_sta sic_ut flam_ma", "5.Ant. VIL c 2", hymn="Crudelis Herodes"),
               s("001", "ob_tu_le_runt. E u o u a e."),
               s("002", "Cru_de_lis He_ro_des", above="Deo gratias. HYMNUS")]
    items = segment(systems)[0].items
    assert [(i.kind, i.refs[0][-3:], i.title) for i in items] == [("antiphon", "000", None),
                                                                  ("hymn", "002", "Crudelis Herodes")]


def test_match_score_reads_divinum_officium_against_the_text_layer():
    assert match_score("Rex pacíficus * magnificátus est", "Rex pa _ ci _ fi _ eus ma _gni _ fi _ ca _ tus est") > 0.8
    assert match_score("Jurávit Dóminus, * et non", "Rex pa _ ci _ fi _ eus ma _gni _ fi _ ca _ tus est") < 0.5
    assert match_score("O", "anything") == 0.0


def test_best_item_prefers_the_numbered_antiphon_of_its_own_section_over_a_weak_match():
    own = Item("antiphon", ["noh8/0079/003"], number=4)
    other = Item("antiphon", ["noh8/0186/004"], number=2)
    texts = {"noh8/0079/003": "ad a _ quas:",
             "noh8/0186/004": "Om _ nes si _ ti _ en _ tes, ve _ ni _ te ad a _ quas: quae _ ri _ te"}
    found = best_item("Omnes sitiéntes, * veníte ad aquas", [("adv", own), ("cor", other)], texts,
                      ("adv",), ("antiphon",), number=4)
    assert found is not None and found.item is other          # a strong reading elsewhere wins
    texts["noh8/0186/004"] = "som_ething else"
    found = best_item("Omnes sitiéntes, * veníte ad aquas", [("adv", own), ("cor", other)], texts,
                      ("adv",), ("antiphon",), number=4)
    assert found is None or found.item is own


def test_propose_offices_aligns_texts_reuses_shared_antiphons_and_scores():
    from pipeline import vesperitems
    systems = {"vesperae-in-nativitate-domini": [
        s("000", "Rex pa _ ci _ fi _ eus ma_gni_fi_ca_tus est. E u o u a e.", "1. Ant. VIII.G", above="IN I. VESPERIS"),
        s("001", "Cum or _ tus fu_e_rit sol de cae_lo. E u o u a e.", "VIII.G", above="Ad Magnificat, Antiphona."),
        s("002", "Ho_di_e Chri_stus na_tus est. E u o u a e.", "I.g2", above="IN II. VESPERIS Ad Magnificat, Antiphona."),
    ]}
    do = {"offices": {"Sancti/12-25": {"hymn": None, "I": {
        "antiphons": [{"text": "Rex pacíficus * magnificátus est", "psalm": 109}],
        "magnificat": "Cum ortus fúerit * sol de cælo", "chapter": None, "versicle": []}, "II": {
        "antiphons": [{"text": "Rex pacíficus * magnificátus est", "psalm": 109}],
        "magnificat": "Hódie * Christus natus est", "chapter": None, "versicle": []}}}}
    specs = tuple(x for x in vesperitems.OFFICE_SPECS if x.do_key == "Sancti/12-25")
    original = vesperitems.OFFICE_SPECS
    vesperitems.OFFICE_SPECS = specs
    try:
        offices = propose_offices(systems, do)
    finally:
        vesperitems.OFFICE_SPECS = original
    first, second = offices["nativitas-1"], offices["nativitas-2"]
    assert first["antiphons"][0]["refs"] == ["noh8/0100/000"] and first["antiphons"][0]["score"] > 0.8
    assert second["antiphons"][0]["refs"] == first["antiphons"][0]["refs"]      # shared: reused
    assert first["magnificat"]["refs"] == ["noh8/0100/001"]
    assert second["magnificat"]["refs"] == ["noh8/0100/002"]


def test_propose_offices_hymn_by_title_with_its_versicle_and_missing_office():
    from pipeline import vesperitems
    systems = {"vesperae-in-nativitate-domini": [
        s("000", "Rex pa _ ci _ fi _ eus ma_gni_fi_ca_tus est. E u o u a e.", "1. Ant. VIII.G", above="IN I. VESPERIS"),
        s("001", "1. Je_su Red_emp_tor o_mni_um", above="HYMNUS", hymn="Jesu Redemptor omnium"),
        s("002", "Y. Cra_sti_na di_e de_le_bi_tur"),
        s("003", "R. Et re_gna_bit su_per nos"),
        s("004", "Cum or _ tus fu_e_rit sol de cae_lo. E u o u a e.", "VIII.G", above="Ad Magnificat, Antiphona."),
    ]}
    do = {"offices": {"Sancti/12-25": {"hymn": "Jesu, Redémptor ómnium,", "I": {
        "antiphons": [{"text": "Rex pacíficus * magnificátus est", "psalm": 109}],
        "magnificat": "Cum ortus fúerit * sol de cælo", "chapter": "Appáruit benígnitas", "versicle": []},
        "II": {"antiphons": [], "magnificat": None, "chapter": None, "versicle": []}}}}
    original = vesperitems.OFFICE_SPECS
    vesperitems.OFFICE_SPECS = (vesperitems._spec("nativitas-1", "Sancti/12-25", "I", "in-nativitate-domini"),
                                vesperitems._spec("gone", "Sancti/99-99", "II", "in-nativitate-domini"))
    try:
        offices = propose_offices(systems, do)
    finally:
        vesperitems.OFFICE_SPECS = original
    first = offices["nativitas-1"]
    assert first["hymn"] == {"title": "Jesu Redemptor omnium", "refs": ["noh8/0100/001"],
                             "section": "vesperae-in-nativitate-domini"}
    assert first["versicle"] == ["noh8/0100/002", "noh8/0100/003"]
    assert first["chapter"] == "Appáruit benígnitas"
    assert offices["gone"] == {"error": "no Divinum Officium text for Sancti/99-99"}


def test_hymn_unknown_title_is_none():
    from pipeline.vesperitems import _hymn
    assert _hymn("O prima, Virgo, pródita", [("x", Item("hymn", ["r"], title="Ave maris stella"))], ("x",)) is None
