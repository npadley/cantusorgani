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


# Where a piece appears on the site. The calendar divisions (temporale,
# sanctorale, commune) are the ones a date lookup links into.
DIVISIONS = frozenset({
    "kyriale", "temporale", "sanctorale", "commune", "defunctorum", "vesperale", "varia",
})


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
    division: str = "varia"
    # 1962 calendar keys this piece serves, e.g. ("tempora:Adv1-0",). Empty for
    # pieces that belong to no single day, such as a Kyriale Mass.
    days: tuple[str, ...] = ()
    # How the page was established: "verified" for a hand transcription; for a
    # scripted index, the evidence `noh index-extract` found (see its docstring).
    status: str = "verified"
    # Parts printed elsewhere: "Introitus. Vultum tuum, Pars IV, p. 115."
    reference: str | None = None
    # Reviewed alternatives or exceptions which a prose rubric cannot resolve
    # to one Mass (e.g. before/after Epiphany's first Sunday).
    reference_sources: tuple[dict[str, object], ...] = ()
    # An addendum's id (data/volumes.yml) when the entry is printed in one: its
    # `page` then counts in that addendum's own pagination, not the body's.
    pagination: str | None = None

    @property
    def printed_pages(self) -> tuple[int, int]:
        return (self.page, self.last_page if self.last_page is not None else self.page)


def load_index(vol_id: str, path: Path | None = None) -> list[IndexEntry]:
    src = path if path is not None else DATA / f"index-{vol_id}.yml"
    doc = yaml.safe_load(src.read_text(encoding="utf-8"))
    entries: list[IndexEntry] = []
    seen: set[str] = set()
    for section in doc["sections"]:
        division = section.get("division", "varia")
        if division not in DIVISIONS:
            raise ValueError(
                f"{section['name']!r}: unknown division {division!r}; "
                f"expected one of {sorted(DIVISIONS)}"
            )
        for e in section["entries"]:
            # Labels are NOT unique: "I"/"II"/"III" occur in both Ordinarium Missae
            # and Missa pro Defunctis, and "Asperges" three times in one section.
            # Keying anything by label alone silently overwrites entries.
            base = e.get("slug") or f"{slugify(section['name'])}-{slugify(e['label'])}"
            slug = base if base not in seen else f"{base}-p{e['page']}"
            if slug in seen:
                raise ValueError(f"duplicate index slug {slug!r} in {vol_id}")
            seen.add(slug)
            if "parts" in e:
                raise ValueError(f"{vol_id} {slug}: `parts:` placed Proper parts by hand; that is a reviewed "
                                 f"section list now: move it to data/sections/{vol_id}.yml "
                                 f"(`uv run noh sections {slug} --review`) and delete `parts:` from the index")
            entries.append(IndexEntry(
                slug=slug, section=section["name"], label=e["label"], title=e["title"],
                genre=e["genre"], page=e["page"], last_page=e.get("last_page"),
                incipit=e.get("incipit"), division=division,
                days=tuple(e.get("days", ())), status=e.get("status", "verified"),
                reference=e.get("reference"),
                reference_sources=tuple(e.get("reference_sources", ())),
                pagination=e.get("pagination", section.get("pagination")),
            ))
    return entries


def resolve_ranges(entries: list[IndexEntry],
                   last_printed_page: int | None = None
                   ) -> list[tuple[IndexEntry, int, int]]:
    """Fill implicit end pages: an entry runs to the page before the next entry.

    Two gaps had to be closed here, both of which orphaned real music:

    * The LAST entry ended at its own start page, because there was no following
      entry to bound it. In NOH5 that stranded printed pages 181-184 -- four
      pages of In Exsequiis that no piece referenced and no page linked to.
    * An entry with an EXPLICIT range that stops short of the next entry left the
      pages between them unclaimed: the index gives Gloria as 139-144 and Sanctus
      as 147, orphaning 145-146.

    Music does not simply stop, so a page inside the volume belongs to whichever
    entry precedes it. `last_printed_page` bounds the final entry; without it the
    old truncating behaviour is kept so callers cannot silently get a longer
    range than they asked for.
    """
    out: list[tuple[IndexEntry, int, int]] = []
    for i, e in enumerate(entries):
        if i + 1 < len(entries):
            # Always run up to the next entry, even when the index states a
            # shorter explicit range: the gap has to belong to someone.
            end = max(e.page, entries[i + 1].page - 1)
        elif last_printed_page is not None:
            end = max(e.page, last_printed_page)
        else:
            end = e.last_page if e.last_page is not None else e.page
        out.append((e, e.page, end))
    return out


def stated_end(entry: IndexEntry) -> int | None:
    """The end page the printed index actually states, if any.

    Kept distinct from the resolved range so a piece extended to fill a gap can
    be told apart from one the index really did bound.
    """
    return entry.last_page
