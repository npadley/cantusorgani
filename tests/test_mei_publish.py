"""Card C1a: verified, write-once publication of approved conversions.

The uploader treats the artifact directory as data. These tests pin that it never reaches a
compiler, uploads only bytes whose sha256 it has just re-checked, and never overwrites a key.
"""

from __future__ import annotations

import ast
import dataclasses
import hashlib
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    ReviewDecision,
    ValidationReport,
)
from pipeline.typeset.mei.publish import (
    PublishBlocked,
    R2AssetStore,
    VerifiedBundle,
    publish_verified,
    verify_publish_bundle,
)
from pipeline.typeset.mei.review import apply_review

INPUTS = ConversionInputs(
    source_sha256="s", include_sha256="i", lilypond_version="2.26.0", extractor_version="listen_full/1",
    converter_version="c1", profile_id="accompaniment-v1", profile_sha256="p", schema_sha256="x",
    verovio_version="6.3.0-425dd7b", font_digest="f",
)
MEI = b'<?xml version="1.0"?><mei><measure xml:id="m001"/></mei>\n'
BOUNDARIES = b"[]\n"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def current(_: ConversionRecord) -> ConversionInputs:
    return INPUTS


def make_record(digest: str, **patch: object) -> ConversionRecord:
    base = ConversionRecord(
        source_path="data/typeset/src/x.ly", target="movement:x", render_hash="a" * 32, state="needs-review",
        inputs=INPUTS, artifact_sha256=digest, diagnostics=(),
        validation=ValidationReport(True, (), (), True, {}, {}), review=None,
    )
    decision = ReviewDecision(
        "Nick", "2026-10-10T00:00:00Z", INPUTS.digest(), digest, {c.id: "pass" for c in REQUIRED_MATRIX}, (),
        "approve",
    )
    return dataclasses.replace(apply_review(base, decision, INPUTS), **patch)


class FakeStore:
    def __init__(self, existing: dict[str, bytes] | None = None) -> None:
        self.objects: dict[str, bytes] = dict(existing or {})
        self.puts: list[tuple[str, str]] = []

    def exists(self, key: str) -> bool:
        return key in self.objects

    def put_if_absent(self, key: str, data: bytes, content_type: str) -> bool:
        if key in self.objects:
            return False
        self.objects[key] = data
        self.puts.append((key, content_type))
        return True

    def content_sha256(self, key: str) -> str:
        return sha(self.objects[key])


@pytest.fixture
def compiler_spy(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def boom(name: str):
        def inner(*args: object, **kwargs: object) -> None:
            calls.append(name)
            raise AssertionError(f"compiler entry point {name} was called")
        return inner

    from pipeline.typeset import lilypond, render

    monkeypatch.setattr(lilypond, "run", boom("lilypond.run"))
    for name in ("render", "render_all", "compile"):
        if hasattr(render, name):
            monkeypatch.setattr(render, name, boom(f"render.{name}"))
    return calls


@pytest.fixture
def world(tmp_path: Path) -> tuple[Path, ConversionRecord]:
    digest = sha(MEI)
    folder = tmp_path / "artifacts" / digest
    folder.mkdir(parents=True)
    (folder / "score.mei").write_bytes(MEI)
    (folder / "boundaries.json").write_bytes(BOUNDARIES)
    return tmp_path / "artifacts", make_record(digest)


def codes_of(error: pytest.ExceptionInfo[PublishBlocked]) -> tuple[str, ...]:
    return tuple(error.value.codes)


def test_verify_publish_bundle_valid_returns_recorded_keys(world, compiler_spy) -> None:
    artifacts, record = world
    bundle = verify_publish_bundle(artifacts, [record], current)
    digest = record.artifact_sha256
    assert bundle.files == {
        f"mei/{digest}/score.mei": sha(MEI),
        f"mei/{digest}/boundaries.json": sha(BOUNDARIES),
    }
    assert compiler_spy == []


def test_verify_publish_bundle_corrupt_mei_blocks_hash_mismatch(world) -> None:
    artifacts, record = world
    (artifacts / record.artifact_sha256 / "score.mei").write_bytes(MEI + b"<!-- x -->")
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [record], current)
    assert "HASH_MISMATCH" in codes_of(error)


def test_verify_publish_bundle_stale_record_blocks_stale_approval(world) -> None:
    artifacts, record = world
    changed = dataclasses.replace(INPUTS, include_sha256="other")
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [record], lambda _r: changed)
    assert codes_of(error) == ("STALE_APPROVAL",)


@pytest.mark.parametrize("state", ["needs-review", "unsupported", "rejected"])
def test_verify_publish_bundle_unapproved_record_blocks_not_approved(world, state) -> None:
    artifacts, record = world
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [dataclasses.replace(record, state=state, review=None)], current)
    assert codes_of(error) == ("NOT_APPROVED",)


def test_verify_publish_bundle_symlinked_score_blocks_unsafe_path(world, tmp_path) -> None:
    artifacts, record = world
    folder = artifacts / record.artifact_sha256
    outside = tmp_path / "outside.mei"
    outside.write_bytes(MEI)
    (folder / "score.mei").unlink()
    (folder / "score.mei").symlink_to(outside)
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [record], current)
    assert "UNSAFE_PATH" in codes_of(error)


def test_verify_publish_bundle_symlinked_digest_directory_blocks_unsafe_path(world, tmp_path) -> None:
    artifacts, record = world
    real = tmp_path / "real"
    (artifacts / record.artifact_sha256).rename(real)
    (artifacts / record.artifact_sha256).symlink_to(real, target_is_directory=True)
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [record], current)
    assert "UNSAFE_PATH" in codes_of(error)


def test_verify_publish_bundle_extra_file_blocks_unsafe_path(world) -> None:
    artifacts, record = world
    (artifacts / record.artifact_sha256 / "evil.ly").write_text("#(system \"id\")")
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [record], current)
    assert codes_of(error) == ("UNSAFE_PATH",)


def test_verify_publish_bundle_subdirectory_blocks_unsafe_path(world) -> None:
    artifacts, record = world
    (artifacts / record.artifact_sha256 / "sub").mkdir()
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [record], current)
    assert codes_of(error) == ("UNSAFE_PATH",)


@pytest.mark.parametrize("digest", ["../escape", "/etc", "a/b", ".." ])
def test_verify_publish_bundle_traversal_digest_blocks_unsafe_path(world, digest) -> None:
    artifacts, record = world
    bad = dataclasses.replace(record, artifact_sha256=digest)
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [bad], current)
    assert "UNSAFE_PATH" in codes_of(error)


def test_verify_publish_bundle_missing_boundaries_blocks(world) -> None:
    artifacts, record = world
    (artifacts / record.artifact_sha256 / "boundaries.json").unlink()
    with pytest.raises(PublishBlocked) as error:
        verify_publish_bundle(artifacts, [record], current)
    assert "ASSET_MISSING" in codes_of(error)


def test_publish_verified_valid_bundle_uploads_exactly_recorded_keys(world, compiler_spy) -> None:
    artifacts, record = world
    bundle = verify_publish_bundle(artifacts, [record], current)
    store = FakeStore()
    report = publish_verified(bundle, store)
    digest = record.artifact_sha256
    assert set(store.objects) == set(bundle.files) == {f"mei/{digest}/score.mei", f"mei/{digest}/boundaries.json"}
    assert dict(store.puts) == {
        f"mei/{digest}/score.mei": "application/xml",
        f"mei/{digest}/boundaries.json": "application/json",
    }
    assert set(report.uploaded) == set(bundle.files) and report.skipped_existing == ()
    assert store.objects[f"mei/{digest}/score.mei"] == MEI
    assert compiler_spy == []


def test_publish_verified_existing_key_same_bytes_is_skipped(world) -> None:
    artifacts, record = world
    bundle = verify_publish_bundle(artifacts, [record], current)
    key = f"mei/{record.artifact_sha256}/score.mei"
    store = FakeStore({key: MEI})
    report = publish_verified(bundle, store)
    assert report.skipped_existing == (key,)
    assert report.uploaded == (f"mei/{record.artifact_sha256}/boundaries.json",)


def test_publish_verified_existing_key_different_bytes_blocks_key_collision(world) -> None:
    artifacts, record = world
    bundle = verify_publish_bundle(artifacts, [record], current)
    key = f"mei/{record.artifact_sha256}/score.mei"
    store = FakeStore({key: b"different"})
    with pytest.raises(PublishBlocked) as error:
        publish_verified(bundle, store)
    assert codes_of(error) == ("KEY_COLLISION",)
    assert store.objects[key] == b"different"


def test_publish_verified_bytes_changed_after_verify_blocks_hash_mismatch(world) -> None:
    artifacts, record = world
    bundle = verify_publish_bundle(artifacts, [record], current)
    (artifacts / record.artifact_sha256 / "score.mei").write_bytes(b"swapped")
    store = FakeStore()
    with pytest.raises(PublishBlocked) as error:
        publish_verified(bundle, store)
    assert "HASH_MISMATCH" in codes_of(error)
    assert store.objects == {}


def test_publish_verified_file_replaced_by_symlink_after_verify_blocks(world, tmp_path) -> None:
    artifacts, record = world
    bundle = verify_publish_bundle(artifacts, [record], current)
    outside = tmp_path / "o.mei"
    outside.write_bytes(MEI)
    target = artifacts / record.artifact_sha256 / "score.mei"
    target.unlink()
    target.symlink_to(outside)
    store = FakeStore()
    with pytest.raises(PublishBlocked) as error:
        publish_verified(bundle, store)
    assert "UNSAFE_PATH" in codes_of(error)
    assert store.objects == {}


def test_publish_verified_tampered_bundle_key_blocks_unsafe_path(world) -> None:
    artifacts, record = world
    bundle = verify_publish_bundle(artifacts, [record], current)
    forged = VerifiedBundle(bundle.root, {"mei/../../x/score.mei": "0" * 64})
    with pytest.raises(PublishBlocked) as error:
        publish_verified(forged, FakeStore())
    assert "UNSAFE_PATH" in codes_of(error)


def test_publish_module_imports_no_compiler_paths() -> None:
    source = (Path(__file__).resolve().parents[1] / "pipeline/typeset/mei/publish.py").read_text()
    forbidden = {"lilypond", "render", "extract", "listen"}
    for node in ast.walk(ast.parse(source)):
        names: list[str] = []
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            base = ("." * node.level) + (node.module or "")
            names = [base] + [f"{base}.{a.name}" for a in node.names]
        for name in names:
            assert not forbidden & set(name.replace("..", ".").split(".")), name


# --- R2AssetStore over a fake S3 client ------------------------------------------------------------


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.put_kwargs: list[dict[str, object]] = []

    def head_object(self, Bucket: str, Key: str) -> dict[str, object]:
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {}

    def put_object(self, Bucket: str, Key: str, Body: bytes, **extra: object) -> None:
        if extra.get("IfNoneMatch") == "*" and Key in self.objects:
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        self.put_kwargs.append({"Key": Key, **extra})
        self.objects[Key] = Body

    def get_object(self, Bucket: str, Key: str) -> dict[str, object]:
        import io

        return {"Body": io.BytesIO(self.objects[Key])}


def test_r2_asset_store_put_if_absent_never_overwrites() -> None:
    client = FakeS3()
    store = R2AssetStore(client, "bucket")
    assert store.put_if_absent("mei/k", b"one", "application/xml") is True
    assert store.put_if_absent("mei/k", b"two", "application/xml") is False
    assert client.objects["mei/k"] == b"one"
    assert store.exists("mei/k") and not store.exists("mei/other")
    assert store.content_sha256("mei/k") == sha(b"one")
    assert client.put_kwargs[0]["IfNoneMatch"] == "*"
    assert client.put_kwargs[0]["ContentType"] == "application/xml"


def test_r2_asset_store_lost_race_precondition_failed_returns_false() -> None:
    client = FakeS3()

    class Racy(FakeS3):
        def head_object(self, Bucket: str, Key: str) -> dict[str, object]:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")  # looks absent, then someone wins

    racy = Racy()
    racy.objects["mei/k"] = b"winner"
    store = R2AssetStore(racy, "bucket")
    assert store.put_if_absent("mei/k", b"loser", "application/xml") is False
    assert racy.objects["mei/k"] == b"winner"
    del client
