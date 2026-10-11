"""Evidence for carrying an approval forward (card C5, decision D20).

``compare_conversions`` compares a re-conversion with the approved conversion on the two grounds the
decision names: (a) the normalized semantic output (``normalize.py``) is equal, and (b) every
Contracts section 3 render case lays out to the same SVG once ids are normalized. The result is the
``review.EvidenceComparison`` that ``review.carry_forward`` consumes; this module decides nothing.

Id normalization. Verovio runs with ``xmlIdChecksum``, so an element's id is a checksum of its
content: unchanged music gives unchanged ids, but any difference in the MEI's own ``xml:id`` values
(or in what a checksum covers) renames them without moving a pixel. ``normalize_svg_ids`` therefore
renumbers every ``id`` in order of first appearance (``id1``, ``id2``, ...) and rewrites each
reference to it (``href``, ``xlink:href``, ``url(#...)``, ``data-*``) the same way. Everything else
is compared byte for byte, so geometry, glyphs, classes and text must match exactly.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pipeline.typeset.mei.model import REQUIRED_MATRIX, LayoutCase
from pipeline.typeset.mei.normalize import normalize_mei
from pipeline.typeset.mei.review import EvidenceComparison

NodeRunner = Callable[[Path, list[LayoutCase], Path, Path | None], None]

_ATTR = re.compile(r'(\s)([\w:.-]+)="([^"]*)"')
_ID_ATTR = re.compile(r'\sid="([^"]*)"')
_TOKEN = re.compile(r"[^\s#()\"';,]+")
_SKIP_ATTRIBUTES = frozenset({"class", "style-class"})


def normalize_svg_ids(svg: str) -> str:
    """``svg`` with every ``id`` renumbered by first appearance and all references rewritten to match."""
    mapping: dict[str, str] = {}
    for value in _ID_ATTR.findall(svg):
        mapping.setdefault(value, f"id{len(mapping) + 1}")

    def swap(match: re.Match[str]) -> str:
        lead, name, value = match.groups()
        if name in _SKIP_ATTRIBUTES:
            return match.group(0)
        return f'{lead}{name}="{_TOKEN.sub(lambda t: mapping.get(t.group(0), t.group(0)), value)}"'

    return _ATTR.sub(swap, svg)


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _semantic_equal(prior: Path, new: Path) -> bool:
    """Normalized MEI of both directories equal, and both boundary lists equal (they ship in the manifest)."""
    try:
        before = normalize_mei((prior / "score.mei").read_bytes(), _read_json(prior / "provenance.json"))
        after = normalize_mei((new / "score.mei").read_bytes(), _read_json(new / "provenance.json"))
        return before == after and _read_json(prior / "boundaries.json") == _read_json(new / "boundaries.json")
    except (OSError, ValueError, KeyError):
        return False


def _case_pages(root: Path) -> dict[str, list[str]]:
    """{case id: [normalized page text, ...]} from a renderer output folder."""
    try:
        summary = _read_json(root / "cases.json")
        pages: dict[str, list[str]] = {}
        for case in summary["cases"]:
            pages[str(case["id"])] = [
                normalize_svg_ids((root / name).read_text(encoding="utf-8")) for name in case.get("files", [])
            ]
        return pages
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def compare_conversions(prior_dir: Path, new_dir: Path, node_runner: NodeRunner, work: Path) -> EvidenceComparison:
    """Compare two ``typeset-mei-convert`` directories (``score.mei``, ``boundaries.json``, ``provenance.json``).

    Both are laid out for every ``REQUIRED_MATRIX`` case by ``node_runner`` (the production renderer,
    ``evidence.run_node_renderer``) under ``work/prior`` and ``work/new``. A case is *differing* when
    either side produced no pages for it or the normalized pages are not all equal."""
    cases = list(REQUIRED_MATRIX)
    renders: list[dict[str, list[str]]] = []
    for label, directory in (("prior", prior_dir), ("new", new_dir)):
        out = work / label
        node_runner(directory / "score.mei", cases, out, directory / "boundaries.json")
        renders.append(_case_pages(out))
    before, after = renders
    differing = tuple(c.id for c in cases if not before.get(c.id) or before.get(c.id) != after.get(c.id))
    return EvidenceComparison(
        semantic_equal=_semantic_equal(prior_dir, new_dir),
        cases_compared=tuple(c.id for c in cases),
        cases_differing=differing,
    )


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
