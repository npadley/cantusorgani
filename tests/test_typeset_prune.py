"""noh typeset-prune: which renders go, against a fake S3 at the transport seam."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pipeline import upload
from pipeline.typeset.prune import Stored, plan, prune
from pipeline.upload import Credentials

CREDS = Credentials(account_id="acct", access_key_id="id", secret_access_key="secret", bucket="b")
NOW = datetime(2026, 9, 29, tzinfo=UTC)
OLD = NOW - timedelta(days=30)
NEW = NOW - timedelta(days=2)
SHOWN, REVIEWED, ORPHAN, FRESH = ("a" * 32, "b" * 32, "c" * 32, "d" * 32)
FILES = ("narrow.svg", "wide.svg", "letter.pdf", "a4.pdf")


def render(digest: str, when: datetime) -> list[Stored]:
    return [Stored(f"typeset/{digest}/{name}", 1000, when) for name in FILES]


class FakeS3:
    """list_objects_v2 by prefix (paged) and delete_objects."""

    def __init__(self, stored: list[Stored], page_size: int = 3, fail: set[str] | None = None):
        self.stored = {s.key: s for s in stored}
        self.page_size = page_size
        self.fail = fail or set()
        self.deleted: list[str] = []

    def list_objects_v2(self, Bucket: str, Prefix: str, MaxKeys: int = 1000,
                        ContinuationToken: str | None = None) -> dict[str, object]:
        keys = sorted(k for k in self.stored if k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start:start + self.page_size]
        out: dict[str, object] = {"Contents": [{"Key": k, "Size": self.stored[k].size,
                                                "LastModified": self.stored[k].modified} for k in page]}
        if start + self.page_size < len(keys):
            out["NextContinuationToken"] = str(start + self.page_size)
        return out

    def delete_objects(self, Bucket: str, Delete: dict[str, list[dict[str, str]]]) -> dict[str, object]:
        errors = []
        for obj in Delete["Objects"]:
            if obj["Key"] in self.fail:
                errors.append({"Key": obj["Key"], "Code": "InternalError", "Message": "try again"})
            else:
                self.deleted.append(obj["Key"])
                self.stored.pop(obj["Key"], None)
        return {"Errors": errors} if errors else {}


@pytest.fixture
def committed(tmp_path: Path) -> tuple[Path, Path]:
    manifest = tmp_path / "manifest.json"
    review = tmp_path / "review.json"
    manifest.write_text(json.dumps({"parts": [{"target": "part:x/introit", "file": "a.ly", "hash": SHOWN}]}))
    review.write_text(json.dumps({"items": [{"file": "b.ly", "status": "proposed", "hash": REVIEWED},
                                            {"file": "c.ly", "status": "broken"}]}))
    return manifest, review


def bucket() -> list[Stored]:
    return [*render(SHOWN, OLD), *render(REVIEWED, OLD), *render(ORPHAN, OLD), *render(FRESH, NEW),
            Stored("typeset/readme.txt", 10, OLD)]


def test_plan_orphaned_old_render_is_deleted_and_named_recent_and_other_kept():
    found = plan(bucket(), {SHOWN, REVIEWED}, NOW, grace_days=14)
    assert sorted(s.key for s in found.delete) == sorted(f"typeset/{ORPHAN}/{n}" for n in FILES)
    assert (found.named, found.recent, found.other, found.renders, found.bytes) == (8, 4, 1, 1, 4000)


def test_plan_empty_keep_set_refuses():
    with pytest.raises(ValueError, match="refusing to prune"):
        plan(bucket(), set(), NOW)


def test_prune_dry_run_deletes_nothing(monkeypatch, committed):
    fake = FakeS3(bucket())
    monkeypatch.setattr(upload, "_client", lambda creds: fake)
    found, failed = prune(apply=False, creds=CREDS, now=NOW, manifest_path=committed[0], review_path=committed[1])
    assert len(found.delete) == 4 and failed == [] and fake.deleted == []


def test_prune_delete_removes_only_the_orphan(monkeypatch, committed):
    fake = FakeS3(bucket())
    monkeypatch.setattr(upload, "_client", lambda creds: fake)
    prune(apply=True, creds=CREDS, now=NOW, manifest_path=committed[0], review_path=committed[1])
    assert sorted(fake.deleted) == sorted(f"typeset/{ORPHAN}/{n}" for n in FILES)
    assert all(not k.startswith(f"typeset/{ORPHAN}/") for k in fake.stored)
    assert f"typeset/{SHOWN}/wide.svg" in fake.stored and f"typeset/{FRESH}/wide.svg" in fake.stored


def test_prune_short_grace_takes_the_recent_orphan_too(monkeypatch, committed):
    fake = FakeS3(bucket())
    monkeypatch.setattr(upload, "_client", lambda creds: fake)
    found, _ = prune(apply=False, grace_days=1, creds=CREDS, now=NOW,
                     manifest_path=committed[0], review_path=committed[1])
    assert found.renders == 2


def test_prune_failed_delete_is_reported(monkeypatch, committed):
    fake = FakeS3(bucket(), fail={f"typeset/{ORPHAN}/wide.svg"})
    monkeypatch.setattr(upload, "_client", lambda creds: fake)
    _, failed = prune(apply=True, creds=CREDS, now=NOW, manifest_path=committed[0], review_path=committed[1])
    assert failed == [f"typeset/{ORPHAN}/wide.svg: try again"]
