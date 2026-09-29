"""A Proper's sections proposed from the book: margin labels first, jgabc's
chants, text only between labelled sections, inference or the review queue in
place of order placement, and chants paired by opening words."""

from __future__ import annotations

import pytest

from pipeline.parts import (
    ChantInfo,
    ExpectedPart,
    PartSystem,
    _contains_alleluia,
    _introit_end,
    _text_label,
    chant_text,
    incipit_title,
    read_label,
    segment_proper,
)
from pipeline.systemtext import condense


@pytest.mark.parametrize(("margin", "expected"), [
    ("2.Gra I.", ("gradual", 2, None)), ("3.Grad I].", ("gradual", 3, None)), ("4.Grad IH.", ("gradual", 4, None)),
    ("I]. Grad Il.", ("gradual", None, None)), ("Hymn. Vil.", ("hymn", None, None)), ("Seq. [.", ("sequence", None, None)),
    ("Tract. Vill.", ("tract", None, None)), ("Ant. 1 VILL.", ("other", None, "Ant. 1")), ("| Resp.", ("other", None, "Resp.")),
    ("Ps -", None), ("f", None), ("Grad. Ecce sacerdos, ut supra, p. 62", None),
    # A label word deep in the OCR is noise read from inside the staff.
    ("a a’ a. w .@n: e fon v BAS’, rat Qu Com. = 2a:", None), ("= ApGe 7. (erica aw? Cant hd CO.", None),
])
def test_read_label_reads_numbered_hymn_sequence_and_labels_outside_the_mass(margin, expected):
    assert read_label(margin) == expected


def test_chant_text_reads_gabc_stored_as_a_list_or_as_one_string():
    assert chant_text('"(c3) BE(ehg)NE(hi)DIC(i)TUS(hi) es(i) (,) Do(gf)mi(h)ne(i)"') == "BENEDICTUS es Domine"
    assert chant_text('[["gabc", "(c4) Qui(f) re(g)gis(h)"]]') == "Qui regis"
    assert chant_text(None) == ""


# The Ember Saturday of Advent as its margins read (NOH1 pp. 24-38, systems from
# 0): a Gradual after each lesson, the hymn Benedictus es, then the Tract.
LABELLED = {0: ("introit", None, "II"), 6: ("gradual", None, "II"), 15: ("gradual", 2, "I"),
            24: ("gradual", 3, "II"), 32: ("gradual", 4, "II"), 44: ("hymn", None, "VIII"),
            68: ("tract", None, "VIII"), 79: ("offertory", None, "III"), 83: ("communion", None, "VI")}
WORDS = {0: "Veni et ostende nobis", 2: "Qui regis Israel intende qui deducis", 6: "A summo caelo egressio ejus",
         15: "In sole posuit tabernaculum", 24: "Domine Deus virtutum converte", 32: "Excita Domine potentiam",
         44: "Benedictus es Domine Deus patrum nostrorum", 68: "Qui regis Israel intende qui deducis",
         79: "Exsulta satis filia Sion", 83: "Ecce Dominus veniet"}


def ember(labels: dict[int, tuple[str, int | None, str]] = LABELLED) -> list[PartSystem]:
    return [PartSystem(f"noh1/{50 + i // 6:04d}/{i % 6:03d}", WORDS.get(i, "et"), labels[i][0] if i in labels else None,
                       labels[i][2] if i in labels else None, labels[i][1] if i in labels else None)
            for i in range(86)]


def part(kind: str, words: str, gid: int, optional: bool = False) -> ExpectedPart:
    whole = condense(words)
    return ExpectedPart(kind, "", whole[:24], gid, optional, whole)


# jgabc's Ember Saturday: an Introit (whose Psalm verse is "Qui regis Israel"),
# the Tract, Offertory and Communion; no Gradual, no hymn.
JGABC = [part("introit", "Veni et ostende nobis faciem tuam Qui regis Israel intende qui deducis velut ovem Joseph", 169),
         part("tract", "Qui regis Israel intende qui deducis velut ovem Joseph", 1157, optional=True),
         part("offertory", "Exsulta satis filia Sion", 929), part("communion", "Ecce Dominus veniet", 88)]


def chant(i: int, office: str, words: str, mode: str, incipit: str) -> ChantInfo:
    return ChantInfo(i, office, condense(words)[:24], mode, incipit, True)


GREGOBASE = [chant(698, "gr", "A summo caelo egressio ejus", "2", "A summo caelo"),
             chant(203, "gr", "In sole posuit tabernaculum suum", "2", "In sole posuit"),
             chant(38, "gr", "Domine Deus virtutum converte nos", "2", "Domine Deus virtutum"),
             chant(506, "gr", "Excita Domine potentiam tuam", "2", "Excita Domine"),
             chant(1589, "hy", "Benedictus es Domine Deus patrum nostrorum", "7", "Benedictus es"),
             chant(1289, "al", "Alleluia Benedictus es Domine Deus patrum", "8", "Benedictus es")]


def test_the_ember_saturday_of_advent_has_nine_sections_as_the_book_prints_them():
    result = segment_proper(ember(), JGABC, GREGOBASE)
    got = [(p.part, p.variant, p.index, p.placed, p.label, p.gregobase_id) for p in result.parts]
    assert got == [("introit", "", 0, "label", "Intr. II", 169),
                   ("gradual", "1", 6, "label", "Grad. II", 698),
                   ("gradual", "2", 15, "label", "2. Grad. I", 203),
                   ("gradual", "3", 24, "label", "3. Grad. II", 38),
                   ("gradual", "4", 32, "label", "4. Grad. II", 506),
                   ("hymn", "", 44, "label", "Hymn. VIII", 1589),
                   ("tract", "", 68, "label", "Tract. VIII", 1157),
                   ("offertory", "", 79, "label", "Offert. III", 929),
                   ("communion", "", 83, "label", "Comm. VI", 88)]
    assert (result.parts[2].title, result.parts[5].title) == ("In sole posuit", "Benedictus es")
    # GregoBase gives Benedictus es in mode 7 where the margin reads VIII: a stroke
    # apart, which the OCR confuses, so it is linked; the Alleluia of that name is not.
    assert result.problems == []


def test_a_pairing_in_a_mode_more_than_a_stroke_away_is_queued_not_linked():
    systems = [PartSystem("v/0001/000", "Veni", "introit", "II"),
               PartSystem("v/0001/001", "A summo caelo egressio ejus", "gradual", "VI")]
    result = segment_proper(systems, [part("introit", "Veni", 1)], GREGOBASE)
    assert result.parts[1].gregobase_id is None
    assert [(p.kind, p.variant, p.chant_id) for p in result.problems] == [("unverified_pairing", "mode", 698)]


def test_a_tract_no_label_names_is_never_taken_from_the_introits_own_psalm_verse():
    labels = {i: l for i, l in LABELLED.items() if l[0] in ("introit", "offertory", "communion")}
    result = segment_proper(ember(labels), JGABC)
    assert "tract" not in [p.part for p in result.parts]           # the verse on system 2 is the Introit's


def test_a_tract_found_by_its_words_after_other_sections_is_placed_by_text():
    labels = {i: l for i, l in LABELLED.items() if l[0] != "tract"}
    tract = [p for p in segment_proper(ember(labels), JGABC).parts if p.part == "tract"]
    assert [(p.index, p.placed) for p in tract] == [(68, "text")]


@pytest.mark.parametrize(("text", "starts"), [
    ("IV. Al _ Ie lu la. * al _ Ie", True), ("Al _ Ie Iii la, * al - Ie", True),
    # The mode where the text layer carries the margin, at the line's end (NOH4 p. 270).
    ("lU _ 18. lu _ 18. * 8 I _ Ie AI _ Ie Vll.", True),
    # The "alleluia" that ends a Paschal Offertory's line starts nothing (NOH2 p. 58).
    ("J.l lac --If-------ji--- , et mel, al _ Ie", False), ("Ve ni et o sten de", False),
])
def test_contains_alleluia_finds_an_alleluia_only_where_its_chant_starts(text, starts):
    assert _contains_alleluia(text) is starts


# Easter Sunday as the text layer reads it (NOH2 pp. 33-36): the Introit sings
# "alleluia" on every line up to its Psalm verse and Gloria Patri.
EASTER = ["Re_sur _ re_ xi, et ad _ hue te _ cum", "al Ie III la: po _ su _ sti su _ per",
          "me rna _ nurn tu am, al _ Ie I~ la:", "tu a, al - Ie - ItI_ ia, al Ie - lu la.",
          "Ps. D6 _ mt _ ne pro_ bit _ sti me", "Gl6 _ rl a Pa _ tri, et Fi _ Ii _ 0",
          ", sem_per, et m sre_cu_la sae_Gu_16 _ rum. A _men.", "es, quam fe - cit di", "mus, et lae te mur",
          "VII. AI _ Ie _ lu la, * al .Ie . Iii", "t. Pas.cha no - strum"]


def test_segment_proper_never_starts_an_alleluia_inside_the_introits_psalm_verse():
    systems = [PartSystem(f"noh2/0033/{i:03d}", t, "introit" if i == 0 else None, "VII" if i == 9 else None)
               for i, t in enumerate(EASTER)]
    result = segment_proper(systems, [part("introit", "Resurrexi et adhuc tecum sum", 1),
                                      part("alleluia", "Alleluia Pascha nostrum", 2)])
    assert [(p.part, p.index) for p in result.parts] == [("introit", 0), ("alleluia", 9)]


def test_text_label_reads_an_introit_label_the_ocr_split_or_set_far_in():
    # "I ntr." (the Sacred Heart, NOH2 p. 165); Pentecost's some 60 characters in (NOH2 p. 109).
    assert _text_label("JUS dis e Co - &1 _ ta _ t i _ 6 _ nes '* Cor I ntr. ~ ---") == "introit"
    assert _text_label("Spi _ ri D6 _ * pie vit bern tus OJI III re - - or - \u2022 \u2022 Intr. e.; ~ VIII.") == "introit"


@pytest.mark.parametrize(("words", "end"), [
    (EASTER, 6),
    # "P,." for "Ps." (NOH3 p. 218).
    (["Ca ri tas De i", "no bis. T.p. Al _ Ie IU - la,", "a I _ Ie lu la. P,. Be_ne dic", "et", "sem per. A _ men.", "IV. Al Ie"], 4),
    # Pentecost's "Ps." lost and its Amen read "A _ mem." (NOH2 p. 110).
    (["Spi _ ri tus", "al _ Ie lu la.", "sur _ gat De. us.", "sae _ cu 16 rum. A _ mem.", "Al . Ie IV."], 3),
    # "Ps," and no Amen read: the last line of the Gloria Patri (NOH2 p. 127).
    (["Re pie a tur", "al Ie", "16 la. Ps, In te", "Cia _ri", "Sic _ ut e _ rat In", "et nunc. et sem.per, et I In",
      "I.", "0 quam bo"], 5),
    (["Ve ni", "et", "et"], 0),
])
def test_introit_end_is_the_amen_of_its_gloria_patri(words, end):
    assert _introit_end([PartSystem(f"v/0001/{i:03d}", t) for i, t in enumerate(words)], 0) == end


def test_segment_proper_keeps_a_repeated_part_after_the_one_numbered_before_it():
    words = ["Eduxit Dominus populum", "et", "et", "VII. Al Ie lu ia, * al le", "et", "et",
             "IV. Al Ie lu ia. * al le", "et"]
    systems = [PartSystem(f"v/0001/{i:03d}", t, "introit" if i == 0 else None, "VII" if i in (3, 6) else None)
               for i, t in enumerate(words)]
    first, second = (ExpectedPart("alleluia", n, "", k, False, "") for n, k in (("1", 2), ("2", 3)))
    result = segment_proper(systems, [part("introit", "Eduxit Dominus populum", 1), first, second])
    assert [(p.part, p.variant, p.index) for p in result.parts] == [
        ("introit", "", 0), ("alleluia", "1", 3), ("alleluia", "2", 6)]


def test_labels_before_the_introit_belong_to_the_mass_before_but_a_blessings_start_sections_with_its_heading():
    systems = [PartSystem("v/0001/000", "a", "communion", "VI"), PartSystem("v/0001/001", "b", "other", "VIII", None, "Ant."),
               PartSystem("v/0001/002", "c"), PartSystem("v/0001/003", "Veni", "introit", "II"), PartSystem("v/0001/004", "d"),
               PartSystem("v/0001/005", "e", "communion", "VI")]
    result = segment_proper(systems, [part("introit", "Veni", 1), part("communion", "e", 2)],
                            heading=lambda i: "Benedictio candelarum" if i == 1 else None)
    assert [(p.part, p.index, p.label) for p in result.parts] == [
        ("other", 1, "Benedictio candelarum"), ("introit", 3, "Intr. II"), ("communion", 5, "Comm. VI")]
    assert segment_proper(systems, [part("introit", "Veni", 1)]).parts[0].label == "Ant."


def test_pairing_links_a_close_match_in_the_printed_mode_and_queues_a_loose_one():
    systems = [PartSystem("v/0001/000", "Veni", "introit", "II"),
               PartSystem("v/0001/001", "A summo caelo egressio ejus", "gradual", "II"),
               PartSystem("v/0001/002", "In sole ponit tabernas nostras", "gradual", "I", 2),
               PartSystem("v/0001/003", "Nothing like any chant here", "gradual", "II", 3)]
    result = segment_proper(systems, [part("introit", "Veni", 1)], GREGOBASE)
    assert [p.gregobase_id for p in result.parts] == [1, 698, None, None]
    assert [(p.kind, p.variant, p.chant_id) for p in result.problems] == [("unverified_pairing", "words", 203)]


@pytest.mark.parametrize(("incipit", "title"), [
    ("Anima nostra (Off.)", "Anima nostra"), ("Confitebor tibi... Deus", "Confitebor tibi"),
    ("In nomine Jesu... Ps. Domine", "In nomine Jesu"), ("Vox in Rama (Com.)", "Vox in Rama"), ("Benedictus es", "Benedictus es"),
])
def test_incipit_title_drops_gregobases_notes(incipit, title):
    assert incipit_title(incipit) == title
