"""Editors' answers about the typeset files, as corrections on typeset:<file>:
which part a file is (`match`), and that it has been proofread (`reviewed`).

A match is applied over data/typeset/parts.yml when the manifest is written;
a proofreading confirms the file's render hash, so an edit to the file reopens
it."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from pipeline import corrections
from pipeline.corrections import (
    CorrectionError,
    Entry,
    apply,
    correct,
    correct_batch,
    hold_reasons,
    load,
    problems,
    review,
    reviews,
    typeset_choices,
)
from pipeline.typeset import manifest, match
from pipeline.typeset.match import settled, with_choices

DAY = date(2026, 9, 29)
KYRIE, GLORIA, ITE = "vol-5/missa-ix/kyrie_IX.ly", "vol-5/missa-ix/gloria_IX.ly", "vol-5/missa-ix/ite_IX.ly"
SOURCE = '\\version "2.26.0"\n\\include "noh2.ily"\n{ c\'4 }\n'


def catalog() -> dict:
    """One Mass with a Kyrie, a Gloria and an Ite missa est."""
    return {"schema_version": 2, "volumes": {}, "pieces": [{
        "id": "noh5-ordinarium-missae-ix", "volume": "noh5", "slug": "ordinarium-missae-ix", "title": "Missa IX",
        "incipit": None, "mode": None, "genre": "mass_ordinary", "printed_pages": [1, 3], "chant": [],
        "systems": ["noh5/0051/000", "noh5/0051/001", "noh5/0051/002"],
        "movements": [{"movement": "kyrie", "ref": "noh5/0051/000"}, {"movement": "gloria", "ref": "noh5/0051/001"},
                      {"movement": "ite", "ref": "noh5/0051/002"}]}]}


@pytest.fixture
def tree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    """Three transcriptions: the Kyrie matched, the Gloria proposed, the Ite broken."""
    src = tmp_path / "src"
    (src / "vol-5" / "missa-ix").mkdir(parents=True)
    for name in (KYRIE, GLORIA, ITE):
        (src / name).write_text(SOURCE + f"% {name}\n")
    include = tmp_path / "include"
    include.mkdir()
    (include / "noh2.ily").write_text("a = 1\n")
    parts = tmp_path / "parts.yml"
    parts.write_text(
        f"- {{file: {KYRIE}, target: 'movement:ordinarium-missae-ix/kyrie', status: matched, evidence: {{melody: 1.0}}}}\n"
        f"- {{file: {GLORIA}, target: 'movement:ordinarium-missae-ix/gloria', status: proposed, "
        "evidence: {melody: 0.5}}\n"
        f"- {{file: {ITE}, target: null, status: broken, evidence: {{error: 'line 3: error: x'}}}}\n")
    base = tmp_path / "catalog.base.json"
    base.write_text(json.dumps(catalog()))
    monkeypatch.setattr(match, "PARTS_FILE", parts)
    monkeypatch.setattr(match, "SRC", src)
    return {"src": src, "parts": parts, "include": include, "base": base, "path": tmp_path / "corrections.yml"}


def choose(tree: dict[str, Path], file: str, value: str) -> Entry:
    entry, _ = correct(f"typeset:{file}", "match", value, today=DAY, base_path=tree["base"], path=tree["path"])
    return entry


# ------------------------------------------------------------ with_choices ---


def test_settled_names_only_what_is_decided():
    assert settled({"status": "matched", "target": "piece:x"}) == "piece:x"
    assert settled({"status": "no-match", "target": None}) == "none"
    assert settled({"status": "other-setting", "target": None}) == "other-setting"
    assert settled({"status": "proposed", "target": "piece:x"}) is None


def test_with_choices_a_chosen_target_is_matched_and_takes_it_from_the_matchers_file():
    entries = [{"file": "a.ly", "target": "piece:x", "status": "matched"},
               {"file": "b.ly", "target": "piece:y", "status": "proposed"}]
    a, b = with_choices(entries, {"b.ly": "piece:x"})
    assert (b["target"], b["status"], b["source"]) == ("piece:x", "matched", "editor")
    assert a["status"] == "proposed" and "an editor chose b.ly" in a["evidence"]["note"]
    assert entries[0]["status"] == "matched"             # the matcher's own list is left alone


def test_with_choices_none_and_other_setting_are_settled_and_shown_nowhere():
    none, other = with_choices([{"file": "a.ly", "target": "piece:x", "status": "matched"},
                                {"file": "b.ly", "target": None, "status": "proposed"}],
                               {"a.ly": "none", "b.ly": "other-setting"})
    assert (none["status"], none["target"]) == ("no-match", None)
    assert (other["status"], other["target"]) == ("other-setting", None)


# ---------------------------------------------------------------- match ---


def test_correct_match_records_the_chosen_part_with_what_the_matcher_said(tree):
    entry = choose(tree, GLORIA, "movement:ordinarium-missae-ix/gloria")
    assert (entry.target, entry.field, entry.was, entry.value) == (
        f"typeset:{GLORIA}", "match", None, "movement:ordinarium-missae-ix/gloria")
    assert typeset_choices(load(tree["path"])) == {GLORIA: "movement:ordinarium-missae-ix/gloria"}


def test_correct_match_changes_no_catalogue_data(tree):
    choose(tree, GLORIA, "movement:ordinarium-missae-ix/gloria")
    assert apply(catalog(), load(tree["path"])) == catalog()


def test_correct_match_refuses_a_part_the_catalogue_does_not_have(tree):
    with pytest.raises(CorrectionError, match="not a part, movement or piece the catalogue has"):
        choose(tree, GLORIA, "movement:ordinarium-missae-ix/credo")


def test_correct_match_refuses_a_file_lilypond_cannot_draw_but_accepts_none(tree):
    with pytest.raises(CorrectionError, match="fix the file first"):
        choose(tree, ITE, "movement:ordinarium-missae-ix/ite")
    assert choose(tree, ITE, "none").value == "none"


def test_correct_match_refuses_what_it_already_is(tree):
    with pytest.raises(CorrectionError, match="already"):
        choose(tree, KYRIE, "movement:ordinarium-missae-ix/kyrie")


def test_correct_match_refuses_an_unknown_file_or_a_path_outside_the_sources(tree):
    with pytest.raises(CorrectionError, match="not a transcription"):
        choose(tree, "vol-5/missa-ix/credo_IX.ly", "none")
    with pytest.raises(CorrectionError, match="not of the form typeset:<file>"):
        choose(tree, "../secrets.ly", "none")


def test_problems_two_files_chosen_as_one_part_is_refused(tree):
    choose(tree, GLORIA, "movement:ordinarium-missae-ix/kyrie")
    entries = load(tree["path"])
    twice = Entry(id="c-0002", target=f"typeset:{ITE}", field="match", was=None,
                  value="movement:ordinarium-missae-ix/kyrie")
    found = problems(catalog(), [*entries, twice])
    assert any("are both chosen as movement:ordinarium-missae-ix/kyrie" in p for p in found)


def test_problems_a_match_the_matcher_has_since_changed_is_stale(tree):
    choose(tree, GLORIA, "none")
    tree["parts"].write_text(tree["parts"].read_text().replace(
        "target: 'movement:ordinarium-missae-ix/gloria', status: proposed",
        "target: 'movement:ordinarium-missae-ix/gloria', status: matched"))
    [found] = problems(catalog(), load(tree["path"]))
    assert "stale correction" in found


# ------------------------------------------------------------- manifest ---


def test_build_shows_a_chosen_file_and_lists_the_one_it_displaced(tree):
    choose(tree, GLORIA, "movement:ordinarium-missae-ix/kyrie")
    shown, listed = manifest.build(tree["src"], tree["parts"], tree["include"], corrections=load(tree["path"]))
    assert [(p["file"], p["target"]) for p in shown["parts"]] == [(GLORIA, "movement:ordinarium-missae-ix/kyrie")]
    kyrie = next(i for i in listed["items"] if i["file"] == KYRIE)
    assert kyrie["status"] == "proposed" and "an editor chose" in kyrie["note"]


def test_build_keeps_a_settled_file_off_the_site_and_marks_it_the_editors(tree):
    choose(tree, KYRIE, "other-setting")
    shown, listed = manifest.build(tree["src"], tree["parts"], tree["include"], corrections=load(tree["path"]))
    assert shown["parts"] == []
    kyrie = next(i for i in listed["items"] if i["file"] == KYRIE)
    assert (kyrie["status"], kyrie["source"]) == ("other-setting", "editor")


def test_build_lists_a_broken_file_with_the_lines_around_its_error(tree):
    lines = "\n".join(f"% line {n}" for n in range(1, 11)) + "\n"
    (tree["src"] / ITE).write_text(lines)
    tree["parts"].write_text(tree["parts"].read_text().replace("'line 3: error: x'", "'line 5:2: error: x'"))
    _, listed = manifest.build(tree["src"], tree["parts"], tree["include"], corrections=[])
    ite = next(i for i in listed["items"] if i["file"] == ITE)
    assert ite["excerpt"] == {"first": 2, "line": 5, "lines": [f"% line {n}" for n in range(2, 9)]}


def test_excerpt_of_an_error_without_a_line_is_none(tmp_path):
    (tmp_path / "a.ly").write_text("x\n")
    assert manifest.excerpt(tmp_path / "a.ly", "LilyPond crashed") is None
    assert manifest.excerpt(tmp_path / "a.ly", "line 40: error: x") is None


# ------------------------------------------------------------ proofread ---


def test_review_typeset_confirms_the_render_hash_and_lapses_when_the_file_changes(tree):
    from pipeline.typeset.render import source_hash
    entry, _ = review(f"typeset:{KYRIE}", today=DAY, base_path=tree["base"], path=tree["path"])
    assert entry.was == source_hash((tree["src"] / KYRIE).read_text())
    current, lapsed = reviews(catalog(), load(tree["path"]))
    assert [e.target for e in current] == [f"typeset:{KYRIE}"] and lapsed == []
    (tree["src"] / KYRIE).write_text(SOURCE + "% edited\n")
    current, lapsed = reviews(catalog(), load(tree["path"]))
    assert current == [] and [e.target for e in lapsed] == [f"typeset:{KYRIE}"]


def test_review_typeset_refuses_a_render_the_editor_did_not_see(tree):
    with pytest.raises(CorrectionError, match="has changed since it was shown"):
        review(f"typeset:{KYRIE}", seen="0" * 32, today=DAY, base_path=tree["base"], path=tree["path"])


# ---------------------------------------------------------------- batch ---


def test_correct_batch_records_matches_and_proofreading_and_merges_itself(tree):
    from pipeline.typeset.render import source_hash
    batch = {"batch": "b-typeset-1", "entries": [
        {"target": f"typeset:{GLORIA}", "field": "match", "value": "movement:ordinarium-missae-ix/gloria",
         "source": "editor", "editor_email": "e@example.org"},
        {"target": f"typeset:{KYRIE}", "field": "reviewed", "value": "yes", "source": "editor",
         "seen": source_hash((tree["src"] / KYRIE).read_text())}]}
    done = correct_batch(batch, today=DAY, base_path=tree["base"], path=tree["path"])
    assert [e.field for e in done] == ["match", "reviewed"]
    assert hold_reasons(done) == []


def test_correct_batch_with_a_bad_match_records_nothing(tree):
    batch = {"batch": "b-typeset-2", "entries": [
        {"target": f"typeset:{GLORIA}", "field": "match", "value": "piece:nowhere", "source": "editor"}]}
    with pytest.raises(CorrectionError, match="nothing was recorded"):
        correct_batch(batch, today=DAY, base_path=tree["base"], path=tree["path"])
    assert not tree["path"].exists()


def test_schema_offers_the_typeset_target_to_every_reader_of_it():
    assert corrections.kind_of(f"typeset:{KYRIE}") == "typeset"
    assert "typeset" in corrections.REVIEW_KINDS
