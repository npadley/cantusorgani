"""Dividing a Proper into its parts (pipeline.parts).

Segmentation runs on synthetic systems -- no scans, no GregoBase dump -- so each
rule is tested on its own. The golden test on real pages is in
tests/test_catalog_invariants.py."""

from __future__ import annotations

import pytest

from pipeline.parts import (
    ExpectedPart,
    PartSystem,
    borrowed_parts,
    chant_text,
    expected_parts,
    label_of,
    link_parts,
    margin_mode,
    segment_proper,
)


def sys_(text: str = "", label: str | None = None, marker: str | None = None, ref: str = "") -> PartSystem:
    return PartSystem(ref=ref, text=text, label=label, mode_marker=marker)


def exp(part: str, opening: str | None = None, variant: str = "", optional: bool = False,
        gid: int | None = None) -> ExpectedPart:
    return ExpectedPart(part=part, variant=variant, opening=opening, gregobase_id=gid, optional=optional)


def refs(systems: list[PartSystem]) -> list[PartSystem]:
    return [PartSystem(ref=f"v/0001/{i:03d}", text=s.text, label=s.label, mode_marker=s.mode_marker)
            for i, s in enumerate(systems)]


# ------------------------------------------------------------- labels ---


@pytest.mark.parametrize(("margin", "expected"), [
    ("Intr. Ill.", "introit"), ("| Intr. Il . |", "introit"), ("lntr. V", "introit"),
    ("Grad. Vv.", "gradual"), ("Tract. If.", "tract"), ("Offert. [.", "offertory"),
    ("| Offert. [. |", "offertory"), ("Comm Vil.", "communion"), ("Comm. JP VOl.", "communion"),
    ("Sequentia", "sequence"),
])
def test_label_of_ocr_variants_reads_the_part(margin: str, expected: str):
    assert label_of(margin) == expected


def test_label_of_reference_line_ut_supra_is_not_a_label():
    """"Graduale. Qui operatus est, ut supra, p. 45." names a part printed elsewhere."""
    assert label_of("Graduale. Qui operatus est, ut supra, p. 45.") is None
    assert label_of("Offertorium. Veritas mea, ibid., p. 80.") is None


def test_label_of_noise_and_mode_only_return_none():
    assert label_of("VII.") is None
    assert label_of("f) # 7% > my’ psi") is None
    assert label_of("") is None


# ------------------------------------------------------------ segmenting ---


def test_segment_proper_empty_input_returns_empty():
    assert segment_proper([], [exp("introit")]).parts == []
    assert segment_proper(refs([sys_("x")]), []).parts == []


def test_segment_proper_label_present_places_by_label():
    systems = refs([sys_("venidelibano", label="introit"), sys_("a"), sys_("b"),
                    sys_("confiteor", label="gradual"), sys_("c"), sys_("d"),
                    sys_("magnificat", label="offertory"), sys_("e"),
                    sys_("circumduxit", label="communion"), sys_("f")])
    result = segment_proper(systems, [exp("introit"), exp("gradual"), exp("offertory"), exp("communion")])
    assert [(p.part, p.index, p.placed) for p in result.parts] == [
        ("introit", 0, "label"), ("gradual", 3, "label"), ("offertory", 6, "label"), ("communion", 8, "label")]
    assert result.problems == []


def test_segment_proper_text_match_places_without_a_label():
    systems = refs([sys_("Ve _ ni de Li _ ba _ no spon _ sa"), sys_("x"), sys_("y"),
                    sys_("Con _ fi _ te _ or ti _ bi Pa _ ter"), sys_("z")])
    result = segment_proper(systems, [exp("introit", "venidelibanosponsa"),
                                      exp("gradual", "confiteortibipater")])
    assert [(p.part, p.index, p.placed) for p in result.parts] == [
        ("introit", 0, "text"), ("gradual", 3, "text")]


def test_segment_proper_reference_line_ut_supra_not_a_start():
    """A part printed elsewhere is named in the text under a system; it is not
    that part's start."""
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b"),
                    sys_("Graduale. Qui operatus est, ut supra, p. 45. Al le lu ia", marker="VIII"),
                    sys_("c"), sys_("d", label="offertory"), sys_("e"), sys_("f", label="communion")])
    result = segment_proper(systems, [exp("introit"), exp("offertory"), exp("communion")])
    assert [p.part for p in result.parts] == ["introit", "offertory", "communion"]
    assert result.parts[1].index == 5


def test_segment_proper_alleluia_found_by_mode_number_and_its_first_word():
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b", label="gradual"), sys_("c"),
                    sys_("Al _ le _ lu _ ia al le", marker="VII"), sys_("d"),
                    sys_("e", label="offertory"), sys_("g"), sys_("h", label="communion")])
    result = segment_proper(systems, [exp("introit"), exp("gradual"), exp("alleluia", "quasirosa"),
                                      exp("offertory"), exp("communion")])
    assert [(p.part, p.index) for p in result.parts][2] == ("alleluia", 4)


def test_segment_proper_no_confident_system_places_by_order_and_queues():
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b"), sys_("c", marker="V"),
                    sys_("d"), sys_("e"), sys_("f", label="communion"), sys_("g")])
    result = segment_proper(systems, [exp("introit"), exp("gradual", "confiteor"), exp("communion")])
    gradual = result.parts[1]
    assert (gradual.part, gradual.index, gradual.placed) == ("gradual", 3, "order")
    assert ("part_by_order", "gradual") in [(p.kind, p.part) for p in result.problems]


def test_segment_proper_optional_part_absent_is_skipped_silently():
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b", label="gradual"), sys_("c"),
                    sys_("d", label="offertory"), sys_("e"), sys_("f", label="communion")])
    result = segment_proper(systems, [exp("introit"), exp("gradual"), exp("tract", optional=True),
                                      exp("offertory"), exp("communion")])
    assert [p.part for p in result.parts] == ["introit", "gradual", "offertory", "communion"]
    assert result.problems == []


def test_segment_proper_too_few_systems_marks_missing():
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b")])
    result = segment_proper(systems, [exp("introit"), exp("gradual", "zzz"), exp("offertory", "qqq"),
                                      exp("communion", "rrr")])
    assert "part_missing" in {p.kind for p in result.problems}
    assert len(result.parts) < 4


def test_segment_proper_first_incipit_absent_marks_mismatch():
    """Neither a label nor the text finds the Introit: the scan is not this
    Proper (a blessing printed before the Mass, or 1942 and 1962 differ).
    Nothing is placed rather than forced."""
    systems = refs([sys_("Lumen ad revelationem", marker="VIII"), sys_("a"), sys_("b"), sys_("c")])
    result = segment_proper(systems, [exp("introit", "suscepimusdeus"), exp("communion", "responsum")])
    assert result.parts == []
    assert [p.kind for p in result.problems] == ["part_mismatch"]


def test_segment_proper_introit_after_a_blessing_is_found_by_label():
    """Candlemas: the blessing's antiphons come first; the Mass starts at "Intr."."""
    systems = refs([sys_("Lumen", marker="VIII"), sys_("a"), sys_("Suscepimus", label="introit"),
                    sys_("b"), sys_("c", label="gradual"), sys_("d")])
    result = segment_proper(systems, [exp("introit", "suscepimusdeus"), exp("gradual")])
    assert [(p.part, p.index) for p in result.parts] == [("introit", 2), ("gradual", 4)]


def test_segment_proper_duplicate_graduals_ember_saturday_keeps_both():
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b", label="gradual"), sys_("c"),
                    sys_("d", label="gradual"), sys_("e"), sys_("f", label="communion")])
    result = segment_proper(systems, [exp("introit"), exp("gradual", variant="1"),
                                      exp("gradual", variant="2"), exp("communion")])
    assert [(p.part, p.variant, p.index) for p in result.parts] == [
        ("introit", "", 0), ("gradual", "1", 2), ("gradual", "2", 4), ("communion", "", 6)]


def test_segment_proper_does_not_skip_past_a_later_parts_label():
    """Searching for the Gradual must stop at the Offertory's label: a text
    match beyond it belongs to something else."""
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b"), sys_("c", label="offertory"),
                    sys_("Con _ fi _ te _ or ti _ bi Pa _ ter"), sys_("d", label="communion")])
    result = segment_proper(systems, [exp("introit"), exp("gradual", "confiteortibipater"),
                                      exp("offertory"), exp("communion")])
    by_part = {p.part: p.index for p in result.parts}
    assert by_part["offertory"] == 3
    assert by_part.get("gradual", -1) < 3


# ------------------------------------------------------- expected parts ---


CHANTS = {59: ("in", "Veni de Libano sponsa mea"), 1034: ("gr", "Confiteor tibi Pater"),
          1257: ("al", "Alleluia Quasi rosa"), 362: ("of", "Magnificat anima mea"),
          162: ("co", "Circumduxit eam"), 500: ("tr", "Jam hiems transiit"),
          600: ("al", "Alleluia Florete flores")}


def test_expected_parts_orders_parts_and_adds_seasonal_variants():
    proprium = {"Oct3": {"inID": 59, "grID": 1034, "alID": 1257, "ofID": 362, "coID": 162},
                "Oct3Quad": {"trID": 500}, "Oct3Pasch": {"alID": 600}}
    parts = expected_parts("Oct3", proprium, CHANTS)
    assert [(p.part, p.variant, p.optional) for p in parts] == [
        ("introit", "", False), ("gradual", "", False), ("alleluia", "", False),
        ("tract", "", True), ("alleluia", "paschal", True),
        ("offertory", "", False), ("communion", "", False)]
    assert parts[0].opening == "venidelibanosponsamea"[:24]
    assert parts[0].gregobase_id == 59


def test_expected_parts_names_a_part_by_its_chant_not_its_field():
    """In Eastertide jgabc stores the first Alleluia under grID."""
    proprium = {"Pasc1": {"inID": 59, "grID": 1257, "alID": 600, "ofID": 362, "coID": 162}}
    parts = expected_parts("Pasc1", proprium, CHANTS)
    assert [p.part for p in parts][:3] == ["introit", "alleluia", "alleluia"]


def test_expected_parts_optional_tract_and_paschal_alleluia_always_offered():
    """NOH prints a Tract and a Paschal Alleluia even where jgabc lists neither."""
    parts = expected_parts("Oct3", {"Oct3": {"inID": 59, "coID": 162}}, CHANTS)
    optional = [(p.part, p.variant) for p in parts if p.optional]
    assert ("tract", "") in optional and ("alleluia", "paschal") in optional


def test_expected_parts_unknown_key_returns_empty():
    assert expected_parts("Nowhere", {}, CHANTS) == []


def test_chant_text_strips_neumes_and_markup():
    gabc = '[["tex","x"],["gabc","(c4) VE(gj)ni(jjj//jv) <i>T. P.</i> de(j) *() Lí(hj)ba(jvIH)no,(h.)"]]'
    assert chant_text(gabc) == "VEni T. P. de Líbano,"


# ------------------------------------------------------- borrowed parts ---


def test_borrowed_parts_reads_each_part_and_ibid():
    ref = ("Introitus. Mihi autem, ut supra, p. 4. Graduale. Nimis honorati sunt, ut supra, p. 2. "
           "Offertorium. Veritas mea, Pars IV, p. 80. Communio. Fidelis, ibid., p. 81.")
    assert borrowed_parts(ref, "noh3") == [("introit", "noh3", 4), ("gradual", "noh3", 2),
                                           ("offertory", "noh4", 80), ("communion", "noh4", 81)]


def test_borrowed_parts_whole_mass_reference_borrows_nothing_part_by_part():
    assert borrowed_parts("Missa. Os justi, Pars IV, p. 76.", "noh3") == []
    assert borrowed_parts("", "noh3") == []


def test_link_parts_borrowed_across_volumes_resolves_anchor():
    catalog = {"pieces": [
        {"volume": "noh4", "slug": "confessor", "printed_pages": [76, 81], "systems": ["a"],
         "sections": [{"kind": "offertory", "variant": "", "system": 5, "ref": "noh4/0110/002"}]},
        {"volume": "noh3", "slug": "borrower", "printed_pages": [11, 12], "systems": ["b"],
         "sections": [{"kind": "offertory", "variant": "", "borrowed_from": None,
                    "borrowed_volume": "noh4", "borrowed_page": 80}]},
    ]}
    unresolved = link_parts(catalog)
    part = catalog["pieces"][1]["sections"][0]
    assert part["borrowed_from"] == "confessor"
    assert part["borrowed_ref"] == "noh4/0110/002"
    assert unresolved == []


def test_link_parts_lender_missing_queues_review():
    catalog = {"pieces": [
        {"volume": "noh3", "slug": "borrower", "printed_pages": [11, 12], "systems": ["b"],
         "sections": [{"kind": "introit", "variant": "", "borrowed_from": None,
                    "borrowed_volume": "noh3", "borrowed_page": 999}]},
    ]}
    unresolved = link_parts(catalog)
    assert unresolved[0]["kind"] == "part_borrowed_unresolved"
    assert unresolved[0]["piece"] == "borrower"


@pytest.mark.parametrize(("margin", "expected"), [
    ("€ VIL.", "VII"), ("Vil.", "VII"), ("VI.", "VI"), ("Intr. Ill.", "III"), ("Tract. I. |", "I"),
])
def test_margin_mode_reads_the_printed_mode_number(margin: str, expected: str):
    assert margin_mode(margin) == expected


def test_margin_mode_noise_without_a_full_stop_is_none():
    assert margin_mode("i") is None
    assert margin_mode("f") is None
    assert margin_mode("fe") is None


def test_segment_proper_mode_number_alone_places_by_order_and_queues():
    """A mode number with no label or words found the right system 5 times in 12
    (hand check, 2026-09-26): it is an order placement, for review."""
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b", label="gradual"), sys_("c"),
                    sys_("d"), sys_("qz xw", marker="VII"), sys_("e"),
                    sys_("f", label="offertory"), sys_("g"), sys_("h", label="communion")])
    result = segment_proper(systems, [exp("introit"), exp("gradual"), exp("alleluia", "quasirosa"),
                                      exp("offertory"), exp("communion")])
    alleluia = result.parts[2]
    assert (alleluia.part, alleluia.index, alleluia.placed) == ("alleluia", 5, "order")
    assert [(p.kind, p.part) for p in result.problems] == [("part_by_order", "alleluia")]


def test_segment_proper_optional_part_never_placed_by_a_mode_number_alone():
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b", label="gradual"), sys_("c"),
                    sys_("d", marker="II"), sys_("e"), sys_("f", label="offertory"), sys_("g")])
    result = segment_proper(systems, [exp("introit"), exp("gradual"), exp("tract", optional=True),
                                      exp("offertory")])
    assert "tract" not in [p.part for p in result.parts]


def test_segment_proper_latin_cor_under_the_staff_is_not_a_communion_label():
    """St Therese's Introit sings "vulnerasti cor meum"."""
    systems = refs([sys_("Ve ni de Li ba no", label="introit"), sys_("a"),
                    sys_("vul ne ra sti cor me um so ror me a"), sys_("b"), sys_("c", label="communion")])
    result = segment_proper(systems, [exp("introit"), exp("communion")])
    assert [(p.part, p.index) for p in result.parts] == [("introit", 0), ("communion", 4)]


def test_segment_proper_alleluia_read_through_ocr_i_for_l():
    """St Andrew: "Al-le-lú-ia" OCR'd as "AL Ie III * al _ Ie lu la"."""
    systems = refs([sys_("x", label="introit"), sys_("a"), sys_("b", label="gradual"), sys_("c"),
                    sys_("AL Ie III * al _ Ie lu la, la"), sys_("d", label="offertory")])
    result = segment_proper(systems, [exp("introit"), exp("gradual"), exp("alleluia", "dilexit"),
                                      exp("offertory")])
    assert ("alleluia", 4, "text") in [(p.part, p.index, p.placed) for p in result.parts]


def test_segment_proper_introit_after_the_tail_of_the_mass_before():
    """A scan that opens on the Mass before's Communion: the Introit is still
    found, below it."""
    systems = refs([sys_("x", label="communion"), sys_("a"), sys_("Ju di ca me", label="introit"),
                    sys_("b"), sys_("c", label="gradual"), sys_("d"), sys_("e", label="communion")])
    result = segment_proper(systems, [exp("introit", "judicame"), exp("gradual"), exp("communion")])
    assert [(p.part, p.index) for p in result.parts] == [("introit", 2), ("gradual", 4), ("communion", 6)]


def test_segment_proper_introit_not_found_later_parts_placed_only_by_their_words():
    """A votive Mass that borrows its Introit (Holy Cross): the Gradual's words
    place it; a bare "Comm." label does not, since the page may print another
    formulary; the Offertory has neither and waits (never placed by order)."""
    systems = refs([sys_("Christus factus est pro nobis obediens"), sys_("a"),
                    sys_("b"), sys_("c", label="communion"), sys_("d")])
    result = segment_proper(systems, [exp("introit", "nosautemgloriari"),
                                      exp("gradual", "christusfactusestpronobis"),
                                      exp("offertory", "protegeDomine"), exp("communion", "perlignum")])
    assert [(p.part, p.index, p.placed) for p in result.parts] == [("gradual", 0, "text")]
    assert [p.kind for p in result.problems] == ["part_mismatch"]


def test_segment_proper_repeat_of_the_part_before_is_not_the_next_part():
    """The Requiem repeats its Introit after the verse, and its Gradual opens
    with the same "Requiem aeternam": the Gradual is at its label, not the repeat."""
    systems = refs([sys_("Requiem aeternam dona eis Domine", label="introit"), sys_("a"),
                    sys_("Requiem aeternam dona eis Domine"), sys_("Kyrie eleison"),
                    sys_("Requiem aeternam dona eis Domine", label="gradual"), sys_("b")])
    result = segment_proper(systems, [exp("introit", "requiemaeternamdonaeisdomine"),
                                      exp("gradual", "requiemaeternamdonaeisdomine")])
    assert [(p.part, p.index) for p in result.parts] == [("introit", 0), ("gradual", 4)]


def test_segment_proper_introit_label_read_as_fntr_in_the_text_layer():
    """NOH5 p. 163: the text layer reads the margin's "Intr." as "fntr." after
    the opening line's words."""
    text = "Re qUI e!n * ter do - - <e nam oa e - fntr. -e-,----- ...-/-"
    systems = refs([sys_("Te decet hymnus"), sys_(text), sys_("a"), sys_("b")])
    result = segment_proper(systems, [exp("introit", "zzzzzzzzzzzzzz")])
    assert [(p.part, p.index, p.placed) for p in result.parts] == [("introit", 1, "label")]


