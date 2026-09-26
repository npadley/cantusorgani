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
