"""Delete typeset renders nothing names any more: `noh typeset-prune`.

A render is published once under typeset/<hash>/ and never overwritten
(pipeline/typeset/render.py), so every change to a source or to the render
settings leaves the old files behind. This removes them. It keeps:

- every render the committed manifest.json and review.json name (the site's
  parts and the admin screen's queues);
- anything uploaded in the last `grace_days` days, whoever names it: a pull
  request's CI publishes its renders before it merges, and the deployed site
  can lag main by a build.

It only ever looks under typeset/: never the scans, never typeset-preview/.
Without --delete it only reports what it would remove. Run it from the Actions
tab ("typeset-prune" -> "Run workflow"; .github/workflows/typeset-prune.yml).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from pipeline.typeset.manifest import MANIFEST, PREFIX, REVIEW, hashes

GRACE_DAYS = 14
_KEY = re.compile(rf"^{PREFIX}/([0-9a-f]{{32}})/[^/]+$")


@dataclass(frozen=True)
class Stored:
    key: str
    size: int
    modified: datetime


@dataclass
class Plan:
    delete: list[Stored] = field(default_factory=list)
    #: Renders the committed files name.
    named: int = 0
    #: Files left because they are recent.
    recent: int = 0
    #: Files under typeset/ that are not a render's (left alone).
    other: int = 0

    @property
    def bytes(self) -> int:
        return sum(s.size for s in self.delete)

    @property
    def renders(self) -> int:
        return len({s.key.split("/")[1] for s in self.delete})


def plan(stored: Iterable[Stored], keep: set[str], now: datetime, grace_days: int = GRACE_DAYS) -> Plan:
    """What to delete: files of renders not in `keep` and older than the grace period."""
    if not keep:
        # An empty keep set means the manifest was not read: deleting against it
        # would take every render the site shows.
        raise ValueError("no render is named by the manifest or review files; refusing to prune")
    cutoff = now - timedelta(days=grace_days)
    out = Plan()
    for s in stored:
        m = _KEY.match(s.key)
        if not m:
            out.other += 1
        elif m.group(1) in keep:
            out.named += 1
        elif s.modified > cutoff:
            out.recent += 1
        else:
            out.delete.append(s)
    return out


def listing(client: Any, bucket: str) -> Iterator[Stored]:
    token: str | None = None
    while True:
        kwargs: dict[str, object] = {"Bucket": bucket, "Prefix": f"{PREFIX}/", "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        response = client.list_objects_v2(**kwargs)
        for obj in response.get("Contents", []):
            yield Stored(str(obj["Key"]), int(obj.get("Size", 0)), obj["LastModified"])
        token = response.get("NextContinuationToken")
        if not token:
            return


def delete(client: Any, bucket: str, stored: list[Stored]) -> list[str]:
    """Delete in batches of 1,000 (the API's limit); returns the failures."""
    failed: list[str] = []
    for start in range(0, len(stored), 1000):
        batch = [{"Key": s.key} for s in stored[start:start + 1000]]
        response = client.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
        failed += [f"{e.get('Key')}: {e.get('Message', e.get('Code', 'failed'))}" for e in response.get("Errors", [])]
    return failed


def prune(apply: bool = False, grace_days: int = GRACE_DAYS, creds: Any = None, now: datetime | None = None,
          manifest_path: Path = MANIFEST, review_path: Path = REVIEW) -> tuple[Plan, list[str]]:
    from pipeline.upload import _client, require_credentials

    resolved = creds if creds is not None else require_credentials()
    client = _client(resolved)
    keep = set(hashes(manifest_path, review_path))
    found = plan(listing(client, resolved.bucket), keep, now or datetime.now(UTC), grace_days)
    failed = delete(client, resolved.bucket, found.delete) if apply and found.delete else []
    return found, failed


__all__ = ["GRACE_DAYS", "Plan", "Stored", "delete", "listing", "plan", "prune"]
