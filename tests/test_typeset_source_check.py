"""The source check: Scheme or commands that reach outside the music are refused
before LilyPond reads a file; the transcriptions' ordinary Scheme is not."""

import pytest

from pipeline.typeset.source_check import check, scheme_regions

OURS = frozenset({"noh.ily", "noh2.ily", "listen.ily"})

TRANSCRIPTION = r'''\version "2.26.0"
\include "gregorian.ly"
\include "noh2.ily"
\paper { #(include-special-characters) }
global = { \key d \dorian \cadenzaOn }
shiftRight = { \once \override NoteColumn.force-hshift = #0.9 }
glis = #(define-music-function (pa pb) (ly:pitch? ly:pitch?)
  #{ \once \override Glissando.style = #'dotted-line $pa $pb #})
chantText = \lyricmode { Ex -- it se -- mi -- nans; ac -- cé -- pit sy -- stem -- a }
'''


def test_check_a_real_transcription_passes():
    assert check(TRANSCRIPTION, OURS) == []


@pytest.mark.parametrize(("line", "found"), [
    ('#(system "curl evil")', "`system`"),
    ('#(ly:system (list "rm" "-rf" "/"))', "`ly:system`"),
    ("#(define p (open-input-file \"/etc/passwd\"))", "`open-input-file`"),
    ("$(eval-string \"(system 1)\")", "`eval-string`"),
    ("#(load \"x.scm\")", "`load`"),
    ("#(getenv \"R2_SECRET_ACCESS_KEY\")", "`getenv`"),
    ("#(ly:set-option 'safe #f)", "`ly:set-option`"),
    ("x = #ly:gulp-file", "`ly:gulp-file`"),
])
def test_check_scheme_that_reaches_outside_is_refused_with_its_line(line, found):
    problems = check(f"\\version \"2.26.0\"\n{line}\n", OURS)
    assert problems and problems[0].line == 2
    assert found in problems[0].message


def test_check_scheme_spread_over_lines_is_still_searched():
    text = "#(define (f)\n  (let ((x 1))\n    (primitive-load \"a\")))\n"
    assert [(p.line, "primitive-load" in p.message) for p in check(text, OURS)] == [(3, True)]


def test_check_scheme_inside_embedded_lilypond_is_searched():
    text = "m = #(define-music-function () ()\n  #{ c'4 $(system \"x\") #})\n"
    assert any("`system`" in p.message for p in check(text, OURS))


@pytest.mark.parametrize(("line", "why"), [
    ('\\include "../../secrets.ly"', "not one of our include files"),
    ('\\include "/etc/passwd"', "not one of our include files"),
    ('\\markup \\verbatim-file "/etc/hosts"', "reads or writes files"),
    ('\\markup \\image #X #2 "x.png"', "reads or writes files"),
    ('\\bookOutputName "../../web/public/x"', "reads or writes files"),
])
def test_check_includes_and_file_commands_are_refused(line, why):
    assert why in check(line, OURS)[0].message


def test_check_comments_and_strings_do_not_count():
    text = ('% #(system "x")\n%{ #(ly:system "y") %}\n'
            'title = "50% of #(system)"\n\\markup "a ; b"\n')
    assert check(text, OURS) == []


def test_check_lyrics_are_never_searched_for_scheme_words():
    assert check("\\lyricmode { exit ac -- cé -- pit load o -- pen }\n", OURS) == []


def test_scheme_regions_balance_parentheses_across_comments():
    text = '#(a ; )\n b) rest'
    [(start, end)] = scheme_regions(text)
    assert text[start:end] == '#(a ; )\n b)'


def test_shared_typescript_fixtures():
    import json
    from pathlib import Path
    fixtures = json.loads((Path(__file__).parent / "fixtures/typeset-source-check.json").read_text())
    for fixture in fixtures:
        actual = [{"line": p.line, "message": p.message} for p in check(fixture["text"], frozenset(fixture["includes"]))]
        assert actual == fixture["problems"], fixture["name"]


def test_shared_source_rules_are_current():
    import json
    from pathlib import Path

    from pipeline.typeset.source_check import DENIED, DENIED_COMMANDS, LILYPOND_INCLUDES
    rules = json.loads((Path(__file__).parents[1] / "data/schema/typeset-source-check.json").read_text())
    assert sorted(DENIED) == rules["denied"]
    assert sorted(DENIED_COMMANDS) == rules["commands"]
    assert sorted(LILYPOND_INCLUDES) == rules["lilypondIncludes"]
