"""Stage 7: publish slices to Cloudflare R2 over its S3-compatible API.

Credentials come from the environment only -- never a file in the repo, never a
default, never a literal. A default would silently publish into somebody else's
bucket.

Uploads are write-if-absent. Keys carry a content hash, so an object already at
a key holds identical bytes by construction; overwriting could only replace good
bytes with the same bytes, or clobber a URL that deployed HTML already points
at. Skipping is both cheaper and safer.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

REQUIRED_VARS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
CONTENT_TYPES = {".webp": "image/webp", ".png": "image/png",
                 # Typeset music (pipeline/typeset/publish.py), checked before upload.
                 ".svg": "image/svg+xml", ".pdf": "application/pdf"}
# Slices are immutable: the key changes whenever the bytes change, which is the
# entire point of content addressing.
CACHE_CONTROL = "public, max-age=31536000, immutable"
DEFAULT_WORKERS = 8


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
            f"  Create an R2 API token with Object Read & Write:\n"
            f"    Cloudflare dashboard > R2 > API > Manage API tokens\n"
            f"  Then copy .dev.vars.example to .dev.vars and export them, or set\n"
            f"  them in your shell. Run `uv run noh doctor` to check."
        )
    return Credentials(
        account_id=source["R2_ACCOUNT_ID"],
        access_key_id=source["R2_ACCESS_KEY_ID"],
        secret_access_key=source["R2_SECRET_ACCESS_KEY"],
        bucket=source["R2_BUCKET"],
    )


# What each value looks like, so a value pasted into the wrong slot is named
# before any request is made. Messages never repeat the value itself.
_HEX32 = re.compile(r"^[0-9a-f]{32}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def credential_problems(creds: Credentials) -> list[str]:
    """Values that cannot be right: an API token where the account ID goes, a
    key of the wrong length. Empty when every value has the expected shape."""
    problems: list[str] = []
    if creds.account_id.startswith("cfat_"):
        problems.append("R2_ACCOUNT_ID holds a Cloudflare API token (it starts with cfat_), "
                        "not the account ID: the 32-character ID on the R2 overview page")
    elif not _HEX32.match(creds.account_id):
        problems.append(f"R2_ACCOUNT_ID is {len(creds.account_id)} characters; "
                        "an account ID is 32 lowercase hex characters")
    if not _HEX32.match(creds.access_key_id):
        problems.append(f"R2_ACCESS_KEY_ID is {len(creds.access_key_id)} characters; "
                        "an R2 Access Key ID is 32 lowercase hex characters")
    if not _HEX64.match(creds.secret_access_key):
        problems.append(f"R2_SECRET_ACCESS_KEY is {len(creds.secret_access_key)} characters; "
                        "an R2 Secret Access Key is 64 lowercase hex characters")
    return problems


PROBE_PREFIX = "_probe/"


def probe(creds: Credentials) -> str:
    """Write, read back and delete one throwaway object: proof that the token
    can do what publishing needs. The key is new each time, so the probe can
    never touch a published object. Returns the key it used; raises on failure."""
    import uuid

    client = _client(creds)
    key = f"{PROBE_PREFIX}{uuid.uuid4().hex}.txt"
    body = b"cantusorgani r2-check\n"
    client.put_object(Bucket=creds.bucket, Key=key, Body=body, ContentType="text/plain")
    try:
        got = client.get_object(Bucket=creds.bucket, Key=key)["Body"].read()
        if got != body:
            raise RuntimeError(f"read back {len(got)} bytes from {key}, wrote {len(body)}")
    finally:
        client.delete_object(Bucket=creds.bucket, Key=key)
    if exists(client, creds.bucket, key):
        raise RuntimeError(f"{key} is still there after deleting it")
    return key


def content_type_for(path: Path) -> str:
    try:
        return CONTENT_TYPES[path.suffix.lower()]
    except KeyError:
        raise ValueError(
            f"refusing to upload {path.name}: only {sorted(CONTENT_TYPES)} are published"
        ) from None


def _client(creds: Credentials):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=creds.endpoint,
        aws_access_key_id=creds.access_key_id,
        aws_secret_access_key=creds.secret_access_key,
        region_name="auto",
        config=Config(retries={"max_attempts": 5, "mode": "standard"}),
    )


@dataclass(frozen=True)
class UploadPlan:
    key: str
    path: Path


@dataclass
class UploadReport:
    uploaded: int = 0
    skipped: int = 0
    failed: list[tuple[str, str]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.failed is None:
            self.failed = []


def exists(client, bucket: str, key: str) -> bool:
    from botocore.exceptions import ClientError

    try:
        client.head_object(Bucket=bucket, Key=key)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise
    return True


def upload_all(plans: Iterable[UploadPlan], creds: Credentials | None = None,
               workers: int = DEFAULT_WORKERS, dry_run: bool = False) -> UploadReport:
    plans = list(plans)
    report = UploadReport()
    if dry_run:
        # Counted, not sent. The caller must phrase this as "would upload": a
        # report that says "uploaded" when nothing left the machine is the same
        # class of lie as a migration run that reports success while dropping the
        # table it just created.
        report.uploaded = len(plans)
        return report

    resolved = creds if creds is not None else require_credentials()
    client = _client(resolved)

    def put(plan: UploadPlan) -> tuple[str, str | None]:
        try:
            content_type = content_type_for(plan.path)
            if exists(client, resolved.bucket, plan.key):
                return ("skipped", None)
            client.put_object(
                Bucket=resolved.bucket,
                Key=plan.key,
                Body=plan.path.read_bytes(),
                ContentType=content_type,
                CacheControl=CACHE_CONTROL,
            )
            return ("uploaded", None)
        except Exception as error:  # noqa: BLE001 - reported, not swallowed
            return ("failed", f"{type(error).__name__}: {error}")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for plan, (outcome, message) in zip(plans, pool.map(put, plans)):
            if outcome == "uploaded":
                report.uploaded += 1
            elif outcome == "skipped":
                report.skipped += 1
            else:
                report.failed.append((plan.key, message or "unknown error"))
    return report


KEY_PATTERN = re.compile(
    r"^systems/(?P<vol>[a-z0-9]+)/(?P<page>\d{4})/(?P<index>\d{3})-(?P<sha>[0-9a-f]{12})"
    r"(?P<variant>@2x)?\.(?P<suffix>webp|png)$"
)


def list_published(vol_id: str, creds: Credentials | None = None
                   ) -> dict[int, dict[int, str]]:
    """What is actually in the bucket: {pdf_page: {index: sha12}}.

    Reconciling against the store rather than against local state means the
    catalog describes URLs that provably resolve. A manifest rebuilt from here
    cannot claim a key the bucket does not hold.
    """
    resolved = creds if creds is not None else require_credentials()
    client = _client(resolved)
    found: dict[int, dict[int, str]] = {}
    token: str | None = None
    while True:
        kwargs: dict[str, object] = {"Bucket": resolved.bucket, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        response = client.list_objects_v2(**kwargs)
        for obj in response.get("Contents", []):
            match = KEY_PATTERN.match(obj["Key"])
            if not match or match.group("vol") != vol_id:
                continue
            page = int(match.group("page"))
            found.setdefault(page, {})[int(match.group("index"))] = match.group("sha")
        token = response.get("NextContinuationToken")
        if not token:
            break
    return found
