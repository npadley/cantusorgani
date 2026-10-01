"""Reading a transcription's melody, comparing it with GregoBase's chant, and
deciding which part of the catalogue each file is."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.typeset import match
from pipeline.typeset.events import Events, first_error, parse, with_listener
from pipeline.typeset.match import (
    Entry,
    Target,
    candidates,
    decide,
    hints,
    settle_duplicates,
    targets,
)
from pipeline.typeset.melody import agreement, compare, gabc_steps, intervals, letters, read

# ---------------------------------------------------------------- events ---

ROWS = [
    "0\tup\tkey\t4\t0\t1\t1",
    "0\tup:chant\tnote\t2\t0\t0\t2\t0\t1\t1/4\t32:2",       # e'
    "0\tup:1\tnote\t0\t0\t0\t1\t0\t3\t3/2\t68:2",           # alto: ignored
    "0\tlyrics\tlyric\tKy\t",
    "0\tlyrics\thyphen",
    "1/4\tup:chant\tnote\t3\t0\t0\t2\t0\t1\t1/4\t32:6",     # f'
    "1/4\tup:chant\ttie",
    "1/2\tup:chant\tnote\t3\t0\t0\t2\t0\t1\t1/4\t32:9",     # f' held over: one note
    "1/2\tlyrics\tlyric\trie\t",
    "3/4\tup:chant\tnote\t4\t0\t1\t2\t0\t1\t1/4\t33:1",     # g''
    "3/4\tlyrics\tlyric\teléison.\t",
]
LOG = "\n".join(ROWS)


def test_parse_takes_the_chant_voice_joins_ties_and_words():
    steps, words = parse(LOG)
    assert steps == (2, 3, 11)
    assert words == ("Kyrie", "eléison")


def test_with_listener_goes_after_the_house_style_or_the_version():
    assert with_listener('\\version "2.26.0"\n\\include "noh2.ily"\nx\n') == \
        '\\version "2.26.0"\n\\include "noh2.ily"\n\\include "listen.ily"\nx\n'
    assert with_listener('\\version "2.26.0"\nx\n') == '\\version "2.26.0"\n\\include "listen.ily"\nx\n'
    assert with_listener("x\n").startswith('\\include "listen.ily"\n')


def test_first_error_names_the_line_in_the_source():
    log = "Processing `/tmp/x/source.ly'\n/tmp/x/source.ly:100:17: error: not a note name: bese\n"
    assert first_error(log) == "line 100:17: error: not a note name: bese"
    assert first_error("") == "LilyPond failed"

# ---------------------------------------------------------------- melody ---


def test_gabc_steps_follows_clefs_and_skips_accidentals_and_custos():
    # c4: j is C. Then an f3 clef: h is F.
    assert gabc_steps("(c4) Ky(jk)ri(ixi)e(j+) (f3) e(hg)") == (0, 1, -1, 3, 2)


def test_gabc_steps_ignores_tags_and_the_header():
    # c3: h is C. [..] inside a group and <..> tags outside never hold notes.
    assert gabc_steps("name: x (not a note);\n%%\n(c3) A(h[ll:1]i) <sp>V/</sp>. B(j)") == (0, 1, 2)


def test_intervals_ignore_repeated_notes():
    assert intervals((0, 0, 2, 2, 1)) == (2, -1)


def test_compare_same_melody_transposed_scores_one():
    chant = (0, 2, 4, 3, 2, 0, 1)
    assert compare(tuple(s + 3 for s in chant), chant).score == 1.0


def test_compare_a_longer_chant_is_not_penalised_but_another_melody_is():
    ours = (0, 2, 4, 3, 2, 0)
    assert compare(ours, ours + (5, 6, 5, 4, 2)).score == 1.0
    assert compare(ours, (0, -1, -3, -1, 1, 3)).score < 0.5
    assert compare((), ours).score == 0.0


KYRIE = "(c4) Ký(f)ri(g)e(h) e(g)lé(f)i(e)son.(d.) <i>iij.</i>(::) Chri(h)ste(j) e(h)lé(g)i(f)son.(e.) <i>ij.</i>(::)"


def test_read_writes_out_the_repeats_gregobase_abbreviates():
    plain, sung = read(KYRIE), read(KYRIE, expand=True)
    assert plain.text == "kyrieeleisonchristeeleison" and len(plain.steps) == 13
    assert sung.text == "kyrieeleison" * 3 + "christeeleison" * 2
    assert sung.steps == plain.steps[:7] * 3 + plain.steps[7:] * 2


def test_read_an_alleluia_is_repeated_before_its_jubilus():
    chant = read("(c4) Al(f)le(g)lú(h)ia.(g) <clear>*(;) <i>ij.</i>(hjh) (::) <sp>V/</sp>. Pa(f)scha(g)", expand=True)
    assert chant.text == "alleluiaalleluiapascha"
    assert chant.steps[:8] == chant.steps[:4] * 2 and len(chant.steps) == 13


def test_read_writes_out_an_introits_doxology_to_the_psalm_tone():
    introit = ("(c4) Ad(f)o(g)rá(h)te.(g) (::) <i>Ps.</i> Dó(f)mi(gh)nus(h) :(hj) (:) ter(h)ra.(gf) (::) "
               "Gló(f)ri(gh)a(h) Pa(h)tri.(h) (::) <eu>E(h) u(h) o(g) u(f) a(g) e.</eu>(f.) (::)")
    plain, sung = read(introit), read(introit, expand=True)
    assert plain.text.endswith("gloriapatrieuouae")
    assert sung.text == "adoratedominusterra" + letters("Gloria Patri et Filio et Spiritui Sancto sicut erat in "
                                                        "principio et nunc et semper et in saecula saeculorum Amen")
    half, ending = read("(c4) a(f) a(gh) a(h) a(hj)").steps, read("(c4) a(h) a(h) a(g) a(f) a(g) a(f)").steps
    assert sung.steps[-(2 * len(half) + len(ending)):] == half + half + ending


def test_agreement_takes_the_better_of_as_written_and_written_out():
    kyrie = read(KYRIE, expand=True)
    words = ("Kýrie", "eléison") * 3 + ("Christe", "eléison") * 2
    both = agreement(tuple(n + 2 for n in kyrie.steps), words, KYRIE)
    assert (both.melody, both.words) == (1.0, 1.0)
    assert compare(kyrie.steps, gabc_steps(KYRIE)).score < 0.6             # as GregoBase writes it: about half
    assert agreement(read(KYRIE).steps, (), KYRIE).words is None            # no words to compare
    assert agreement(kyrie.steps, ("Sanctus", "Dominus", "Deus"), KYRIE).words < 0.5

# ----------------------------------------------------------------- match ---


def test_hints_read_volume_page_kind_and_mass():
    assert hints("vol-1/al_beatus_homo.csv.ly", "%Page reference: page i.109\n") == \
        match.Hints("noh1", 109, "alleluia", None, None, "al")
    assert hints("vol-5/missa-ix/kyrie_IX.ly", "") == match.Hints("noh5", None, "kyrie", 9, 9, "kyrie")
    assert hints("vol-5/credo_III.ly", "").number == 3


def catalog() -> dict:
    return {"pieces": [
        {"slug": "dominica-ii", "volume": "noh1", "genre": "proper", "systems": ["noh1/0034/000"],
         "sections": [{"kind": "introit", "variant": "", "system": 0, "ref": "noh1/0034/000", "gregobase_id": 10},
                   {"kind": "alleluia", "variant": "", "system": 3, "ref": "noh1/0035/001", "gregobase_id": 11},
                   {"kind": "offertory", "variant": "", "borrowed_from": "p. 3", "gregobase_id": 12}]},
        {"slug": "ordinarium-missae-ix", "volume": "noh5", "genre": "mass_ordinary", "systems": ["noh5/0061/000"],
         "movements": [{"movement": "kyrie", "ref": "noh5/0061/000"}, {"movement": "gloria", "ref": "noh5/0062/000"}],
         "chant": [{"movement": "kyrie", "id": 20}, {"movement": "gloria", "id": 21}]},
        {"slug": "ordinarium-missae-credo-iii", "volume": "noh5", "genre": "credo", "systems": ["noh5/0100/000"],
         "chant": [{"movement": "credo", "id": 30}]},
    ]}


def all_targets() -> list[Target]:
    return targets(catalog(), lambda ref: int(ref.split("/")[1]) + 75)


def test_targets_are_printed_parts_movements_and_single_chant_pieces():
    found = {t.target: (t.kind, t.page, t.chant) for t in all_targets()}
    assert found == {"part:dominica-ii/introit": ("introit", 109, 10),
                     "part:dominica-ii/alleluia": ("alleluia", 110, 11),
                     "movement:ordinarium-missae-ix/kyrie": ("kyrie", 136, 20),
                     "movement:ordinarium-missae-ix/gloria": ("gloria", 137, 21),
                     "piece:ordinarium-missae-credo-iii": ("credo", 175, 30)}


@pytest.mark.parametrize(("rel", "text", "expected", "by"), [
    ("vol-1/in_x.csv.ly", "%Page reference: page i.109", ["part:dominica-ii/introit"], "page"),
    ("vol-1/al_x.csv.ly", "%Page reference: page i.111", ["part:dominica-ii/alleluia"], "page"),
    ("vol-5/missa-ix/gloria_IX.ly", "", ["movement:ordinarium-missae-ix/gloria"], "folder"),
    ("vol-5/credo_III.ly", "", ["piece:ordinarium-missae-credo-iii"], "name"),
    ("vol-1/co_x.csv.ly", "", [], "kind"),
    ("vol-1/hy_gloria_laus.csv.ly", "", [], "none"),
])
def test_candidates_come_from_folder_name_page_or_kind(rel, text, expected, by):
    found, how = candidates(hints(rel, text), all_targets())
    assert ([t.target for t in found], how) == (expected, by)


MELODY = (0, 2, 4, 3, 2, 0, 1, 2, 4, 5, 4, 2)


def gabc(steps: tuple[int, ...]) -> str:
    """A chant with these steps, on a c3 clef (h is C: a to m reach -7 to +5)."""
    return "(c3) " + " ".join(f"a({chr(ord('h') + s)})" for s in steps)


def chants(**by_id: tuple[int, ...]) -> dict:
    return {k.removeprefix("c"): {"gabc": gabc(v)} for k, v in by_id.items()}


def test_decide_a_named_candidate_with_its_melody_is_matched():
    events = Events(True, MELODY, ("Kyrie",))
    entry = decide("vol-5/missa-ix/kyrie_IX.ly", "", events, all_targets(), chants(c20=MELODY))
    assert (entry.target, entry.status, entry.evidence["by"], entry.evidence["melody"]) == \
        ("movement:ordinarium-missae-ix/kyrie", "matched", "folder", 1.0)


def test_decide_a_named_candidate_with_another_melody_differs():
    events = Events(True, MELODY, ())
    other = (0, -1, -3, -2, -4, -1, 0, 3, 1, -2, 0, -3)
    entry = decide("vol-5/missa-ix/kyrie_IXb.ly", "", events, all_targets(), chants(c20=other))
    assert entry.status == "melody-differs" and entry.target == "movement:ordinarium-missae-ix/kyrie"


def test_decide_found_by_melody_alone_is_only_proposed():
    events = Events(True, MELODY, ())
    entry = decide("vol-1/in_x.csv.ly", "", events, all_targets(), chants(c10=MELODY))
    assert (entry.target, entry.status, entry.evidence["by"]) == ("part:dominica-ii/introit", "proposed", "kind")


def test_decide_no_chant_to_compare_is_proposed_and_broken_is_broken():
    entry = decide("vol-1/in_x.csv.ly", "%Page reference: page i.109", Events(True, MELODY, ()), all_targets(), {})
    assert (entry.status, entry.evidence["melody"]) == ("proposed", None)
    broken = decide("vol-1/in_x.csv.ly", "", Events(False, (), (), "line 3: error: x"), all_targets(), {})
    assert (broken.status, broken.evidence) == ("broken", {"error": "line 3: error: x"})


OTHER = (0, -1, -3, -2, -4, -1, 0, 3, 1, -2, 0, -3)


def test_decide_a_kyriale_file_named_for_its_movement_is_matched_whatever_the_melody():
    # GABC writes "iij." where NOH prints each invocation: the name decides.
    entry = decide("vol-5/missa-ix/kyrie_IX.ly", "", Events(True, MELODY, ()), all_targets(), chants(c20=OTHER))
    assert (entry.target, entry.status, entry.evidence["name"]) == \
        ("movement:ordinarium-missae-ix/kyrie", "matched", "kyrie_IX")
    assert entry.evidence["melody"] < 0.6


def test_decide_a_kyriale_name_with_a_letter_is_not_settled_by_name():
    entry = decide("vol-5/missa-ix/kyrie_IXa.ly", "", Events(True, MELODY, ()), all_targets(), chants(c20=OTHER))
    assert entry.status == "melody-differs" and "name" not in entry.evidence


def named_catalog() -> list[Target]:
    return [Target("part:dominica-ii/introit", "noh1", "dominica-ii", "introit", 109, 10, "Adorate Deum"),
            Target("part:dominica-iii/introit", "noh1", "dominica-iii", "introit", 140, 11, "Gaudeamus"),
            Target("part:dominica-ii/communion", "noh1", "dominica-ii", "communion", 109, 12, "Mirabantur")]


def test_decide_a_proper_named_for_the_part_on_its_page_is_matched():
    almost = MELODY[:9] + (0, -3, 1)
    entry = decide("vol-1/in_adorate_deum.csv.ly", "%Page reference: page i.109", Events(True, almost, ()),
                   named_catalog(), chants(c10=MELODY))
    assert (entry.target, entry.status, entry.evidence["by"], entry.evidence["name"]) == \
        ("part:dominica-ii/introit", "matched", "page", "Adorate Deum")
    assert entry.evidence["melody"] < match.MATCHED


def test_decide_a_proper_named_otherwise_than_its_page_candidate_is_not_matched_by_name():
    entry = decide("vol-1/in_adjutor.csv.ly", "%Page reference: page i.109", Events(True, MELODY, ()),
                   named_catalog(), chants(c10=OTHER))
    assert entry.status == "melody-differs" and "name" not in entry.evidence


def test_decide_a_name_found_across_the_volume_needs_a_melody_that_does_not_disagree():
    found = decide("vol-1/in_gaudeamus.csv.ly", "", Events(True, MELODY, ()), named_catalog(), chants(c11=MELODY))
    assert (found.target, found.status, found.evidence["by"]) == ("part:dominica-iii/introit", "matched", "name")
    other = decide("vol-1/in_gaudeamus.csv.ly", "", Events(True, MELODY, ()), named_catalog(), chants(c11=OTHER))
    assert other.status == "proposed"


def test_named_reads_the_words_after_the_dots_and_leaves_later_verses_alone():
    target = Target("part:x/introit", "noh3", "x", "introit", 1, 5, "Gaudeamus")
    incipits = {"5": {"incipit": "Gaudeamus... Agathae (Intr.)"}}
    assert match.named("vol-3/in_gaudeamus__agathae.csv.ly", target, incipits) == "Gaudeamus"
    assert match.named("vol-3/in_gaudeamus__annae.csv.ly", target, incipits) is None
    assert match.named("vol-3/in_gaudeamus_omnes_12.csv.ly", target, {}) == "Gaudeamus"
    assert match.named("vol-3/in_gaudeamus.1.csv.ly", target, {}) == "Gaudeamus"
    assert match.named("vol-3/in_gaudeamus.2.csv.ly", target, {}) is None
    assert match.file_name("vol-1/gr_speciosus_v_eructavit.csv.ly") == [("speciosus",), ("eructavit",)]
    assert match.catalogue_name("Júbiláte Deo... ómnis") == [("iubilate", "deo"), ("omnis",)]


def worded(steps: tuple[int, ...], text: str) -> dict:
    return {"gabc": "(c3) " + " ".join(f"{w}({chr(ord('h') + n)})" for w, n in zip(text.split() * 12, steps, strict=False))}


SUNG = "A do ra te De um om nes an ge li e"


def test_decide_the_same_notes_under_other_words_are_a_type_melody_not_a_match():
    events = Events(True, MELODY, ("Timebunt", "gentes", "nomen", "tuum"))
    entry = decide("vol-1/in_x.csv.ly", "%Page reference: page i.109", events, all_targets(), {"10": worded(MELODY, SUNG)})
    assert (entry.status, entry.evidence["melody"]) == ("proposed", 1.0) and entry.evidence["words"] < 0.5


def test_decide_words_that_agree_carry_a_melody_that_is_only_close():
    close = MELODY[:8] + (0, -3, 1, 6)
    events = Events(True, close, tuple(SUNG.split()))
    entry = decide("vol-1/in_x.csv.ly", "%Page reference: page i.109", events, all_targets(), {"10": worded(MELODY, SUNG)})
    assert entry.status == "matched" and 0.6 <= entry.evidence["melody"] < 0.85 and entry.evidence["words"] == 1.0


def test_decide_melody_and_words_together_match_with_no_page_or_name():
    events = Events(True, MELODY, tuple(SUNG.split()))
    entry = decide("vol-1/in_x.csv.ly", "", events, all_targets(), {"10": worded(MELODY, SUNG)})
    assert (entry.target, entry.status, entry.evidence["by"]) == \
        ("part:dominica-ii/introit", "matched", "melody and words")


def mass_iv() -> dict:
    """Mass IV with its two dismissals listed (data/sections): the rows take the
    place of the movement found on the Ite's system."""
    refs = [f"noh5/0074/{n:03d}" for n in range(6)]
    return {"pieces": [{
        "slug": "ordinarium-missae-iv", "volume": "noh5", "genre": "mass_ordinary", "systems": refs,
        "movements": [{"movement": "agnus", "ref": refs[0]}, {"movement": "ite", "ref": refs[4]}],
        "chant": [{"movement": "agnus", "id": 264}, {"movement": "ite", "id": 353}],
        "sections": [
            {"kind": "other", "key": "ite", "variant": "", "system": 4, "ref": refs[4], "gregobase_id": 353, "placed": "reviewed"},
            {"kind": "other", "key": "benedicamus", "variant": "", "system": 5, "ref": refs[5], "gregobase_id": 2856,
             "placed": "reviewed"}]}]}


def test_targets_a_listed_row_takes_the_place_of_the_movement_on_its_system():
    found = [t.target for t in targets(mass_iv(), lambda ref: 28)]
    assert found == ["part:ordinarium-missae-iv/other:ite", "part:ordinarium-missae-iv/other:benedicamus",
                     "movement:ordinarium-missae-iv/agnus"]


@pytest.mark.parametrize(("rel", "expected"), [
    ("vol-5/missa-iv/ite_IV.ly", ["part:ordinarium-missae-iv/other:ite"]),
    ("vol-5/missa-iv/benedicamus_IV.ly", ["part:ordinarium-missae-iv/other:benedicamus"]),
    ("vol-5/missa-iv/agnus_IV.ly", ["movement:ordinarium-missae-iv/agnus"]),
    # Named for nothing the Mass lists: both rows are another movement's.
    ("vol-5/missa-iv/deo_IV.ly", []),
])
def test_candidates_a_kyriale_file_goes_to_the_row_its_first_word_names(rel, expected):
    found, _ = candidates(hints(rel, ""), targets(mass_iv(), lambda ref: 28))
    assert [t.target for t in found] == expected


def test_by_first_word_leaves_out_rows_named_for_another_movement():
    rows = [Target(f"part:m/other:{key}", "noh5", "m", "other", 1, None) for key in ("kyrie-b", "deo-gratias-i", "deo-gratias-vi")]
    assert [t.target for t in match.by_first_word("ite", rows)] == ["part:m/other:deo-gratias-i", "part:m/other:deo-gratias-vi"]
    assert [t.target for t in match.by_first_word("kyrie", rows)] == ["part:m/other:kyrie-b"]


def test_decide_two_settings_of_one_melody_are_told_apart_by_their_words():
    # Easter week's Ite (with alleluias) and the rest of Paschaltide's.
    rows = [Target("part:ordinarium-missae-i/other:ite-paschal", "noh5", "ordinarium-missae-i", "other", 10, 1),
            Target("part:ordinarium-missae-i/other:ite", "noh5", "ordinarium-missae-i", "other", 10, 2)]
    sung = "I te mis sa est al le lu ia al le lu"
    given = {"1": worded(MELODY, sung), "2": worded(MELODY, "De us in ad iu to ri um me um in ten")}
    entry = decide("vol-5/missa-i/ite_Ia.ly", "", Events(True, MELODY, tuple(sung.split())), rows, given)
    assert (entry.target, entry.status) == ("part:ordinarium-missae-i/other:ite-paschal", "matched")


def test_settle_duplicates_keeps_the_file_named_for_the_target():
    ite = Entry("vol-5/missa-iv/ite_IV.ly", "movement:m/ite", "matched", {"melody": 0.9, "name": "ite_IV"})
    benedicamus = Entry("vol-5/missa-iv/benedicamus_IV.ly", "movement:m/ite", "matched", {"melody": 1.0})
    settle_duplicates([benedicamus, ite])
    assert (ite.status, benedicamus.status) == ("matched", "proposed")


def test_settle_duplicates_keeps_the_better_melody():
    a = Entry("vol-1/a.ly", "part:dominica-ii/introit", "matched", {"melody": 0.9})
    b = Entry("vol-1/b.ly", "part:dominica-ii/introit", "matched", {"melody": 1.0})
    settle_duplicates([a, b])
    assert (a.status, b.status) == ("proposed", "matched")
    assert a.evidence["note"] == "vol-1/b.ly matched part:dominica-ii/introit better"


def test_run_keeps_what_an_editor_settled(tmp_path: Path):
    src = tmp_path / "src" / "vol-5" / "missa-ix"
    src.mkdir(parents=True)
    (src / "kyrie_IX.ly").write_text("x")
    (tmp_path / "catalog.json").write_text(__import__("json").dumps(catalog()))
    (tmp_path / "chants.json").write_text(__import__("json").dumps({"chants": chants(c20=MELODY)}))
    parts = tmp_path / "parts.yml"
    parts.write_text("- file: vol-5/missa-ix/kyrie_IX.ly\n  target: null\n  status: proposed\n  source: editor\n"
                     "  evidence: {note: not this one}\n")
    entries = match.run(tmp_path / "src", parts, tmp_path / "catalog.json", tmp_path / "chants.json",
                        read_events=lambda files: {f: Events(True, MELODY, ()) for f in files})
    assert [(e.status, e.source) for e in entries] == [("proposed", "editor")]
    assert "source: editor" in parts.read_text()


@pytest.mark.lilypond
def test_read_the_imported_kyrie_ix_is_mass_ix_kyrie(tmp_path: Path):
    """End to end on the real file: LilyPond reads it, and its melody is Mass IX's Kyrie."""
    import json

    from pipeline.typeset.events import read
    events = read(Path("data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"), cache=tmp_path)
    assert events.ok and len(events.steps) == 180
    assert events.words[:2] == ("Kyrie", "eléison") or "eléison" in events.words
    kyrie = json.loads(Path("data/chants.json").read_text())["chants"]["2976"]["gabc"]
    assert compare(events.steps, gabc_steps(kyrie)).score == 1.0
    again = read(Path("data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"), cache=tmp_path)
    assert again == events and len(list(tmp_path.iterdir())) == 1
