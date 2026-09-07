"""Pin and verify source PDF integrity.

The source PDFs are untracked (230 MB); the checksum is what makes the dataset
reproducible by someone who obtains them independently.
"""

import hashlib
from pathlib import Path

from pipeline.volumes import SOURCE, load_volumes


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_volume(vol_id: str) -> bool:
    vol = load_volumes()[vol_id]
    if vol.sha256 is None:
        raise ValueError(
            f"{vol_id}: sha256 is null in data/volumes.yml, so the source PDF cannot be "
            f"verified. Compute and paste it:\n"
            f"  uv run python -c \"from pipeline.checksum import sha256_of, SOURCE; "
            f"print(sha256_of(SOURCE/'{vol.file}'))\""
        )
    return sha256_of(SOURCE / vol.file) == vol.sha256
