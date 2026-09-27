"""jsrjenkins/vesperale's Sunday table, vendored as a cross-check (pipeline.vesperale)."""

from __future__ import annotations

import json

import pytest

from pipeline import doctor
from pipeline.doctor import FAIL, OK
from pipeline.vesperale import (
    VesperaleIntegrityError,
    calendar_key,
    load_magnificat,
    parse_magnificat,
    tone_of,
    write_vendored,
)

STY = r"""
\newcommand{\canticum}[3][\magnificat]{% two arguments
   \IfEqCase{#2}{%
    {epiphania}{\IfEqCase{#3}{%
        {ii} {#1{an--deficiente_vino--solesmes}{1f}} %2nd after Epiphany
        {iii}{#1{}{}}   %% TODO %%
      }}% end epiphany cases
    {pentecostes}{\IfEqCase{#3}{%
        {xiv}  {#1{an--quaerite_primum--solesmes}{1g}}   %14th
        {xv}   {#1{an--propheta_magnus--solesmes}{4A}}   %15th
      }}% end pentecost cases
  }% end choose instruction
}%end command
\newcommand\conclusio[1]{}
"""


def test_parse_magnificat_reads_sundays_and_skips_empty_entries():
    assert parse_magnificat(STY) == {
        "tempora:Epi2-0": {"antiphon": "an--deficiente_vino--solesmes", "tone": "1f"},
        "tempora:Pent14-0": {"antiphon": "an--quaerite_primum--solesmes", "tone": "1g"},
        "tempora:Pent15-0": {"antiphon": "an--propheta_magnus--solesmes", "tone": "4A"},
    }


def test_parse_magnificat_no_table_raises():
    with pytest.raises(VesperaleIntegrityError, match="no \\\\canticum table"):
        parse_magnificat(r"\newcommand\other{}")


@pytest.mark.parametrize(("season", "sunday", "key"), [
    ("pentecostes", "xiv", "tempora:Pent14-0"), ("epiphania", "ii", "tempora:Epi2-0"),
    ("septuagesima", "i", "tempora:Quadp1-0"), ("passio", "i", "tempora:Quad5-0"),
    ("nowhere", "i", None), ("pentecostes", "xxx", None),
])
def test_calendar_key_maps_vesperale_seasons_to_site_keys(season, sunday, key):
    assert calendar_key(season, sunday) == key


@pytest.mark.parametrize(("theirs", "ours"), [
    ("1g", "I.g"), ("8Gstar", "VIII.G*"), ("1D2", "I.D2"), ("6", "VI"), ("req-7c", None),
])
def test_tone_of_converts_to_noh_notation(theirs, ours):
    assert tone_of(theirs) == ours


def test_load_magnificat_hand_edit_fails_with_the_fix(tmp_path):
    path = write_vendored({"tempora:Pent14-0": {"antiphon": "a", "tone": "1g"}}, "abc1234", "s",
                          tmp_path / "v.json")
    assert load_magnificat(path) == {"tempora:Pent14-0": {"antiphon": "a", "tone": "1g"}}
    doc = json.loads(path.read_text())
    doc["magnificat"]["tempora:Pent14-0"]["tone"] = "8G"
    path.write_text(json.dumps(doc))
    with pytest.raises(VesperaleIntegrityError, match="re-run uv run noh vesperale-fetch"):
        load_magnificat(path)


def test_load_magnificat_missing_file_says_how_to_vendor_it(tmp_path):
    with pytest.raises(VesperaleIntegrityError, match="run uv run noh vesperale-fetch"):
        load_magnificat(tmp_path / "none.json")


def test_check_vesperale_doctor_fail_and_pass(tmp_path):
    bad = doctor.check_vesperale(tmp_path / "none.json")
    assert bad.status == FAIL and "Fix: uv run noh vesperale-fetch" in bad.detail
    assert doctor.check_vesperale().status == OK


def test_vendored_table_covers_the_green_sundays_it_lists():
    table = load_magnificat()
    assert table["tempora:Pent14-0"]["tone"] == "1g"
    assert "tempora:Epi3-0" not in table          # left empty in the source


class _Response:
    def __init__(self, body: bytes):
        self.body = body

    def read(self) -> bytes:
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


def test_fetch_vendors_the_table_at_a_commit(tmp_path, monkeypatch):
    import urllib.request

    from pipeline.vesperale import fetch
    monkeypatch.setattr(urllib.request, "urlopen", lambda *_a, **_k: _Response(STY.encode()))
    path, commit, count = fetch("abc1234", tmp_path / "v.json")
    assert (commit, count) == ("abc1234", 3)
    assert load_magnificat(path)["tempora:Pent15-0"]["tone"] == "4A"


def test_fetch_bad_commit_or_empty_table_leaves_the_file_untouched(tmp_path, monkeypatch):
    import urllib.request

    from pipeline.vesperale import fetch
    path = tmp_path / "v.json"
    with pytest.raises(VesperaleIntegrityError, match="not a commit sha"):
        fetch("main; rm -rf", path)
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *_a, **_k: _Response(rb"\newcommand{\canticum}{} \newcommand\x{}"))
    with pytest.raises(VesperaleIntegrityError, match="yielded no Sundays"):
        fetch("abc1234", path)
    assert not path.exists()


def test_cli_vesperale_fetch_reports_and_fails_cleanly(capsys, monkeypatch):
    from pipeline import cli, vesperale

    monkeypatch.setattr(vesperale, "fetch", lambda _c: ("data/vesperale-lineup.json", "abc1234def", 36))
    assert cli.main(["vesperale-fetch"]) == 0
    assert "36 Sundays" in capsys.readouterr().out

    def broken(_c):
        raise VesperaleIntegrityError("not a commit sha: 'x'")
    monkeypatch.setattr(vesperale, "fetch", broken)
    assert cli.main(["vesperale-fetch", "--commit", "x"]) == 1
    assert "left untouched" in capsys.readouterr().err
