"""The chant notation the site publishes (pipeline.chants)."""

from __future__ import annotations

import json

import pytest

from pipeline.chants import chant_body, good_friday_ids, select_chants, write_chants
from pipeline.gregobase import DUMP, Chant, load_chant_rows

GABC = '[["tex","\\\\grechangedim"],["gabc","(c4) VE(gj)ni(jjj) de(j) Lí(hj)ba(jvIH)no,(h.)"]]'


def chant(cid: int, part: str = "in", copyrighted: bool = False) -> tuple[Chant, bool]:
    return Chant(id=cid, incipit=f"Incipit {cid}", office_part=part, mode="3", gabc=GABC,
                 cantusid=None), copyrighted


def catalog() -> dict[str, object]:
    return {"pieces": [
        {"slug": "therese", "sections": [
            {"kind": "introit", "gregobase_id": 59, "system": 0, "ref": "r", "placed": "label"},
            {"kind": "gradual", "gregobase_id": 1034, "system": 3, "ref": "s", "placed": "label"},
            {"kind": "offertory", "gregobase_id": None, "system": 5, "ref": "t", "placed": "label"},
            {"kind": "communion", "gregobase_id": 162, "borrowed_page": 81, "borrowed_from": None},
        ]},
        {"slug": "mass", "sections": []},
    ]}


def test_chant_body_takes_the_gabc_item_of_gregobase_json():
    assert chant_body(GABC) == "(c4) VE(gj)ni(jjj) de(j) Lí(hj)ba(jvIH)no,(h.)"


def test_chant_body_plain_gabc_and_nothing_pass_through():
    assert chant_body("(c4) A(f)") == "(c4) A(f)"
    assert chant_body(None) is None
    assert chant_body('[["tex","x"]]') is None


def test_select_chants_every_referenced_part_printed_or_borrowed():
    rows = [chant(59), chant(1034, "gr"), chant(162, "co"), chant(999)]
    chosen = select_chants(catalog(), rows)
    assert sorted(chosen) == [59, 162, 1034]
    assert chosen[59] == {"part": "in", "mode": "3", "incipit": "Incipit 59",
                          "gabc": "(c4) VE(gj)ni(jjj) de(j) Lí(hj)ba(jvIH)no,(h.)"}


def test_select_chants_never_publishes_a_copyrighted_transcription():
    chosen = select_chants(catalog(), [chant(59, copyrighted=True), chant(1034, "gr")])
    assert 59 not in chosen
    assert 1034 in chosen


def test_write_chants_sorted_json_with_its_licence(tmp_path):
    path = write_chants({1034: {"gabc": "x"}, 59: {"gabc": "y"}}, tmp_path / "chants.json")
    doc = json.loads(path.read_text())
    assert list(doc["chants"]) == ["59", "1034"]
    assert doc["source"]["licence"] == "CC0"


def test_select_chants_verified_movement_pairings_of_the_kyriale_are_published():
    """Missa IX's movements carry GregoBase pairings; an unverified one is left out."""
    cat = {"pieces": [{"slug": "ordinarium-missae-ix", "sections": [], "chant": [
        {"source": "gregobase", "id": 2976, "movement": "kyrie", "status": "verified"},
        {"source": "gregobase", "id": 2771, "movement": "gloria", "status": "unverified"},
    ]}]}
    chosen = select_chants(cat, [chant(2976, "ky"), chant(2771, "ky")])
    assert sorted(chosen) == [2976]


def test_chant_body_gabc_stored_as_a_json_string():
    """Kyrie I (GregoBase 1143) keeps its notation as a JSON-quoted string."""
    assert chant_body('"(c3) KY(ef!hv)ri(f)e(fhhvGE)"') == "(c3) KY(ef!hv)ri(f)e(fhhvGE)"


def test_good_friday_ids_every_item_of_both_rites(tmp_path):
    path = tmp_path / "good-friday.json"
    path.write_text(json.dumps({"rites": [
        {"sections": [{"items": [{"gregobase_id": 602}, {"gregobase_id": 157}]}]},
        {"sections": [{"items": [{"gregobase_id": 157}, {"gregobase_id": 4612}]}]},
    ]}), encoding="utf-8")
    assert good_friday_ids(path) == {602, 157, 4612}
    assert good_friday_ids(tmp_path / "missing.json") == set()


@pytest.mark.skipif(not DUMP.exists(), reason="GregoBase dump not vendored")
def test_good_friday_chants_are_in_the_dump_and_publishable():
    """Every chant the Good Friday page names is a GregoBase row that is not a
    duplicate, has notation, and is not flagged copyrighted."""
    rows = {chant.id: (chant, copyrighted) for chant, copyrighted in load_chant_rows()}
    ids = good_friday_ids()
    assert ids
    assert sorted(i for i in ids if i not in rows) == []
    assert sorted(i for i in ids if rows[i][1] or not chant_body(rows[i][0].gabc)) == []
