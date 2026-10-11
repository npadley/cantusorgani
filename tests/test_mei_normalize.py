"""Card A4a: the independent MEI normaliser, checked against the encoder on the five pilots."""

from __future__ import annotations

import ast
from fractions import Fraction
from functools import cache
from pathlib import Path

import pytest

from pipeline.typeset.mei.encode import encode_score
from pipeline.typeset.mei.extract import ir_from_rows, parse_rows
from pipeline.typeset.mei.model import (
    ConversionProfile,
    EncodedScore,
    NormalizedScore,
    Pitch,
    ScoreIR,
)
from pipeline.typeset.mei.normalize import UnsafeXmlError, normalize_ir, normalize_mei

ROOT = Path(__file__).resolve().parents[1]
EXTRACTION = ROOT / "tests/fixtures/mei/extraction"
PROFILE = ROOT / "data/typeset/mei/profiles/accompaniment-v1.json"
PILOTS = {
    "F1": ("kyrie_IX.tsv", "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"),
    "F2": ("al_ego_dilecto.csv.tsv", "data/typeset/src/vol-3/al_ego_dilecto.csv.ly"),
    "F3": ("agnus_XI.tsv", "data/typeset/src/vol-5/missa-xi/agnus_XI.ly"),
    "F4": ("ite_Ib.tsv", "data/typeset/src/vol-5/missa-i/ite_Ib.ly"),
    "F5": ("co_inclina_aurem_tuam.csv.tsv", "data/typeset/src/vol-2/co_inclina_aurem_tuam.csv.ly"),
}
NORMALIZE_SOURCE = ROOT / "pipeline/typeset/mei/normalize.py"


@cache
def pilot(fixture: str) -> tuple[ScoreIR, EncodedScore]:
    tsv, source = PILOTS[fixture]
    ir = ir_from_rows(parse_rows((EXTRACTION / tsv).read_text(encoding="utf-8")), source, "0" * 64)
    return ir, encode_score(ir, ConversionProfile.load(PROFILE))


def doc(measures: str) -> bytes:
    return (
        '<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><music><body><mdiv><score>'
        f"<section>{measures}</section></score></mdiv></body></music></mei>"
    ).encode()


def measure(layer_body: str, right: str = "invis", extra: str = "") -> str:
    return (
        f'<measure right="{right}"><staff n="1"><layer n="1">{layer_body}</layer></staff>{extra}</measure>'
    )


def summary(score: NormalizedScore) -> dict[str, list[tuple]]:
    return {
        key: [
            (e.onset, e.duration, e.kind, e.pitch, e.is_attack, e.source_event_id, e.notehead, e.printed_accidental)
            for e in events
        ]
        for key, events in score.layers.items()
    }


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_normalize_mei_pilot_round_trip_equals_normalize_ir(fixture: str) -> None:
    ir, encoded = pilot(fixture)
    expected = normalize_ir(ir)
    actual = normalize_mei(encoded.xml, encoded.provenance)
    assert summary(actual) == summary(expected)
    assert actual.lyrics == expected.lyrics
    assert actual.entry_markers == expected.entry_markers
    assert actual.spans == expected.spans
    # The piece-final finalis is checked separately (known encoder defect, see below).
    assert [d for d in actual.divisions if d[1] != actual.total_duration] == [
        d for d in expected.divisions if d[1] != expected.total_duration
    ]
    assert actual.total_duration == expected.total_duration


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_normalize_mei_pilot_round_trip_keeps_the_final_division(fixture: str) -> None:
    ir, encoded = pilot(fixture)
    assert normalize_mei(encoded.xml, encoded.provenance).divisions == normalize_ir(ir).divisions


def test_normalize_ir_kyrie_layer_keys_follow_staff_and_layer_order() -> None:
    ir, _ = pilot("F1")
    assert set(normalize_ir(ir).layers) == {"1.1", "1.2", "2.1", "2.2"}


def test_normalize_mei_split_sustain_merges_into_one_seven_eighths_event() -> None:
    xml = doc(
        measure('<note xml:id="a" pname="c" oct="4" dur="4" dots="1" next="#a1"/>')
        + measure(
            '<note xml:id="a1" pname="c" oct="4" dur="2" type="split-continuation" prev="#a" visible="false"/>'
        )
    )
    score = normalize_mei(xml, {"a": "E1", "a1": "E1"})
    (event,) = score.layers["1.1"]
    assert (event.onset, event.duration, event.is_attack, event.source_event_id) == (
        Fraction(0),
        Fraction(7, 8),
        True,
        "E1",
    )
    assert event.notehead == "normal"
    assert score.total_duration == Fraction(7, 8)


def test_normalize_mei_broken_chain_keeps_continuation_as_non_attack() -> None:
    xml = doc(
        measure('<note xml:id="a" pname="c" oct="4" dur="4" dots="1" next="#a1"/>')
        + measure('<note xml:id="a1" pname="c" oct="4" dur="2" type="split-continuation" prev="#gone"/>')
    )
    events = normalize_mei(xml, {"a": "E1", "a1": "E1"}).layers["1.1"]
    assert [(e.duration, e.is_attack) for e in events] == [(Fraction(3, 8), True), (Fraction(1, 2), False)]


@pytest.mark.parametrize(
    "continuation",
    [
        '<note xml:id="a1" pname="d" oct="4" dur="2" type="split-continuation" prev="#a"/>',
        '<note xml:id="a1" pname="c" oct="5" dur="2" type="split-continuation" prev="#a"/>',
    ],
)
def test_normalize_mei_continuation_with_other_pitch_is_not_merged(continuation: str) -> None:
    xml = doc(
        measure('<note xml:id="a" pname="c" oct="4" dur="4" next="#a1"/>') + measure(continuation)
    )
    events = normalize_mei(xml, {"a": "E1", "a1": "E1"}).layers["1.1"]
    assert [e.is_attack for e in events] == [True, False]


def test_normalize_mei_continuation_after_a_gap_is_not_merged() -> None:
    xml = doc(
        measure(
            '<note xml:id="a" pname="c" oct="4" dur="4" next="#a1"/><rest xml:id="r" dur="4"/>'
            '<note xml:id="a1" pname="c" oct="4" dur="4" type="split-continuation" prev="#a"/>'
        )
    )
    events = normalize_mei(xml, {"a": "E1", "r": "E2", "a1": "E1"}).layers["1.1"]
    assert [e.is_attack for e in events] == [True, True, False]


def test_normalize_mei_note_absent_from_provenance_has_no_source_id() -> None:
    xml = doc(measure('<note xml:id="a" pname="c" oct="4" dur="4"/><note xml:id="b" pname="d" oct="4" dur="4"/>'))
    events = normalize_mei(xml, {"a": "E1"}).layers["1.1"]
    assert [e.source_event_id for e in events] == ["E1", None]


def test_normalize_mei_doctype_is_rejected_without_expansion() -> None:
    hostile = b'<?xml version="1.0"?><!DOCTYPE mei [<!ENTITY x SYSTEM "http://127.0.0.1:9/x">]><mei>&x;</mei>'
    with pytest.raises(UnsafeXmlError):
        normalize_mei(hostile, {})


def test_normalize_mei_tuplet_scales_durations_by_numbase_over_num() -> None:
    xml = doc(
        measure(
            '<tuplet num="3" numbase="2">'
            '<note xml:id="a" pname="c" oct="4" dur="4"/><note xml:id="b" pname="d" oct="4" dur="4"/>'
            '<note xml:id="c" pname="e" oct="4" dur="4"/></tuplet>'
        )
    )
    events = normalize_mei(xml, {}).layers["1.1"]
    assert [(e.onset, e.duration) for e in events] == [
        (Fraction(0), Fraction(1, 6)),
        (Fraction(1, 6), Fraction(1, 6)),
        (Fraction(1, 3), Fraction(1, 6)),
    ]


def test_normalize_mei_pitch_comes_from_accidentals_not_keysig() -> None:
    xml = doc(
        measure(
            '<note xml:id="a" pname="b" oct="3" dur="4" accid.ges="f"/>'
            '<note xml:id="b" pname="b" oct="3" dur="4" accid="n" accid.ges="n"/>'
            '<note xml:id="c" pname="f" oct="4" dur="4"/>'
        )
    ).replace(b"<score>", b'<score><scoreDef><staffGrp><staffDef n="1" keysig="2s"/></staffGrp></scoreDef>')
    events = normalize_mei(xml, {}).layers["1.1"]
    assert [e.pitch for e in events] == [
        Pitch("b", Fraction(-1), 3),
        Pitch("b", Fraction(0), 3),
        Pitch("f", Fraction(0), 4),
    ]
    assert [e.printed_accidental for e in events] == ["none", "natural", "none"]


def test_normalize_mei_real_ties_become_tie_spans_and_split_ties_do_not() -> None:
    xml = doc(
        measure(
            '<note xml:id="a" pname="c" oct="4" dur="4" tie="i"/>'
            '<note xml:id="b" pname="c" oct="4" dur="4" tie="t" next="#b1"/>'
        )
        + measure('<note xml:id="b1" pname="c" oct="4" dur="4" type="split-continuation" prev="#b"/>')
    )
    score = normalize_mei(xml, {"a": "A", "b": "B", "b1": "B"})
    assert score.spans == (("tie", "A", "B"),)
    assert [e.duration for e in score.layers["1.1"]] == [Fraction(1, 4), Fraction(1, 2)]


def test_normalize_mei_slur_resolves_through_provenance() -> None:
    xml = doc(
        measure(
            '<note xml:id="a" pname="c" oct="4" dur="4"/><note xml:id="b" pname="d" oct="4" dur="4"/>',
            extra='<slur startid="#a" endid="#b"/><gliss startid="#a" endid="#b"/>',
        )
    )
    score = normalize_mei(xml, {"a": "A", "b": "B"})
    assert score.spans == (("slur", "A", "B"), ("voice-line", "A", "B"))


def test_normalize_mei_quilisma_and_hidden_noteheads() -> None:
    xml = doc(
        measure(
            '<note xml:id="q" pname="c" oct="4" dur="4" head.visible="false"/>'
            '<note xml:id="h" pname="d" oct="4" dur="4" visible="false"/>'
            '<note xml:id="p" pname="e" oct="4" dur="4" head.visible="false"/>',
            extra='<mordent startid="#q"/>',
        )
    )
    events = normalize_mei(xml, {}).layers["1.1"]
    assert [e.notehead for e in events] == ["quilisma", "hidden", "normal"]


def test_normalize_mei_divisions_from_barlines_and_caesurae() -> None:
    xml = doc(
        measure(
            '<note xml:id="a" pname="c" oct="4" dur="2"/>',
            right="single",
            extra='<caesura startid="#a" glyph.num="U+E8F3"/>',
        )
        + measure(
            '<note xml:id="b" pname="c" oct="4" dur="2"/>',
            right="dbl",
            extra='<caesura startid="#b" glyph.num="U+E8F4"/>',
        )
    )
    score = normalize_mei(xml, {})
    half, whole = Fraction(1, 2), Fraction(1)
    assert score.divisions == (("maxima", half), ("minima", half), ("finalis", whole), ("maior", whole))


def test_normalize_mei_lyrics_and_entry_markers_anchor_to_the_note() -> None:
    xml = doc(
        measure(
            '<note xml:id="a" pname="c" oct="4" dur="4"><verse n="1"><label>*</label><syl>Ky</syl></verse></note>'
        )
    )
    score = normalize_mei(xml, {"a": "A"})
    assert score.lyrics == (("Ky", "A"),)
    assert score.entry_markers == (("*", "A"),)


def test_normalize_py_does_not_import_encoder_or_extractor() -> None:
    tree = ast.parse(NORMALIZE_SOURCE.read_text(encoding="utf-8"))
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            imported.append(base)
            imported += [f"{base}.{alias.name}" for alias in node.names]
    forbidden = ("pipeline.typeset.mei.encode", "pipeline.typeset.mei.extract")
    assert not [name for name in imported if name.startswith(forbidden)]
