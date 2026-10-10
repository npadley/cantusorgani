from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

import pytest

from pipeline.typeset.mei import extract
from pipeline.typeset.mei.extract import (
    build_events,
    build_layers,
    build_staves,
    extractor_version,
    parse_rows,
    total_duration,
)

FIXTURES = Path(__file__).parent / "fixtures" / "mei"
EXTRACTION = FIXTURES / "extraction"


def load(name: str):
    rows = parse_rows((EXTRACTION / f"{name}.tsv").read_text(encoding="utf-8"))
    layers = build_layers(rows)
    events, diagnostics = build_events(rows, f"{name}.ly")
    return rows, layers, events, diagnostics


def by_layer(events, layer_id):
    return [e for e in events if e.layer_id == layer_id]


def test_parse_rows_kyrie_first_row_is_version():
    rows = parse_rows((EXTRACTION / "kyrie_IX.tsv").read_text(encoding="utf-8"))
    assert extractor_version(rows) == "listen_full/1"


def test_build_layers_kyrie_ids_and_voice_commands():
    rows, layers, _, _ = load("kyrie_IX")
    assert [layer.id for layer in layers] == ["up:chant", "up:#1", "down:#2", "down:#3"]
    assert [layer.voice_command for layer in layers] == [
        "voiceOne", "voiceTwo", "voiceOne", "voiceTwo",
    ]
    assert [layer.role for layer in layers] == [
        "chant", "accompaniment", "accompaniment", "accompaniment",
    ]
    staves = build_staves(rows)
    assert [(s.id, s.index, s.clef_shape, s.clef_line, s.key_fifths) for s in staves] == [
        ("up", 1, "G", 2, 1),
        ("down", 2, "F", 4, 1),
    ]


def test_build_events_kyrie_matches_baseline():
    _, layers, events, _ = load("kyrie_IX")
    baseline = json.loads((FIXTURES / "kyrie-ix" / "baseline-events.json").read_text())
    for layer, key in zip(layers, ["165", "168", "175", "178"], strict=True):
        got = [
            (
                e.onset,
                e.duration,
                e.pitch.step if e.pitch else None,
                e.pitch.alter if e.pitch else None,
                e.pitch.octave if e.pitch else None,
                e.kind,
            )
            for e in by_layer(events, layer.id)
        ]
        want = [
            (
                Fraction(b["onset"]),
                Fraction(b["duration"]),
                b.get("step"),
                Fraction(b["alter"]) if "alter" in b else None,
                b.get("octave"),
                b["kind"],
            )
            for b in baseline["voices"][key]
        ]
        assert got == want, layer.id


def test_build_events_kyrie_totals_and_counts():
    _, _, events, diagnostics = load("kyrie_IX")
    assert total_duration(events) == Fraction(373, 8)
    assert sum(e.kind == "note" for e in events) == 358
    assert sum(e.kind == "skip" for e in events) == 5
    assert diagnostics == ()
    assert events == tuple(sorted(events, key=lambda e: (e.onset, int(e.id.split("e")[0]), e.id)))
    assert events[0].id == "0e0000"
    assert sum(e.tie_to_next for e in events) == 68


def test_build_events_agnus_xi_voice_line_layer_and_cross_staff():
    _, layers, events, diagnostics = load("agnus_XI")
    assert len(layers) == 5
    voice_line = [layer for layer in layers if layer.role == "voice-line"]
    assert len(voice_line) == 1
    notes = [e for e in by_layer(events, voice_line[0].id) if e.kind == "note"]
    assert notes and all(e.notehead == "hidden" for e in notes)
    home = {layer.id: layer.home_staff_id for layer in layers}
    assert sum(e.staff_id != home[e.layer_id] for e in events) >= 3
    assert sum(e.printed_accidental != "none" for e in events) == 3
    assert any(d.code == "VOICE_ENDS_UNEQUAL" and d.severity == "warning" for d in diagnostics)


def test_build_events_ite_ib_has_one_quilisma():
    _, _, events, _ = load("ite_Ib")
    assert sum(e.notehead == "quilisma" for e in events) == 1
    quil = next(e for e in events if e.notehead == "quilisma")
    assert quil.onset == Fraction(1, 2)
    assert quil.location.line == 22


def test_build_events_al_ego_dilecto_has_seven_rests():
    _, _, events, _ = load("al_ego_dilecto.csv")
    rests = [e for e in events if e.kind == "rest"]
    assert len(rests) == 7
    assert all(e.pitch is None for e in rests)


def test_build_events_notated_duration_for_notes_and_rests():
    _, _, events, _ = load("kyrie_IX")
    triple = next(e for e in events if e.notated.scale != 1)
    assert triple.duration == triple.notated.scale * Fraction(1, 2**triple.notated.log)
    _, _, events, _ = load("agnus_XI")
    rest = next(e for e in events if e.kind == "rest")
    assert rest.notated.scale == 1
    assert rest.duration == Fraction(1, 2**rest.notated.log) * (2 - Fraction(1, 2**rest.notated.dots))


@pytest.mark.parametrize(
    ("dur", "log", "dots", "scale"),
    [
        (Fraction(1, 4), 2, 0, Fraction(1)),
        (Fraction(3, 8), 2, 1, Fraction(1)),
        (Fraction(7, 16), 2, 2, Fraction(1)),
        (Fraction(1), 0, 0, Fraction(1)),
        (Fraction(1, 6), 2, 0, Fraction(2, 3)),
        (Fraction(2), 0, 0, Fraction(2)),
    ],
)
def test_notated_from_duration_representable_and_fallback(dur, log, dots, scale):
    n = extract.notated_from_duration(dur)
    assert (n.log, n.dots, n.scale) == (log, dots, scale)


def test_build_events_acknowledgers_keyed_by_loc_not_adjacency():
    tsv = (
        "0\t-\t-\tversion\tlisten_full/1\t2.26.0\n"
        "0\t-\tup\tstaff\t1\n"
        "0\t-\tup\tclef\tclefs.G\t-2\t-\n"
        "0\tup:#0\tup\tvoice\t0\tvoiceOne\n"
        "0\tup:#0\tup\tnote\tc\t0\t4\t2\t0\t1\t1\t1/4\ta.ly:1:0\n"
        "0\tup:#0\tup\tnote\td\t0\t4\t2\t0\t1\t1\t1/4\ta.ly:1:5\n"
        "0\tup:#0\tup\thead\t1\tnormal\ta.ly:1:5\n"
        "0\tup:#0\tup\thead\t0\tquilisma\ta.ly:1:0\n"
        "0\tup:#0\tup\tstem\t0\ta.ly:1:0\n"
    )
    events, _ = build_events(parse_rows(tsv), "a.ly")
    assert [(e.pitch.step, e.notehead) for e in events if e.pitch] == [
        ("c", "quilisma"),
        ("d", "hidden"),
    ]
    # the second chord note has no stem row of its own but shares the chord's stem
    assert all(e.stem_visible for e in events)


def test_parse_rows_text_fields_unescaped():
    tsv = (
        "0\t-\t-\tversion\tlisten_full/1\t2.26.0\n"
        "0\tlyrics:#0\tup:chant\tlyric\ta\\tb\\\\c\\n\t-\tx.ly:1:0\n"
    )
    assert parse_rows(tsv)[1].fields[0] == "a\tb\\c\n"


@pytest.mark.parametrize(
    ("body", "needle"),
    [
        ("0\t-\tup\tstaff\t1\t2\n", "line 2"),
        ("1/4@1/8\tup:#0\tup\trest\t1/4\tx.ly:1:0\n", "line 2"),
        ("0\t-\tup\tbogus\t1\n", "line 2"),
        ("0.5\t-\tup\tstaff\t1\n", "line 2"),
    ],
)
def test_parse_rows_invalid_row_raises_value_error_with_line(body, needle):
    tsv = "0\t-\t-\tversion\tlisten_full/1\t2.26.0\n" + body
    with pytest.raises(ValueError, match=needle):
        parse_rows(tsv)


def test_parse_rows_missing_version_raises_value_error():
    with pytest.raises(ValueError, match="line 1"):
        parse_rows("0\t-\tup\tstaff\t1\n")


def test_extract_source_has_no_float_calls():
    source = Path(extract.__file__).read_text(encoding="utf-8")
    assert "float(" not in source


# --- A2c: lyrics, spans, divisions, features ------------------------------------------

from collections import Counter

from pipeline.typeset.mei.extract import (
    build_divisions,
    build_lyrics,
    build_spans,
    division_diagnostics,
    feature_uses,
)


def load_all(name: str):
    rows, layers, events, _ = load(name)
    lyrics, markers, lyric_diags = build_lyrics(rows, layers, events)
    spans, span_diags = build_spans(rows, events)
    divisions = build_divisions(rows, layers)
    features = feature_uses(rows, events, spans, layers, lyrics, markers, divisions)
    return rows, layers, events, lyrics, markers, lyric_diags, spans, span_diags, divisions, features


FIXTURE_NAMES = [
    "kyrie_IX", "al_ego_dilecto.csv", "agnus_XI", "ite_Ib", "co_inclina_aurem_tuam.csv", "agnus_IX",
]


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_build_lyrics_pilot_fixtures_have_no_unanchored_syllables(name):
    assert load_all(name)[5] == ()


def test_build_lyrics_kyrie_counts_and_anchors_are_chant_attacks():
    _, _, events, lyrics, _, _, _, _, _, _ = load_all("kyrie_IX")
    assert len(lyrics) == 82
    assert sum(s.text != "" for s in lyrics) == 60
    by_id = {e.id: e for e in events}
    for s in lyrics:
        anchor = by_id[s.anchor_event_id]
        assert anchor.layer_id == "up:chant" and anchor.kind == "note" and anchor.onset == s.onset


def test_build_lyrics_anchor_ignores_accompaniment_sharing_the_onset():
    _, _, events, lyrics, _, _, _, _, _, _ = load_all("kyrie_IX")
    shared = [
        s
        for s in lyrics
        if any(e.layer_id != "up:chant" and e.kind == "note" and e.onset == s.onset for e in events)
    ]
    assert shared
    by_id = {e.id: e for e in events}
    for s in shared:
        assert by_id[s.anchor_event_id].layer_id == "up:chant"


def test_build_lyrics_kyrie_entry_markers_on_right_syllables():
    _, _, _, lyrics, markers, *_ = load_all("kyrie_IX")
    by_id = {s.id: s for s in lyrics}
    got = [(m.text, by_id[m.syllable_id].onset, by_id[m.syllable_id].text) for m in markers]
    assert got == [("*", Fraction(25, 8), "e"), ("*", Fraction(38), ""), ("**", Fraction(42), "")]


def test_build_lyrics_ite_ib_unnamed_contexts_are_separate():
    _, _, _, lyrics, *_ = load_all("ite_Ib")
    assert {s.lyrics_context for s in lyrics} == {"lyrics:#0", "lyrics:#1"}
    assert any(s.hyphen_after for s in lyrics)


def test_build_lyrics_unanchored_syllable_reports_error():
    tsv = (
        "0\t-\t-\tversion\tlisten_full/1\t2.26.0\n"
        "0\t-\tup\tstaff\t1\n"
        "0\t-\tup\tclef\tclefs.G\t-2\t-\n"
        "0\tup:chant\tup\tvoice\t0\tvoiceOne\n"
        "0\tup:chant\tup\tnote\tc\t0\t4\t2\t0\t1\t1\t1/4\ta.ly:1:0\n"
        "1/4\tlyrics:#0\tup:chant\tlyric\tx\t-\ta.ly:2:0\n"
    )
    rows = parse_rows(tsv)
    layers = build_layers(rows)
    events, _ = build_events(rows, "a.ly")
    lyrics, _, diags = build_lyrics(rows, layers, events)
    assert lyrics[0].anchor_event_id is None
    assert [(d.code, d.severity) for d in diags] == [("LYRIC_UNANCHORED", "error")]


def test_build_divisions_kyrie_kinds():
    *_, divisions, _ = load_all("kyrie_IX")
    assert len(divisions) == 22
    assert Counter(d.kind for d in divisions) == {"finalis": 18, "minima": 4}


def test_build_divisions_co_inclina_has_maxima():
    *_, divisions, _ = load_all("co_inclina_aurem_tuam.csv")
    assert Counter(d.kind for d in divisions)["maxima"] == 4


def test_division_diagnostics_other_kind_is_error():
    tsv = (
        "0\t-\t-\tversion\tlisten_full/1\t2.26.0\n"
        "1\tup:chant\tup\tdiv\tother\ta.ly:1:0\n"
    )
    rows = parse_rows(tsv)
    assert build_divisions(rows, ()) == ()
    assert [(d.code, d.severity) for d in division_diagnostics(rows)] == [("UNKNOWN_FEATURE", "error")]


def test_build_spans_kyrie_ties_slurs_and_repeated_attacks():
    result = load_all("kyrie_IX")
    events, spans, span_diags = result[2], result[6], result[7]
    assert span_diags == ()
    assert Counter(s.kind for s in spans) == {"tie": 68, "slur": 59}
    tied = {s.start_event_id for s in spans if s.kind == "tie"}
    repeats = [
        (a, b)
        for layer in {e.layer_id for e in events}
        for a, b in zip(
            [e for e in events if e.layer_id == layer],
            [e for e in events if e.layer_id == layer][1:],
            strict=False,
        )
        if a.kind == b.kind == "note" and a.pitch == b.pitch and not a.tie_to_next
    ]
    assert repeats
    for a, b in repeats:
        assert a.id not in tied


def test_build_spans_agnus_xi_voice_line_spans():
    *_, spans, span_diags, _, _ = load_all("agnus_XI")
    assert Counter(s.kind for s in spans)["voice-line"] == 3
    assert span_diags == ()


def test_build_spans_ordinary_glissando_warns():
    _, _, _, _, _, _, spans, span_diags, _, _ = load_all("agnus_IX")
    assert Counter(s.kind for s in spans)["voice-line"] == 4
    assert [(d.code, d.severity) for d in span_diags] == [("UNKNOWN_FEATURE", "warning")] * 4


def test_build_spans_unbalanced_slur_reports_error():
    base = (
        "0\t-\t-\tversion\tlisten_full/1\t2.26.0\n"
        "0\t-\tup\tstaff\t1\n"
        "0\t-\tup\tclef\tclefs.G\t-2\t-\n"
        "0\tup:chant\tup\tvoice\t0\tvoiceOne\n"
        "0\tup:chant\tup\tnote\tc\t0\t4\t2\t0\t1\t1\t1/4\ta.ly:1:0\n"
        "0\tup:chant\tup\tslur\t-1\ta.ly:1:2\n"
    )
    rows = parse_rows(base)
    events, _ = build_events(rows, "a.ly")
    spans, diags = build_spans(rows, events)
    assert spans == ()
    assert [(d.code, d.severity) for d in diags] == [("UNKNOWN_FEATURE", "error")]


def test_feature_uses_ite_ib_reports_quilisma():
    *_, features = load_all("ite_Ib")
    assert [f.family for f in features].count("quilisma") == 1


def test_feature_uses_agnus_xi_reports_voice_line_and_cross_staff():
    *_, features = load_all("agnus_XI")
    families = Counter(f.family for f in features)
    assert families["voice-line-voice"] == 1
    assert families["voice-line-glissando"] == 3
    assert families["cross-staff"] >= 3
    assert all(f.family in extract.FEATURE_FAMILIES for f in features)


def test_feature_uses_kyrie_reports_marker_blank_and_division_families():
    *_, features = load_all("kyrie_IX")
    families = Counter(f.family for f in features)
    assert families["stanza-marker"] == 3
    assert families["blank-lyric"] == 22
    assert families["finalis"] == 18
    assert families["divisio-minima"] == 4
    assert families["force-break"] == 5
    assert families["key-change"] == 0 and families["clef-change"] == 0
