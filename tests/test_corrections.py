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
    (tmp_path / "vespers-noh8.yml").write_text("magnificat_antiphons:\n  tempora:Pent04-0: {tone: I.g, chant: null}\n")
    (tmp_path / "vespers-offices.yml").write_text("offices:\n  adv1:\n    antiphons:\n    - {n: 1, tone: VIII.G, chant: 2835}\n")
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
    first = min(json.loads(corrections.DATA.joinpath("vespers-lineup.json").read_text())["days"])
    assert anchor is not None and anchor.year == int(first[:4]) + YEARS_BEHIND


def test_vendored_outputs_are_current_with_their_corrections():
    assert corrections.stale_outputs() == []


def test_every_lineup_target_names_a_correctable_vespers_item():
    """The targets the site offers ("Report an error" on a Vespers page) all
    resolve, for both fields."""
    lineup = json.loads(corrections.DATA.joinpath("vespers-lineup.json").read_text())
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
