"""Card A5b/A5c: the review evidence packet and its geometry flags."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline.typeset.mei.cli import convert_command, evidence_command
from pipeline.typeset.mei.diagnostics import Diagnostic
from pipeline.typeset.mei.evidence import (
    EvidenceError,
    build_evidence,
    geometry_findings,
    run_node_renderer,
)
from pipeline.typeset.mei.manifest import current_inputs_from_files
from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    EvidencePacket,
    LayoutCase,
    ValidationReport,
)
from pipeline.typeset.mei.review import state_for

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"
KYRIE_TSV = ROOT / "tests/fixtures/mei/extraction/kyrie_IX.tsv"
TARGET = "movement:ordinarium-missae-ix/kyrie"
WEB = ROOT / "web"

CLEAN_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500">'
    '<svg class="definition-scale" viewBox="0 0 10000 5000"><g class="page-margin" transform="translate(0, 0)">'
    '<g class="system"><g class="note"><g class="note bounding-box"><rect x="100" y="100" width="200" height="200"/></g></g></g>'
    "</g></svg></svg>"
)


def _svg(body: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500">'
        '<svg class="definition-scale" viewBox="0 0 10000 5000"><g class="page-margin" transform="translate(0, 0)">'
        f'<g class="system">{body}</g></g></svg></svg>'
    )


CLIPPED_SVG = _svg(
    '<g class="note"><g class="note bounding-box"><rect x="9900" y="100" width="300" height="200"/></g></g>'
)
GAP = {"page": 1, "a": "son.", "b": "Chri"}


class _Runner:
    version = "2.26.0"

    def run(self, args, cwd, includes, timeout):
        shutil.copy(KYRIE_TSV, cwd / "out.listen.tsv")
        return True, ""


@pytest.fixture(scope="module")
def converted(tmp_path_factory: pytest.TempPathFactory) -> Path:
    base = tmp_path_factory.mktemp("convert")
    assert convert_command(SOURCE, base / "kyrie", _Runner(), base / "build") == 0
    return base / "kyrie"


def fake_runner(svg_for: dict[str, str] | None = None, default: str = CLEAN_SVG, gaps: dict[str, list[dict]] | None = None):
    """A node runner that writes canned SVGs for every requested case."""
    calls: list[tuple[Path, list[LayoutCase], Path, Path | None]] = []

    def run(mei: Path, cases: list[LayoutCase], out: Path, boundaries: Path | None) -> None:
        calls.append((mei, cases, out, boundaries))
        results = []
        for case in cases:
            folder = out / case.id
            folder.mkdir(parents=True, exist_ok=True)
            name = f"{case.id}-p1.svg"
            svg = (svg_for or {}).get(case.id, default)
            (folder / name).write_text(svg, encoding="utf-8")
            results.append({
                "id": case.id, "pageCount": 1, "systemsPerPage": [1], "systemCount": 1,
                "staffHeightMm": 7.2, "expectedStaffHeightMm": 7.2, "pageWidthMm": 215.9, "pageHeightMm": 279.4,
                "marginMm": 12, "contentWidthMm": 100.0, "contentHeightMm": 50.0,
                "files": [f"{case.id}/{name}"], "lyricGaps": (gaps or {}).get(case.id, []), "diagnostics": [],
            })
        (out / "cases.json").write_text(json.dumps({"verovio": "6.3.0-test", "cases": results}), encoding="utf-8")

    run.calls = calls  # type: ignore[attr-defined]
    return run


def no_original(_source: str, _work: Path) -> Path | None:
    return None


def no_scans(_target: str | None) -> list[Path]:
    return []


def build(converted: Path, tmp_path: Path, runner=None, record: ConversionRecord | None = None, **kw) -> EvidencePacket:
    return build_evidence(
        converted, record, tmp_path / "evidence",
        node_runner=runner or fake_runner(), lilypond_svg=kw.pop("lilypond_svg", no_original),
        scan_images=kw.pop("scan_images", no_scans), **kw,
    )


def html_of(packet: EvidencePacket) -> str:
    return packet.index_html.read_text(encoding="utf-8")


def record_for(converted: Path, diagnostics: tuple[Diagnostic, ...] = ()) -> ConversionRecord:
    sha = hashlib.sha256((converted / "score.mei").read_bytes()).hexdigest()
    skeleton = ConversionInputs("", "", "2.26.0", "listen_full/1", "c1", "accompaniment-v1", "", "", "6.3.0", "f")
    base = ConversionRecord(
        source_path="data/typeset/src/vol-5/missa-ix/kyrie_IX.ly", target=TARGET, render_hash="a" * 32,
        state="needs-review", inputs=skeleton, artifact_sha256=sha,
        diagnostics=diagnostics,
        validation=ValidationReport(True, (), (), True, {"x": "y"}, {"lilypond": "2.26.0"}), review=None,
    )
    return dataclasses.replace(base, inputs=current_inputs_from_files(base))


# --- the packet ---------------------------------------------------------------------------------


def test_build_evidence_fake_renderer_lists_all_thirteen_cases(converted: Path, tmp_path: Path) -> None:
    packet = build(converted, tmp_path)
    page = html_of(packet)
    assert [c.id for c in REQUIRED_MATRIX] == list(packet.cases)
    assert len(packet.cases) == 13
    for case in REQUIRED_MATRIX:
        assert f'id="case-{case.id}"' in page
        assert packet.cases[case.id].is_file()
    assert packet.index_html == tmp_path / "evidence" / "index.html"


def test_build_evidence_runner_receives_exactly_the_required_matrix_and_boundaries(converted: Path, tmp_path: Path) -> None:
    runner = fake_runner()
    build(converted, tmp_path, runner)
    ((mei, cases, _out, boundaries),) = runner.calls
    assert mei == converted / "score.mei" and boundaries == converted / "boundaries.json"
    assert tuple(cases) == REQUIRED_MATRIX


def test_build_evidence_header_carries_every_digest_and_tool_version(converted: Path, tmp_path: Path) -> None:
    record = record_for(converted)
    page = html_of(build(converted, tmp_path, record=record))
    for value in (
        record.inputs.source_sha256, record.inputs.include_sha256, record.inputs.profile_sha256,
        record.inputs.schema_sha256, record.inputs.digest(), record.artifact_sha256,
    ):
        assert value and value in page
    for text in ("data/typeset/src/vol-5/missa-ix/kyrie_IX.ly", TARGET, "listen_full/1", "2.26.0", "6.3.0-test"):
        assert text in page


def test_build_evidence_default_output_folder_is_keyed_by_the_inputs_digest(converted: Path, tmp_path: Path) -> None:
    record = record_for(converted)
    packet = build_evidence(
        converted, record, None, build_root=tmp_path / "build",
        node_runner=fake_runner(), lilypond_svg=no_original, scan_images=no_scans,
    )
    assert packet.directory == tmp_path / "build" / record.inputs.digest() / "evidence"


def test_build_evidence_without_a_record_derives_inputs_from_the_files_and_validates(converted: Path, tmp_path: Path) -> None:
    page = html_of(build(converted, tmp_path))
    assert TARGET in page  # looked up in data/typeset/manifest.json, never inferred
    assert "Schema: valid" in page
    assert "Semantic differences: 0" in page
    assert "Eligible: yes" in page
    assert re.search(r"source_sha256</th><td>[0-9a-f]{64}<", page)


def test_build_evidence_lists_the_diagnostics(converted: Path, tmp_path: Path) -> None:
    diagnostic = Diagnostic("UNSUPPORTED_FEATURE", "warning", "synthetic diagnostic for the packet")
    page = html_of(build(converted, tmp_path, record=record_for(converted, (diagnostic,))))
    assert "UNSUPPORTED_FEATURE" in page and "synthetic diagnostic for the packet" in page


def test_build_evidence_page_is_self_contained(converted: Path, tmp_path: Path) -> None:
    original = tmp_path / "original.svg"
    original.write_text(CLEAN_SVG.replace("viewBox", 'width="539" height="697" viewBox', 1), encoding="utf-8")
    scan = tmp_path / "scan.png"
    scan.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 32)
    page = html_of(build(converted, tmp_path, lilypond_svg=lambda _s, _w: original, scan_images=lambda _t: [scan]))
    assert "http" not in page.lower()
    assert "<script" not in page.lower() and "<link" not in page.lower()
    assert not re.findall(r'(?:src|href)="(?!data:|#)', page)
    assert "LilyPond original" in page and "Scan" in page


def test_build_evidence_missing_original_and_scan_are_stated_per_case(converted: Path, tmp_path: Path) -> None:
    page = html_of(build(converted, tmp_path))
    assert page.count("no LilyPond original") == 13
    assert page.count("no scan") == 13


# --- geometry flags (A5c) -----------------------------------------------------------------------


def test_geometry_findings_clipped_glyph_reports_clipping(tmp_path: Path) -> None:
    path = tmp_path / "c-p1.svg"
    path.write_text(CLIPPED_SVG, encoding="utf-8")
    (finding,) = geometry_findings("c", path)
    assert (finding.code, finding.severity) == ("GEOMETRY_CLIPPING", "warning")
    assert dict(finding.details)["case"] == "c"


def test_geometry_findings_clean_page_reports_nothing(tmp_path: Path) -> None:
    path = tmp_path / "c-p1.svg"
    path.write_text(CLEAN_SVG, encoding="utf-8")
    assert geometry_findings("c", path) == []


def test_geometry_findings_lyric_gap_under_threshold_reports_collision(tmp_path: Path) -> None:
    path = tmp_path / "c-p1.svg"
    path.write_text(CLEAN_SVG, encoding="utf-8")
    (finding,) = geometry_findings("c", path, [{**GAP, "gapMm": 0.1}])
    assert finding.code == "GEOMETRY_COLLISION" and "0.10 mm" in finding.message


def test_geometry_findings_lyric_gap_at_or_above_threshold_reports_nothing(tmp_path: Path) -> None:
    path = tmp_path / "c-p1.svg"
    path.write_text(CLEAN_SVG, encoding="utf-8")
    assert geometry_findings("c", path, [{**GAP, "gapMm": 0.3}, {**GAP, "gapMm": 0.9}]) == []


def test_build_evidence_close_lyric_pair_is_a_note_not_a_finding(converted: Path, tmp_path: Path) -> None:
    runner = fake_runner(gaps={"a4-p-orig": [{**GAP, "gapMm": 0.6}]})
    packet = build(converted, tmp_path, runner)
    assert packet.geometry_findings == ()
    page = html_of(packet)
    assert "close (note only)" in page and "0.60 mm apart" in page
    assert "estimated" not in page


def test_geometry_findings_prefers_the_bounding_box_render(tmp_path: Path) -> None:
    plain = tmp_path / "c-p1.svg"
    plain.write_text(CLEAN_SVG, encoding="utf-8")
    (tmp_path / "c-p1.bbox.svg").write_text(CLIPPED_SVG, encoding="utf-8")
    assert [f.code for f in geometry_findings("c", plain)] == ["GEOMETRY_CLIPPING"]


def test_build_evidence_geometry_flags_are_listed_but_never_change_eligibility_or_state(
    converted: Path, tmp_path: Path
) -> None:
    record = record_for(converted)
    before = (record.validation, state_for(record), record.state, record.review)
    runner = fake_runner({"letter-p-orig": CLIPPED_SVG}, gaps={"a4-p-orig": [{**GAP, "gapMm": -0.2}]})
    packet = build(converted, tmp_path, runner, record=record)
    assert {f.code for f in packet.geometry_findings} == {"GEOMETRY_CLIPPING", "GEOMETRY_COLLISION"}
    page = html_of(packet)
    assert "GEOMETRY_CLIPPING" in page and "GEOMETRY_COLLISION" in page and "flags only" in page
    assert record.validation is not None and record.validation.eligible is True
    assert (record.validation, state_for(record), record.state, record.review) == before
    assert state_for(record) == "needs-review"


def test_build_evidence_flagged_and_clean_runs_give_the_same_review_state(converted: Path, tmp_path: Path) -> None:
    record = record_for(converted)
    clean = build(converted, tmp_path / "a", record=record)
    flagged = build(converted, tmp_path / "b", fake_runner(default=CLIPPED_SVG), record=record)
    assert clean.geometry_findings == () and len(flagged.geometry_findings) == 13
    assert state_for(record) == "needs-review"


def test_build_evidence_unreadable_renderer_output_raises_evidence_error(converted: Path, tmp_path: Path) -> None:
    def broken(mei: Path, cases: list[LayoutCase], out: Path, boundaries: Path | None) -> None:
        return None

    with pytest.raises(EvidenceError):
        build(converted, tmp_path, broken)


# --- CLI -------------------------------------------------------------------------------------------


def test_evidence_command_prints_the_index_path(converted: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code = evidence_command(
        converted, tmp_path / "ev", node_runner=fake_runner(), lilypond_svg=no_original, scan_images=no_scans
    )
    assert code == 0
    assert capsys.readouterr().out.strip().splitlines()[-1] == str(tmp_path / "ev" / "index.html")


def test_evidence_command_missing_convert_dir_exits_nonzero(tmp_path: Path) -> None:
    assert evidence_command(tmp_path / "nope", tmp_path / "ev") == 1


# --- the real renderer -------------------------------------------------------------------------------


@pytest.mark.slow
def test_run_node_renderer_kyrie_writes_thirteen_case_folders_with_svgs(converted: Path, tmp_path: Path) -> None:
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    if not (WEB / "node_modules" / "verovio").is_dir():
        pytest.skip("web/node_modules is missing (run pnpm install in web/)")
    version = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True).stdout
    if int(version.strip().lstrip("v").split(".")[0]) < 24:
        pytest.skip("node >= 24 is needed to run TypeScript directly")
    packet = build_evidence(
        converted, None, tmp_path / "evidence", node_runner=run_node_renderer,
        lilypond_svg=no_original, scan_images=no_scans,
    )
    folders = sorted(p.name for p in (tmp_path / "evidence" / "cases").iterdir() if p.is_dir())
    assert folders == sorted(c.id for c in REQUIRED_MATRIX)
    for case in REQUIRED_MATRIX:
        svgs = sorted((tmp_path / "evidence" / "cases" / case.id).glob(f"{case.id}-p*.svg"))
        assert svgs, case.id
        assert packet.cases[case.id].read_text(encoding="utf-8").lstrip().startswith("<svg")


def test_build_evidence_semantic_difference_is_listed_with_code_layer_onset_and_ids(converted: Path, tmp_path: Path) -> None:
    from fractions import Fraction

    from pipeline.typeset.mei.model import SemanticDifference

    diff = SemanticDifference("PITCH_MISMATCH", "1.1", Fraction(3, 4), ("0e0007",), "pitch differs")
    record = record_for(converted)
    record = dataclasses.replace(
        record, validation=ValidationReport(True, (), (diff,), False, {}, {})
    )
    page = html_of(build(converted, tmp_path, record=record))
    assert "Semantic differences: 1" in page and "Eligible: NO" in page
    assert "PITCH_MISMATCH" in page and "layer 1.1" in page and "onset 3/4" in page and "0e0007" in page


def test_build_evidence_without_record_agrees_with_validate_command(converted: Path, tmp_path: Path) -> None:
    from pipeline.typeset.mei.cli import validation_for_directory

    report = validation_for_directory(converted)
    page = html_of(build(converted, tmp_path))
    assert f"Semantic differences: {len(report.semantic_differences)}" in page
    assert f"Eligible: {'yes' if report.eligible else 'NO'}" in page
