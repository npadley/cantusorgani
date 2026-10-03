import pytest

from pipeline.hymnlinks import attach_hymn_links, load_hymn_links


def test_reviewed_alternate_links_preserve_the_existing_accompaniment(tmp_path):
    path = tmp_path / "hymns.yml"
    path.write_text('hymns:\n- titles: [Ave maris stella]\n  pieces: [ave, alternate]\n')
    catalog = {"pieces": [
        {"slug": s, "volume": "noh7", "genre": "hymn", "systems": [f"noh7/0139/{n:03d}"]}
        for n, s in enumerate(["ave", "alternate"])
    ]}
    links = load_hymn_links(path, catalog)
    original = {"type": "printed", "refs": ["noh8/0204/000"]}
    items = [{"kind": "hymn", "label": "Ave maris stella", "source": original}]
    attach_hymn_links(items, links)
    assert items[0]["source"] == original
    assert items[0]["hymn_links"] == ["ave", "alternate"]
    missing = [{"kind": "hymn", "label": "O prima, Virgo, pródita", "source": {"type": "note", "text": "Missing"}}]
    attach_hymn_links(missing, links)
    assert missing[0]["source"]["type"] == "note"
    assert "hymn_links" not in missing[0]


def test_rejects_unavailable_or_non_hymn_settings(tmp_path):
    path = tmp_path / "hymns.yml"
    path.write_text('hymns:\n- titles: [Ave]\n  pieces: [missing]\n')
    with pytest.raises(ValueError, match="missing"):
        load_hymn_links(path, {"pieces": []})
    for piece in [
        {"slug": "missing", "volume": "noh7", "genre": "psalm", "systems": ["r"]},
        {"slug": "missing", "volume": "noh7", "genre": "hymn", "systems": []},
        {"slug": "missing", "volume": "noh7", "genre": "hymn", "systems": ["r"], "source_note": "Incomplete"},
    ]:
        with pytest.raises(ValueError, match="missing"):
            load_hymn_links(path, {"pieces": [piece]})
