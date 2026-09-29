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
from pipeline.typeset.melody import compare, gabc_steps, intervals

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

# ----------------------------------------------------------------- match ---


def test_hints_read_volume_page_kind_and_mass():
    assert hints("vol-1/al_beatus_homo.csv.ly", "%Page reference: page i.109\n") == \
        match.Hints("noh1", 109, "alleluia", None, None)
    assert hints("vol-5/missa-ix/kyrie_IX.ly", "") == match.Hints("noh5", None, "kyrie", 9, 9)
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
    entry = decide("vol-5/missa-ix/kyrie_IX.ly", "", events, all_targets(), chants(c20=other))
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
