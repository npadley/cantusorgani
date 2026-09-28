"""Divinum Officium's Vespers texts, vendored (pipeline.officium).

The parser and resolver run on small synthetic files in Divinum Officium's
format; the vendored copy is checked once for the offices the lineup needs."""

from __future__ import annotations

import json

import pytest

from pipeline import cli, doctor
from pipeline.doctor import FAIL, OK
from pipeline.officium import (
    Library,
    OfficiumError,
    antiphon_lines,
    applies_1960,
    build,
    load,
    needed_files,
    office,
    parse_sections,
    psalm_text,
    write_vendored,
)

FEAST = """[Rank]
In Festo;;Duplex I Classis;;6

[Rule]
ex C11;
Psalmi Dominica

[Ant Vespera]
Rex pacíficus * magnificátus est.;;109
Magnificátus est * Rex pacíficus.;;110

[Ant 1]
Cum ortus fúerit * sol de cælo.

[Hymnus Vespera]
{:H-Jesu:}v. Jesu, Redémptor ómnium,
Quem lucis ante oríginem

[Versum 1]
@:Versum 1_
(sed rubrica cisterciensis)
@:Versum 1C

[Versum 1_]
V. Crástina die.

[Versum 1C]
V. Cisterciensis.

[Ant 3]
Hódie * Christus natus est.
"""

COMMON = """[Rule]
9 lectiones

[Ant Vespera 3]
Isti sunt Sancti * of the Common.;;109

[Capitulum Vespera]
Benedíxit te Dóminus.
$Deo gratias
"""


def lib() -> Library:
    return Library({"Sancti/12-25": FEAST, "Commune/C11": COMMON})


def test_parse_sections_names_conditions_and_bodies():
    sections = parse_sections("[Rank]\nA\n\n[Rank] (rubrica 1960)\nB\n")
    assert sections["Rank"] == [(None, ["A", ""]), ("rubrica 1960", ["B"])]


@pytest.mark.parametrize(("condition", "holds"), [
    (None, True), ("rubrica 1960", True), ("rubrica 196", True), ("nisi rubrica 1960", False),
    ("rubrica cisterciensis", False), ("nisi rubrica cisterciensis", True), ("rubrica tridentina", False),
])
def test_applies_1960_reads_the_rubric_conditions(condition, holds):
    assert applies_1960(condition) is holds


def test_section_follows_same_file_references_and_skips_other_uses():
    assert lib().section("Sancti/12-25", "Versum 1") == ["V. Crástina die."]


def test_section_falls_back_to_the_rules_common():
    assert lib().section("Sancti/12-25", "Capitulum Vespera") == ["Benedíxit te Dóminus.", "$Deo gratias"]


def test_section_unresolved_reference_names_the_file_section_and_fix():
    broken = Library({"Tempora/X": "[Ant 1]\n@Tempora/Missing:Ant 1\n"})
    with pytest.raises(OfficiumError, match=r"Tempora/X \[Ant 1\]: reference @Tempora/Missing:Ant 1 not found"):
        broken.section("Tempora/X", "Ant 1")


def test_office_own_antiphons_are_not_displaced_by_the_commons_ii_vespers():
    """A feast's own [Ant Vespera] serves II Vespers before its Common's
    [Ant Vespera 3] (All Saints, the Circumcision)."""
    o = office(lib(), "Sancti/12-25")
    assert [a["text"] for a in o["II"]["antiphons"]] == ["Rex pacíficus * magnificátus est.",
                                                          "Magnificátus est * Rex pacíficus."]
    assert o["I"]["magnificat"] == "Cum ortus fúerit * sol de cælo."
    assert o["II"]["magnificat"] == "Hódie * Christus natus est."
    assert o["hymn"] == "Jesu, Redémptor ómnium,"
    assert o["II"]["chapter"] == "Benedíxit te Dóminus."


def test_antiphon_lines_and_psalm_text():
    assert antiphon_lines(["Tecum * in die.;;109", "Alleluia"]) == [
        {"text": "Tecum * in die.", "psalm": 109}, {"text": "Alleluia", "psalm": None}]
    assert psalm_text("109:1a Dixit Dóminus: * Sede.\n109:1b Donec ponam.\n") == ["Dixit Dóminus: * Sede.",
                                                                                     "Donec ponam."]


def test_build_and_needed_files_follow_commons_and_psalms():
    files = {"Sancti/12-25": FEAST, "Commune/C11": COMMON, "Psalterium/Psalmi/Psalmi major": "[Day0 Vespera]\n"
             "Dixit * Dómino meo.;;109\n", "Psalterium/Psalmorum/Psalm109": "109:1 Dixit.\n",
             "Psalterium/Psalmorum/Psalm110": "110:1 Confitébor.\n"}
    fetched = needed_files(lambda name: files.get(name))
    assert {"Sancti/12-25", "Commune/C11", "Psalterium/Psalmorum/Psalm109"} <= set(fetched)
    content = build(fetched)
    assert content["sunday"] == [{"text": "Dixit * Dómino meo.", "psalm": 109}]
    assert content["psalms"]["110"] == ["Confitébor."]
    assert "Sancti/12-25" in content["offices"]


def test_load_hand_edit_or_missing_file_fails_with_the_fix(tmp_path):
    content = {"offices": {}, "sunday": [], "psalms": {"109": ["Dixit."]}}
    path = write_vendored(content, "abc1234", tmp_path / "o.json")
    assert load(path)["psalms"]["109"] == ["Dixit."]
    doc = json.loads(path.read_text())
    doc["psalms"]["109"] = ["Edited."]
    path.write_text(json.dumps(doc))
    with pytest.raises(OfficiumError, match="re-run uv run noh officium-fetch"):
        load(path)
    with pytest.raises(OfficiumError, match="run uv run noh officium-fetch"):
        load(tmp_path / "none.json")


def test_fetch_bad_commit_leaves_the_file_untouched(tmp_path):
    from pipeline.officium import fetch
    with pytest.raises(OfficiumError, match="not a commit sha"):
        fetch("main; rm", tmp_path / "o.json")
    assert not (tmp_path / "o.json").exists()


def test_fetch_downloads_resolves_and_vendors(tmp_path, monkeypatch):
    import io
    import urllib.error
    import urllib.request

    from pipeline import officium
    files = {"Sancti/12-25": FEAST, "Commune/C11": COMMON}
    monkeypatch.setattr(officium, "OFFICES", ["Sancti/12-25"])

    def urlopen(request, timeout=60):
        name = request.full_url.split("/Latin/", 1)[1].removesuffix(".txt").replace("%20", " ")
        if name not in files:
            raise urllib.error.HTTPError(request.full_url, 404, "missing", {}, None)
        return io.BytesIO(files[name].encode())
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    path, _commit, count = officium.fetch("abc1234", tmp_path / "o.json")
    assert count == 1 and load(path)["offices"]["Sancti/12-25"]["I"]["antiphons"][0]["psalm"] == 109


def test_vendored_copy_has_the_offices_the_lineup_needs():
    content = load()
    assert content["offices"]["Sancti/12-25"]["II"]["antiphons"][3]["psalm"] == 129
    assert content["offices"]["Sancti/11-01"]["II"]["antiphons"][0]["text"].startswith("Vidi turbam")
    assert content["psalms"]["109"][0].startswith("Dixit Dóminus")


def test_check_officium_doctor_fail_and_pass(tmp_path):
    bad = doctor.check_officium(tmp_path / "none.json")
    assert bad.status == FAIL and "Fix: uv run noh officium-fetch" in bad.detail
    assert doctor.check_officium().status == OK


def test_cli_officium_fetch_reports_and_fails_cleanly(capsys, monkeypatch):
    from pipeline import officium
    monkeypatch.setattr(officium, "fetch", lambda _c: ("data/vespers/divinum-officium-vespers.json", "abc1234def", 70))
    assert cli.main(["officium-fetch"]) == 0
    assert "Vespers of 70 offices" in capsys.readouterr().out

    def broken(_c):
        raise OfficiumError("not a commit sha: 'x'")
    monkeypatch.setattr(officium, "fetch", broken)
    assert cli.main(["officium-fetch", "--commit", "x"]) == 1
    assert "left untouched" in capsys.readouterr().err
