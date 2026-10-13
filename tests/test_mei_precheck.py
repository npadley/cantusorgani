"""The automated pre-review (Kyrie IX checklist) on a real render of the approved pilot piece."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from pipeline.typeset.mei.cli import convert_command
from pipeline.typeset.mei.evidence import build_evidence, run_node_renderer
from pipeline.typeset.mei.precheck import _Page, precheck_packet

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


def _system_edge_split_tie_svg(tmp_path: Path, *, spanning: str | None = None,
                               counterpart: str | None = None, source: str | None = None,
                               continuation: str | None = None, intervening: str = "") -> Path:
    source = source if source is not None else '<g id="ev9" class="note"><g class="notehead"><use transform="translate(4700, 100)"/></g></g>'
    counterpart = counterpart if counterpart is not None else '<g id="ev9c2-tie" class="tie split-tie"><path d="M4700,100 C4750,0 4850,0 4900,100"/></g>'
    spanning = spanning if spanning is not None else '<g class="tie id-ev9c2-tie spanning split-tie"><path d="M1477,100 C1499,0 1543,0 1565,100"/></g>'
    continuation = continuation if continuation is not None else '<g id="ev9c2" class="note split-continuation"><g class="notehead"><use transform="translate(1610, 100)"/></g></g>'
    svg = tmp_path / "edge.svg"
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg">'
        '<g class="system"><g class="staff"><path d="M0 0 L5000 0"/></g>' + source + counterpart + '</g>'
        + intervening +
        '<g class="system"><g class="staff"><path d="M270 0 L5000 0"/></g>'
        + continuation + spanning + '</g></svg>', encoding="utf-8",
    )
    return svg


def test_precheck_accepts_drawn_split_tie_continuation_at_its_own_system_edge(tmp_path: Path) -> None:
    page = _Page(_system_edge_split_tie_svg(tmp_path))
    assert page.stubs == []


@pytest.mark.parametrize("mutation", [
    "no-counterpart", "malformed-counterpart", "displaced-counterpart", "no-source",
    "distant-endpoint", "giant-spanning-control", "wrong-target-class", "skipped-system",
    "interior", "not-split-tie", "ordinary-tie",
])
def test_precheck_keeps_short_arc_gate_when_split_tie_proof_is_missing(tmp_path: Path, mutation: str) -> None:
    kwargs: dict[str, str] = {}
    if mutation == "no-counterpart":
        kwargs["counterpart"] = ""
    elif mutation == "malformed-counterpart":
        kwargs["counterpart"] = '<g id="ev9c2-tie" class="tie split-tie"><path d="M-2147468953,100 C1610627456,0 536885696,0 4900,100"/></g>'
    elif mutation == "displaced-counterpart":
        kwargs["counterpart"] = '<g id="ev9c2-tie" class="tie split-tie"><path d="M4000,100 C4100,0 4200,0 4300,100"/></g>'
    elif mutation == "no-source":
        kwargs["source"] = ""
    elif mutation == "distant-endpoint":
        kwargs["continuation"] = '<g id="ev9c2" class="note split-continuation"><g class="notehead"><use transform="translate(2500, 100)"/></g></g>'
    elif mutation == "giant-spanning-control":
        kwargs["spanning"] = '<g class="tie id-ev9c2-tie spanning split-tie"><path d="M1477,100 C1499,9999999 1543,0 1565,100"/></g>'
    elif mutation == "wrong-target-class":
        kwargs["continuation"] = '<g id="ev9c2" class="note"><g class="notehead"><use transform="translate(1610, 100)"/></g></g>'
    elif mutation == "skipped-system":
        kwargs["intervening"] = '<g class="system"><g class="staff"><path d="M0 0 L5000 0"/></g></g>'
    elif mutation == "interior":
        kwargs["spanning"] = '<g class="tie id-ev9c2-tie spanning split-tie"><path d="M3000,100 C3020,0 3060,0 3080,100"/></g>'
    elif mutation == "not-split-tie":
        kwargs["spanning"] = '<g class="tie id-ev9c2-tie spanning"><path d="M1477,100 C1499,0 1543,0 1565,100"/></g>'
    else:
        kwargs["spanning"] = '<g class="tie"><path d="M1477,100 C1499,0 1543,0 1565,100"/></g>'
    assert _Page(_system_edge_split_tie_svg(tmp_path, **kwargs)).stubs


def test_precheck_cached_exaudi_malformed_source_tie_stays_blocking() -> None:
    svg = ROOT / "build/catalogue/efa7e3cce8baa2d30b97885d3703df2b88a9d699f810fe9a108d6d7ccba5c66d/evidence/cases/custom-160x230-auto/custom-160x230-auto-p1.svg"
    if not svg.exists():
        pytest.skip("cached real render unavailable")
    page = _Page(svg)
    assert any("id-ev1e0057c2-tie" in stub for stub in page.stubs)


def test_precheck_fresh_exaudi_split_tie_is_a_system_edge_piece() -> None:
    svg = ROOT / "build/p5-rerenders/efa7e3cce8baa2d30b97885d3703df2b88a9d699f810fe9a108d6d7ccba5c66d/evidence/cases/custom-160x230-auto/custom-160x230-auto-p1.svg"
    if not svg.exists():
        pytest.skip("fresh P5 render unavailable")
    page = _Page(svg)
    assert not any("id-ev1e0057c2-tie" in stub for stub in page.stubs)
