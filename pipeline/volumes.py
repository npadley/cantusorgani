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
SOURCE = ROOT / "pdf-source"


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

    @property
    def path(self) -> Path:
        return SOURCE / self.file


def load_volumes(path: Path = DATA / "volumes.yml") -> dict[str, Volume]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))["volumes"]
    return {k: Volume(id=k, **v) for k, v in raw.items()}


def resolve_source(filename: str) -> Path:
    """Resolve a PDF filename to a path, refusing anything not in the registry."""
    registered = {v.file for v in load_volumes().values()}
    if filename not in registered:
        raise ValueError(
            f"{filename!r} is not in the registry (data/volumes.yml) and must not be "
            f"read by the pipeline. Registered volumes: {sorted(registered)}"
        )
    return SOURCE / filename
