"""`noh typeset-check`: sources pass the source check, and parts.yml covers
exactly the sources with targets that exist."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.typeset.check import problems
from tests.test_typeset_match import catalog


@pytest.fixture
def tree(tmp_path: Path) -> dict[str, Path]:
    src = tmp_path / "data" / "typeset" / "src"
    include = tmp_path / "data" / "typeset" / "include"
    (src / "vol-5" / "missa-ix").mkdir(parents=True)
    include.mkdir(parents=True)
    (src / "vol-5" / "missa-ix" / "kyrie_IX.ly").write_text('\\include "noh2.ily"\n')
    (src / "vol-5" / "missa-ix" / "gloria_IX.ly").write_text('\\include "noh2.ily"\n')
    (include / "noh2.ily").write_text("x = 1\n")
    (tmp_path / "catalog.json").write_text(json.dumps(catalog()))
    parts = tmp_path / "parts.yml"
    parts.write_text("- {file: vol-5/missa-ix/kyrie_IX.ly, target: 'movement:ordinarium-missae-ix/kyrie', status: matched}\n"
                     "- {file: vol-5/missa-ix/gloria_IX.ly, target: null, status: proposed}\n")
    return {"src": src, "include": include, "parts": parts, "catalog_path": tmp_path / "catalog.json"}


def test_problems_a_sound_tree_has_none(tree):
    assert problems(**tree) == []


def test_problems_the_committed_typeset_data_is_sound():
    assert problems() == []


def test_problems_a_source_the_check_refuses_is_named(tree):
    (tree["include"] / "noh2.ily").write_text("#(ly:set-option 'safe #f)\n")
    assert problems(**tree) == [("data/typeset/include/noh2.ily: line 1: Scheme `ly:set-option` reaches outside "
                                 "the music, so it is not allowed")]


def test_problems_files_and_entries_must_agree(tree):
    (tree["src"] / "vol-5" / "missa-ix" / "sanctus_IX.ly").write_text("x\n")
    (tree["src"] / "vol-5" / "missa-ix" / "gloria_IX.ly").unlink()
    found = problems(**tree)
    assert "parts.yml: vol-5/missa-ix/gloria_IX.ly has no source file in data/typeset/src/" in found
    assert "parts.yml: vol-5/missa-ix/sanctus_IX.ly has no entry; run `uv run noh typeset-match`" in found


def test_problems_unknown_target_status_and_double_match(tree):
    tree["parts"].write_text(
        "- {file: vol-5/missa-ix/kyrie_IX.ly, target: 'movement:ordinarium-missae-ix/kyrie', status: matched}\n"
        "- {file: vol-5/missa-ix/gloria_IX.ly, target: 'movement:ordinarium-missae-ix/kyrie', status: matched}\n")
    assert problems(**tree) == ["parts.yml: 2 files are matched to movement:ordinarium-missae-ix/kyrie; keep one"]
    tree["parts"].write_text(
        "- {file: vol-5/missa-ix/kyrie_IX.ly, target: 'part:gone/introit', status: done}\n"
        "- {file: vol-5/missa-ix/gloria_IX.ly, target: null, status: matched}\n")
    found = problems(**tree)
    assert any("status 'done'" in p for p in found)
    assert any("names part:gone/introit, which is not in the catalogue" in p for p in found)
    assert "parts.yml: vol-5/missa-ix/gloria_IX.ly is matched to nothing" in found
