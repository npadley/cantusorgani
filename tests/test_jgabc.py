"""jgabc's per-day chant ids (pipeline.jgabc): strict literal parsing, the
vendored file's integrity, and the mapping from 1962 calendar keys."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.jgabc import (
    JgabcIntegrityError,
    JgabcSyntaxError,
    extract_menus,
    extract_proprium,
    jgabc_key,
    jgabc_key_for_piece,
    load_menus,
    load_proprium,
    parse_js_literal,
    proper_url,
    resolve,
    slim,
    write_vendored,
)

# ---------------------------------------------------------------- parsing ---


def test_parse_proprium_valid_literal_returns_dict():
    src = """{
        "Oct3": {"inID": 59, 'grID': 1034, gbid: "ste_therese_ej",},  // trailing comma
        /* a comment */ "list": [1, 2.5, -3, true, false, null],
        "esc": "a\\"b\\n\\u00e6",
    }"""
    assert parse_js_literal(src) == {
        "Oct3": {"inID": 59, "grID": 1034, "gbid": "ste_therese_ej"},
        "list": [1, 2.5, -3, True, False, None],
        "esc": 'a"b\næ',
    }


def test_parse_proprium_opaque_references_and_regexes_are_dropped_not_run():
    """jgabc's file names helper variables and regex literals as values; they
    are never evaluated, only skipped."""
    src = '{"a": {"inID": 1, "gabcReplace": gabcRemoveLastAlleluia, "re": [/d[oó](\\([^)]+\\))na/g, "x"]}}'
    assert parse_js_literal(src) == {"a": {"inID": 1, "re": ["x"]}}


def test_parse_proprium_function_call_rejected_raises():
    with pytest.raises(JgabcSyntaxError, match="line 1"):
        parse_js_literal('{"a": alert(1)}')


def test_parse_proprium_operator_rejected_raises():
    with pytest.raises(JgabcSyntaxError):
        parse_js_literal('{"a": "x" + "y"}')


def test_parse_proprium_unterminated_string_raises():
    with pytest.raises(JgabcSyntaxError):
        parse_js_literal('{"a": "never closed}')


def test_extract_proprium_finds_the_object_among_other_code():
    js = ('var sundayKeys = [{key:"Adv1"}];\nvar proprium = {\n "Oct3": {"inID": 59}\n};\n'
          'if(module && module.exports) module.exports.proprium = proprium;')
    assert extract_proprium(js) == {"Oct3": {"inID": 59}}


def test_extract_proprium_missing_raises():
    with pytest.raises(JgabcSyntaxError, match="proprium"):
        extract_proprium("var other = {};")


# ------------------------------------------------------------ slim/resolve ---


def test_slim_keeps_ids_refs_and_incipits_only():
    raw = {"Oct3": {"inID": 59, "inVerses": "Ps 112", "gbid": "x", "coID": 162},
           "votiveSCJ": {"ref": "SCJ", "coVerses": "Ps 88"},
           "mass_holy_pope": {"in": "Si diligis me", "inID": 1, "href": "http://x"}}
    assert slim(raw) == {"Oct3": {"inID": 59, "coID": 162},
                         "votiveSCJ": {"ref": "SCJ"},
                         "mass_holy_pope": {"in": "Si diligis me", "inID": 1}}


def test_resolve_follows_ref_chains_with_own_fields_winning():
    data = {"a": {"ref": "b", "inID": 1}, "b": {"ref": "c", "grID": 2}, "c": {"inID": 9, "coID": 3}}
    assert resolve(data, "a") == {"inID": 1, "grID": 2, "coID": 3}


def test_resolve_cycle_and_missing_return_none():
    assert resolve({"a": {"ref": "b"}, "b": {"ref": "a"}}, "a") is None
    assert resolve({}, "nope") is None


# -------------------------------------------------------------- vendoring ---


def test_write_vendored_then_load_round_trips(tmp_path: Path):
    path = tmp_path / "jgabc.json"
    write_vendored({"Oct3": {"inID": 59}}, commit="abc123", source_sha256="f" * 64, path=path)
    assert load_proprium(path) == {"Oct3": {"inID": 59}}
    header = json.loads(path.read_text())["source"]
    assert header["commit"] == "abc123"
    assert header["licence"] == "Unlicense"


def test_load_proprium_hand_edit_fails_integrity_with_fix(tmp_path: Path):
    path = tmp_path / "jgabc.json"
    write_vendored({"Oct3": {"inID": 59}}, commit="abc", source_sha256="0" * 64, path=path)
    doc = json.loads(path.read_text())
    doc["proprium"]["Oct3"]["inID"] = 60
    path.write_text(json.dumps(doc))
    with pytest.raises(JgabcIntegrityError, match="re-run uv run noh jgabc-fetch; do not hand-edit"):
        load_proprium(path)


def test_load_proprium_missing_file_says_how_to_fetch(tmp_path: Path):
    with pytest.raises(JgabcIntegrityError, match="noh jgabc-fetch"):
        load_proprium(tmp_path / "absent.json")


def test_vendored_file_matches_its_header():
    assert "Oct3" in load_proprium()


# -------------------------------------------------------------- key mapping ---


@pytest.mark.parametrize(("day", "expected"), [
    ("sancti:10-03", "Oct3"),
    ("sancti:07-03r", "Jul3"),
    ("sancti:12-25m1", "Dec25_1"),
    ("sancti:12-25m3", "Dec25_3"),
    ("sancti:10-DU", "ChristusRex"),
    ("tempora:Adv1-0", "Adv1"),
    ("tempora:Adv3-3", "Adv3w"),
    ("tempora:Adv3-5", "Adv3f"),
    ("tempora:Adv3-6", "Adv3s"),
    ("tempora:Quadp1-0", "7a"),
    ("tempora:Quadp3-3", "5aw"),
    ("tempora:Quad3-3", "Quad3w"),
    ("tempora:Quad5-5Feria", "Quad5f"),
    ("tempora:Quad6-0r", "Quad6"),
    ("tempora:Quad6-4r", "Quad6h"),
    ("tempora:Pasc0-0", "Pasc0"),
    ("tempora:Pasc0-1", "Pasc0m"),
    ("tempora:Pasc5-4", "Asc"),
    ("tempora:Pasc7-0", "Pent0"),
    ("tempora:Pasc7-3", "Pent0w"),
    ("tempora:Pent01-0r", "Pent1"),
    ("tempora:Pent01-4", "CorpusChristi"),
    ("tempora:Pent02-5", "SCJ"),
    ("tempora:Pent18-0", "Pent18"),
    ("tempora:093-3", "EmbWedSept"),
    ("tempora:Epi3-0", "Epi3"),
    ("tempora:Nat2-0", "Nat2"),
])
def test_jgabc_key_known_day_maps(day: str, expected: str):
    assert jgabc_key(day) == expected


def test_jgabc_key_unknown_shape_returns_none():
    assert jgabc_key("commune:C5b") is None
    assert jgabc_key("tempora:Nonsense-9") is None


def test_jgabc_key_for_piece_commons_and_votives_by_slug():
    assert jgabc_key_for_piece({"slug": "commune-unius-aut-plurium-summorum-pontificum",
                                "days": [], "linked_days": []}) == "mass_holy_pope"
    assert jgabc_key_for_piece({"slug": "feria-iii-missa-de-angelis",
                                "days": [], "linked_days": []}) == "votiveA"


def test_jgabc_key_for_piece_uses_its_own_day_not_a_lent_one():
    """St Andrew's Mass is lent to St James: its own day decides."""
    piece = {"slug": "s-andre-apostoli", "days": ["sancti:11-30", "sancti:07-25"],
             "linked_days": ["sancti:07-25"]}
    assert jgabc_key_for_piece(piece) == "Nov30"


def test_extract_menus_maps_each_key_to_the_menu_it_is_listed_under():
    js = ('var sundayKeys = [{title:"x"},{key:"Pent18",title:"a"}];\n'
          'var saintKeys = [{key:"Oct3",title:"b"}];\n'
          'var otherKeys = [{key:"votiveA",title:"c"}];\n'
          'var commonsKeys = [{key:"mass_holy_pope",title:"d"}];')
    assert extract_menus(js) == {"Pent18": "sunday", "Oct3": "saint", "votiveA": "mass",
                                 "mass_holy_pope": "common"}


def test_proper_url_uses_the_menu_as_the_hash_and_none_when_unlisted():
    menus = {"Oct3": "saint", "Pent18": "sunday"}
    assert proper_url("Oct3", menus) == "https://bbloomf.github.io/jgabc/propers.html#saint=Oct3"
    assert proper_url("Pent18", menus) == "https://bbloomf.github.io/jgabc/propers.html#sunday=Pent18"
    assert proper_url("Nowhere", menus) is None


def test_vendored_menus_list_st_therese_under_saints():
    assert load_menus()["Oct3"] == "saint"


def test_jgabc_key_feasts_jgabc_names_by_two_dates():
    assert jgabc_key("sancti:02-24") == "Feb24or25"
    assert jgabc_key("sancti:02-27") == "Feb27or28"
