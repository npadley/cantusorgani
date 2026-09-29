"""Shared test setup: tests marked `lilypond` need the pinned LilyPond, and are
skipped, saying how to install it, where it is missing. The hand corrections
apply no reviewed section lists (data/sections/) to a test's own catalogue,
unless the test is marked `real_sections` (it checks the committed data)."""

from __future__ import annotations

import pytest


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if not any("lilypond" in item.keywords for item in items):
        return
    from pipeline.typeset.lilypond import LilyPondError, find
    try:
        find()
    except LilyPondError:
        skip = pytest.mark.skip(reason="needs the pinned LilyPond: uv run noh lilypond-install")
        for item in items:
            if "lilypond" in item.keywords:
                item.add_marker(skip)


@pytest.fixture(autouse=True)
def _no_reviewed_sections(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory,
                          monkeypatch: pytest.MonkeyPatch) -> None:
    if "real_sections" in request.keywords:
        return
    from pipeline import corrections
    monkeypatch.setattr(corrections, "SECTIONS", tmp_path_factory.mktemp("sections"))
