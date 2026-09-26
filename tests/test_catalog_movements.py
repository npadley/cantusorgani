"""Kyriale Ordinaries segmented whole in the catalog (pipeline.catalog.ordinary_movements)."""

from __future__ import annotations

import pytest

from pipeline.catalog import SystemRef, ordinary_movements


def ref(i: int, text: str, marker: str | None = None) -> SystemRef:
    return SystemRef(f"noh5/0100/{i:03d}", 100, i, (1000, 250), "", text, marker)


@pytest.fixture
def mass_refs() -> list[SystemRef]:
    texts = (["kyrieeleisonkyrie", "christeeleison", "christeeleison", "kyrieeleison"]
             + ["gloriainexcelsisdeo", "laudamuste", "gratias", "dominedeus", "quitollis",
                "quisedes", "quoniamtusolus", "cumsanctospiritu"]
             + ["vellssanelusxxqqzz", "plenisunt", "hosannainexcelsis"]
             + ["agnusdeiquitollispeccatamundi", "miserere", "donanobispacem"])
    return [ref(i, t) for i, t in enumerate(texts)]


def test_ordinary_movements_every_movement_placed_weak_ones_queued(mass_refs):
    movements, uncertain = ordinary_movements("IX", mass_refs)
    assert [m["movement"] for m in movements] == ["kyrie", "gloria", "sanctus", "agnus"]
    sanctus = next(m for m in movements if m["movement"] == "sanctus")
    assert (sanctus["ref"], sanctus["placed"]) == ("noh5/0100/012", "order")
    assert [u["movement"] for u in uncertain] == ["sanctus"]
    assert uncertain[0]["kind"] == "uncertain_movement"


def test_ordinary_movements_ferial_mass_has_no_gloria(mass_refs):
    movements, _ = ordinary_movements("XVIII", mass_refs)
    assert "gloria" not in [m["movement"] for m in movements]


def test_ordinary_movements_empty_mass():
    assert ordinary_movements("I", []) == ([], [])


def test_attach_hymns_to_the_office_printing_them(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from pipeline import catalog, pagesplit
    from pipeline.offset import PageMap, Segment

    monkeypatch.setattr(catalog, "analyse_page", lambda _v, _p: SimpleNamespace(boxes=[], page_height=3000))
    monkeypatch.setattr(catalog, "system_texts", lambda _v, _p: ["", ""])
    monkeypatch.setattr(pagesplit, "first_system", lambda _reader, title: 1 if "Creator" in title else 0)
    monkeypatch.setattr(pagesplit.GapReader, "__init__", lambda self, *a, **k: None)
    pieces = [{"slug": "advent", "systems": ["noh8/0081/000", "noh8/0081/001", "noh8/0082/000"]},
              {"slug": "christmas", "systems": ["noh8/0099/000"]}]
    review: list[dict[str, object]] = []
    page_map = PageMap((Segment(31, 343, 30),))
    catalog.attach_hymns("noh8", page_map, pieces, review, [
        {"title": "Creator alme siderum", "page": 51, "status": "verified"},
        {"title": "Jesu Redemptor omnium", "page": 69, "status": "unverified"},
        {"title": "Lost hymn", "page": 300, "status": "unverified"}])
    assert pieces[0]["hymns"] == [{"title": "Creator alme siderum", "ref": "noh8/0081/001", "printed_page": 51}]
    assert pieces[1]["hymns"][0]["ref"] == "noh8/0099/000"
    assert [r["kind"] for r in review] == ["hymn_at_page_top", "hymn_unplaced"]


def test_load_hymns_from_the_index(tmp_path):
    from pipeline.catalog import load_hymns
    path = tmp_path / "index-noh8.yml"
    path.write_text("sections: []\nhymns:\n- {title: A, page: 51}\n- {title: B, page: null}\n")
    assert [h["title"] for h in load_hymns("noh8", path)] == ["A"]
    assert load_hymns("noh8", tmp_path / "missing.yml") == []


def test_hymn_system_finds_the_hymns_opening_words():
    from pipeline.catalog import hymn_system
    texts = ["elpotestasejusejusisraoticaitu", "ivcreatoralmesiderumeternaluxc", "supplicum"]
    assert hymn_system("Creator alme siderum", texts, 3) == 1
    assert hymn_system("Ave maris stella (alius tonus)", ["x" * 12, "avemarisstelladeimater"], 2) == 1
    assert hymn_system("Te lucis", texts, 3) == 0            # too short to trust
    assert hymn_system("Ut queant laxis", texts, 3) == 0     # not on this page
