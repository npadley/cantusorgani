"""All voices must preserve attacks, timing and evidence of unsupported input."""
from fractions import Fraction
from pathlib import Path

import pytest

from pipeline.typeset.score_events import instrument_voices, parse_score, read_score


def test_parse_score_preserves_voice_pitch_written_value_and_rest_vs_skip():
    tsv = ("0\tup:alto\tnote\t2\t-1/2\t0\t1\t0\t3/2\t3/4\t8:4\n"
           "0\tdown:tenor\trest\t1/4\n"
           "0\tdown:bass\tskip\t1/4\n"
           "3/4\tup:alto\tnote\t1\t0\t0\t2\t0\t1\t1/4\t9:4")
    result = parse_score(tsv)
    assert not result.flags
    assert [(e.voice, e.kind, e.step, e.alteration, e.onset, e.duration)
            for e in result.events] == [
        ("alto", "note", 2, Fraction(-1, 2), Fraction(0), Fraction(3, 4)),
        ("tenor", "rest", None, None, Fraction(0), Fraction(1, 4)),
        ("bass", "skip", None, None, Fraction(0), Fraction(1, 4)),
        ("alto", "note", 1, Fraction(0), Fraction(3, 4), Fraction(1, 4)),
    ]
    assert result.events[0].origin == "8:4"
    assert result.events[0].written == (1, 0, "3/2")


def test_parse_score_retains_tied_written_notes_and_flags_wrong_pitch():
    prefix = "0\tup:alto\tnote\t0\t0\t0\t1\t0\t1\t1/2\t5:1\n0\tup:alto\ttie\n"
    valid = parse_score(prefix + "1/2\tup:alto\tnote\t0\t0\t0\t1\t0\t1\t1/2\t6:1")
    assert len(valid.events) == 2
    assert valid.events[0].tie_out and valid.events[1].tie_in
    assert not valid.flags
    wrong = parse_score(prefix + "1/2\tup:alto\tnote\t1\t0\t0\t1\t0\t1\t1/2\t6:1")
    assert any("tie" in f for f in wrong.flags)


def test_parse_score_abstains_on_malformed_or_unidentified_voice():
    assert parse_score("garbage").flags
    assert parse_score("").flags
    assert parse_score("0\tdown:4\tnote\t0\t0\t0\t2\t0\t1\t1/4\t4:1").flags
    assert parse_score("0\tup:alto\tnote\t0\t0\t0\t2\t0\t1\t-1/4\t4:1").flags


def test_instrument_voices_names_only_explicit_music_bindings():
    source = r'\new Voice { \voiceOne \global \tenorMusic } \new Voice { \bassMusic }'
    named = instrument_voices(source)
    assert r'\new Voice = "tenor"' in named
    assert r'\new Voice = "bass"' in named
    assert instrument_voices(r'\new Voice = "chant" { \chantMusic }').count('"chant"') == 1


def test_read_score_rejects_unsafe_source_before_running_lilypond(tmp_path):
    source = tmp_path / "unsafe.ly"
    source.write_text('#(system "echo no")')
    assert read_score(source).flags


@pytest.mark.lilypond
def test_read_score_real_kyrie_preserves_four_independently_known_first_notes():
    from pipeline.typeset.lilypond import LilyPondError, find
    try:
        find()
    except LilyPondError:
        pytest.skip("pinned LilyPond not installed")
    result = read_score(Path("data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"))
    assert not result.flags
    first = {v: next(e for e in result.events if e.voice == v) for v in
             ("chant", "alto", "tenor", "bass")}
    assert {v: (e.step, e.alteration, e.duration) for v, e in first.items()} == {
        "chant": (2, Fraction(0), Fraction(1, 4)),
        "alto": (2, Fraction(0), Fraction(3, 2)),
        "tenor": (-3, Fraction(0), Fraction(3, 2)),
        "bass": (-5, Fraction(0), Fraction(3, 2)),
    }


@pytest.mark.lilypond
@pytest.mark.parametrize("notation", ["R1", r"\repeatTie"])
def test_read_score_flags_notation_that_listener_cannot_fully_compare(tmp_path, notation):
    from pipeline.typeset.lilypond import LilyPondError, find
    try:
        find()
    except LilyPondError:
        pytest.skip("pinned LilyPond not installed")
    source = tmp_path / "unsupported.ly"
    source.write_text(r'''\version "2.26.0"
\score { <<
  \new Staff <<
    \new Voice = "chant" { c'4 }
    \new Voice = "alto" { e'4 ''' + notation + r''' }
  >>
  \new Staff <<
    \new Voice = "tenor" { g4 }
    \new Voice = "bass" { c4 }
  >>
>> }
''')
    result = read_score(source)
    assert any("unsupported" in flag for flag in result.flags)
