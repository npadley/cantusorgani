"""How well a volume's Propers were divided, and a sample to check by eye.

`noh catalog` prints the summary after every build; `--parts-report` also
writes build/parts-sample-<volume>.html -- random part starts beside their
slices -- so a hand check is a page to scroll, not a script to write."""

from __future__ import annotations

import html
import random
from collections import Counter
from pathlib import Path

from pipeline import sections
from pipeline.render import BUILD


def _parts(catalog: dict[str, object], volume: str) -> list[tuple[dict[str, object], dict[str, object]]]:
    return [(piece, part) for piece in catalog.get("pieces", [])     # type: ignore[union-attr]
            if piece.get("volume") == volume for part in sections.of(piece)]


def summary(catalog: dict[str, object], review: list[dict[str, object]], volume: str) -> str:
    parts = _parts(catalog, volume)
    if not parts:
        return f"{volume}: no Proper parts"
    printed = [p for _, p in parts if "ref" in p and "borrowed_page" not in p]
    borrowed = [p for _, p in parts if "borrowed_page" in p]
    placed = Counter(str(p.get("placed")) for p in printed)
    kinds = Counter(str(r.get("kind")) for r in review if r.get("volume") == volume)
    slugs = {str(piece["slug"]) for piece, _ in parts}
    unresolved = sum(1 for r in review if r.get("kind") == "part_borrowed_unresolved"
                     and r.get("piece") in slugs)
    return (f"{volume}: {len(printed)} parts placed (label {placed['label']}, text {placed['text']}, "
            f"inferred {placed['inferred']}, reviewed {placed['reviewed']}), {kinds['part_missing']} missing, "
            f"{kinds['part_mismatch']} mismatched, {kinds['part_unsupported']} unsupported; "
            f"{len(borrowed)} borrowed ({unresolved} unresolved)")


def write_sample(catalog: dict[str, object], volume: str, n: int = 30, seed: int = 0,
                 out_dir: Path = BUILD) -> Path:
    printed = [(piece, part) for piece, part in _parts(catalog, volume)
               if "ref" in part and "borrowed_page" not in part]
    sample = random.Random(seed).sample(printed, min(n, len(printed)))
    rows = []
    for piece, part in sorted(sample, key=lambda pp: str(pp[1]["ref"])):
        ref = html.escape(str(part["ref"]))
        label = html.escape(f"{part['kind']}{' (' + sections.suffix(part)[1:] + ')' if sections.suffix(part) else ''}")
        rows.append(
            f"<tr><td>{html.escape(str(piece.get('title', piece['slug'])))}<br><b>{label}</b>"
            f"<br><small>{ref} · placed by {html.escape(str(part.get('placed')))}</small></td>"
            f'<td><img src="systems/{ref}@2x.png" alt="{ref}" width="720"></td></tr>')
    page = ("<!doctype html><meta charset=utf-8><title>Parts sample " + html.escape(volume) +
            "</title><style>body{font:14px system-ui;margin:1rem}td{vertical-align:top;"
            "padding:.5rem;border-bottom:1px solid #ccc}</style>"
            f"<h1>{html.escape(volume)}: {len(sample)} random part starts</h1>"
            "<p>Each image should begin with the part named beside it.</p><table>"
            + "".join(rows) + "</table>")
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"parts-sample-{volume}.html"
    path.write_text(page, encoding="utf-8")
    return path


__all__ = ["summary", "write_sample"]
