"""Hand corrections over the generated catalogue (pipeline.corrections).

Everything here runs on small synthetic catalogues, with no PDFs: applying a
correction must work for an editor, and for CI, without pdf-source/."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from pipeline import cli, corrections, doctor
from pipeline.corrections import (
    CorrectionError,
    Entry,
    apply,
    coerce,
    correct,
    drop,
    load,
    no_ops,
    problems,
    where,
)
from pipeline.doctor import FAIL, OK


def base() -> dict:
    return {"schema_version": 2, "volumes": {}, "pieces": [
        {"id": "noh1-dominica-i-adventus", "volume": "noh1", "slug": "dominica-i-adventus",
         "title": "Dominica I Adventus", "incipit": None, "mode": None, "genre": "proper",
         "printed_pages": [3, 7]},
        {"id": "noh5-kyrie-i", "volume": "noh5", "slug": "kyrie-i", "title": "Lux et origo",
         "incipit": "Kyrie", "mode": "VIII", "genre": "kyrie", "printed_pages": [1, 2]},
    ]}


def entry(**kw) -> Entry:
    fields = {"id": "c-0001", "target": "piece:dominica-i-adventus", "field": "title",
              "was": "Dominica I Adventus", "value": "Dominica prima Adventus"}
    return Entry(**{**fields, **kw})


def test_apply_changes_only_the_named_field_and_leaves_the_base_alone():
    b = base()
    out = apply(b, [entry()])
    assert out["pieces"][0]["title"] == "Dominica prima Adventus"
    assert b["pieces"][0]["title"] == "Dominica I Adventus"
    assert out["pieces"][1] == b["pieces"][1]


def test_apply_printed_pages_become_a_pair_of_integers():
    out = apply(base(), [entry(field="printed_pages", was=[3, 7], value="3-8")])
    assert out["pieces"][0]["printed_pages"] == [3, 8]


def test_problems_missing_target_names_the_line_and_the_next_step():
    found = problems(base(), [entry(target="piece:gone", line=14)])
    assert found == [("corrections.yml:14 (c-0001): piece:gone no longer exists; run `uv run noh where \"gone\"` "
                      "to see current slugs, then update or delete this entry")]


def test_problems_stale_was_stops_the_build_and_says_how_to_fix():
    found = problems(base(), [entry(was="Dominica Adventus")])
    assert len(found) == 1 and "stale correction" in found[0] and "noh corrections --drop c-0001" in found[0]


def test_problems_same_field_twice_and_same_id_twice_fail():
    found = problems(base(), [entry(), entry(id="c-0002"), entry(target="piece:kyrie-i", was="Lux et origo")])
    assert any("already corrected by c-0001" in f for f in found)
    assert any("the id c-0001 is used twice" in f for f in found)


@pytest.mark.parametrize(("name", "value", "message"), [
    ("mode", "IX", "I to VIII"), ("printed_pages", "9-3", "runs backwards"),
    ("title", "<b>x</b>", "no < or >"), ("chant", "x", "unknown field"),
])
def test_coerce_bad_values_name_the_rule(name, value, message):
    with pytest.raises(CorrectionError, match=message):
        coerce(name, value)


@pytest.mark.parametrize(("name", "value", "expected"), [("mode", "1", "I"), ("mode", " 8 ", "VIII"), ("mode", "vii", None),
                                                        ("title", "1", None), ("title", "A1", None), ("title", "Ad te", "Ad te")])
def test_coerce_reads_arabic_modes_and_wants_two_letters_in_a_title(name, value, expected):
    if expected is None:
        with pytest.raises(CorrectionError, match="expected"):
            coerce(name, value)
    else:
        assert coerce(name, value) == expected


def test_coerce_refuses_a_mode_for_a_proper_with_the_reason():
    with pytest.raises(CorrectionError, match="A Proper has no single mode"):
        coerce("mode", "I", "proper")
    assert coerce("mode", "I", "kyrie") == "I"
    found = problems(base(), [entry(field="mode", was=None, value="I")])     # dominica-i-adventus is a Proper
    assert "A Proper has no single mode" in found[0]


def test_problems_genre_must_be_one_the_catalogue_uses_and_targets_must_be_pieces():
    found = problems(base(), [entry(field="genre", was="proper", value="sermon"),
                              entry(id="c-0002", target="vespers:2026-09-27/II", field="tone")])
    assert "not one the catalogue uses" in found[0]
    assert "not a target this file can correct yet" in found[1]


def test_apply_raises_with_every_problem():
    with pytest.raises(CorrectionError) as err:
        apply(base(), [entry(target="piece:gone"), entry(id="c-0002", was="old")])
    assert str(err.value).count("\n") == 1


def test_no_ops_lists_entries_the_source_now_agrees_with():
    fixed = base()
    fixed["pieces"][0]["title"] = "Dominica prima Adventus"
    assert [e.id for e in no_ops(fixed, [entry()])] == ["c-0001"]
    assert no_ops(base(), [entry()]) == []


def test_correct_records_fills_was_and_id_then_replaces_and_drops(tmp_path):
    b, c = tmp_path / "catalog.base.json", tmp_path / "corrections.yml"
    b.write_text(json.dumps(base()))
    first, replaced = correct("piece:dominica-i-adventus", "title", "Dominica prima Adventus",
                              note="as printed", today=date(2026, 9, 27), base_path=b, path=c)
    assert (first.id, first.was, replaced) == ("c-0001", "Dominica I Adventus", False)
    second, _ = correct("piece:kyrie-i", "mode", "VII", today=date(2026, 9, 27), base_path=b, path=c)
    assert second.id == "c-0002"
    again, replaced = correct("piece:dominica-i-adventus", "title", "Dominica 1 Adventus", base_path=b, path=c)
    assert replaced and again.id == "c-0001" and again.was == "Dominica I Adventus"
    loaded = load(c)
    assert [(e.id, e.value, e.line) for e in loaded] == [("c-0001", "Dominica 1 Adventus", loaded[0].line),
                                                         ("c-0002", "VII", loaded[1].line)]
    assert loaded[0].line > 1 and c.read_text().startswith("# Hand corrections")
    assert drop("c-0002", c).target == "piece:kyrie-i"
    assert [e.id for e in load(c)] == ["c-0001"]
    with pytest.raises(CorrectionError, match="no correction c-0009"):
        drop("c-0009", c)


def test_correct_refuses_an_unknown_piece_and_an_unchanged_value(tmp_path):
    b, c = tmp_path / "catalog.base.json", tmp_path / "corrections.yml"
    b.write_text(json.dumps(base()))
    with pytest.raises(CorrectionError, match="noh where"):
        correct("piece:gone", "title", "x", base_path=b, path=c)
    with pytest.raises(CorrectionError, match="already 'VIII'"):
        correct("piece:kyrie-i", "mode", "VIII", base_path=b, path=c)
    assert not c.exists()


def test_write_applies_the_overlay_and_reports_unchanged(tmp_path):
    b, c, out = tmp_path / "catalog.base.json", tmp_path / "corrections.yml", tmp_path / "catalog.json"
    b.write_text(json.dumps(base()))
    correct("piece:kyrie-i", "mode", "VII", base_path=b, path=c)
    _path, count, changed = corrections.write(b, c, out)
    assert (count, changed) == (1, True)
    assert json.loads(out.read_text())["pieces"][1]["mode"] == "VII"
    assert corrections.write(b, c, out)[2] is False


def test_load_base_missing_and_load_malformed_name_the_fix(tmp_path):
    with pytest.raises(CorrectionError, match="git checkout data/catalog.base.json"):
        corrections.load_base(tmp_path / "none.json")
    bad = tmp_path / "c.yml"
    bad.write_text("- id: c-1\n  target: piece:x\n")
    with pytest.raises(CorrectionError, match="corrections.yml:1: an entry needs"):
        load(bad)
    bad.write_text("id: c-1\n")
    with pytest.raises(CorrectionError, match="expected a list"):
        load(bad)


def test_where_reads_piece_vespers_and_day_urls_and_title_words(tmp_path):
    (tmp_path / "index-noh1.yml").write_text("sections:\n- entries:\n  - slug: dominica-i-adventus\n")
    cat = base()
    piece = where("https://cantusorgani.org/piece/dominica-i-adventus/", cat, tmp_path)[0]
    assert piece.target == "piece:dominica-i-adventus"
    assert piece.source.endswith("index-noh1.yml:3")
    assert where("/vespers/2027-08-15/i/", cat, tmp_path)[0].target == "vespers:2027-08-15/I"
    assert where("/day/tempora/Adv1-0/", cat, tmp_path)[0].target == "day:tempora:Adv1-0"
    assert [x.target for x in where("lux origo", cat, tmp_path)] == ["piece:kyrie-i"]
    assert where("nothing like it", cat, tmp_path) == []


def point_at(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the CLI's default paths at a temporary data dir."""
    b, c, out = tmp_path / "catalog.base.json", tmp_path / "corrections.yml", tmp_path / "catalog.json"
    b.write_text(json.dumps(base(), indent=2) + "\n")
    monkeypatch.setattr(corrections, "CATALOG", out)
    real = {"load_base": corrections.load_base, "load": corrections.load, "write": corrections.write,
            "correct": corrections.correct, "drop": corrections.drop}
    monkeypatch.setattr(corrections, "load_base", lambda path=b: real["load_base"](path))
    monkeypatch.setattr(corrections, "load", lambda path=c: real["load"](path))
    monkeypatch.setattr(corrections, "write", lambda: real["write"](b, c, out))
    monkeypatch.setattr(corrections, "correct",
                        lambda *a, **k: real["correct"](*a, **{"base_path": b, "path": c, **k}))
    monkeypatch.setattr(corrections, "drop", lambda i: real["drop"](i, c))


def test_cli_correct_apply_check_list_drop_and_where(tmp_path, monkeypatch, capsys):
    point_at(tmp_path, monkeypatch)
    assert cli.main(["apply-corrections", "--check"]) == 1
    assert "Fix: uv run noh apply-corrections" in capsys.readouterr().err
    assert cli.main(["apply-corrections"]) == 0
    assert cli.main(["apply-corrections", "--check"]) == 0
    assert cli.main(["correct", "piece:kyrie-i", "mode", "VII", "--note", "p. 1"]) == 0
    assert "recorded c-0001: piece:kyrie-i mode 'VIII' -> 'VII'" in capsys.readouterr().out
    assert cli.main(["corrections"]) == 0
    assert "c-0001  piece:kyrie-i  mode" in capsys.readouterr().out
    assert cli.main(["correct", "piece:kyrie-i", "mode", "IX"]) == 1
    assert "Nothing was written" in capsys.readouterr().err
    assert cli.main(["where", "lux origo"]) == 0
    assert "piece:kyrie-i" in capsys.readouterr().out
    assert cli.main(["where", "zzz"]) == 1
    assert cli.main(["corrections", "--drop", "c-0001"]) == 0
    assert json.loads((tmp_path / "catalog.json").read_text())["pieces"][1]["mode"] == "VIII"


def test_check_corrections_doctor_fails_when_stale_or_not_applied(tmp_path, monkeypatch):
    point_at(tmp_path, monkeypatch)
    assert doctor.check_corrections().status == FAIL           # catalog.json not written yet
    corrections.write()
    assert doctor.check_corrections().status == OK
    (tmp_path / "corrections.yml").write_text(
        "- id: c-0001\n  target: piece:kyrie-i\n  field: mode\n  was: VII\n  value: VI\n")
    bad = doctor.check_corrections()
    assert bad.status == FAIL and "stale correction" in bad.detail


def test_vendored_catalogue_is_current_with_its_corrections():
    """The committed catalog.json is the base plus corrections.yml, byte for byte."""
    text = corrections.dump(apply(corrections.load_base(), load()))
    assert corrections.CATALOG.read_text(encoding="utf-8") == text


def test_where_vespers_names_the_office_and_its_line(tmp_path):
    (tmp_path / "vespers-lineup.json").write_text(json.dumps({
        "days": {"2026-11-29": {"office": "tempora:Adv1-0", "vespers": "II"},
                 "2026-09-27": {"office": "tempora:Pent18-0", "vespers": "II"}},
        "first_vespers": {}}))
    (tmp_path / "vespers-offices.yml").write_text(
        "offices:\n  adv1:\n    vespers: II\n    keys:\n    - tempora:Adv1-0\n")
    (tmp_path / "vespers-noh8.yml").write_text("magnificat_antiphons:\n  tempora:Pent18-0: {tone: I.g}\n")
    adv = where("/vespers/2026-11-29/", base(), tmp_path)[0]
    assert (adv.label, adv.source) == ("II Vespers of tempora:Adv1-0 (office adv1)", "data/vespers-offices.yml:2")
    assert where("/vespers/2026-09-27/", base(), tmp_path)[0].source.startswith("data/vespers-noh8.yml:2")
    assert where("/vespers/2026-09-27/i/", base(), tmp_path)[0].label == "no I Vespers page for 2026-09-27"


def batch(*entries: dict, batch_id: str = "b-20260927-abc123") -> dict:
    return {"batch": batch_id, "entries": list(entries)}


def test_correct_batch_records_every_entry_with_its_editor_and_source(tmp_path):
    b, c = tmp_path / "catalog.base.json", tmp_path / "corrections.yml"
    b.write_text(json.dumps(base()))
    done = corrections.correct_batch(batch(
        {"target": "piece:kyrie-i", "field": "mode", "value": "VII", "source": "reader#12", "note": "Liber"},
        {"target": "piece:dominica-i-adventus", "field": "title", "value": "Dominica prima Adventus",
         "editor_email": "ed@example.org"}), base_path=b, path=c)
    assert [(e.id, e.source, e.editor_email) for e in done] == [("c-0001", "reader#12", ""),
                                                                ("c-0002", "editor", "ed@example.org")]
    summary = corrections.batch_summary("b-20260927-abc123", done)
    assert "| c-0002 | piece:dominica-i-adventus | title | \"Dominica I Adventus\" | \"Dominica prima Adventus\" | ed@example.org |" in summary


@pytest.mark.parametrize(("payload", "message"), [
    (batch({"target": "piece:kyrie-i", "field": "mode", "value": "VII"}, batch_id="main; rm"), "batch id"),
    (batch(), "1 to 100 entries"),
    (batch({"target": "piece:kyrie-i", "field": "mode", "value": "VII", "source": "bot"}), "source 'bot'"),
    (batch({"target": "piece:kyrie-i", "field": "mode", "value": "VII", "editor_email": "x"}), "not an address"),
    (batch("nope"), "not an object"),
])
def test_correct_batch_bad_payload_names_the_problem(tmp_path, payload, message):
    b = tmp_path / "catalog.base.json"
    b.write_text(json.dumps(base()))
    with pytest.raises(CorrectionError, match=message):
        corrections.correct_batch(payload, base_path=b, path=tmp_path / "c.yml")


def test_correct_batch_is_all_or_nothing(tmp_path):
    b, c = tmp_path / "catalog.base.json", tmp_path / "corrections.yml"
    b.write_text(json.dumps(base()))
    correct("piece:kyrie-i", "title", "Lux", base_path=b, path=c)
    before = c.read_text()
    with pytest.raises(CorrectionError, match="nothing was recorded") as err:
        corrections.correct_batch(batch({"target": "piece:kyrie-i", "field": "mode", "value": "VII"},
                                        {"target": "piece:gone", "field": "title", "value": "x"}),
                                  base_path=b, path=c)
    assert "entry 2 (piece:gone title)" in str(err.value)
    assert c.read_text() == before
    fresh = tmp_path / "fresh.yml"
    with pytest.raises(CorrectionError):
        corrections.correct_batch(batch({"target": "piece:gone", "field": "title", "value": "x"}), base_path=b, path=fresh)
    assert not fresh.exists()


def test_cli_correct_batch_writes_the_summary(tmp_path, monkeypatch, capsys):
    point_at(tmp_path, monkeypatch)
    real = corrections.correct_batch
    monkeypatch.setattr(corrections, "correct_batch", lambda b_: real(b_, base_path=tmp_path / "catalog.base.json",
                                                                         path=tmp_path / "corrections.yml"))
    (tmp_path / "b.json").write_text(json.dumps(batch({"target": "piece:kyrie-i", "field": "mode", "value": "VII"})))
    assert cli.main(["correct-batch", str(tmp_path / "b.json"), "--summary", str(tmp_path / "pr.md")]) == 0
    assert "recorded 1 correction(s): c-0001" in capsys.readouterr().out
    assert "b-20260927-abc123" in (tmp_path / "pr.md").read_text()
