"""Card A4b: semantic comparison and the validation report."""

from __future__ import annotations

import json
from dataclasses import replace
from fractions import Fraction

import pytest

from pipeline.cli import main
from pipeline.typeset.mei.model import NormalizedEvent, NormalizedScore, Pitch
from pipeline.typeset.mei.normalize import normalize_ir, normalize_mei
from pipeline.typeset.mei.schema import load_schema_bundle
from pipeline.typeset.mei.validate import compare_scores, validate_conversion
from tests.test_mei_normalize import PILOTS, pilot

C4 = Pitch("c", Fraction(0), 4)


def ev(onset: int, sid: str | None, **kw: object) -> NormalizedEvent:
    base = {
        "layer_key": "1.1",
        "onset": Fraction(onset, 4),
        "duration": Fraction(1, 4),
        "kind": "note",
        "pitch": C4,
        "is_attack": True,
        "notehead": "normal",
        "printed_accidental": "none",
        "source_event_id": sid,
    }
    base.update(kw)
    return NormalizedEvent(**base)  # type: ignore[arg-type]


def score(
    events: tuple[NormalizedEvent, ...] | None = None,
    layers: dict[str, tuple[NormalizedEvent, ...]] | None = None,
    **kw: object,
) -> NormalizedScore:
    base = {
        "layers": layers if layers is not None else {"1.1": events or (ev(0, "A"), ev(1, "B"))},
        "lyrics": (("Ky", "A"),),
        "entry_markers": (("*", "A"),),
        "spans": (("slur", "A", "B"), ("tie", "A", "B")),
        "divisions": (("minima", Fraction(1, 2)),),
        "total_duration": Fraction(1, 2),
    }
    base.update(kw)
    return NormalizedScore(**base)  # type: ignore[arg-type]


def codes(source: NormalizedScore, converted: NormalizedScore) -> list[str]:
    return [d.code for d in compare_scores(source, converted)]


def test_compare_scores_identical_scores_yield_nothing() -> None:
    assert compare_scores(score(), score()) == []


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_compare_scores_pilot_has_only_the_known_final_finalis_difference(fixture: str) -> None:
    ir, encoded = pilot(fixture)
    found = compare_scores(normalize_ir(ir), normalize_mei(encoded.xml, encoded.provenance))
    assert [(d.code, d.onset) for d in found] == [("DIVISION_MISMATCH", ir.total_duration)]
    assert "finalis" in found[0].detail


def test_validate_conversion_kyrie_fails_only_on_the_final_finalis() -> None:
    ir, encoded = pilot("F1")
    report = validate_conversion(ir, encoded, load_schema_bundle())
    assert report.schema_ok
    assert [d.code for d in report.semantic_differences] == ["DIVISION_MISMATCH"]
    assert not report.eligible
    assert set(report.hashes) == {"ir", "mei", "schema"}
    assert report.hashes["mei"] == encoded.artifact_sha256
    assert "schema_validator" in report.tool_versions


def test_validate_conversion_schema_invalid_mei_is_not_eligible() -> None:
    ir, encoded = pilot("F1")
    bad = replace(encoded, xml=encoded.xml.replace(b"<mdiv>", b"<bogus/><mdiv>", 1))
    report = validate_conversion(ir, bad, load_schema_bundle())
    assert not report.schema_ok
    assert not report.eligible


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (lambda e: replace(e, pitch=Pitch("d", Fraction(0), 4)), "PITCH_MISMATCH"),
        (lambda e: replace(e, onset=Fraction(1, 8)), "ONSET_MISMATCH"),
        (lambda e: replace(e, duration=Fraction(1, 8)), "DURATION_MISMATCH"),
        (lambda e: replace(e, is_attack=False), "ATTACK_MISMATCH"),
        (lambda e: replace(e, notehead="hidden"), "NOTEHEAD_MISMATCH"),
        (lambda e: replace(e, printed_accidental="sharp"), "ACCIDENTAL_DISPLAY_MISMATCH"),
    ],
)
def test_compare_scores_event_attribute_change_yields_its_code(mutate, expected: str) -> None:
    converted = score(events=(mutate(ev(0, "A")), ev(1, "B")))
    found = compare_scores(score(), converted)
    assert [d.code for d in found] == [expected]
    assert found[0].layer_key == "1.1"
    assert found[0].source_event_ids == ("A",)


def test_compare_scores_dropped_event_is_render_event_missing() -> None:
    assert codes(score(), score(events=(ev(0, "A"),))) == ["RENDER_EVENT_MISSING"]


def test_compare_scores_unmapped_event_pairs_by_order_and_reports_nothing_else() -> None:
    assert codes(score(), score(events=(ev(0, "A"), ev(1, None)))) == []


def test_compare_scores_extra_converted_event_is_attack_mismatch() -> None:
    converted = score(events=(ev(0, "A"), ev(1, "B"), ev(2, None)))
    assert codes(score(), converted) == ["ATTACK_MISMATCH"]


def test_compare_scores_missing_and_extra_layers() -> None:
    other = (ev(0, "Z", layer_key="2.1"),)
    assert codes(score(), score(layers={"2.1": other})) == [
        "VOICE_MISSING",
        "VOICE_EXTRA",
    ]


@pytest.mark.parametrize(
    ("field", "value", "expected"),
    [
        ("spans", (("slur", "A", "B"),), "TIE_MISMATCH"),
        ("spans", (("tie", "A", "B"),), "SLUR_MISMATCH"),
        ("divisions", (("maior", Fraction(1, 2)),), "DIVISION_MISMATCH"),
        ("entry_markers", (("**", "A"),), "ENTRY_MARKER_MISMATCH"),
        ("lyrics", (("Ly", "A"),), "LYRIC_TEXT_MISMATCH"),
        ("lyrics", (("Ky", "B"),), "LYRIC_ANCHOR_MISMATCH"),
        ("total_duration", Fraction(1, 4), "ENDING_MISSING"),
    ],
)
def test_compare_scores_non_event_change_yields_its_code(field: str, value: object, expected: str) -> None:
    found = codes(score(), score(**{field: value}))
    assert expected in found
    assert set(found) <= {expected, "DIVISION_MISMATCH"} if field == "divisions" else set(found) == {expected}


def test_compare_scores_voice_line_gliss_is_a_slur_mismatch_with_detail() -> None:
    source = score(spans=(("voice-line", "A", "B"),))
    found = compare_scores(source, score(spans=()))
    assert [d.code for d in found] == ["SLUR_MISMATCH"]
    assert "voice-line" in found[0].detail


def test_validate_command_writes_report_and_exits_one_when_not_eligible(tmp_path, capsys) -> None:
    ir, encoded = pilot("F1")
    (tmp_path / "ir.json").write_text(json.dumps(ir.to_dict()), encoding="utf-8")
    (tmp_path / "score.mei").write_bytes(encoded.xml)
    (tmp_path / "provenance.json").write_text(json.dumps(encoded.provenance), encoding="utf-8")
    assert main(["typeset-mei-validate", str(tmp_path)]) == 1
    report = json.loads((tmp_path / "validation.json").read_text(encoding="utf-8"))
    assert report["schema_ok"] is True
    assert report["eligible"] is False
    assert [d["code"] for d in report["semantic_differences"]] == ["DIVISION_MISMATCH"]
