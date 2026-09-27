"""Margin labels read from the published slices (pipeline.margins)."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline import margins
from pipeline.margins import MarginReader
from pipeline.parts import label_of

SLICES = Path("build/systems")
THERESE_OFFERTORY = "noh3/0405/002"     # "Offert. I." -- missed by the PDF's text layer


@pytest.mark.skipif(not (SLICES / f"{THERESE_OFFERTORY}@2x.png").exists(), reason="slices not built")
def test_read_margin_real_slice_reads_the_offertory_label():
    text = margins.read_margin(SLICES / f"{THERESE_OFFERTORY}@2x.png")
    assert label_of(text) == "offertory"


def test_margin_reader_caches_per_page_and_rereads_a_resliced_system(tmp_path, monkeypatch):
    slices = tmp_path / "systems" / "noh3" / "0405"
    slices.mkdir(parents=True)
    (slices / "002@2x.png").write_bytes(b"png")
    calls: list[Path] = []

    def fake_read(png: Path) -> str:        # Tesseract is the external dependency
        calls.append(png)
        return "Offert. I."

    monkeypatch.setattr(margins, "read_margin", fake_read)
    reader = MarginReader(cache_dir=tmp_path / "margins", slices=tmp_path / "systems")
    assert reader.text("noh3/0405/002", "hash1") == "Offert. I."
    assert MarginReader(cache_dir=tmp_path / "margins", slices=tmp_path / "systems").text(
        "noh3/0405/002", "hash1") == "Offert. I."
    assert len(calls) == 1, "a second reader uses the page cache"
    reader.text("noh3/0405/002", "hash2")
    assert len(calls) == 2, "a new slice hash is read again"


def test_margin_reader_missing_slice_reads_nothing(tmp_path):
    reader = MarginReader(cache_dir=None, slices=tmp_path)
    assert reader.text("noh3/0001/000") == ""
