"""Reference editions: read for reconciliation, never published.

Kept in a separate registry from data/volumes.yml so that "is this publishable?"
is answered by which file a volume appears in, not by a naming convention.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml

from pipeline.volumes import DATA, SOURCE


@dataclass(frozen=True)
class Reference:
    id: str
    title: str
    file: str
    pdf_pages: int
    excluded_reason: str

    @property
    def path(self) -> Path:
        return SOURCE / self.file


def load_references(path: Path = DATA / "reference-editions.yml") -> dict[str, Reference]:
    """Reference editions keyed by id."""
    if not path.exists():
        return {}
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))["references"]
    return {k: Reference(id=k, **v) for k, v in raw.items()}


def reference_filenames(path: Path = DATA / "reference-editions.yml") -> set[str]:
    """Filenames that must never appear in data/volumes.yml."""
    return {r.file for r in load_references(path).values()}
