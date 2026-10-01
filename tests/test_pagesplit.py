"""Where on its first page a piece begins (pipeline.pagesplit)."""

from __future__ import annotations

import json

import pytest

from pipeline import pagesplit
from pipeline.pagesplit import GapReader, first_system, gap_bounds


class FakeGaps(GapReader):
    """Gap texts supplied directly: gap k lies above system k."""

    def __init__(self, embedded: list[str], ocr: list[str] | None = None, printed: int = 17) -> None:
        self.vol_id, self.pdf_page, self.printed = "noh5", 63, printed
        self.gaps = [(0, 100)] * len(embedded)
        self.cache = None
        self._embedded = embedded
        self._ocr = {f"{k}:0-100": t for k, t in enumerate(ocr or [""] * len(embedded))}


def test_gap_bounds_one_gap_above_each_system_and_one_below():
    assert gap_bounds([(300, 500), (600, 800)], 1000) == [(30, 300), (500, 600), (800, 920)]
    assert gap_bounds([], 1000) == [(30, 920)]


def test_first_system_heading_mid_page():
    reader = FakeGaps(["", "", "", "III. IN FESTIS SOLEMNIBUS. 2.\n(Kyrie Deus sempiterne)", ""])
    assert first_system(reader, "III In Festis Solemnibus 2 Kyrie Deus sempiterne") == 3


def test_first_system_heading_at_top_and_nowhere():
    top = FakeGaps(["DOMINICA II. POST PENTECOSTEN", "", ""], printed=128)
    assert first_system(top, "Dominica II Post Pentecosten") == 0
    assert first_system(FakeGaps(["", "", ""]), "Dominica II Post Pentecosten") == 0


def test_first_system_running_head_does_not_count():
    """A continuation page repeats the heading beside its folio; that is not a start."""
    reader = FakeGaps(["XIII. IN FESTIS SEMIDUPLICIBUS 2  77", "", "XIII. IN FESTIS SEMIDUPLICIBUS 2"],
                      printed=77)
    assert first_system(reader, "XIII In Festis Semiduplicibus 2") == 2


def test_vespers_opening_heading_beside_folio_is_not_a_running_head():
    """NOH8 p152 starts Sunday's own antiphon before the Sacred Heart feast."""
    reader = FakeGaps([
        ("152 DOMINICA INFRA OCT. CORPORIS CHRISTI,\n"
        "quae est II post Pentecosten.\nIN II. VESPERIS.\n"
        "Antiphonae et Psalmi ut in I. Vesperis Festi, p. 146."),
        "", "", ("FERIA VI. POST OCTAVAM SS. CORPORIS CHRISTI.\n"
        "SACRATISSIMI CORDIS JESU"), "",
    ], printed=152)
    reader.vol_id = "noh8"
    assert "DOMINICA INFRA OCT." in reader.embedded(0)
    assert first_system(reader, "Dominica infra Octavam Corporis Christi") == 0


def test_first_system_falls_back_to_ocr_per_gap():
    reader = FakeGaps(["", "", ""], ocr=["", "21. MARTII. — S. BENEDICTI ABBATIS.", ""])
    assert first_system(reader, "S. Benedicti Abbatis 21 Martii") == 1


def test_first_system_prefers_heading_over_later_rubric():
    reader = FakeGaps(["", "FERIA SECUNDA.", "Graduale, ut in Dominica IV Quadragesimae feria"])
    assert first_system(reader, "Feria II post dom. IV Quadragesimae") == 1


def test_gap_reader_embedded_and_cached_ocr(tmp_path, monkeypatch):
    from pipeline.indexextract import Word

    monkeypatch.setattr(pagesplit, "embedded_words", lambda _v, _p: [
        Word(50, 100, 150, 108, "HEADING"), Word(50, 180, 150, 188, "lyric")])  # inside the system
    cache = tmp_path / "noh5" / "0063.json"
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps({"0:125-500": "CACHED"}))
    reader = GapReader("noh5", 63, 17, [(500, 1000)], 4000, cache_dir=tmp_path)
    assert reader.gaps[0] == (120, 500)
    assert reader.embedded(0) == "HEADING"
    assert reader.embedded(1) == ""
    reader.gaps[0] = (125, 500)
    assert reader.recognised(0) == "CACHED"


def test_gap_reader_small_gap_skips_ocr(tmp_path):
    reader = GapReader("noh5", 63, 17, [(130, 1000)], 4000, cache_dir=tmp_path)
    assert reader.recognised(0) == ""                    # 120-130px: too thin to hold text
    assert json.loads((tmp_path / "noh5" / "0063.json").read_text()) == {"0:120-130": ""}


@pytest.mark.parametrize("k,expected", [(0, "HEAD"), (1, "HEAD 17")])
def test_gap_reader_running_head_only_in_first_gap(k, expected):
    reader = FakeGaps(["HEAD\nHEAD 17", "HEAD 17"])
    assert reader.embedded(k) == expected
