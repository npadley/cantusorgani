"""A Proper's sections: how each is named, and schema 2 parts read as sections."""

import json

import pytest

from pipeline import cli, corrections, sections


def test_suffix_target_and_named_follow_the_names_corrections_have_always_used():
    alone = sections.record("introit", system=0, ref="noh1/0029/000")
    second = sections.record("gradual", "2", system=15, ref="noh1/0052/003")
    paschal = sections.record("alleluia", "paschal", system=20, ref="noh1/0053/000")
    assert [sections.suffix(s) for s in (alone, second, paschal)] == ["", ":2", ":paschal"]
    assert sections.target("sabbato", second) == "part:sabbato/gradual:2"
    assert second == {"kind": "gradual", "n": 2, "variant": "", "system": 15, "ref": "noh1/0052/003"}
    assert sections.named(second, "gradual", "2") and not sections.named(second, "gradual")
    assert sections.named(alone, "introit") and not sections.named(paschal, "alleluia")


def test_from_part_reads_a_schema_2_part_and_printed_leaves_out_borrowed_sections():
    old = {"part": "communion", "variant": "2", "system": 4, "ref": "r", "gregobase_id": 300, "placed": "label"}
    assert sections.from_part(old) == {"kind": "communion", "n": 2, "variant": "", "system": 4, "ref": "r",
                                       "gregobase_id": 300, "placed": "label"}
    piece = {"sections": [sections.from_part(old),
                          sections.from_part({"part": "offertory", "variant": "", "borrowed_page": 3})]}
    assert [s["kind"] for s in sections.printed(piece)] == ["communion"]
    assert len(sections.of(piece)) == 2 and sections.of({}) == []


def test_every_kind_the_plan_names_is_known():
    assert set(sections.KINDS) >= {"introit", "gradual", "alleluia", "tract", "sequence", "hymn",
                                   "offertory", "communion", "other"}


# ------------------------------------------------------- reviewed sections ---

REFS = [f"noh3/0481/{n:03d}" for n in range(12)]


def piece() -> dict:
    """A small Queenship Mass as the pipeline proposes it, in the fixed order."""
    return {"slug": "regina", "volume": "noh3", "systems": list(REFS), "sections": [
        sections.record("introit", system=0, ref=REFS[0], gregobase_id=61, placed="label"),
        sections.record("gradual", system=4, ref=REFS[4], gregobase_id=1368, placed="label"),
        sections.record("alleluia", system=7, ref=REFS[7], gregobase_id=717, placed="order"),
        sections.record("offertory", system=9, ref=REFS[9], gregobase_id=719, placed="label")]}


QUEENSHIP = [{"kind": "introit", "ref": REFS[0]}, {"kind": "alleluia", "variant": "paschal", "ref": REFS[2]},
             {"kind": "gradual", "label": "Grad. I", "ref": REFS[4]}, {"kind": "alleluia", "ref": REFS[7], "chant": 718},
             {"kind": "offertory", "ref": REFS[9], "chant": "none"}]


def test_a_reviewed_list_is_the_whole_truth_in_printed_order_keeping_the_pipelines_chants():
    catalog = {"pieces": [piece()]}
    assert sections.apply_reviewed(catalog, {"regina": ("data/sections/noh3.yml", QUEENSHIP)}) == []
    got = catalog["pieces"][0]["sections"]
    assert [(s["kind"], s["variant"], s["system"], s["placed"]) for s in got] == [
        ("introit", "", 0, "reviewed"), ("alleluia", "paschal", 2, "reviewed"), ("gradual", "", 4, "reviewed"),
        ("alleluia", "", 7, "reviewed"), ("offertory", "", 9, "reviewed")]
    # The pipeline's chant where the list gives none; the list's own, and none, where it does.
    assert [s["gregobase_id"] for s in got] == [61, None, 1368, 718, None]
    assert got[2]["label"] == "Grad. I"


@pytest.mark.parametrize(("entries", "message"), [
    ([{"kind": "introit", "ref": "noh3/0999/000"}],
     "regina section 1 (introit): noh3/0999/000 is not a system of regina, which runs noh3/0481/000 to noh3/0481/011"),
    ([{"kind": "introit", "ref": REFS[3]}, {"kind": "gradual", "ref": REFS[1]}],
     "starts on noh3/0481/001, not after the section before"),
    ([{"kind": "gradual", "ref": REFS[1]}, {"kind": "gradual", "ref": REFS[3]}],
     "part:regina/gradual is listed twice; number them with n: 1, n: 2"),
    ([{"kind": "psalm", "ref": REFS[1]}], "kind 'psalm' is not one of"),
    ([{"kind": "gradual", "n": 0, "ref": REFS[1]}], "n 0 should be 1, 2, 3"),
    ([{"kind": "gradual", "ref": REFS[1], "chant": "x"}], "chant 'x' should be a GregoBase id or none"),
])
def test_a_reviewed_list_that_cannot_apply_names_the_piece_the_section_and_the_fix_and_changes_nothing(entries, message):
    catalog = {"pieces": [piece()]}
    found = sections.apply_reviewed(catalog, {"regina": ("data/sections/noh3.yml", entries)})
    assert found and message in found[0] and found[0].startswith("data/sections/noh3.yml: regina section")
    assert catalog["pieces"][0]["sections"] == piece()["sections"]


def test_a_reviewed_list_for_a_piece_the_catalogue_lacks_or_listed_twice_is_refused(tmp_path):
    assert "gone is not in the catalogue" in sections.apply_reviewed({"pieces": []}, {"gone": ("f", [])})[0]
    (tmp_path / "noh1.yml").write_text("regina: []\n")
    (tmp_path / "noh3.yml").write_text("regina: []\n")
    with pytest.raises(sections.ReviewedError, match="regina is also listed in data/sections/noh1.yml"):
        sections.load_reviewed(tmp_path)
    (tmp_path / "noh1.yml").write_text("- not a mapping\n")
    with pytest.raises(sections.ReviewedError, match="expected pieces by slug"):
        sections.load_reviewed(tmp_path)


def test_corrections_apply_the_reviewed_lists_first_and_a_stale_one_stops_the_build(tmp_path, monkeypatch):
    base = {"schema_version": 3, "volumes": {}, "pieces": [piece()]}
    (tmp_path / "noh3.yml").write_text(json.dumps({"regina": QUEENSHIP}))
    monkeypatch.setattr(corrections, "SECTIONS", tmp_path)
    moved = corrections.Entry(id="c-0001", target="part:regina/alleluia:paschal", field="start_system", was=3, value=4)
    out = corrections.apply(base, [moved])
    assert out["pieces"][0]["sections"][1]["ref"] == REFS[3]            # a correction on top of the reviewed list
    (tmp_path / "noh3.yml").write_text(json.dumps({"regina": [{"kind": "introit", "ref": "noh3/0999/000"}]}))
    with pytest.raises(corrections.CorrectionError, match="noh3/0999/000 is not a system of regina"):
        corrections.apply(base, [])


def test_describe_and_review_start_a_list_in_printed_order(tmp_path):
    p = piece()
    p["sections"].insert(2, sections.record("alleluia", "paschal", system=2, ref=REFS[2], gregobase_id=354,
                                            placed="hand"))
    p["sections"].append(sections.record("communion", gregobase_id=None, borrowed_volume="noh4",
                                         borrowed_page=81, borrowed_from=None, borrowed_ref=None))
    text = sections.describe(p)
    assert "part:regina/alleluia:paschal  system 3 (noh3/0481/002)  placed hand  chant 354" in text
    assert "part:regina/communion  printed elsewhere (noh4, p. 81; unresolved)" in text
    listed = sections.as_reviewed(p)
    assert [(e["kind"], e.get("variant", "")) for e in listed] == [
        ("introit", ""), ("alleluia", "paschal"), ("gradual", ""), ("alleluia", ""), ("offertory", ""), ("communion", "")]
    path = sections.save_reviewed("regina", "noh3", listed, tmp_path)
    assert sections.load_reviewed(tmp_path)["regina"][1] == listed
    assert path.read_text().startswith("# A Proper's sections, checked against the scans")


def test_cli_sections_prints_the_list_and_names_a_missing_piece(capsys):
    assert cli.main(["sections", "sabbato-temporum-adventus"]) == 0
    out = capsys.readouterr().out
    assert "part:sabbato-temporum-adventus/gradual:4  system 33 (noh1/0055/002)  placed reviewed" in out
    assert cli.main(["sections", "no-such-piece"]) == 1
    assert "no piece 'no-such-piece'" in capsys.readouterr().err


@pytest.mark.real_sections
def test_the_committed_reviewed_lists_all_apply():
    # As the build applies them: after the pieces' corrected system ranges.
    _, failed = corrections._ranged(corrections.load_base(), corrections.load())
    assert failed == {}
