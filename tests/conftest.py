"""Shared test setup: tests marked `lilypond` need the pinned LilyPond, and are
skipped, saying how to install it, where it is missing."""

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
