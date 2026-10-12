"""Regression evidence for the five P2 vol-1 tie mismatches."""

from dataclasses import replace
from pathlib import Path

import pytest

from pipeline.typeset.mei.encode import encode_score
from pipeline.typeset.mei.extract import build_spans, ir_from_rows, parse_rows
from pipeline.typeset.mei.model import ConversionProfile
from pipeline.typeset.mei.normalize import normalize_ir, normalize_mei
from pipeline.typeset.mei.validate import compare_scores

ROOT = Path(__file__).resolve().parents[1]
NAMES = (
    "of_ad_te_domine", "gr_dirigatur_oratio_mea", "of_deus_enim",
    "of_exsulta_satis", "gr_salvos_fac_nos",
)


def score(name):
    fixture = ROOT / "tests/fixtures/mei/extraction" / f"{name}.csv.tsv"
    source = f"data/typeset/src/vol-1/{name}.csv.ly"
    return ir_from_rows(parse_rows(fixture.read_text(encoding="utf-8")), source, "0" * 64)


@pytest.mark.parametrize("name", NAMES)
def test_encode_score_vol_one_tie_regressions_match_independent_oracle(name):
    ir = score(name)
    profile = ConversionProfile.load(ROOT / "data/typeset/mei/profiles/accompaniment-v1.json")
    encoded = encode_score(ir, profile)
    assert compare_scores(normalize_ir(ir), normalize_mei(encoded.xml, encoded.provenance)) == []


def test_build_spans_tied_chord_preserves_each_matching_pitch():
    ir = score("gr_dirigatur_oratio_mea")
    events = {event.id: event for event in ir.events}
    chord_ties = [
        span for span in ir.spans
        if span.kind == "tie" and events[span.start_event_id].location.line == 74
    ]
    assert len(chord_ties) == 2
    assert {events[span.start_event_id].pitch.step for span in chord_ties} == {"c", "e"}
    for span in chord_ties:
        start, end = events[span.start_event_id], events[span.end_event_id]
        assert start.pitch == end.pitch
        assert end.onset == start.onset + start.duration


@pytest.mark.parametrize("name", [name for name in NAMES if name != "gr_dirigatur_oratio_mea"])
def test_build_spans_invalid_chant_tie_keeps_warning_without_invented_span(name):
    ir = score(name)
    ties = {span.start_event_id for span in ir.spans if span.kind == "tie"}
    invalid = [event for event in ir.events if event.tie_to_next and event.id not in ties]
    assert invalid
    for event in invalid:
        assert any(
            diagnostic.code == "UNKNOWN_FEATURE"
            and diagnostic.severity == "warning"
            and event.id in diagnostic.event_ids
            and "no same-pitch target" in diagnostic.message
            for diagnostic in ir.diagnostics
        )


@pytest.mark.parametrize("kind", ["note", "rest", "skip"])
def test_build_spans_intervening_attack_does_not_jump_to_later_matching_pitch(kind):
    template = score("of_ad_te_domine").events[0]
    start = replace(template, id="start", tie_to_next=True)
    barrier = replace(
        template, id="barrier", onset=start.onset + start.duration, kind=kind,
        pitch=replace(template.pitch, step="d") if kind == "note" else None,
        tie_to_next=False,
    )
    later = replace(
        template, id="later", onset=barrier.onset + barrier.duration, tie_to_next=False,
    )
    spans, diagnostics = build_spans([], (start, barrier, later))
    assert spans == ()
    assert len(diagnostics) == 1
    assert diagnostics[0].event_ids == ("start",)
    assert "no same-pitch target" in diagnostics[0].message


@pytest.mark.lilypond
def test_run_listener_note_local_chord_tie_preserves_only_tied_pitch(tmp_path):
    from pipeline.typeset.mei.extract import PinnedLilyPondRunner, run_listener
    source = tmp_path / 'local-tie.ly'
    source.write_text('\\version "2.26.0"\n\\score { \\new Staff { <c\'~ e\'>4 <c\' e\'>4 } }\n')
    ir = ir_from_rows(parse_rows(run_listener(source, PinnedLilyPondRunner())), str(source), '0' * 64)
    ties = [s for s in ir.spans if s.kind == 'tie']
    assert [(s.start_event_id, s.end_event_id) for s in ties] == [('0e0000', '0e0002')]
