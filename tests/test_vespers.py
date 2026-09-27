"""Sunday Vespers in sung order (pipeline.vespers).

The rules run on the reviewed data and the real 1962 calendar: every golden day
names its civil date and calendar key."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
import yaml

from pipeline import cli, doctor
from pipeline.doctor import FAIL, OK
from pipeline.vespers import (
    GREEN,
    REVIEWED,
    VespersDataError,
    build_lineup,
    calendar_days,
    catalog_sha256,
    check_lineup,
    describe,
    dump_lineup,
    load_reviewed,
    marian_for,
    normalise_tone,
    resolve_day,
    sunday_lineup,
    tone_disagreements,
    tone_label,
)


@pytest.fixture(scope="module")
def reviewed():
    return load_reviewed()


@pytest.fixture(scope="module")
def days():
    return calendar_days()


@pytest.fixture(scope="module")
def lineup(reviewed, days):
    from pipeline.vespers import ranks
    doc, review = build_lineup(reviewed, days, "sha", ranks())
    return doc, review


# ----------------------------------------------------------------- tones ---

@pytest.mark.parametrize(("raw", "tone"), [
    ("VIII. G", "VIII.G"), ("VIILG", "VIII.G"), ("Ad Magnif. Ant. I. g 2", "I.g2"),
    ("5. Ant. IV. A*", "IV.A*"), ("5 Ant. T. perec", "peregrinus"), ("Ad Magnif. Ant. VI.C", "VI.C"),
    ("I. Ant. Vil.c 2", "VII.c2"), ("2. Ant. lil. b", "III.b"), ("3. Ant. IV. g", "IV.g"),
    ("Ad Magnif. Ant. III. a | |", "III.a"),
])
def test_normalise_tone_ocr_readings_give_the_printed_tone(raw, tone):
    assert normalise_tone(raw) == tone


@pytest.mark.parametrize("raw", ["", "Ad | Ant.", "Ad Magnif. Ant. Il. g -", "VII. l", "f"])
def test_normalise_tone_unreadable_or_unprinted_is_none(raw):
    """"II.g" is not an ending NOH8 prints: never a guess at a neighbour."""
    assert normalise_tone(raw) is None


def test_tone_label_spaces_and_peregrinus():
    assert tone_label("VII.c2") == "VII c2"
    assert tone_label("peregrinus") == "tonus peregrinus"


# ------------------------------------------------------------ Marian antiphon ---

@pytest.mark.parametrize(("day", "which"), [
    (date(2026, 1, 18), "alma"), (date(2027, 2, 2), "alma"), (date(2027, 2, 7), "ave"),
    (date(2026, 11, 8), "salve"), (date(2026, 7, 5), "salve"),
])
def test_marian_for_boundaries_follow_1962(day, which):
    assert marian_for(day) == which


# --------------------------------------------------------------- green keys ---

@pytest.mark.parametrize(("key", "green"), [
    ("tempora:Pent15-0", True), ("tempora:Pent02-0r", True), ("tempora:Epi5-0", True),
    ("tempora:Pent01-0r", False), ("tempora:Epi1-0", False), ("sancti:10-DU", False),
    ("tempora:Pent24-0", True), ("tempora:Pent25-0", False),
])
def test_green_trinity_holy_family_and_feasts_are_not_green_sundays(key, green):
    assert bool(GREEN.match(key)) is green


# ------------------------------------------------------------ calendar goldens ---

def test_build_lineup_resumed_epiphany_v_in_november_2026_11_08(lineup):
    """tempora:Epi5-0 resumed after Pent XXIII: its antiphon from pp. 105-106,
    the Salve Regina (not the Alma of January)."""
    day = lineup[0]["days"]["2026-11-08"]
    assert day["office"] == "tempora:Epi5-0"
    kinds = [i["kind"] for i in day["items"]]
    assert kinds[:4] == ["initium", "antiphon", "psalm", "antiphon"]
    mag = next(i for i in day["items"] if i["kind"] == "magnificat-antiphon")
    assert mag["label"] == "Colligite primum zizania" and mag["tone"] == "I.g"
    assert next(i for i in day["items"] if i["kind"] == "marian-antiphon")["label"] == "Salve Regina"


def test_build_lineup_christ_the_king_2026_10_25_takes_the_sunday(lineup):
    day = lineup[0]["days"]["2026-10-25"]
    assert day["office"] == "sancti:10-DU" and day["vespers"] == "II"
    assert next(i for i in day["items"] if i["kind"] == "hymn")["label"] == "Te saeculorum Principem"


def test_build_lineup_all_saints_on_sunday_2026_11_01_is_all_saints(lineup):
    assert lineup[0]["days"]["2026-11-01"]["office"] == "sancti:11-01"


def test_build_lineup_last_sunday_is_pent_xxiv_2026_11_22(lineup):
    day = lineup[0]["days"]["2026-11-22"]
    assert day["office"] == "tempora:Pent24-0"
    assert next(i for i in day["items"] if i["kind"] == "magnificat-antiphon")["label"] == "Amen dico vobis"


def test_build_lineup_magnificat_tone_unprinted_is_a_note_2026_09_06(lineup):
    """tempora:Pent15-0's Magnificat is in IV A; NOH8 prints IV A* only: the
    page says so rather than guessing a neighbouring ending."""
    doc, review = lineup
    mag = next(i for i in doc["days"]["2026-09-06"]["items"] if i["kind"] == "magnificat")
    assert mag["source"]["type"] == "note" and "IV A" in mag["source"]["text"]
    assert any(r["kind"] == "tone_unprinted" and "IV.A" in r["why"] for r in review)


def test_build_lineup_pent_ii_2026_06_07_uses_its_own_key_not_the_stack(lineup):
    """Pent II (Pent02-0r) is outside "Dominicae IV-XXIV": its antiphon, "Exi
    cito", is found by key on p. 152."""
    mag = next(i for i in lineup[0]["days"]["2026-06-07"]["items"] if i["kind"] == "magnificat-antiphon")
    assert mag["label"] == "Exi cito in plateas"


def test_build_lineup_feast_nohviii_does_not_print_is_held_back_2028_08_06(lineup):
    """The Transfiguration on a Sunday: NOH VIII has no section for it."""
    assert "sancti:08-06" in lineup[0]["held_back"]["2028-08-06"]


def test_build_lineup_vigil_of_christmas_is_first_vespers_of_christmas_2026_12_24(lineup):
    day = lineup[0]["days"]["2026-12-24"]
    assert (day["office"], day["vespers"]) == ("sancti:12-25", "I")
    assert next(i for i in day["items"] if i["kind"] == "magnificat-antiphon")["label"] == "Cum ortus fúerit"


def test_build_lineup_first_vespers_of_a_first_class_feast_the_evening_before_2027_08_14(lineup):
    first = lineup[0]["first_vespers"]["2027-08-15"]
    assert (first["office"], first["evening_of"]) == ("sancti:08-15", "2027-08-14")


def test_build_lineup_easter_octave_haec_dies_and_its_benedicamus_2027_03_28(lineup):
    items = lineup[0]["days"]["2027-03-28"]["items"]
    assert "hymn" not in [i["kind"] for i in items]
    assert next(i for i in items if i["kind"] == "chapter")["label"] == "Haec dies"
    assert next(i for i in items if i["kind"] == "benedicamus")["source"]["refs"][0] == "noh8/0149/000"
    assert next(i for i in items if i["kind"] == "marian-antiphon")["label"] == "Regina caeli"


def test_build_lineup_paschaltide_one_antiphon_all_psalms_in_the_seventh_tone_2027_04_04(lineup):
    items = lineup[0]["days"]["2027-04-04"]["items"]
    ants = [i for i in items if i["kind"] == "antiphon"]
    assert len(ants) == 2 and ants[1]["repeat"]
    assert {i["tone"] for i in items if i["kind"] == "psalm"} == {"VII.c2"}


def test_build_lineup_advent_sunday_from_17_december_takes_the_o_antiphon_2026_12_20(lineup):
    mag = next(i for i in lineup[0]["days"]["2026-12-20"]["items"] if i["kind"] == "magnificat-antiphon")
    assert mag["label"] == "O clavis David" and mag["tone"] == "II.D"


def test_build_lineup_lent_laus_tibi_and_the_lenten_hymn_2027_02_14(lineup):
    items = lineup[0]["days"]["2027-02-14"]["items"]
    assert [i["label"] for i in items if i["kind"] == "initium"] == ["Deus in adjutorium", "Laus tibi, Domine"]
    assert next(i for i in items if i["kind"] == "hymn")["label"] == "Audi benigne Conditor"


def test_build_lineup_epiphany_ii_before_candlemas_sings_the_alma_2026_01_18(lineup):
    day = lineup[0]["days"]["2026-01-18"]
    assert day["office"] == "tempora:Epi2-0"
    assert next(i for i in day["items"] if i["kind"] == "marian-antiphon")["label"] == "Alma Redemptoris Mater"


def test_build_lineup_every_day_has_unique_item_keys_and_real_systems(lineup, reviewed):
    for iso, day in {**lineup[0]["days"], **lineup[0]["first_vespers"]}.items():
        keys = [i["item_key"] for i in day["items"]]
        assert len(keys) == len(set(keys)), iso
        for i in day["items"]:
            assert all(r in reviewed.known for r in i["source"].get("refs") or []), (iso, i["item_key"])


# ------------------------------------------------------------ one Sunday ---

def test_sunday_lineup_order_repeats_each_antiphon_after_its_psalm(reviewed):
    items, why = sunday_lineup(date(2026, 9, 13), "tempora:Pent16-0", reviewed)
    assert why is None
    groups = [i["group"] for i in items]
    assert groups[0] == "initium" and groups[-1] == "marian"
    for n in range(1, 6):
        psalm = [i for i in items if i["group"] == f"psalm-{n}"]
        assert [i["kind"] for i in psalm] == ["antiphon", "psalm", "antiphon"]
        assert psalm[0]["source"]["refs"] == psalm[2]["source"]["refs"] and psalm[2]["repeat"]
    mag = [i for i in items if i["group"] == "magnificat"]
    assert [i["kind"] for i in mag] == ["magnificat-antiphon", "magnificat", "magnificat-antiphon"]
    assert mag[1]["source"]["type"] == "bank" and mag[1]["tone"] == "VII.a"


def test_sunday_lineup_commemoration_is_a_note(reviewed):
    items, _ = sunday_lineup(date(2026, 9, 13), "tempora:Pent16-0", reviewed, ["sancti:09-13"])
    note = next(i for i in items if i["kind"] == "commemoration")
    assert note["source"] == {"type": "note", "text": "sancti:09-13"}


def test_sunday_lineup_unknown_key_is_held_back(reviewed):
    items, why = sunday_lineup(date(2026, 9, 13), "tempora:Pent99-0", reviewed)
    assert items is None and "prints no II Vespers" in (why or "")


# ------------------------------------------------------------ reviewed data ---

def test_load_reviewed_bad_ref_or_tone_names_the_entry_and_the_fix(tmp_path):
    doc = yaml.safe_load(REVIEWED.read_text(encoding="utf-8"))
    doc["magnificat_antiphons"]["tempora:Pent16-0"]["refs"] = ["noh8/0999/000"]
    doc["magnificat_antiphons"]["tempora:Pent16-0"]["tone"] = "II.g"
    path = tmp_path / "vespers-noh8.yml"
    path.write_text(yaml.safe_dump(doc), encoding="utf-8")
    with pytest.raises(VespersDataError) as err:
        load_reviewed(path)
    text = str(err.value)
    assert "noh8/0999/000 is not in the catalogue" in text
    assert "tone 'II.g' is not one NOH8 prints" in text
    assert "Fix the entry against the scan" in text


def test_tone_disagreements_noh_label_used_and_difference_queued(reviewed):
    table = {"tempora:Pent16-0": {"antiphon": "an--cum_vocatus_fueris--solesmes", "tone": "7a"},
             "tempora:Pent21-0": {"antiphon": "an--serve_nequam--solesmes", "tone": "6"}}
    out = tone_disagreements(reviewed, table)
    assert [o["office"] for o in out] == ["tempora:Pent21-0"]
    assert "NOH8 margin reads VI.C" in out[0]["why"]


# ------------------------------------------------------------ one-day view ---

def test_resolve_day_date_key_and_errors(days):
    assert resolve_day("2026-09-13", days) == ["2026-09-13"]
    assert "2026-06-07" in resolve_day("tempora:Pent02-0", days)
    with pytest.raises(ValueError, match="no entry in data/calendar"):
        resolve_day("1999-01-03", days)
    with pytest.raises(ValueError, match="not a celebration"):
        resolve_day("tempora:Nonsense-0", days)


def test_describe_lists_items_with_sources_and_explains_held_and_absent_days(lineup):
    doc = lineup[0]
    text = describe("2026-11-08", doc)
    assert "tone bank: Psalm 109 in I g (Advent II, p. 54)" in text
    assert "Salve Regina" in text and "chant 2715" in text
    assert "held back" in describe("2028-08-06", doc)
    assert "no Vespers lineup" in describe("2026-10-26", doc)


# ------------------------------------------------------------ the file ---

def test_dump_lineup_one_day_per_line_round_trips(lineup):
    doc = lineup[0]
    text = dump_lineup({**doc, "review": []})
    assert json.loads(text)["days"] == doc["days"]
    assert text.count("\n") >= len(doc["days"])


def test_check_lineup_missing_ref_and_stale_catalogue(tmp_path, reviewed, days):
    doc, _ = build_lineup(reviewed, days, catalog_sha256())
    path = tmp_path / "l.json"
    path.write_text(dump_lineup(doc), encoding="utf-8")
    assert check_lineup(path) is None
    stale = {**doc, "catalog_sha256": "x"}
    path.write_text(dump_lineup(stale), encoding="utf-8")
    assert "has changed" in (check_lineup(path) or "")
    first = next(iter(doc["days"]))
    doc["days"][first]["items"][0]["source"]["refs"] = ["noh8/0999/000"]
    path.write_text(dump_lineup(doc), encoding="utf-8")
    assert "no longer has" in (check_lineup(path) or "")
    assert "missing" in (check_lineup(tmp_path / "none.json") or "")


def test_check_vespers_lineup_doctor_names_the_fix(tmp_path):
    check = doctor.check_vespers_lineup(tmp_path / "none.json")
    assert check.status == FAIL and "Fix: uv run noh vespers-lineup" in check.detail


def test_check_vespers_lineup_current_file_passes():
    assert doctor.check_vespers_lineup().status == OK


def test_cli_vespers_lineup_day_unknown_date_exits_1_with_the_fix(capsys):
    assert cli.main(["vespers-lineup", "--day", "1999-01-03"]) == 1
    assert "pass a date the calendar covers" in capsys.readouterr().err


def test_cli_vespers_lineup_day_prints_that_sunday(capsys):
    assert cli.main(["vespers-lineup", "--day", "2026-11-08"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("2026-11-08  tempora:Epi5-0  II Vespers")


def test_reviewed_file_is_where_the_module_says():
    assert Path(REVIEWED).name == "vespers-noh8.yml"


@pytest.mark.parametrize(("text", "key"), [
    ("DOMINICA XIV. POST PENTECOSTEN. Quaerite", "tempora:Pent14-0"),
    ("DOMINICA IV. POST PENTECOSTEN. Prce . ce _ ptor", "tempora:Pent04-0"),
    ("DOMINICA XXIV POST PENTECOSTEN", "tempora:Pent24-0"),
    ("DOMINICA III. POST EPIPHANIAM. D ' . *. 0_ ml _ ne", "tempora:Epi3-0"),
    ("DOMINICA IV. QUAE SUPERFUIT POST EPIPHANIAM.", "tempora:Epi4-0"),
    ("DOMINICA I. POST EPIPHANIAM.", None),          # the Holy Family, a feast
    ("De _ fi _ ci _ en _ te vi _ no", None),
])
def test_sunday_heading_reads_the_key_from_the_text_layer(text, key):
    from pipeline.vespers import sunday_heading
    assert sunday_heading(text) == key


# ------------------------------------------------------------ writing and proposing ---

def test_normalise_tone_ocr_roman_without_ending_and_nonsense():
    assert normalise_tone("Ad Magnif. Ant. VIIL") is None        # VIII alone is not a psalm ending
    assert normalise_tone("Ant. XX. a") is None


def test_write_lineup_writes_the_file_with_review_entries(tmp_path):
    from pipeline.vespers import write_lineup
    path, doc, review = write_lineup(tmp_path / "l.json")
    assert json.loads(path.read_text())["days"]["2026-11-08"]["office"] == "tempora:Epi5-0"
    kinds = {r["kind"] for r in review}
    assert {"tone_unprinted", "tone_disagreement"} <= kinds
    assert doc["review"] == review


def test_write_lineup_without_vesperale_still_writes_and_says_so(tmp_path, monkeypatch):
    from pipeline import vesperale
    from pipeline.vespers import write_lineup

    def missing(*_a, **_k):
        raise vesperale.VesperaleIntegrityError("data/vesperale-lineup.json is missing")
    monkeypatch.setattr(vesperale, "load_magnificat", missing)
    _, doc, review = write_lineup(tmp_path / "l.json")
    assert "2026-11-08" in doc["days"]
    assert any(r["kind"] == "vesperale_unavailable" for r in review)


def test_check_lineup_other_schema_version(tmp_path):
    path = tmp_path / "l.json"
    path.write_text(json.dumps({"schema_version": 9, "days": {}}))
    assert "expected 1" in (check_lineup(path) or "")


def test_referenced_chants_missing_file_is_empty(tmp_path):
    from pipeline.vespers import referenced_chants
    assert referenced_chants(tmp_path / "none.json") == set()
    assert 2715 in referenced_chants()


def test_propose_reads_headings_and_wide_margins_into_a_proposal(tmp_path, monkeypatch):
    """The PDF, its text layer and the OCR are faked: two Sundays, the second
    heading ending the first."""
    import contextlib
    from types import SimpleNamespace

    import pymupdf

    from pipeline import catalog as catalog_mod
    from pipeline import vespers as vespers_mod

    systems = ["noh8/0195/000", "noh8/0195/001", "noh8/0195/002", "noh8/0195/003"]
    cat = {"pieces": [{"slug": "vesperae-dominicae-iv-xxiv-post-pentecosten", "systems": systems}]}
    cat_path = tmp_path / "catalog.json"
    cat_path.write_text(json.dumps(cat))
    texts = {systems[0]: "DOMINICA XIII. POST PENTECOSTEN. Unus autem", systems[1]: "regressus est",
             systems[2]: "DOMINICA XIV. POST PENTECOSTEN.", systems[3]: "et haec omnia"}

    def fake_scan(_vol, _page, _doc_page):
        return [SimpleNamespace(ref=r, text=t) for r, t in texts.items()], [], []

    monkeypatch.setattr(catalog_mod, "scan_page", fake_scan)
    monkeypatch.setattr(pymupdf, "open", lambda _p: contextlib.nullcontext({195 - 1: None}))
    readings = iter(["Ad Magnif. Ant. 1. D 2", "Ad Magnif. Ant. I. g"])
    monkeypatch.setattr(vespers_mod, "read_tone_margin", lambda _png: next(readings))
    slices = tmp_path / "slices"
    for r in (systems[0], systems[2]):
        png = slices / "noh8" / f"{r.split('/', 1)[1]}@2x.png"
        png.parent.mkdir(parents=True, exist_ok=True)
        png.write_bytes(b"")
    path, count = vespers_mod.propose(cat_path, slices, tmp_path / "p.yml")
    doc = yaml.safe_load(path.read_text())["magnificat_antiphons"]
    assert count == 2
    assert doc["tempora:Pent13-0"]["refs"] == systems[:2] and doc["tempora:Pent13-0"]["tone"] == "I.D2"
    assert doc["tempora:Pent14-0"]["tone"] == "I.g"
    assert path.read_text().startswith("# PROPOSED")


def test_cli_vespers_lineup_writes_and_summarises(capsys, monkeypatch, tmp_path):
    from pipeline import vespers as vespers_mod
    real = vespers_mod.write_lineup
    monkeypatch.setattr(vespers_mod, "write_lineup", lambda: real(tmp_path / "l.json"))
    assert cli.main(["vespers-lineup"]) == 0
    out = capsys.readouterr().out
    assert "Vespers by date" in out and "tone_unprinted" in out


def test_cli_vespers_lineup_bad_reviewed_data_exits_1(capsys, monkeypatch):
    from pipeline import vespers as vespers_mod

    def bad():
        raise VespersDataError("vespers-noh8.yml:\n  psalm 110: noh8/0999/000 is not in the catalogue")
    monkeypatch.setattr(vespers_mod, "write_lineup", bad)
    assert cli.main(["vespers-lineup"]) == 1
    assert "noh8/0999/000" in capsys.readouterr().err


# ------------------------------------------------------------ accompaniment choices ---

def test_psalm_music_full_psalm_opening_formula_or_note(reviewed):
    from pipeline.vespers import psalm_music
    full, text = psalm_music(reviewed, 112, "VII.c", None)
    assert full["type"] == "printed" and len(full["refs"]) == 12 and text is False
    opening, text = psalm_music(reviewed, 110, "VII.d", ["noh8/0085/001"])
    assert opening == {"type": "printed", "refs": ["noh8/0085/001"], "opening_only": True} and text
    formula, text = psalm_music(reviewed, 129, "IV.A*", None)
    assert formula["type"] == "bank" and formula["bank_label"] == "Psalm 113 in IV A*" and text
    note, text = psalm_music(reviewed, 111, "VII.b", None)
    assert note["type"] == "note" and "VII b" in note["text"] and text


def test_psalm_music_prefers_the_same_psalm_in_the_tone(reviewed):
    from pipeline.vespers import psalm_music
    formula, _ = psalm_music(reviewed, 110, "VIII.G*", None)
    assert formula["bank_label"] == "Psalm 110 in VIII G*"


def test_magnificat_music_printed_magnificat_psalm_formula_or_note(reviewed):
    from pipeline.vespers import magnificat_music
    assert magnificat_music(reviewed, "VIII.G*")["bank_kind"] == "magnificat"
    assert magnificat_music(reviewed, "I.f")["bank_label"] == "Psalm 112 in I f"
    assert "sing it unaccompanied" in magnificat_music(reviewed, "IV.E")["text"]
    assert magnificat_music(reviewed, None)["type"] == "note"


# ------------------------------------------------------------ the calendar ---

@pytest.mark.parametrize(("year", "day"), [(2026, date(2026, 4, 5)), (2027, date(2027, 3, 28)),
                                           (2038, date(2038, 4, 25)), (2024, date(2024, 3, 31))])
def test_easter_known_dates(year, day):
    from pipeline.vespers import easter
    assert easter(year) == day


def test_advent_start_and_laus_tibi_and_season():
    from pipeline.vespers import advent_start, laus_tibi, normal_key, season_of
    assert advent_start(2026) == date(2026, 11, 29)
    assert laus_tibi(date(2027, 1, 24)) and not laus_tibi(date(2027, 1, 17)) and not laus_tibi(date(2027, 3, 28))
    assert season_of("tempora:Quad5-0") == "passiontide" and season_of("tempora:Pasc3-0") == "easter"
    assert season_of("tempora:Pent10-0") is None
    assert normal_key("sancti:12-25m3") == "sancti:12-25" and normal_key("tempora:Pent01-0r") == "tempora:Pent01-0"


def test_marian_for_regina_caeli_in_eastertide_and_alma_in_advent():
    assert marian_for(date(2027, 4, 4)) == "regina"
    assert marian_for(date(2027, 5, 22)) == "regina"      # the Saturday after Pentecost
    assert marian_for(date(2027, 5, 23)) == "salve"       # Trinity
    assert marian_for(date(2026, 11, 29)) == "alma"
    assert marian_for(date(2027, 3, 21)) == "ave"


def test_window_keeps_last_year_and_five_ahead(days):
    from pipeline.vespers import window
    kept = window(days, date(2026, 9, 27))
    assert {d.year for d, _ in kept} == set(range(2025, 2032))
