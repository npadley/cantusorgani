"""The conversion-source audit: a text scan over tiny fake sources, plus the real catalogue."""

import shutil
from pathlib import Path

import pytest

from pipeline.typeset.lilypond import INCLUDE as REAL_INCLUDE
from pipeline.typeset.match import PARTS_FILE, SRC
from pipeline.typeset.mei.audit import audit_sources
from pipeline.typeset.mei.model import FEATURE_FAMILIES, PILOT_FIXTURES

HEADER = '\\version "2.26.0"\n\\include "gregorian.ly"\n\\include "noh2.ily"\n'


@pytest.fixture
def world(tmp_path: Path) -> tuple[Path, Path]:
    src = tmp_path / "data" / "typeset" / "src"
    inc = tmp_path / "data" / "typeset" / "include"
    src.mkdir(parents=True)
    inc.mkdir(parents=True)
    shutil.copy(REAL_INCLUDE / "noh2.ily", inc / "noh2.ily")
    return src, inc


def write(src: Path, name: str, body: str, header: str = HEADER) -> None:
    path = src / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + body, encoding="utf-8")


def test_dependency_change_changes_digest(world):
    src, inc = world
    write(src, "vol-1/a.ly", "a = { c'4 }\n")
    write(src, "vol-1/b.ly", "b = { d'4 }\n")
    before = audit_sources(src, [], inc)
    with (inc / "noh2.ily").open("a", encoding="utf-8") as fh:
        fh.write("\n% edited\n")
    after = audit_sources(src, [], inc)
    assert len(before.sources) == len(after.sources) == 2
    for old, new in zip(before.sources, after.sources, strict=True):
        assert old.path == new.path
        assert old.dependency_digest != new.dependency_digest


def test_absent_target_is_not_a_failure(world):
    src, inc = world
    write(src, "vol-1/a.ly", "a = { c'4 }\n")
    targets = [
        {"file": "vol-1/a.ly", "target": "piece:a", "status": "matched"},
        {"file": "vol-1/missing.ly", "target": "piece:gone", "status": "matched"},
    ]
    report = audit_sources(src, targets, inc)
    assert [s.path for s in report.sources] == ["vol-1/a.ly"]
    assert report.sources[0].target == "piece:a"
    assert report.sources[0].match_status == "matched"
    assert report.absent_targets == ("piece:gone",)
    assert report.sources[0].classification == "candidate"
    assert report.proposed_pilot == PILOT_FIXTURES


def test_unknown_include_reports_location(world):
    src, inc = world
    write(src, "vol-1/a.ly", "a = { c'4 }\n", header='\\version "2.26.0"\n\\include "other.ily"\n')
    record = audit_sources(src, [], inc).sources[0]
    [diag] = [d for d in record.diagnostics if d.code == "UNKNOWN_INCLUDE"]
    assert diag.severity == "error"
    assert diag.source_location is not None
    assert (diag.source_location.filename, diag.source_location.line, diag.source_location.column) \
        == ("data/typeset/src/vol-1/a.ly", 2, 1)
    assert diag.source_location.filename.startswith("data/typeset/src/")
    assert record.path == "vol-1/a.ly"
    assert record.includes == ("other.ily",)


def test_feature_text_scan(world):
    src, inc = world
    body = r'''
voiceLines = { c'4 }
% \quil in a comment is not counted
a = { \quil c'4 \quil d'4 \divisioMinima \quarterBar \divisioMaior \halfBar
  \divisioMaxima \singleBar \finalis \doubleBar \set stanza = "1." \forceBreak \break
  \change Staff = "down" e'4 }
\new Staff { \voiceLine "down" c'4 \voiceLine "up" d'4 }
\new Staff \new Voice { \voiceLines }
\new Voice { \hide Stem }
'''
    write(src, "vol-1/a.ly", body)
    record = audit_sources(src, [], inc).sources[0]
    f = record.features
    assert set(f) <= set(FEATURE_FAMILIES)
    assert f["quilisma"] == 2
    assert f["divisio-minima"] == 2
    assert f["divisio-maior"] == 2
    assert f["divisio-maxima"] == 2
    assert f["finalis"] == 2
    assert f["stanza-marker"] == 1
    assert f["force-break"] == 2
    assert f["cross-staff"] == 1
    assert f["voice-line-glissando"] == 2
    assert f["voice-line-voice"] == 1
    assert f["hidden-stem"] == 1
    assert record.staves == 2
    assert record.voices == 2
    assert record.classification == "candidate"


def test_unknown_commands_classify_unknown_feature(world):
    src, inc = world
    write(src, "vol-1/a.ly", "mine = { c'4 }\na = { \\mine \\mysteryThing c'4 }\n")
    write(src, "vol-1/b.ly", "b = { c'4 }\n")
    report = audit_sources(src, [], inc)
    by_path = {s.path: s for s in report.sources}
    assert by_path["vol-1/a.ly"].classification == "unknown-feature"
    assert by_path["vol-1/b.ly"].classification == "candidate"
    assert report.unknown_commands == {"mysteryThing": 1}


def test_real_repository_audit():
    import yaml

    targets = yaml.safe_load(PARTS_FILE.read_text(encoding="utf-8"))
    report = audit_sources(SRC, targets, REAL_INCLUDE)
    assert len(report.sources) == 859
    paths = {s.path for s in report.sources}
    assert set(PILOT_FIXTURES) <= paths
    assert report.proposed_pilot == PILOT_FIXTURES
    assert not any(d.code == "UNKNOWN_INCLUDE" for s in report.sources for d in s.diagnostics)
