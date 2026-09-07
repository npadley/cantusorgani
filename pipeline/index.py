"""Hand-transcribed volume indices.

data/index-<vol>.yml is authoritative. Both OCR sources cross-check against it.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import yaml

from pipeline.volumes import DATA


def slugify(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", ascii_only.lower())).strip("-")


@dataclass(frozen=True)
class IndexEntry:
    slug: str
    section: str
    label: str
    title: str
    genre: str
    page: int
    last_page: int | None
    incipit: str | None

    @property
    def printed_pages(self) -> tuple[int, int]:
        return (self.page, self.last_page if self.last_page is not None else self.page)


def load_index(vol_id: str, path: Path | None = None) -> list[IndexEntry]:
    src = path if path is not None else DATA / f"index-{vol_id}.yml"
    doc = yaml.safe_load(src.read_text(encoding="utf-8"))
    entries: list[IndexEntry] = []
    seen: set[str] = set()
    for section in doc["sections"]:
        for e in section["entries"]:
            # Labels are NOT unique: "I"/"II"/"III" occur in both Ordinarium Missae
            # and Missa pro Defunctis, and "Asperges" three times in one section.
            # Keying anything by label alone silently overwrites entries.
            base = f"{slugify(section['name'])}-{slugify(e['label'])}"
            slug = base if base not in seen else f"{base}-p{e['page']}"
            if slug in seen:
                raise ValueError(f"duplicate index slug {slug!r} in {vol_id}")
            seen.add(slug)
            entries.append(IndexEntry(
                slug=slug, section=section["name"], label=e["label"], title=e["title"],
                genre=e["genre"], page=e["page"], last_page=e.get("last_page"),
                incipit=e.get("incipit"),
            ))
    return entries


def resolve_ranges(entries: list[IndexEntry]) -> list[tuple[IndexEntry, int, int]]:
    """Fill implicit end pages: an entry runs to the page before the next entry."""
    out: list[tuple[IndexEntry, int, int]] = []
    for i, e in enumerate(entries):
        if e.last_page is not None:
            end = e.last_page
        elif i + 1 < len(entries):
            end = max(e.page, entries[i + 1].page - 1)
        else:
            end = e.page
        out.append((e, e.page, end))
    return out
