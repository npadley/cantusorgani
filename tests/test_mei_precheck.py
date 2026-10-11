"""The automated pre-review (Kyrie IX checklist) on a real render of the approved pilot piece."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from pipeline.typeset.mei.cli import convert_command
from pipeline.typeset.mei.evidence import build_evidence, run_node_renderer
from pipeline.typeset.mei.precheck import precheck_packet

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"
WEB = ROOT / "web"


class _Runner:
    version = "2.26.0"

    def run(self, args, cwd, includes, timeout):
        shutil.copy(ROOT / "tests/fixtures/mei/extraction/kyrie_IX.tsv", cwd / "out.listen.tsv")
        return True, ""


@pytest.mark.slow
def test_precheck_packet_kyrie_findings_are_only_the_known_page_break_tie(tmp_path: Path) -> None:
    if shutil.which("node") is None or not (WEB / "node_modules" / "verovio").is_dir():
        pytest.skip("node or web/node_modules is missing")
    assert convert_command(SOURCE, tmp_path / "kyrie", _Runner(), tmp_path / "build") == 0
    build_evidence(
        tmp_path / "kyrie", None, tmp_path / "kyrie" / "evidence", node_runner=run_node_renderer,
        lilypond_svg=lambda _s, _w: None, scan_images=lambda _t: [],
    )
    findings = precheck_packet(tmp_path / "kyrie")
    assert len(findings) == 14  # the piece plus the 13 required cases
    # The only finding is a known Verovio limitation: a tie across a PAGE break is not fully drawn
    # (one tie, in the four matrix cases that break the part across pages). Everything else must be clean.
    found = {k: v for k, v in findings.items() if v}
    assert all("crosses a page break" in f for fs in found.values() for f in fs), found
    assert len(found) == 4


def test_precheck_packet_flags_a_tie_that_is_not_drawn(tmp_path: Path) -> None:
    if shutil.which("node") is None or not (WEB / "node_modules" / "verovio").is_dir():
        pytest.skip("node or web/node_modules is missing")
    assert convert_command(SOURCE, tmp_path / "kyrie", _Runner(), tmp_path / "build") == 0
    build_evidence(
        tmp_path / "kyrie", None, tmp_path / "kyrie" / "evidence", node_runner=run_node_renderer,
        lilypond_svg=lambda _s, _w: None, scan_images=lambda _t: [],
    )
    case = tmp_path / "kyrie" / "evidence" / "cases" / "letter-p-orig"
    svg = case / "letter-p-orig-p1.svg"
    svg.write_text(svg.read_text(encoding="utf-8").replace('class="tie"', 'class="nothing"'), encoding="utf-8")
    findings = precheck_packet(tmp_path / "kyrie")
    assert any("no piece" in f for f in findings["letter-p-orig"])
