"""A Proper's whole list of sections as one correction (sections:<slug>), as the
admin's Sections screen saves it: checked, recorded with refs, applied like a
reviewed list, and stale when the list it replaced changes."""

import json

import pytest

from pipeline import corrections, sections

REFS = [f"noh3/0481/{n:03d}" for n in range(12)]


def piece() -> dict:
    return {"slug": "regina", "volume": "noh3", "genre": "proper", "systems": list(REFS), "printed_pages": [1, 3],
            "sections": [
                sections.record("introit", system=0, ref=REFS[0], gregobase_id=61, placed="label"),
                sections.record("gradual", system=4, ref=REFS[4], gregobase_id=1368, placed="label"),
                sections.record("offertory", system=9, ref=REFS[9], gregobase_id=719, placed="label")]}


def lender() -> dict:
    return {"slug": "commune", "volume": "noh4", "genre": "proper", "systems": ["noh4/0111/000"],
            "printed_pages": [76, 77], "sections": [
                sections.record("communion", system=0, ref="noh4/0111/000", gregobase_id=133, placed="label")]}


def base() -> dict:
    return {"schema_version": 3, "volumes": {}, "pieces": [piece(), lender()]}


# The Queenship Mass as an editor lists it: the Paschal Alleluia before the Gradual.
LISTED = [{"kind": "introit", "system": 1, "chant": 61},
          {"kind": "alleluia", "variant": "paschal", "label": "T.P.", "title": "Beata es", "system": 3, "chant": 354},
          {"kind": "gradual", "label": "Grad. I", "system": 5, "chant": 1368},
          {"kind": "offertory", "system": 10, "chant": 719},
          {"kind": "communion", "borrowed_volume": "noh4", "borrowed_page": 76, "chant": "none"}]


@pytest.fixture
def files(tmp_path):
    path = tmp_path / "base.json"
    path.write_text(json.dumps(base()))
    return path, tmp_path / "corrections.yml"


def test_parse_value_checks_the_shape_of_each_section_and_names_the_one_at_fault():
    assert sections.parse_value(json.dumps(LISTED))[1] == {
        "kind": "alleluia", "variant": "paschal", "label": "T.P.", "title": "Beata es", "system": 3, "chant": 354}
    for bad, message in [
        ("not json", "not valid JSON"), ([], "a list of 1 to 40"),
        ([{"kind": "psalm", "system": 1}], "section 1: kind 'psalm'"),
        ([{"kind": "introit", "system": 1, "colour": "red"}], "colour, which a section does not take"),
        ([{"kind": "introit"}], "say where it starts"),
        ([{"kind": "introit", "system": 1, "variant": "lent"}], "should be paschal"),
        ([{"kind": "introit", "system": 1, "label": "<b>"}], "no < or >"),
        ([{"kind": "introit", "system": 1, "chant": "x"}], "GregoBase id"),
        ([{"kind": "introit", "borrowed_page": 4}], "borrowed_volume"),
    ]:
        with pytest.raises(sections.ReviewedError, match=message):
            sections.parse_value(bad)


def test_with_refs_records_each_start_as_the_systems_ref_and_refuses_one_outside_the_piece():
    listed = sections.with_refs(sections.parse_value(LISTED), piece())
    assert listed[1] == {"kind": "alleluia", "variant": "paschal", "label": "T.P.", "title": "Beata es",
                         "ref": REFS[2], "chant": 354}
    with pytest.raises(sections.ReviewedError, match="system 13 is outside regina, which has 12 systems"):
        sections.with_refs(sections.parse_value([{"kind": "introit", "system": 13}]), piece())


def test_correct_records_the_whole_list_with_the_list_it_replaces_and_apply_makes_it_the_pieces(files):
    base_path, path = files
    entry, replaced = corrections.correct("sections:regina", "sections", json.dumps(LISTED), note="as printed",
                                          editor_email="ed@example.org", base_path=base_path, path=path)
    assert not replaced and entry.was == sections.as_reviewed(piece())
    assert [e.get("ref") for e in entry.value] == [REFS[0], REFS[2], REFS[4], REFS[9], None]
    out = corrections.apply(base(), corrections.load(path))
    got = out["pieces"][0]["sections"]
    assert [(s["kind"], s["variant"], s.get("system"), s.get("placed")) for s in got] == [
        ("introit", "", 0, "reviewed"), ("alleluia", "paschal", 2, "reviewed"), ("gradual", "", 4, "reviewed"),
        ("offertory", "", 9, "reviewed"), ("communion", "", None, None)]
    # The communion printed elsewhere is linked to the piece that lends it.
    assert (got[4]["borrowed_from"], got[4]["borrowed_ref"]) == ("commune", "noh4/0111/000")
    assert got[1]["title"] == "Beata es" and got[1]["gregobase_id"] == 354


def test_correct_a_second_list_for_the_same_piece_replaces_the_first_keeping_what_it_replaced(files):
    base_path, path = files
    corrections.correct("sections:regina", "sections", json.dumps(LISTED), base_path=base_path, path=path)
    shorter = [e for e in LISTED if e["kind"] != "communion"]
    entry, replaced = corrections.correct("sections:regina", "sections", shorter, base_path=base_path, path=path)
    assert replaced and entry.was == sections.as_reviewed(piece()) and len(entry.value) == 4
    assert len(corrections.load(path)) == 1


def test_correct_a_list_out_of_order_or_unchanged_is_refused_recording_nothing(files):
    base_path, path = files
    backwards = [LISTED[2], LISTED[0]]
    with pytest.raises(corrections.CorrectionError, match="not after the section before"):
        corrections.correct("sections:regina", "sections", backwards, base_path=base_path, path=path)
    same = sections.as_reviewed(piece())
    with pytest.raises(corrections.CorrectionError, match="nothing to correct"):
        corrections.correct("sections:regina", "sections", same, base_path=base_path, path=path)
    assert not path.exists()


def test_apply_a_list_whose_piece_changed_since_is_stale_stopping_the_build(files):
    base_path, path = files
    corrections.correct("sections:regina", "sections", json.dumps(LISTED), base_path=base_path, path=path)
    changed = base()
    changed["pieces"][0]["sections"][1]["system"], changed["pieces"][0]["sections"][1]["ref"] = 5, REFS[5]
    with pytest.raises(corrections.CorrectionError, match="stale correction: sections:regina sections"):
        corrections.apply(changed, corrections.load(path))


def test_apply_a_part_correction_counts_from_the_list(files):
    base_path, path = files
    corrections.correct("sections:regina", "sections", json.dumps(LISTED), base_path=base_path, path=path)
    corrections.correct("part:regina/alleluia:paschal", "start_system", "4", base_path=base_path, path=path)
    out = corrections.apply(base(), corrections.load(path))
    assert out["pieces"][0]["sections"][1]["ref"] == REFS[3]


def test_correct_batch_takes_a_list_as_json_text_summarised_in_brief(files):
    base_path, path = files
    done = corrections.correct_batch({"batch": "b-202609291200-abcdef", "entries": [
        {"target": "sections:regina", "field": "sections", "value": json.dumps(LISTED), "source": "editor",
         "editor_email": "ed@example.org"}]}, base_path=base_path, path=path)
    summary = corrections.batch_summary("b-202609291200-abcdef", done)
    assert "introit noh3/0481/000; alleluia (paschal) noh3/0481/002; gradual noh3/0481/004" in summary
    assert "communion noh4 p. 76" in summary and corrections.hold_reasons(done) == []


def test_no_ops_a_list_the_data_now_has_anyway_is_listed(files):
    base_path, path = files
    entry, _ = corrections.correct("sections:regina", "sections", json.dumps(LISTED), base_path=base_path, path=path)
    assert corrections.no_ops(base(), [entry]) == []
    fixed = corrections.apply(base(), [entry])            # as if the source now printed it this way
    assert corrections.no_ops(fixed, [entry]) == [entry]


def test_save_reviewed_replaces_one_pieces_list_and_keeps_the_comments_around_it(tmp_path):
    path = tmp_path / "noh3.yml"
    path.write_text(sections.REVIEWED_HEADER + "\n# The Queenship Mass: checked 2026-09-29.\nregina:\n"
                    "- {kind: introit, ref: noh3/0481/000}\n# St Paul of the Cross.\npaul:\n"
                    "- {kind: introit, ref: noh3/0185/000}\n")
    sections.save_reviewed("regina", "noh3", [{"kind": "introit", "ref": REFS[1], "chant": "none"}], tmp_path)
    text = path.read_text()
    assert "# The Queenship Mass: checked 2026-09-29.\nregina:\n- {kind: introit, ref: noh3/0481/001, chant: none}\n" \
           "# St Paul of the Cross.\npaul:" in text
    sections.save_reviewed("new-one", "noh3", [{"kind": "introit", "ref": REFS[2]}], tmp_path)
    assert sections.load_reviewed(tmp_path)["new-one"][1] == [{"kind": "introit", "ref": REFS[2]}]
