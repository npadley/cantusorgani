"""The per-volume parts summary and the hand-check sample (pipeline.partsreport)."""

from __future__ import annotations

from pipeline.partsreport import summary, write_sample


def catalog() -> dict[str, object]:
    return {"pieces": [
        {"volume": "noh3", "slug": "therese", "title": "S. Theresiæ <&>", "parts": [
            {"part": "introit", "variant": "", "system": 0, "ref": "noh3/0397/000", "placed": "label"},
            {"part": "gradual", "variant": "", "system": 8, "ref": "noh3/0398/003", "placed": "text"},
            {"part": "offertory", "variant": "", "system": 48, "ref": "noh3/0405/002", "placed": "order"},
            {"part": "communion", "variant": "", "borrowed_volume": "noh4", "borrowed_page": 81,
             "borrowed_from": None},
        ]},
        {"volume": "noh1", "slug": "other", "title": "x", "parts": [
            {"part": "introit", "variant": "", "system": 0, "ref": "noh1/0030/000", "placed": "label"}]},
    ]}


def test_summary_counts_one_volumes_parts_by_how_they_were_placed():
    review = [{"volume": "noh3", "kind": "part_missing"}, {"volume": "noh3", "kind": "part_mismatch"},
              {"volume": "noh3", "kind": "part_unsupported"}, {"volume": "noh1", "kind": "part_missing"},
              {"volume": "links", "kind": "part_borrowed_unresolved", "piece": "therese"}]
    assert summary(catalog(), review, "noh3") == (
        "noh3: 3 parts placed (label 1, text 1, mode 0, order 1), 1 missing, 1 mismatched, "
        "1 unsupported; 1 borrowed (1 unresolved)")


def test_summary_volume_without_parts_says_so():
    assert summary({"pieces": []}, [], "noh5") == "noh5: no Proper parts"


def test_write_sample_escapes_titles_and_links_each_slice(tmp_path):
    path = write_sample(catalog(), "noh3", n=30, out_dir=tmp_path)
    html = path.read_text()
    assert path.name == "parts-sample-noh3.html"
    assert "S. Theresiæ &lt;&amp;&gt;" in html
    assert 'src="systems/noh3/0398/003@2x.png"' in html
    assert "noh1/0030/000" not in html          # one volume only
    assert "borrowed" not in html               # borrowed parts have no slice here
