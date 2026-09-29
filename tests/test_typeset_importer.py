"""Importing the upstream transcriptions: files land in our tree, the record
says where they came from, and a file edited here is never overwritten."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

import pytest
import yaml

from pipeline.typeset import importer
from pipeline.typeset.importer import UpstreamError, destination, import_files, our_include, unpack

COMMIT = "bc6388ad215d1da1ad5633469b56664791b3bd36"
KYRIE = '\\version "2.18.0"\n\\include "gregorian.ly"\n\\include "noh2.ily"\nchantMusic = { c\'4 d\' }\n'
NOH2 = "divisioMinima = { }\n#(ly:set-option 'compile-scheme-code)\n#(debug-enable 'backtrace)\nx = 1\n"


def tarball(files: dict[str, str], top: str = "nova-organi-harmonia-bc6388a") -> bytes:
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as tar:
        for path, text in files.items():
            body = text.encode()
            info = tarfile.TarInfo(f"{top}/{path}")
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return data.getvalue()


def upstream(**changes: str) -> dict[str, bytes]:
    files = {"noh2.ily": NOH2, "noh.ily": "% chant marks\n", "volume-5/missa-ix/kyrie_IX.ly": KYRIE,
             "volume-1/in_ad_te_levavi.csv.ly": KYRIE, "build.sh": "lilypond\n", "volume-5.sla": "<x/>",
             **changes}
    return unpack(tarball(files))


@pytest.fixture
def tree(tmp_path: Path) -> dict[str, Path]:
    return {"src": tmp_path / "src", "include": tmp_path / "include", "record_path": tmp_path / "UPSTREAM.yml"}


def test_unpack_keeps_only_the_volumes_and_the_shared_includes():
    assert sorted(upstream()) == ["noh.ily", "noh2.ily", "volume-1/in_ad_te_levavi.csv.ly",
                                  "volume-5/missa-ix/kyrie_IX.ly"]


def test_unpack_refuses_paths_that_climb_out():
    assert unpack(tarball({"volume-1/../../evil.ly": "x"})) == {}


def test_destination_maps_volumes_and_includes(tree):
    assert destination("volume-5/missa-ix/kyrie_IX.ly", tree["src"], tree["include"]) == \
        tree["src"] / "vol-5" / "missa-ix" / "kyrie_IX.ly"
    assert destination("noh2.ily", tree["src"], tree["include"]) == tree["include"] / "noh2.ily"


def test_our_include_drops_the_debugging_settings():
    assert our_include(NOH2) == "divisioMinima = { }\nx = 1\n"


def test_import_files_writes_the_tree_and_the_record(tree):
    report = import_files(upstream(), COMMIT, None, **tree)
    assert len(report.added) == 4 and report.refused == {}
    assert (tree["src"] / "vol-5" / "missa-ix" / "kyrie_IX.ly").read_text() == KYRIE
    record = yaml.safe_load(tree["record_path"].read_text())
    assert record["commit"] == COMMIT and record["repo"] == "joeegan2202/nova-organi-harmonia"
    assert "Joe Egan" in record["credit"]
    entry = record["files"]["volume-5/missa-ix/kyrie_IX.ly"]
    assert entry["upstream"] == entry["imported"] == importer.sha256(KYRIE.encode())
    assert tree["record_path"].read_text().startswith("# Where data/typeset/ came from")


def test_import_files_again_keeps_an_edited_file_and_reports_a_conflict(tree):
    import_files(upstream(), COMMIT, None, **tree)
    edited = tree["src"] / "vol-5" / "missa-ix" / "kyrie_IX.ly"
    edited.write_text(KYRIE + "% proofread\n")
    changed = KYRIE.replace("d'", "e'")
    report = import_files(upstream(**{"volume-5/missa-ix/kyrie_IX.ly": changed,
                                      "volume-1/in_ad_te_levavi.csv.ly": changed}), "f" * 40, None, **tree)
    assert report.kept == ["volume-5/missa-ix/kyrie_IX.ly"]
    assert report.conflicts == ["volume-5/missa-ix/kyrie_IX.ly"]
    assert edited.read_text() == KYRIE + "% proofread\n"
    assert report.updated == ["volume-1/in_ad_te_levavi.csv.ly"]
    assert (tree["src"] / "vol-1" / "in_ad_te_levavi.csv.ly").read_text() == changed
    assert any("merge by hand" in line for line in report.lines())


def test_import_files_unchanged_upstream_leaves_everything(tree):
    import_files(upstream(), COMMIT, None, **tree)
    report = import_files(upstream(), COMMIT, None, **tree)
    assert report.added == report.updated == [] and len(report.unchanged) == 4


def test_import_files_keeps_a_file_added_by_hand(tree):
    hand = tree["src"] / "vol-1" / "in_ad_te_levavi.csv.ly"
    hand.parent.mkdir(parents=True)
    hand.write_text("% typeset here\n")
    report = import_files(upstream(), COMMIT, None, **tree)
    assert "volume-1/in_ad_te_levavi.csv.ly" in report.kept
    assert hand.read_text() == "% typeset here\n"


def test_import_files_leaves_out_empty_placeholders(tree):
    report = import_files(upstream(**{"volume-3/al_quam_magna.csv.ly": "\n"}), COMMIT, None, **tree)
    assert report.empty == ["volume-3/al_quam_magna.csv.ly"]
    assert not (tree["src"] / "vol-3").exists()
    assert "1 empty placeholder(s) upstream, not imported" in report.lines()[-1]


def test_import_files_reports_what_the_source_check_refuses(tree):
    report = import_files(upstream(**{"volume-1/in_ad_te_levavi.csv.ly": '#(system "x")\n'}), COMMIT, None, **tree)
    assert "volume-1/in_ad_te_levavi.csv.ly" in report.refused


def test_fetch_refuses_a_branch_name():
    with pytest.raises(UpstreamError, match="full 40-character commit"):
        importer.fetch("master")


@pytest.mark.lilypond
def test_import_files_converts_to_the_pinned_lilypond(tree):
    from pipeline.typeset.lilypond import load_pin, tool
    report = import_files(upstream(), COMMIT, tool("convert-ly"), **tree)
    assert report.not_converted == {}
    text = (tree["src"] / "vol-5" / "missa-ix" / "kyrie_IX.ly").read_text()
    assert f'\\version "{load_pin().version}"' in text
