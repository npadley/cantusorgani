"""Stage 7: publish slices to Cloudflare R2.

Credentials come from the environment only -- never a file in the repo, never a
default, never a literal. Uploads are write-if-absent: keys carry a content hash,
so an existing object with the same key already holds identical bytes, and
overwriting could only ever replace good bytes with the same bytes or corrupt a
URL that deployed HTML already points at.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REQUIRED_VARS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
CONTENT_TYPES = {".webp": "image/webp", ".png": "image/png"}
# Slices are immutable: the key changes whenever the bytes change, so a long
# cache is safe and is the point of content addressing.
CACHE_CONTROL = "public, max-age=31536000, immutable"


@dataclass(frozen=True)
class Credentials:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str

    @property
    def endpoint(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"


def require_credentials(env: dict[str, str] | None = None) -> Credentials:
    source = os.environ if env is None else env
    missing = [name for name in REQUIRED_VARS if not source.get(name)]
    if missing:
        raise RuntimeError(
            f"missing R2 credentials: {', '.join(missing)}.\n"
            f"  These are read from the environment only and must never be committed.\n"
            f"  Fix: copy .dev.vars.example to .dev.vars and export them, or set them\n"
            f"  in your shell. Run `uv run noh doctor` to check."
        )
    return Credentials(
        account_id=source["R2_ACCOUNT_ID"],
        access_key_id=source["R2_ACCESS_KEY_ID"],
        secret_access_key=source["R2_SECRET_ACCESS_KEY"],
        bucket=source["R2_BUCKET"],
    )


def content_type_for(path: Path) -> str:
    try:
        return CONTENT_TYPES[path.suffix.lower()]
    except KeyError:
        raise ValueError(
            f"refusing to upload {path.name}: only {sorted(CONTENT_TYPES)} are published"
        ) from None
