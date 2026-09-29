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
    # PDF pages where a stray row (a slur, a beam) or a line read twice or not
    # at all hides a staff from the standard grouping; their staves are fitted
    # as on faint print (pipeline.evaluate.analyse_page). Named page by page,
    # after checking the page's overlay: the fitter re-cuts every page it runs on.
    refit_staff_pages: tuple[int, ...] = ()

    @property
    def path(self) -> Path:
        return SOURCE / self.file


def load_volumes(path: Path = DATA / "volumes.yml") -> dict[str, Volume]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))["volumes"]
    return {k: Volume(id=k, **{**v, "addenda": tuple(Addendum(**a) for a in v.get("addenda", ())),
                               "refit_staff_pages": tuple(v.get("refit_staff_pages", ()))})
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
