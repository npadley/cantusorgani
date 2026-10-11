"""Card C5: include_sha256 covers only the .ily files a source loads, transitively."""

from __future__ import annotations

import hashlib
from pathlib import Path

from pipeline.typeset import lilypond
from pipeline.typeset.mei.includes import include_closure, include_digest, included_names


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_included_names_ignores_comments_and_strings() -> None:
    text = (
        '\\version "2.26.0"\n'
        '\\include "a.ily"  % \\include "line-comment.ily"\n'
        '%{ \\include "block-comment.ily" %}\n'
        'lyr = "\\include \\"quoted.ily\\" 100%"\n'
        '\\include "b.ily"\n'
    )
    assert included_names(text) == ["a.ily", "b.ily"]


def test_include_closure_follows_nested_includes_once(tmp_path: Path) -> None:
    inc = tmp_path / "include"
    write(inc / "top.ily", '\\include "mid.ily"\n\\include "leaf.ily"\n')
    write(inc / "mid.ily", '\\include "leaf.ily"\n')
    write(inc / "leaf.ily", "x = 1\n")
    write(inc / "unused.ily", "y = 2\n")
    src = write(tmp_path / "src" / "s.ly", '\\include "top.ily"\n')
    names = [p.name for p in include_closure(src, inc)]
    assert names == ["leaf.ily", "mid.ily", "top.ily"]


def test_include_closure_skips_builtin_files_and_survives_cycles(tmp_path: Path) -> None:
    inc = tmp_path / "include"
    write(inc / "a.ily", '\\include "b.ily"\n')
    write(inc / "b.ily", '\\include "a.ily"\n\\include "gregorian.ly"\n')
    src = write(tmp_path / "s.ly", '\\include "gregorian.ly"\n\\include "a.ily"\n')
    assert [p.name for p in include_closure(src, inc)] == ["a.ily", "b.ily"]


def test_include_closure_prefers_file_next_to_the_includer(tmp_path: Path) -> None:
    inc = tmp_path / "include"
    write(inc / "n.ily", "shared = 1\n")
    local = write(tmp_path / "src" / "n.ily", "local = 1\n")
    src = write(tmp_path / "src" / "s.ly", '\\include "n.ily"\n')
    assert include_closure(src, inc) == [local]


def test_include_digest_ignores_files_the_source_does_not_load(tmp_path: Path) -> None:
    inc = tmp_path / "include"
    write(inc / "used.ily", "u = 1\n")
    other = write(inc / "other.ily", "o = 1\n")
    src = write(tmp_path / "s.ly", '\\include "used.ily"\n')
    before = include_digest(src, inc)
    other.write_text("o = 2\n", encoding="utf-8")
    assert include_digest(src, inc) == before
    (inc / "used.ily").write_text("u = 2\n", encoding="utf-8")
    assert include_digest(src, inc) != before


def test_include_digest_hashes_name_nul_text_nul_in_name_order(tmp_path: Path) -> None:
    inc = tmp_path / "include"
    write(inc / "b.ily", "b\n")
    write(inc / "a.ily", "a\n")
    src = write(tmp_path / "s.ly", '\\include "b.ily"\n\\include "a.ily"\n')
    expected = hashlib.sha256(b"a.ily\0a\n\0b.ily\0b\n\0").hexdigest()
    assert include_digest(src, inc) == expected


def test_include_closure_on_real_sources_is_narrower_than_the_include_directory() -> None:
    source = lilypond.ROOT / "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"
    names = [p.name for p in include_closure(source, lilypond.INCLUDE)]
    assert names == ["noh2.ily"]
    assert {p.name for p in lilypond.INCLUDE.glob("*.ily")} > set(names)


def test_include_closure_on_real_sources_stays_inside_the_include_directory() -> None:
    sources = sorted((lilypond.ROOT / "data/typeset/src").rglob("*.ly"))
    assert sources
    for source in sources[::40]:
        for path in include_closure(source, lilypond.INCLUDE):
            assert path.parent == lilypond.INCLUDE, (source, path)
