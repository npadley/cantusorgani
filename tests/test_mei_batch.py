"""Card C4a: resumable, digest-keyed MEI conversion batches. Conversion never approves."""

from __future__ import annotations

import dataclasses
import json
import shutil
import threading
import time
from pathlib import Path

import pytest

from pipeline.typeset.mei.batch import run_batch
from pipeline.typeset.mei.model import ConversionInputs, ConversionProfile

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ConversionProfile.load(ROOT / "data/typeset/mei/profiles/accompaniment-v1.json")
STATES = {"unsupported", "failed", "needs-review", "approved"}


def inputs_for(path: Path, include: str = "i1", extractor: str = "e1") -> ConversionInputs:
    import hashlib

    return ConversionInputs(
        hashlib.sha256(path.read_bytes()).hexdigest(), include, "2.26.0", extractor, "c1", "accompaniment-v1",
        "p", "s", "v", "f",
    )


class Harness:
    """Fake converter + evidence builder that count calls and can fail or report unsupported features."""

    def __init__(
        self, fail: set[str] = frozenset(), unsupported: set[str] = frozenset(), include: str = "i1",
    ) -> None:
        self.fail, self.unsupported, self.include = fail, unsupported, include
        self.converted: list[str] = []
        self.packets: list[str] = []
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def inputs(self, source: Path) -> ConversionInputs:
        return inputs_for(source, include=self.include)

    def convert(self, source: Path, out: Path) -> None:
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            self.converted.append(source.name)
        try:
            time.sleep(0.02)
            if source.name in self.fail:
                raise RuntimeError("COMPILE_FAILED: boom")
            out.mkdir(parents=True, exist_ok=True)
            (out / "score.mei").write_text(f"<mei>{source.name}</mei>", encoding="utf-8")
            codes = ["UNSUPPORTED_FEATURE"] if source.name in self.unsupported else []
            (out / "diagnostics.json").write_text(
                json.dumps([{"code": c, "severity": "error", "message": c} for c in codes]), encoding="utf-8"
            )
        finally:
            with self.lock:
                self.active -= 1

    def evidence(self, convert_dir: Path, out: Path) -> None:
        self.packets.append((convert_dir / "score.mei").read_text(encoding="utf-8"))
        out.mkdir(parents=True, exist_ok=True)
        (out / "index.html").write_text("<html>packet</html>", encoding="utf-8")


def make_sources(tmp_path: Path, names: list[str]) -> list[Path]:
    paths = []
    for name in names:
        path = tmp_path / "src" / name
        path.parent.mkdir(exist_ok=True)
        path.write_text(f"\\relative c' {{ {name} }}\n", encoding="utf-8")
        paths.append(path)
    return paths


def batch(h: Harness, sources: list[Path], out: Path, **kw):
    return run_batch(sources, PROFILE, out, convert_fn=h.convert, inputs_fn=h.inputs, evidence_fn=h.evidence, **kw)


def test_run_batch_counts_every_requested_source_once_by_state_and_never_approves(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly", "b.ly", "c.ly", "d.ly"])
    h = Harness(fail={"b.ly"}, unsupported={"c.ly"})
    report = batch(h, sources, tmp_path / "out")
    assert report.results == {
        str(sources[0]): "needs-review", str(sources[1]): "failed", str(sources[2]): "unsupported",
        str(sources[3]): "needs-review",
    }
    assert report.counts == {"unsupported": 1, "failed": 1, "needs-review": 2, "approved": 0}
    assert set(report.counts) == STATES and sum(report.counts.values()) == len(sources)
    assert report.counts["approved"] == 0  # conversion itself never approves


def test_run_batch_partial_failure_does_not_abort_unrelated_scores(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly", "b.ly", "c.ly"])
    h = Harness(fail={"a.ly"})
    report = batch(h, sources, tmp_path / "out")
    assert report.results[str(sources[0])] == "failed"
    assert report.results[str(sources[1])] == report.results[str(sources[2])] == "needs-review"
    assert sorted(h.converted) == ["a.ly", "b.ly", "c.ly"]


def test_run_batch_unsupported_and_failed_scores_get_no_evidence_packet(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly", "b.ly", "c.ly"])
    h = Harness(fail={"b.ly"}, unsupported={"c.ly"})
    report = batch(h, sources, tmp_path / "out")
    assert list(report.evidence) == [str(sources[0])]
    assert report.evidence[str(sources[0])].joinpath("index.html").is_file()
    assert len(h.packets) == 1


def test_run_batch_resume_reuses_cached_successes_without_converting_again(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly", "b.ly"])
    out = tmp_path / "out"
    first = Harness()
    assert batch(first, sources, out).cached == ()
    second = Harness()
    report = batch(second, sources, out)
    assert set(report.cached) == {str(s) for s in sources}
    assert second.converted == [] and second.packets == []
    assert report.counts["needs-review"] == 2 and set(report.evidence) == {str(s) for s in sources}


def test_run_batch_interrupted_build_is_ignored_and_redone(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly"])
    out = tmp_path / "out"
    digest = inputs_for(sources[0]).digest()
    (out / f".tmp-{digest}-crashed").mkdir(parents=True)  # a half-written build from a dead process
    (out / digest).mkdir()  # a final directory with no result file is not a cache hit either
    h = Harness()
    report = batch(h, sources, out)
    assert h.converted == ["a.ly"] and report.cached == ()


def test_run_batch_changed_source_include_or_version_invalidates_a_cached_success(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly"])
    out = tmp_path / "out"
    cached = inputs_for(sources[0])
    assert batch(Harness(), sources, out).cached == ()
    assert batch(Harness(), sources, out).cached == (str(sources[0]),)

    sources[0].write_text("changed\n", encoding="utf-8")
    changed_source = inputs_for(sources[0])
    assert changed_source.digest() != cached.digest()
    h = Harness()
    assert batch(h, sources, out).cached == () and h.converted == ["a.ly"]

    changed_include = Harness(include="i2")
    assert inputs_for(sources[0], include="i2").digest() != changed_source.digest()
    assert batch(changed_include, sources, out).cached == () and changed_include.converted == ["a.ly"]
    assert dataclasses.replace(changed_source, extractor_version="e2").digest() != changed_source.digest()


def test_run_batch_never_overwrites_another_agents_output(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly"])
    out = tmp_path / "out"
    batch(Harness(), sources, out)
    digest_dir = out / inputs_for(sources[0]).digest()
    marker = digest_dir / "score.mei"
    marker.write_text("<mei>other agent's accepted artifact</mei>", encoding="utf-8")
    batch(Harness(), sources, out)
    assert marker.read_text(encoding="utf-8") == "<mei>other agent's accepted artifact</mei>"
    reports = sorted((out / "reports").glob("*.json"))
    assert len(reports) == 2 and len({r.name for r in reports}) == 2  # each run keeps its own report


def test_run_batch_bounds_compiler_concurrency(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, [f"s{i}.ly" for i in range(8)])
    h = Harness()
    batch(h, sources, tmp_path / "out", workers=2)
    assert 1 <= h.max_active <= 2


def test_run_batch_duplicate_and_empty_sources_are_counted_only_when_requested_and_nonempty(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly", "b.ly"])
    empty = tmp_path / "src" / "empty.ly"
    empty.write_text("   \n", encoding="utf-8")
    h = Harness()
    report = batch(h, [sources[0], sources[0], sources[1], empty], tmp_path / "out")
    assert report.requested == (str(sources[0]), str(sources[1]))
    assert sum(report.counts.values()) == 2 and "empty.ly" not in h.converted


def test_run_batch_report_file_lists_digests_diagnostics_and_decisions(tmp_path: Path) -> None:
    sources = make_sources(tmp_path, ["a.ly", "c.ly"])
    out = tmp_path / "out"
    batch(Harness(unsupported={"c.ly"}), sources, out)
    (path,) = (out / "reports").glob("*.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    by = {e["source"]: e for e in data["scores"]}
    assert by[str(sources[0])]["digest"] == inputs_for(sources[0]).digest() and by[str(sources[0])]["decision"] == "converted"
    assert by[str(sources[1])]["state"] == "unsupported" and "UNSUPPORTED_FEATURE" in by[str(sources[1])]["diagnostics"]
    assert data["counts"] == {"unsupported": 1, "failed": 0, "needs-review": 1, "approved": 0}


@pytest.mark.slow
def test_run_batch_real_kyrie_conversion_with_the_fake_lilypond_runner(tmp_path: Path) -> None:
    from pipeline.typeset.mei.cli import convert_command

    class Runner:
        version = "2.26.0"

        def run(self, args, cwd, includes, timeout):
            shutil.copy(ROOT / "tests/fixtures/mei/extraction/kyrie_IX.tsv", cwd / "out.listen.tsv")
            return True, ""

    source = ROOT / "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"

    def convert(src: Path, out: Path) -> None:
        if convert_command(src, out, Runner(), tmp_path / "build") != 0:
            raise RuntimeError("convert failed")

    h = Harness()
    report = run_batch([source], PROFILE, tmp_path / "out", convert_fn=convert, evidence_fn=h.evidence)
    assert report.results == {"data/typeset/src/vol-5/missa-ix/kyrie_IX.ly": "needs-review"} and report.counts["approved"] == 0


def test_run_batch_default_convert_classifies_an_errored_conversion_by_its_diagnostics(tmp_path: Path, monkeypatch) -> None:
    """convert_command returns 1 for any error diagnostic; the batch must read the diagnostics it wrote
    (unsupported / failed) rather than call every such score failed."""
    from pipeline.typeset.mei import cli

    def fake_convert(source: Path, out: Path, *args, **kwargs) -> int:
        out.mkdir(parents=True, exist_ok=True)
        (out / "diagnostics.json").write_text(
            json.dumps([{"code": "UNSUPPORTED_FEATURE", "severity": "error", "message": "source line break falls inside a measure"}]),
            encoding="utf-8",
        )
        return 1

    monkeypatch.setattr(cli, "convert_command", fake_convert)
    sources = make_sources(tmp_path, ["a.ly"])
    report = run_batch(sources, PROFILE, tmp_path / "out", inputs_fn=lambda s: inputs_for(s), evidence_fn=None)
    assert report.results == {str(sources[0]): "unsupported"}
