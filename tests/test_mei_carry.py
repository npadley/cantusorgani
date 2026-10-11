"""Card C5 / D20: render comparison and the typeset-mei-carry command."""

from __future__ import annotations

import dataclasses
import json
import shutil
from pathlib import Path

import pytest

from pipeline.typeset.mei.carry import compare_conversions, normalize_svg_ids
from pipeline.typeset.mei.cli import (
    carry_command,
    convert_command,
    record_for_directory,
    review_command,
)
from pipeline.typeset.mei.manifest import record_from_dict
from pipeline.typeset.mei.model import REQUIRED_MATRIX, LayoutCase

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"
KYRIE_TSV = ROOT / "tests/fixtures/mei/extraction/kyrie_IX.tsv"
NOW = "2026-10-12T01:02:03Z"

SVG = (
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><defs><g id="E0A4-1x"><path d="M0 0"/></g></defs>'
    '<g id="n9zk2" class="note"><use xlink:href="#E0A4-1x" x="5"/></g>'
    '<g id="m1abc" class="measure"><use href="#E0A4-1x"/><path style="fill:url(#m1abc)"/></g></svg>'
)


class _Runner:
    version = "2.26.0"

    def run(self, args, cwd, includes, timeout):
        shutil.copy(KYRIE_TSV, cwd / "out.listen.tsv")
        return True, ""


def fixed(record):
    return record.inputs


def changed(record):
    return dataclasses.replace(record.inputs, include_sha256="f" * 64)


@pytest.fixture(scope="module")
def converted(tmp_path_factory: pytest.TempPathFactory) -> Path:
    base = tmp_path_factory.mktemp("convert")
    assert convert_command(SOURCE, base / "kyrie", _Runner(), base / "build") == 0
    return base / "kyrie"


def fake_renderer(variant: dict[str, str] | None = None, ids: str = "a"):
    """A node renderer stand-in: one page per case, ids prefixed so a raw diff would always fail."""
    variant = variant or {}

    def run(mei: Path, cases: list[LayoutCase], out: Path, boundaries: Path | None) -> None:
        out.mkdir(parents=True, exist_ok=True)
        summary = []
        for case in cases:
            folder = out / case.id
            folder.mkdir(exist_ok=True)
            page = folder / f"{case.id}-p1.svg"
            body = SVG.replace("n9zk2", f"{ids}n9zk2").replace("m1abc", f"{ids}m1abc") + variant.get(case.id, "")
            page.write_text(body, encoding="utf-8")
            summary.append({"id": case.id, "files": [f"{case.id}/{page.name}"]})
        (out / "cases.json").write_text(json.dumps({"cases": summary}), encoding="utf-8")

    return run


class Switching:
    """Renders the prior MEI one way and the new MEI another; the call order is prior, then new."""

    def __init__(self, first, second) -> None:
        self.runs = [first, second]

    def __call__(self, mei, cases, out, boundaries) -> None:
        self.runs.pop(0)(mei, cases, out, boundaries)


# --- id normalization ----------------------------------------------------------------------------


def test_normalize_svg_ids_renumbers_ids_and_every_reference() -> None:
    out = normalize_svg_ids(SVG)
    assert "E0A4-1x" not in out and "n9zk2" not in out and "m1abc" not in out
    assert out.count('id="id1"') == 1 and 'href="#id1"' in out and "url(#id3)" in out


def test_normalize_svg_ids_two_renders_with_different_checksum_ids_are_equal() -> None:
    other = SVG.replace("n9zk2", "q7w8e").replace("m1abc", "zz999").replace("E0A4-1x", "E0A4-9q")
    assert normalize_svg_ids(SVG) == normalize_svg_ids(other)


def test_normalize_svg_ids_geometry_change_is_still_a_difference() -> None:
    assert normalize_svg_ids(SVG) != normalize_svg_ids(SVG.replace('x="5"', 'x="6"'))


def test_normalize_svg_ids_leaves_class_names_and_text_alone() -> None:
    svg = '<g id="note" class="note"><text>note</text><use href="#note"/></g>'
    out = normalize_svg_ids(svg)
    assert 'class="note"' in out and "<text>note</text>" in out and 'id="id1"' in out and 'href="#id1"' in out


def test_normalize_svg_ids_reordered_ids_are_a_difference() -> None:
    a = '<g id="x1"/><g id="y2"/><use href="#x1"/>'
    b = '<g id="x1"/><g id="y2"/><use href="#y2"/>'
    assert normalize_svg_ids(a) != normalize_svg_ids(b)


# --- compare_conversions -------------------------------------------------------------------------


def test_compare_conversions_same_mei_with_different_ids_is_identical(converted: Path, tmp_path: Path) -> None:
    result = compare_conversions(
        converted, converted, Switching(fake_renderer(ids="a"), fake_renderer(ids="b")), tmp_path / "work"
    )
    assert result.semantic_equal and result.cases_differing == ()
    assert result.cases_compared == tuple(c.id for c in REQUIRED_MATRIX)
    assert result.identical


def test_compare_conversions_one_render_difference_names_the_case(converted: Path, tmp_path: Path) -> None:
    moved = fake_renderer(variant={"a4-l-auto": '<path d="M1 1"/>'}, ids="b")
    result = compare_conversions(converted, converted, Switching(fake_renderer(), moved), tmp_path / "work")
    assert result.cases_differing == ("a4-l-auto",) and not result.identical


def test_compare_conversions_missing_page_counts_as_a_difference(converted: Path, tmp_path: Path) -> None:
    def fewer(mei, cases, out, boundaries) -> None:
        fake_renderer()(mei, cases[:-1], out, boundaries)

    result = compare_conversions(converted, converted, Switching(fake_renderer(), fewer), tmp_path / "work")
    assert result.cases_differing == (REQUIRED_MATRIX[-1].id,)


def test_compare_conversions_different_music_is_not_semantically_equal(converted: Path, tmp_path: Path) -> None:
    other = tmp_path / "other"
    shutil.copytree(converted, other)
    text = (other / "score.mei").read_text(encoding="utf-8")
    (other / "score.mei").write_text(text.replace('pname="g"', 'pname="a"', 1), encoding="utf-8")
    result = compare_conversions(converted, other, Switching(fake_renderer(), fake_renderer()), tmp_path / "work")
    assert not result.semantic_equal and not result.identical


def test_compare_conversions_different_boundaries_is_not_semantically_equal(converted: Path, tmp_path: Path) -> None:
    other = tmp_path / "other"
    shutil.copytree(converted, other)
    (other / "boundaries.json").write_text("[]\n", encoding="utf-8")
    result = compare_conversions(converted, other, Switching(fake_renderer(), fake_renderer()), tmp_path / "work")
    assert not result.semantic_equal


# --- typeset-mei-carry -----------------------------------------------------------------------------


def approved_record(converted: Path, tmp_path: Path) -> Path:
    record, current = record_for_directory(converted, fixed)
    decision = {
        "reviewer": "Test Reviewer", "timestamp": "2026-10-10T00:00:00Z", "inputs_digest": current.digest(),
        "artifact_sha256": record.artifact_sha256, "matrix_results": {c.id: "pass" for c in REQUIRED_MATRIX},
        "accepted_differences": [], "decision": "approve",
    }
    (tmp_path / "decision.json").write_text(json.dumps(decision), encoding="utf-8")
    out = tmp_path / "prior.json"
    assert review_command(converted, tmp_path / "decision.json", out, fixed) == 0
    return out


def test_carry_command_identical_renders_write_a_carried_record(converted: Path, tmp_path: Path, capsys) -> None:
    prior_path = approved_record(converted, tmp_path)
    out = tmp_path / "carried.json"
    rc = carry_command(
        converted, prior_path, out, prior_dir=converted, node_runner=Switching(fake_renderer(ids="a"), fake_renderer(ids="b")),
        inputs_fn=changed, now=NOW,
    )
    assert rc == 0
    record = record_from_dict(json.loads(out.read_text(encoding="utf-8")))
    prior = record_from_dict(json.loads(prior_path.read_text(encoding="utf-8")))
    assert record.state == "approved" and record.carried_from is not None
    assert record.carried_from.prior_artifact_sha256 == prior.artifact_sha256
    assert record.carried_from.prior_inputs_digest == prior.inputs.digest()
    assert record.carried_from.reason == ("include_sha256",) and record.carried_from.attributed_to == "ci"
    assert "carried" in capsys.readouterr().out


def test_carry_command_render_difference_writes_a_needs_review_record(converted: Path, tmp_path: Path, capsys) -> None:
    prior_path = approved_record(converted, tmp_path)
    out = tmp_path / "carried.json"
    moved = fake_renderer(variant={"letter-p-orig": '<path d="M9 9"/>'})
    rc = carry_command(converted, prior_path, out, prior_dir=converted, node_runner=Switching(fake_renderer(), moved), inputs_fn=changed, now=NOW)
    assert rc == 0
    record = record_from_dict(json.loads(out.read_text(encoding="utf-8")))
    assert record.state == "needs-review" and record.carried_from is None and record.review is None
    assert "letter-p-orig" in capsys.readouterr().out


def test_carry_command_prior_dir_must_match_the_approved_artifact(converted: Path, tmp_path: Path, capsys) -> None:
    prior_path = approved_record(converted, tmp_path)
    wrong = tmp_path / "wrong"
    shutil.copytree(converted, wrong)
    (wrong / "score.mei").write_bytes((wrong / "score.mei").read_bytes() + b"\n")
    out = tmp_path / "carried.json"
    rc = carry_command(converted, prior_path, out, prior_dir=wrong, node_runner=fake_renderer(), inputs_fn=changed, now=NOW)
    assert rc == 1 and not out.exists()
    assert "not the approved artifact" in capsys.readouterr().out


def test_carry_command_without_prior_dir_needs_identical_bytes(converted: Path, tmp_path: Path, capsys) -> None:
    prior_path = approved_record(converted, tmp_path)
    record = json.loads(prior_path.read_text(encoding="utf-8"))
    record["artifact_sha256"] = "0" * 64
    prior_path.write_text(json.dumps(record), encoding="utf-8")
    rc = carry_command(converted, prior_path, tmp_path / "carried.json", node_runner=fake_renderer(), inputs_fn=changed, now=NOW)
    assert rc == 1 and "--prior-dir" in capsys.readouterr().out


def test_noh_registers_typeset_mei_carry(converted: Path, tmp_path: Path, monkeypatch) -> None:
    from pipeline import cli
    from pipeline.typeset.mei import cli as mei_cli

    prior_path = approved_record(converted, tmp_path)
    seen: dict[str, object] = {}

    def fake(convert_dir, prior_record, out, prior_dir=None):
        seen.update(convert_dir=convert_dir, prior_record=prior_record, out=out, prior_dir=prior_dir)
        return 0

    monkeypatch.setattr(mei_cli, "carry_command", fake)
    argv = ["typeset-mei-carry", str(converted), "--prior", str(prior_path), "--out", str(tmp_path / "o.json"),
            "--prior-dir", str(converted)]
    assert cli.main(argv) == 0
    assert seen == {"convert_dir": converted, "prior_record": prior_path, "out": tmp_path / "o.json", "prior_dir": converted}
