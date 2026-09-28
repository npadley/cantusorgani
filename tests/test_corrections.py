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
    VespersData,
    apply,
    coerce,
    correct,
    drop,
    load,
    no_ops,
    problems,
)
from pipeline.doctor import FAIL, OK
from pipeline.where import where


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
                      "to see current targets, then update or delete this entry")]


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


def test_problems_genre_must_be_one_the_catalogue_uses_and_targets_must_be_known_kinds():
    found = problems(base(), [entry(field="genre", was="proper", value="sermon"),
                              entry(id="c-0002", target="day:tempora:Adv1-0", field="tone")])
    assert "not one the catalogue uses" in found[0]
    assert "is not a target this file can correct" in found[1]


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


def point_at(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, vespers: VespersData | None = None) -> None:
    """Point the CLI's default paths at a temporary data dir. The Vespers lineup
    is left out: write_all and stale_outputs cover catalog.json only here."""
    b, c, out = tmp_path / "catalog.base.json", tmp_path / "corrections.yml", tmp_path / "catalog.json"
    b.write_text(json.dumps(base(), indent=2) + "\n")
    monkeypatch.setattr(corrections, "CATALOG", out)
    real = {"load_base": corrections.load_base, "load": corrections.load, "write": corrections.write,
            "correct": corrections.correct, "drop": corrections.drop}
    monkeypatch.setattr(corrections, "load_base", lambda path=b: real["load_base"](path))
    monkeypatch.setattr(corrections, "load", lambda path=c: real["load"](path))
    monkeypatch.setattr(corrections, "load_vespers", lambda data=None: vespers or VespersData({}, {}))
    monkeypatch.setattr(corrections, "write", lambda: real["write"](b, c, out))

    def write_all() -> tuple[int, list[str]]:
        _, count, changed = real["write"](b, c, out)
        return count, [out.name] if changed else []

    def stale_outputs() -> list[str]:
        text = corrections.dump(corrections.apply(real["load_base"](b), real["load"](c)))
        return [] if out.exists() and out.read_text() == text else [out.name]

    monkeypatch.setattr(corrections, "write_all", write_all)
    monkeypatch.setattr(corrections, "stale_outputs", stale_outputs)
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
    corrections.write_all()
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
    (tmp_path / "vespers").mkdir()
    (tmp_path / "vespers" / "vespers-lineup.json").write_text(json.dumps({
        "days": {"2026-11-29": {"office": "tempora:Adv1-0", "vespers": "II"},
                 "2026-09-27": {"office": "tempora:Pent18-0", "vespers": "II"}},
        "first_vespers": {}}))
    (tmp_path / "vespers" / "vespers-offices.yml").write_text(
        "offices:\n  adv1:\n    vespers: II\n    keys:\n    - tempora:Adv1-0\n")
    (tmp_path / "vespers" / "vespers-noh8.yml").write_text("magnificat_antiphons:\n  tempora:Pent18-0: {tone: I.g}\n")
    adv = where("/vespers/2026-11-29/", base(), tmp_path)[0]
    assert (adv.label, adv.source) == ("II Vespers of tempora:Adv1-0 (office adv1)", "data/vespers/vespers-offices.yml:2")
    assert where("/vespers/2026-09-27/", base(), tmp_path)[0].source.startswith("data/vespers/vespers-noh8.yml:2")
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


def proper() -> dict:
    """A catalogue with one Proper: five systems, three placed parts and one borrowed."""
    b = base()
    b["pieces"].append({
        "id": "noh1-dominica-ii", "volume": "noh1", "slug": "dominica-ii", "title": "Dominica II", "incipit": None,
        "mode": None, "genre": "proper", "printed_pages": [8, 9],
        "systems": [f"noh1/0034/00{n}" for n in range(5)],
        "parts": [{"part": "introit", "variant": "", "system": 0, "ref": "noh1/0034/000", "gregobase_id": 100},
                  {"part": "gradual", "variant": "", "system": 2, "ref": "noh1/0034/002", "gregobase_id": None},
                  {"part": "offertory", "variant": "", "borrowed_from": "Pars IV, p. 3", "gregobase_id": 7},
                  {"part": "communion", "variant": "2", "system": 4, "ref": "noh1/0034/004", "gregobase_id": 300}]})
    return b


def vespers_data() -> VespersData:
    return VespersData({"magnificat_antiphons": {"tempora:Pent04-0": {"tone": "I.g", "chant": None, "refs": ["x"]}}},
                       {"adv1": {"antiphons": [{"n": 1, "tone": "VIII.G", "chant": 2835}],
                                 "magnificat": {"tone": "I.g", "chant": 12}}})


def test_apply_part_start_system_moves_the_part_and_its_ref():
    out = apply(proper(), [entry(target="part:dominica-ii/gradual", field="start_system", was=3, value=2)])
    gradual = out["pieces"][2]["parts"][1]
    assert (gradual["system"], gradual["ref"], gradual["placed"]) == (1, "noh1/0034/001", "hand")


def test_apply_part_chant_sets_or_clears_the_gregobase_id_and_reads_a_variant():
    out = apply(proper(), [entry(target="part:dominica-ii/gradual", field="chant", was=None, value=1169),
                           entry(id="c-0002", target="part:dominica-ii/communion:2", field="chant", was=300, value="none")])
    parts = out["pieces"][2]["parts"]
    assert (parts[1]["gregobase_id"], parts[3]["gregobase_id"]) == (1169, None)


@pytest.mark.parametrize(("target", "value", "message"), [
    ("part:dominica-ii/gradual", 1, "out of order: it must come after system 1 and before system 5"),
    ("part:dominica-ii/gradual", 9, "outside the piece, which has 5 systems"),
    ("part:dominica-ii/offertory", 2, "printed in another volume (Pars IV, p. 3)"),
    ("part:dominica-ii/tract", 2, "no longer exists"),
    ("part:Dominica/II", 2, "is not of the form part:"),
])
def test_problems_part_start_system_must_exist_stay_in_order_and_be_printed_here(target, value, message):
    found = problems(proper(), [entry(target=target, field="start_system", was=3, value=value)])
    assert message in found[0]


def test_apply_vespers_sets_tone_and_chant_on_offices_and_green_sundays():
    entries = [entry(target="vespers:adv1/antiphon-1", field="tone", was="VIII.G", value="VIII.G*"),
               entry(id="c-0002", target="vespers:adv1/magnificat", field="chant", was=12, value="none"),
               entry(id="c-0003", target="vespers:sunday:tempora:Pent04-0/magnificat", field="chant", was=None, value=4242)]
    data = vespers_data()
    out = corrections.apply_vespers(data, entries)
    assert out.offices["adv1"]["antiphons"][0]["tone"] == "VIII.G*"
    assert out.offices["adv1"]["magnificat"]["chant"] is None
    assert out.doc["magnificat_antiphons"]["tempora:Pent04-0"]["chant"] == 4242
    assert data.offices["adv1"]["antiphons"][0]["tone"] == "VIII.G"          # the input is untouched
    assert apply(base(), entries) == base()                                   # the catalogue ignores them


def test_problems_vespers_tone_must_be_printed_and_item_must_exist():
    found = problems(None, [entry(target="vespers:adv1/antiphon-1", field="tone", was="VIII.G", value="IX.z"),
                            entry(id="c-0002", target="vespers:adv1/antiphon-7", field="tone", was="I.g", value="I.g2"),
                            entry(id="c-0003", target="vespers:nowhere/magnificat", field="chant", was=1, value=2)],
                     vespers_data())
    assert "not a valid tone" in found[0]
    assert "no longer exists" in found[1] and "no longer exists" in found[2]


def test_correct_records_a_vespers_correction_with_was_from_the_files(tmp_path):
    (tmp_path / "vespers").mkdir()
    (tmp_path / "vespers" / "vespers-noh8.yml").write_text("magnificat_antiphons:\n  tempora:Pent04-0: {tone: I.g, chant: null}\n")
    (tmp_path / "vespers" / "vespers-offices.yml").write_text("offices:\n  adv1:\n    antiphons:\n    - {n: 1, tone: VIII.G, chant: 2835}\n")
    c = tmp_path / "corrections.yml"
    made, _ = correct("vespers:adv1/antiphon-1", "chant", "2836", path=c, vespers_dir=tmp_path)
    assert (made.was, made.value) == (2835, 2836)
    with pytest.raises(CorrectionError, match="already 'I.g'"):
        correct("vespers:sunday:tempora:Pent04-0/magnificat", "tone", "I.g", path=c, vespers_dir=tmp_path)


def test_load_reviewed_applies_vespers_corrections(tmp_path):
    from pipeline.vespers import REVIEWED, load_reviewed
    c = tmp_path / "corrections.yml"
    offices = corrections.load_vespers().offices
    oid, office = next((k, o) for k, o in offices.items() if o.get("antiphons"))
    first = office["antiphons"][0]
    new = "VIII.G*" if first["tone"] != "VIII.G*" else "VIII.G"
    corrections.save([entry(target=f"vespers:{oid}/antiphon-{first['n']}", field="tone", was=first["tone"], value=new)], c)
    reviewed = load_reviewed(REVIEWED, corrections_path=c)
    assert reviewed.offices[oid]["antiphons"][0]["tone"] == new


def test_lineup_anchor_keeps_the_window_a_lineup_already_covers():
    from pipeline.vespers import YEARS_BEHIND, lineup_anchor
    anchor = lineup_anchor()
    first = min(json.loads(corrections.DATA.joinpath("vespers", "vespers-lineup.json").read_text())["days"])
    assert anchor is not None and anchor.year == int(first[:4]) + YEARS_BEHIND


def test_vendored_outputs_are_current_with_their_corrections():
    assert corrections.stale_outputs() == []


def test_every_lineup_target_names_a_correctable_vespers_item():
    """The targets the site offers ("Report an error" on a Vespers page) all
    resolve, for both fields."""
    lineup = json.loads(corrections.DATA.joinpath("vespers", "vespers-lineup.json").read_text())
    targets = {i["target"] for d in [*lineup["days"].values(), *lineup.get("first_vespers", {}).values()]
               for i in d["items"] if "target" in i}
    data = corrections.load_vespers()
    assert len(targets) > 100
    for target in targets:
        for name in ("tone", "chant"):
            corrections.slot(target, name, None, data)


def test_log_text_is_newest_first_and_never_carries_an_address_or_note():
    entries = [entry(editor_email="ed@example.org", note="private", source="reader#4"),
               entry(id="c-0002", field="mode", was=None, value="I", source="editor")]
    doc = json.loads(corrections.log_text(entries))
    assert [r["id"] for r in doc["corrections"]] == ["c-0002", "c-0001"]
    assert [r["by"] for r in doc["corrections"]] == ["editor", "reader"]
    assert "ed@example.org" not in corrections.log_text(entries) and "private" not in corrections.log_text(entries)


def test_the_workers_tone_list_is_the_shared_schemas():
    """workers/corrections cannot read data/ at run time; its copy must match."""
    import re as _re
    source = (corrections.DATA.parent / "workers" / "corrections" / "src" / "schema.ts").read_text()
    block = source[source.index("export const TONES = ["):source.index("] as const;")]
    assert _re.findall(r'"([^"]+)"', block) == json.loads(corrections.SCHEMA.read_text())["tones"]


def test_apply_vespers_refs_replaces_the_systems_and_checks_they_exist():
    data = vespers_data()
    data.offices["adv1"]["antiphons"][0]["refs"] = ["noh8/0077/000"]
    data = VespersData(data.doc, data.offices, frozenset({"noh8/0077/000", "noh8/0077/001", "noh8/0077/002"}))
    moved = entry(target="vespers:adv1/antiphon-1", field="refs", was=["noh8/0077/000"],
                  value="noh8/0077/001  noh8/0077/002")
    out = corrections.apply_vespers(data, [moved])
    assert out.offices["adv1"]["antiphons"][0]["refs"] == ["noh8/0077/001", "noh8/0077/002"]
    bad = entry(target="vespers:adv1/antiphon-1", field="refs", was=["noh8/0077/000"], value="noh8/9999/000")
    assert "not systems in the catalogue" in problems(None, [bad], data)[0]
    with pytest.raises(CorrectionError, match="not a valid refs"):
        coerce("refs", "noh5/0001/000", kind="vespers")


def test_fetch_dump_refuses_a_file_that_is_not_the_pinned_one(tmp_path, monkeypatch):
    import io
    import urllib.request

    from pipeline import gregobase
    monkeypatch.setattr(urllib.request, "urlopen", lambda url, timeout=0: io.BytesIO(b"not the dump"))
    with pytest.raises(gregobase.DumpError, match="nothing was written"):
        gregobase.fetch_dump(tmp_path / "dump.sql")
    assert not (tmp_path / "dump.sql").exists()
    import hashlib
    body = b"-- a dump"
    monkeypatch.setattr(urllib.request, "urlopen", lambda url, timeout=0: io.BytesIO(body))
    path = gregobase.fetch_dump(tmp_path / "dump.sql", pinned=hashlib.sha256(body).hexdigest())
    assert path.read_bytes() == body


def ordinary() -> dict:
    """A catalogue with an Ordinary whose Kyrie is paired and Gloria is not."""
    b = base()
    b["pieces"].append({"id": "noh5-missa-ix", "volume": "noh5", "slug": "missa-ix", "title": "Cum jubilo",
                        "incipit": None, "mode": None, "genre": "mass_ordinary", "printed_pages": [40, 45],
                        "movements": [{"movement": "kyrie"}, {"movement": "gloria"}, {"movement": "sanctus"}],
                        "chant": [{"source": "gregobase", "id": 1143, "movement": "kyrie", "incipit": "Kyrie IX",
                                   "mode": "1", "score": 0.8, "status": "unverified"}]})
    return b


def test_apply_pairing_replaces_adds_and_removes_a_movements_chant(monkeypatch):
    monkeypatch.setattr(corrections, "_CHANTS", {"2980": {"incipit": "Gloria IX", "mode": "7"}})
    out = apply(ordinary(), [entry(target="pairing:missa-ix/kyrie", field="chant", was=1143, value=1148),
                             entry(id="c-0002", target="pairing:missa-ix/gloria", field="chant", was=None, value=2980)])
    chant = {c["movement"]: c for c in out["pieces"][2]["chant"]}
    assert (chant["kyrie"]["id"], chant["kyrie"]["status"], chant["kyrie"]["incipit"]) == (1148, "verified", "GregoBase 1148")
    assert (chant["gloria"]["incipit"], chant["gloria"]["mode"]) == ("Gloria IX", "7")
    gone = apply(ordinary(), [entry(target="pairing:missa-ix/kyrie", field="chant", was=1143, value="none")])
    assert gone["pieces"][2]["chant"] == []


def test_piece_movements_an_ordinary_has_only_what_is_printed_or_paired():
    missa = ordinary()["pieces"][2]
    assert corrections.piece_movements(missa) == ["kyrie", "gloria", "sanctus"]
    missa["movements"] = [{"movement": "kyrie"}]                # the pairing keeps kyrie
    assert corrections.piece_movements({**missa, "chant": []}) == ["kyrie"]
    assert corrections.piece_movements({"genre": "asperges"}) == ["chant"]


def test_problems_pairing_movement_must_suit_the_genre():
    found = problems(ordinary(), [entry(target="pairing:missa-ix/credo", field="chant", was=None, value=1),
                                  entry(id="c-0002", target="pairing:dominica-i-adventus/chant", field="chant", was=None, value=1),
                                  entry(id="c-0003", target="pairing:kyrie-i/kyrie", field="chant", was=None, value=5)])
    assert "has no credo chant to pair (its movements: kyrie, gloria, sanctus)" in found[0]
    assert "a Proper's chants are on its parts" in found[1]
    assert len(found) == 2                     # a Kyrie piece's kyrie is fine


# ------------------------------------------------------ system ranges and notes ---

def two_propers(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Two neighbouring Propers of noh1 over ten published systems of page 34:
    dominica-ii owns 0-4 (introit on 0, gradual on 2), dominica-iii owns 5-8
    (introit on 6), and system 9 belongs to nobody."""
    order = [(f"noh1/0034/{n:03d}", f"systems/noh1/0034/{n:03d}-hash{n}", [1800, 400 + n]) for n in range(10)]
    monkeypatch.setitem(corrections._VOLUME_SYSTEMS, "noh1", order)
    b = base()

    def proper_of(slug: str, span: range, parts: list[tuple[str, int]]) -> dict:
        refs = [order[n] for n in span]
        return {"id": f"noh1-{slug}", "volume": "noh1", "slug": slug, "title": slug, "incipit": None, "mode": None,
                "genre": "proper", "printed_pages": [8, 8], "pdf_pages": [34, 34],
                "systems": [r for r, _, _ in refs], "system_assets": [a for _, a, _ in refs],
                "system_aspect": [x for _, _, x in refs], "movements": [],
                "hymns": [{"title": "Hymnus", "ref": order[span[-1]][0], "printed_page": 8}],
                "parts": [{"part": p, "variant": "", "system": n - span[0], "ref": order[n][0], "gregobase_id": None}
                          for p, n in parts]}

    b["pieces"] += [proper_of("dominica-ii", range(5), [("introit", 0), ("gradual", 2)]),
                    proper_of("dominica-iii", range(5, 9), [("introit", 6)])]
    return b


def range_entry(value: str, was: list[str] | None = None, target: str = "piece:dominica-ii", **kw) -> Entry:
    return entry(target=target, field="system_range", was=was or ["noh1/0034/000", "noh1/0034/004"], value=value, **kw)


def test_coerce_system_range_reads_to_spaces_and_hyphens_and_refuses_backwards_or_two_volumes():
    assert coerce("system_range", "noh1/0034/000 to noh1/0034/004") == ["noh1/0034/000", "noh1/0034/004"]
    assert coerce("system_range", ["noh1/0034/000", "noh1/0034/004"]) == ["noh1/0034/000", "noh1/0034/004"]
    with pytest.raises(CorrectionError, match="runs backwards"):
        coerce("system_range", "noh1/0034/004-noh1/0034/000")
    with pytest.raises(CorrectionError, match="across two volumes"):
        coerce("system_range", "noh1/0034/004-noh2/0034/005")
    with pytest.raises(CorrectionError, match="not a valid system_range"):
        coerce("system_range", "34/0-34/4")


def test_apply_system_range_moves_the_boundary_for_both_neighbours(monkeypatch):
    out = apply(two_propers(monkeypatch), [range_entry("noh1/0034/000-noh1/0034/005",
                                                       was=["noh1/0034/000", "noh1/0034/004"])])
    ii, iii = out["pieces"][2], out["pieces"][3]
    assert ii["systems"][-1] == "noh1/0034/005" and len(ii["systems"]) == 6
    assert ii["system_assets"][-1] == "systems/noh1/0034/005-hash5" and ii["system_aspect"][-1] == [1800, 405]
    assert iii["systems"] == ["noh1/0034/006", "noh1/0034/007", "noh1/0034/008"]
    assert iii["pdf_pages"] == [34, 34]


def test_apply_system_range_recounts_parts_and_moves_hymns_with_their_system(monkeypatch):
    b = two_propers(monkeypatch)
    b["pieces"][3]["hymns"][0]["ref"] = "noh1/0034/005"
    out = apply(b, [range_entry("noh1/0034/000-noh1/0034/005")])
    ii, iii = out["pieces"][2], out["pieces"][3]
    assert [p["system"] for p in ii["parts"]] == [0, 2]
    assert iii["parts"][0]["system"] == 0                                # its introit on 006 is now its 1st system
    assert [h["ref"] for h in ii["hymns"]] == ["noh1/0034/004", "noh1/0034/005"]
    assert iii["hymns"] == []


def test_problems_system_range_refuses_what_would_break_a_piece(monkeypatch):
    b = two_propers(monkeypatch)
    cases = {
        "noh1/0034/001-noh1/0034/004": "leave its introit (which starts on noh1/0034/000) outside the piece",
        "noh1/0034/000-noh1/0034/008": "take every system of piece:dominica-iii",
        "noh1/0034/000-noh1/0034/099": "noh1/0034/099 is not a system of noh1's pages",
    }
    for value, message in cases.items():
        found = problems(b, [range_entry(value)])
        assert found and message in found[0], (value, found)
    found = problems(b, [range_entry("noh1/0034/006-noh1/0034/007", target="piece:kyrie-i", was=None)])
    assert "stale correction" in found[0]


def test_problems_system_range_refuses_to_split_a_neighbour_or_take_its_part(monkeypatch):
    b = two_propers(monkeypatch)
    b["pieces"][3]["systems"].append("noh1/0034/009")
    moved = range_entry("noh1/0034/006-noh1/0034/007", target="piece:kyrie-i", was=None)
    b["pieces"][1].update(volume="noh1", systems=["noh1/0034/007"])
    moved.was = ["noh1/0034/007", "noh1/0034/007"]
    assert "split piece:dominica-iii in two" in problems(b, [moved])[0]
    taking = range_entry("noh1/0034/000-noh1/0034/006")
    assert "dominica-iii's introit starts on (noh1/0034/006)" in problems(b, [taking])[0]


def test_parts_count_from_the_corrected_range_and_correct_records_was_from_it(monkeypatch, tmp_path):
    b = two_propers(monkeypatch)
    base_path, c = tmp_path / "base.json", tmp_path / "corrections.yml"
    base_path.write_text(json.dumps(b))
    correct("piece:dominica-ii", "system_range", "noh1/0034/000-noh1/0034/005", base_path=base_path, path=c)
    with pytest.raises(CorrectionError, match="system_range would take the system"):
        correct("piece:dominica-ii", "system_range", "noh1/0034/000-noh1/0034/006", base_path=base_path, path=c)
    # The gradual may now start on the 6th system, which the piece did not have before.
    made, _ = correct("part:dominica-ii/gradual", "start_system", "6", base_path=base_path, path=c)
    assert made.was == 3
    out = apply(b, load(c))
    assert out["pieces"][2]["parts"][1]["ref"] == "noh1/0034/005"


def test_apply_vespers_note_replaces_the_music_and_none_brings_it_back():
    data = vespers_data()
    data.offices["adv1"]["antiphons"][0]["note"] = "An old note."
    entries = [entry(target="vespers:adv1/magnificat", field="note", was=None,
                     value="  The book's version is for II Vespers;\n sing it from the Antiphonale. "),
               entry(id="c-0002", target="vespers:adv1/antiphon-1", field="note", was="An old note.", value="none")]
    out = corrections.apply_vespers(data, entries)
    assert out.offices["adv1"]["magnificat"]["note"] == "The book's version is for II Vespers; sing it from the Antiphonale."
    assert "note" not in out.offices["adv1"]["antiphons"][0]
    with pytest.raises(CorrectionError, match="not a valid note"):
        coerce("note", "<b>bold</b>", kind="vespers")


def test_build_office_shows_an_editors_note_in_place_of_the_music_and_keeps_the_target():
    from datetime import date as _date

    from pipeline.vespers import REVIEWED, build_office, load_reviewed
    reviewed = load_reviewed(REVIEWED)
    oid, office = next((k, o) for k, o in reviewed.offices.items()
                       if isinstance(o.get("magnificat"), dict) and o["magnificat"].get("refs") and o.get("keys"))
    plain, _ = build_office(_date(2026, 12, 8), office["keys"][0], office["vespers"], reviewed)
    office["magnificat"]["note"] = "Sung from the Antiphonale."
    noted, _ = build_office(_date(2026, 12, 8), office["keys"][0], office["vespers"], reviewed)
    assert plain is not None and noted is not None
    mag = next(i for i in noted if i.get("target") == f"vespers:{oid}/magnificat")
    assert mag["source"] == {"type": "note", "text": "Sung from the Antiphonale.", "refs": office["magnificat"]["refs"]}
    assert len(noted) == len(plain) - 1                                  # no repeat after the Magnificat


def test_volume_systems_gives_every_catalogued_system_its_published_key_and_size():
    """A corrected range takes its image keys from data/published/: they must be
    the keys `noh catalog` wrote, or every moved system would 404."""
    for piece in corrections.load_base()["pieces"]:
        found = {r: (a, x) for r, a, x in corrections.volume_systems(piece["volume"])}
        for ref, asset, aspect in zip(piece["systems"], piece["system_assets"], piece["system_aspect"], strict=True):
            assert found[ref] == (asset, aspect), (piece["slug"], ref)


def test_stranded_lists_vespers_systems_no_corrected_piece_has():
    catalog = {"pieces": [{"systems": ["noh8/0031/000"]}]}
    lineup = {"days": {"2026-11-29": {"items": [
        {"source": {"type": "printed", "refs": ["noh8/0031/000", "noh8/0031/001"]}},
        {"source": {"type": "note", "text": "x", "refs": ["noh8/0099/000"]}}]}},
        "first_vespers": {"2026-12-07": {"items": [{"source": {"type": "bank", "refs": ["noh8/0040/000"]}}]}}}
    assert corrections._stranded(catalog, lineup) == ["noh8/0031/001", "noh8/0040/000"]
