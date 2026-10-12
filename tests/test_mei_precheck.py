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
def test_precheck_packet_kyrie_is_clean(tmp_path: Path) -> None:
    if shutil.which("node") is None or not (WEB / "node_modules" / "verovio").is_dir():
        pytest.skip("node or web/node_modules is missing")
    assert convert_command(SOURCE, tmp_path / "kyrie", _Runner(), tmp_path / "build") == 0
    build_evidence(
        tmp_path / "kyrie", None, tmp_path / "kyrie" / "evidence", node_runner=run_node_renderer,
        lilypond_svg=lambda _s, _w: None, scan_images=lambda _t: [],
    )
    findings = precheck_packet(tmp_path / "kyrie")
    assert len(findings) == 14  # the piece plus the 13 required cases
    assert {k: v for k, v in findings.items() if v} == {}


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


def _kyrie_packet(tmp_path: Path) -> Path:
    if shutil.which("node") is None or not (WEB / "node_modules" / "verovio").is_dir():
        pytest.skip("node or web/node_modules is missing")
    assert convert_command(SOURCE, tmp_path / "kyrie", _Runner(), tmp_path / "build") == 0
    build_evidence(
        tmp_path / "kyrie", None, tmp_path / "kyrie" / "evidence", node_runner=run_node_renderer,
        lilypond_svg=lambda _s, _w: None, scan_images=lambda _t: [],
    )
    return tmp_path / "kyrie"


def test_precheck_packet_flags_a_finalis_drawn_as_a_single_bar(tmp_path: Path) -> None:
    import re

    packet = _kyrie_packet(tmp_path)
    svg = packet / "evidence" / "cases" / "letter-p-orig" / "letter-p-orig-p1.svg"
    text = svg.read_text(encoding="utf-8")
    # Drop the second stroke of every double bar: each "M x y L x y" whose x is 99 units right of another.
    strokes = re.findall(r'<path d="M(\d+) (\d+) L\1 (\d+)"[^>]*/>', text)
    by_y: dict[tuple[str, str], list[str]] = {}
    for x, y1, y2 in strokes:
        by_y.setdefault((y1, y2), []).append(x)
    ordered = {y: sorted(xs, key=int) for y, xs in by_y.items() if len(xs) >= 2}
    doubled = [(y, xs) for y, xs in ordered.items() if 90 <= int(xs[1]) - int(xs[0]) <= 110]
    assert doubled, "no double bar found in the Kyrie render"
    for (y1, y2), xs in doubled:
        text = re.sub(rf'<path d="M{xs[1]} {y1} L{xs[1]} {y2}"[^>]*/>', "", text)
    svg.write_text(text, encoding="utf-8")
    findings = precheck_packet(packet)
    assert any("bar line" in f for f in findings["letter-p-orig"])


def test_precheck_packet_flags_a_required_case_that_was_never_laid_out(tmp_path: Path) -> None:
    packet = _kyrie_packet(tmp_path)
    shutil.rmtree(packet / "evidence" / "cases" / "a5-l-orig")
    assert "case was not laid out" in precheck_packet(packet)["a5-l-orig"][0]


def _inject(tmp_path: Path, markup: str) -> dict[str, list[str]]:
    packet = _kyrie_packet(tmp_path)
    svg = packet / "evidence" / "cases" / "letter-p-orig" / "letter-p-orig-p1.svg"
    text = svg.read_text(encoding="utf-8")
    svg.write_text(text[: text.rindex("</svg>")] + markup + "</svg>", encoding="utf-8")
    return precheck_packet(packet)


@pytest.mark.slow
def test_precheck_flags_a_ledger_line_with_no_head_on_it(tmp_path: Path) -> None:
    findings = _inject(tmp_path, '<g class="ledgerLines below"><path d="M100 99999 L400 99999" stroke-width="22"/></g>')
    assert any(f.startswith("ledger:") for f in findings["letter-p-orig"])


@pytest.mark.slow
def test_precheck_flags_a_revealed_continuation_that_draws_a_stem(tmp_path: Path) -> None:
    markup = '<g id="ev9c1" class="note split-continuation"><g class="notehead"><use transform="translate(10, 10)"/></g><g class="stem"/></g>'
    findings = _inject(tmp_path, markup)
    assert any(f.startswith("stem:") and "ev9c1" in f for f in findings["letter-p-orig"])


@pytest.mark.slow
def test_precheck_flags_a_tie_stub_in_mid_system(tmp_path: Path) -> None:
    findings = _inject(tmp_path, '<g class="tie"><path d="M5000,100 C5020,50 5060,50 5080,100"/></g>')
    assert any(f.startswith("arc:") for f in findings["letter-p-orig"])
