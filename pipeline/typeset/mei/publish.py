"""Verified, write-once publication of approved MEI conversions (card C1a).

SECURITY BOUNDARY. This module is the secret-bearing half of the conversion pipeline, so it never
executes, imports, parses or compiles anything from the artifact directory: files are read as raw
bytes, hashed and uploaded, nothing else. It imports no compiler, renderer or extractor module
(``tests/test_mei_publish.py`` pins that with an AST check).

Two steps, deliberately separate:

``verify_publish_bundle`` checks every approved record against the artifact directory
(``<artifact_dir>/<sha256>/{score.mei,boundaries.json}``) and returns the key -> sha256 map that is
the only thing allowed to leave the machine. ``publish_verified`` re-reads each file, re-hashes it
immediately before upload (the TOCTOU guard) and writes it only if the key is absent.

Write-if-absent. ``R2AssetStore.put_if_absent`` first HEADs the key and then sends the PUT with
``If-None-Match: *``, which R2 enforces atomically, so a concurrent writer that wins the race makes
our PUT fail with 412 and we report ``False`` rather than overwrite. (The existing
``pipeline.upload.upload_all`` does only the HEAD check, which has a check-then-put race; the
conditional header closes it.) A store that ignored the header would reduce to the HEAD check; that
residual race is harmless for content-addressed keys but is why ``publish_verified`` compares bytes
whenever a key already exists.

The ``mei/<digest>/...`` object key embeds the sha256 of the MEI, and ``boundaries.json`` sits beside
it. The record pins only the MEI digest; the boundaries file is pinned at verify time and re-checked
at publish time.
"""

from __future__ import annotations

import hashlib
import os
import re
import stat
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, Protocol

from pipeline.typeset.mei.model import (
    AssetStore as _ContractAssetStore,
)
from pipeline.typeset.mei.model import (
    ConversionInputs,
    ConversionRecord,
    PublishInputs,
    PublishReport,
    VerifiedBundle,
)
from pipeline.typeset.mei.model import PublishBlocked as _ContractPublishBlocked
from pipeline.typeset.mei.review import approval_is_current

__all__ = ["AssetStore", "PublishBlocked", "PublishInputs", "PublishReport", "R2AssetStore", "VerifiedBundle",
           "publish_verified", "verify_publish_bundle"]

SCORE_NAME = "score.mei"
BOUNDARIES_NAME = "boundaries.json"
ALLOWED_NAMES = frozenset({SCORE_NAME, BOUNDARIES_NAME})
PREFIX = "mei"
CONTENT_TYPES = {SCORE_NAME: "application/xml", BOUNDARIES_NAME: "application/json"}
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_KEY = re.compile(r"^mei/([0-9a-f]{64})/(score\.mei|boundaries\.json)$")
_MAX_BYTES = 64 * 1024 * 1024


class PublishBlocked(_ContractPublishBlocked):
    """Publication refused. ``codes`` are stable machine-readable reasons."""

    def __init__(self, codes: Sequence[str], message: str = "") -> None:
        self.codes: tuple[str, ...] = tuple(dict.fromkeys(codes))
        super().__init__(f"{', '.join(self.codes)}: {message}" if message else ", ".join(self.codes))


class AssetStore(_ContractAssetStore, Protocol):
    def content_sha256(self, key: str) -> str:
        """sha256 (hex) of the bytes currently stored at ``key`` (contract extension: needed for KEY_COLLISION)."""
        ...


# --- safe reads ----------------------------------------------------------------------------------


def _read_regular(path: Path) -> bytes:
    """Bytes of a regular file reached without following a symlink. Raises ``PublishBlocked``."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        raise PublishBlocked(["ASSET_MISSING"], f"{path.name} is missing") from None
    except OSError:
        raise PublishBlocked(["UNSAFE_PATH"], f"{path.name} cannot be opened safely (symlink?)") from None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise PublishBlocked(["UNSAFE_PATH"], f"{path.name} is not a regular file")
        if info.st_size > _MAX_BYTES:
            raise PublishBlocked(["UNSAFE_PATH"], f"{path.name} is implausibly large")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            return handle.read(_MAX_BYTES + 1)
    finally:
        os.close(fd)


def _digest_dir(artifact_dir: Path, digest: str) -> Path:
    if not _SHA256.match(digest):
        raise PublishBlocked(["UNSAFE_PATH"], f"artifact digest {digest!r} is not a sha256")
    folder = artifact_dir / digest
    try:
        mode = folder.lstat().st_mode
    except FileNotFoundError:
        raise PublishBlocked(["ASSET_MISSING"], f"artifact directory for {digest} is missing") from None
    if not stat.S_ISDIR(mode):  # lstat: a symlink to a directory is not S_ISDIR
        raise PublishBlocked(["UNSAFE_PATH"], f"artifact directory for {digest} is not a plain directory")
    extra = sorted(entry.name for entry in os.scandir(folder) if entry.name not in ALLOWED_NAMES)
    if extra:
        raise PublishBlocked(["UNSAFE_PATH"], f"unexpected entries in {digest}: {extra[:3]}")
    return folder


# --- verification --------------------------------------------------------------------------------


def verify_publish_bundle(
    artifact_dir: Path,
    records: Sequence[ConversionRecord],
    current_inputs: Callable[[ConversionRecord], ConversionInputs],
) -> VerifiedBundle:
    """Key -> sha256 of every file that may be published, or ``PublishBlocked`` listing all reasons."""
    files: dict[str, str] = {}
    problems: list[tuple[str, str]] = []
    for record in records:
        try:
            files.update(_verify_record(artifact_dir, record, current_inputs))
        except PublishBlocked as blocked:
            problems.extend((code, str(blocked)) for code in blocked.codes)
    if problems:
        raise PublishBlocked([c for c, _ in problems], "; ".join(dict.fromkeys(m for _, m in problems)))
    return VerifiedBundle(root=artifact_dir, files=files)


def _verify_record(
    artifact_dir: Path, record: ConversionRecord, current_inputs: Callable[[ConversionRecord], ConversionInputs]
) -> dict[str, str]:
    digest = record.artifact_sha256 or ""
    if record.state != "approved":
        raise PublishBlocked(["NOT_APPROVED"], f"{record.source_path} state is {record.state}")
    if not approval_is_current(record, current_inputs(record)):
        raise PublishBlocked(["STALE_APPROVAL"], f"{record.source_path} approval is stale")
    if not digest:
        raise PublishBlocked(["HASH_MISMATCH"], f"{record.source_path} has no artifact sha256")
    folder = _digest_dir(artifact_dir, digest)
    mei = _read_regular(folder / SCORE_NAME)
    actual = hashlib.sha256(mei).hexdigest()
    if actual != digest:
        raise PublishBlocked(["HASH_MISMATCH"], f"{SCORE_NAME} sha256 {actual} != record {digest}")
    boundaries = _read_regular(folder / BOUNDARIES_NAME)
    return {
        f"{PREFIX}/{digest}/{SCORE_NAME}": actual,
        f"{PREFIX}/{digest}/{BOUNDARIES_NAME}": hashlib.sha256(boundaries).hexdigest(),
    }


# --- publication ---------------------------------------------------------------------------------


def publish_verified(bundle: VerifiedBundle, store: AssetStore) -> PublishReport:
    """Upload each verified file once. Re-checks every file just before its upload; never overwrites."""
    # Everything is re-read and re-hashed before the first byte leaves, so a swap is caught up front.
    payloads: list[tuple[str, bytes, str, str]] = []
    for key, expected in sorted(bundle.files.items()):
        match = _KEY.match(key)
        if match is None or not _SHA256.match(expected):
            raise PublishBlocked(["UNSAFE_PATH"], f"refusing key {key!r}")
        digest, name = match.groups()
        data = _read_regular(bundle.root / digest / name)
        actual = hashlib.sha256(data).hexdigest()
        if actual != expected:
            raise PublishBlocked(["HASH_MISMATCH"], f"{key} changed after verification ({actual} != {expected})")
        payloads.append((key, data, CONTENT_TYPES[name], expected))
    uploaded: list[str] = []
    skipped: list[str] = []
    for key, data, content_type, expected in payloads:
        if store.exists(key) or not store.put_if_absent(key, data, content_type):
            if store.content_sha256(key) != expected:
                raise PublishBlocked(["KEY_COLLISION"], f"{key} already holds different bytes")
            skipped.append(key)
        else:
            uploaded.append(key)
    return PublishReport(uploaded=tuple(uploaded), skipped_existing=tuple(skipped))


# --- R2 transport --------------------------------------------------------------------------------


class R2AssetStore:
    """``AssetStore`` over the S3 API of R2, with the transport semantics of ``pipeline.upload``.

    Credentials come from the environment (``pipeline.upload.require_credentials``); the client is
    built by ``pipeline.upload._client`` and the HEAD logic is ``pipeline.upload.exists``.
    """

    def __init__(self, client: Any, bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    @classmethod
    def from_environment(cls) -> R2AssetStore:
        from pipeline import upload

        creds = upload.require_credentials()
        return cls(upload._client(creds), creds.bucket)

    def exists(self, key: str) -> bool:
        from pipeline import upload

        return upload.exists(self._client, self._bucket, key)

    def put_if_absent(self, key: str, data: bytes, content_type: str) -> bool:
        from botocore.exceptions import ClientError

        from pipeline import upload

        if self.exists(key):
            return False
        try:
            self._client.put_object(
                Bucket=self._bucket, Key=key, Body=data, ContentType=content_type,
                CacheControl=upload.CACHE_CONTROL, IfNoneMatch="*",
            )
        except ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code in ("PreconditionFailed", "412", "ConditionalRequestConflict"):
                return False  # lost a race to another writer: their object stays
            raise
        return True

    def content_sha256(self, key: str) -> str:
        body = self._client.get_object(Bucket=self._bucket, Key=key)["Body"]
        digest = hashlib.sha256()
        for chunk in iter(lambda: body.read(1 << 20), b""):
            digest.update(chunk)
        return digest.hexdigest()
