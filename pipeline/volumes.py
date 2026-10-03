"""Registry of publication source volumes.

`data/volumes.yml` is an explicit allowlist. `pdf-source/` also holds the Corpus
Christi Watershed reference edition (branding burned into the imagery, pages
re-numbered and re-cropped, modern copyrighted preface translation), which must
never reach the site. Nothing in the pipeline may glob `pdf-source/*.pdf`.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
# The reviewed Vespers files, the lineup and the vendored Vespers sources.
VESPERS = DATA / "vespers"
SOURCE = ROOT / "pdf-source"


@dataclass(frozen=True)
class Addendum:
    """A supplement bound into a volume with its own pagination (NOH3's two
    addenda, each numbered from its own title page)."""
    id: str
    title: str
    first_pdf: int
    last_pdf: int
    # Staff lines too faint for the standard staff finder (pipeline.segment).
    faint_staff_lines: bool = False


@dataclass(frozen=True)
class Insert:
    """A leaf inserted after printed page `after_printed`, scan pages
    `first_pdf`..`last_pdf`, printed as `label` ("162 bis-163 bis")."""
    after_printed: int
    first_pdf: int
    last_pdf: int
    label: str


@dataclass(frozen=True)
class Volume:
    id: str
    title: str
    part: str
    file: str
    pdf_pages: int
    index_pdf_pages: list[int]
    first_body_pdf_page: int
    page_offset: int | None
    sha256: str | None
    source_url: str | None
    retrieved: str | None
    provenance: str | None
    # Last PDF page of the body, when something with its own pagination follows
    # (NOH3's addenda). Omitted: the body runs to the end, less the index pages.
    last_body_pdf_page: int | None = None
    addenda: tuple[Addendum, ...] = ()
    # Pages the standard staff finder misreads, by the setting that reads them
    # (pipeline.evaluate.analyse_page, STAFF_FINDERS). Named page by page, after
    # checking the page's overlay: a setting re-cuts every page it runs on.
    staff_finder: tuple[tuple[str, tuple[int, ...]], ...] = ()
    # Leaves inserted after the book was paginated ("162 bis"): scan pages with no
    # printed number of their own, catalogued with the piece that runs past them.
    inserts: tuple[Insert, ...] = ()

    @property
    def path(self) -> Path:
        return SOURCE / self.file


STAFF_FINDERS = ("refit", "dashed", "plain")


def _staff_finder(vol_id: str, raw: dict[str, list[int]]) -> tuple[tuple[str, tuple[int, ...]], ...]:
    unknown = sorted(set(raw) - set(STAFF_FINDERS))
    if unknown:
        raise ValueError(f"data/volumes.yml: {vol_id} staff_finder has {unknown}; "
                         f"the settings are {', '.join(STAFF_FINDERS)}")
    pages = [p for v in raw.values() for p in v]
    if len(pages) != len(set(pages)):
        raise ValueError(f"data/volumes.yml: {vol_id} staff_finder names a page twice")
    return tuple((mode, tuple(raw[mode])) for mode in STAFF_FINDERS if mode in raw)


def load_volumes(path: Path = DATA / "volumes.yml") -> dict[str, Volume]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))["volumes"]
    return {k: Volume(id=k, **{**v, "addenda": tuple(Addendum(**a) for a in v.get("addenda", ())),
                               "inserts": tuple(Insert(**i) for i in v.get("inserts", ())),
                               "staff_finder": _staff_finder(k, v.get("staff_finder") or {})})
            for k, v in raw.items()}


def resolve_source(filename: str) -> Path:
    """Resolve a PDF filename to a path, refusing anything not in the registry."""
    registered = {v.file for v in load_volumes().values()}
    if filename not in registered:
        raise ValueError(
            f"{filename!r} is not in the registry (data/volumes.yml) and must not be "
            f"read by the pipeline. Registered volumes: {sorted(registered)}"
        )
    return SOURCE / filename
