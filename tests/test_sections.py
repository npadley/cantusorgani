"""A Proper's sections: how each is named, and schema 2 parts read as sections."""

from pipeline import sections


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
