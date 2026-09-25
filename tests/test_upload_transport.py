"""R2 transport tests against a fake S3 client.

boto3 is the external dependency, so it is replaced at the seam (`_client`) with
an in-memory store that raises botocore's real ClientError shapes. The transport
logic itself runs unmodified.
"""

from pathlib import Path

import pytest
from botocore.exceptions import ClientError

from pipeline import upload
from pipeline.upload import Credentials, UploadPlan, list_published, upload_all

CREDS = Credentials(account_id="acct", access_key_id="id", secret_access_key="secret",
                    bucket="cantusorgani-assets")


class FakeS3:
    """Minimal S3: head_object, put_object, paginated list_objects_v2."""

    def __init__(self, existing: dict[str, bytes] | None = None, page_size: int = 1000,
                 fail_on: set[str] | None = None, head_error: str | None = None):
        self.objects: dict[str, bytes] = dict(existing or {})
        self.puts: list[dict[str, object]] = []
        self.page_size = page_size
        self.fail_on = fail_on or set()
        self.head_error = head_error

    def head_object(self, Bucket: str, Key: str) -> dict[str, object]:
        if self.head_error:
            raise ClientError({"Error": {"Code": self.head_error}}, "HeadObject")
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {}

    def put_object(self, Bucket: str, Key: str, Body: bytes, **extra: object) -> None:
        if Key in self.fail_on:
            raise ClientError({"Error": {"Code": "InternalError"}}, "PutObject")
        self.objects[Key] = Body
        self.puts.append({"Key": Key, **extra})

    def list_objects_v2(self, Bucket: str, MaxKeys: int = 1000,
                        ContinuationToken: str | None = None) -> dict[str, object]:
        keys = sorted(self.objects)
        start = int(ContinuationToken or 0)
        page = keys[start:start + self.page_size]
        response: dict[str, object] = {"Contents": [{"Key": k, "Size": len(self.objects[k])}
                                                    for k in page], "KeyCount": len(page)}
        if start + self.page_size < len(keys):
            response["NextContinuationToken"] = str(start + self.page_size)
        return response


@pytest.fixture
def s3(monkeypatch):
    """Factory installing a FakeS3 as the client the transport will use."""
    def install(**kwargs: object) -> FakeS3:
        fake = FakeS3(**kwargs)
        monkeypatch.setattr(upload, "_client", lambda creds: fake)
        return fake
    return install


@pytest.fixture
def slice_files(tmp_path) -> list[UploadPlan]:
    plans = []
    for name, key in (("000.webp", "systems/noh5/0051/000-aaaaaaaaaaaa.webp"),
                      ("000@2x.webp", "systems/noh5/0051/000-aaaaaaaaaaaa@2x.webp"),
                      ("000@2x.png", "systems/noh5/0051/000-aaaaaaaaaaaa@2x.png")):
        path = tmp_path / name
        path.write_bytes(name.encode())
        plans.append(UploadPlan(key=key, path=path))
    return plans


def test_upload_all_new_objects_are_uploaded_with_type_and_cache(s3, slice_files):
    fake = s3()
    report = upload_all(slice_files, CREDS)
    assert (report.uploaded, report.skipped, report.failed) == (3, 0, [])
    types = {p["Key"].rsplit(".", 1)[1]: p["ContentType"] for p in fake.puts}
    assert types == {"webp": "image/webp", "png": "image/png"}
    assert all("immutable" in str(p["CacheControl"]) for p in fake.puts)


def test_upload_all_existing_keys_are_skipped_never_overwritten(s3, slice_files):
    """A content-hashed key already holds identical bytes; overwriting could only
    clobber a URL that deployed HTML points at."""
    existing = {slice_files[0].key: b"already there"}
    fake = s3(existing=existing)
    report = upload_all(slice_files, CREDS)
    assert (report.uploaded, report.skipped) == (2, 1)
    assert fake.objects[slice_files[0].key] == b"already there"


def test_upload_all_failure_is_collected_not_raised(s3, slice_files):
    s3(fail_on={slice_files[1].key})
    report = upload_all(slice_files, CREDS)
    assert report.uploaded == 2
    assert [key for key, _ in report.failed] == [slice_files[1].key]
    assert "ClientError" in report.failed[0][1]


def test_upload_all_dry_run_contacts_nothing(monkeypatch, slice_files):
    def forbidden(_creds):
        raise AssertionError("dry run must not create a client")
    monkeypatch.setattr(upload, "_client", forbidden)
    report = upload_all(slice_files, CREDS, dry_run=True)
    assert report.uploaded == 3


def test_upload_all_unexpected_file_type_is_refused(s3, tmp_path):
    secret = tmp_path / "secrets.env"
    secret.write_text("TOKEN=x")
    report = upload_all([UploadPlan(key="systems/x.env", path=secret)], CREDS)
    assert report.uploaded == 0
    assert "refusing to upload" in report.failed[0][1]


def test_upload_all_without_credentials_raises_before_any_work(monkeypatch, slice_files):
    for name in upload.REQUIRED_VARS:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(RuntimeError, match="missing R2 credentials"):
        upload_all(slice_files)


def test_exists_non_404_error_propagates(s3):
    """A permissions error must not be mistaken for 'object absent' — that would
    turn an auth failure into a silent re-upload attempt."""
    fake = s3(head_error="403")
    with pytest.raises(ClientError):
        upload.exists(fake, "b", "k")


def test_list_published_parses_keys_across_pages(s3):
    keys = {f"systems/noh5/{p:04d}/{i:03d}-{'b' * 12}{v}": b"x"
            for p in (51, 52) for i in range(3) for v in (".webp", "@2x.webp", "@2x.png")}
    s3(existing=keys, page_size=4)       # forces several continuation pages
    found = list_published("noh5", CREDS)
    assert set(found) == {51, 52}
    assert found[51] == {0: "b" * 12, 1: "b" * 12, 2: "b" * 12}


def test_list_published_ignores_other_volumes_and_foreign_keys(s3):
    s3(existing={
        "systems/noh5/0051/000-cccccccccccc.webp": b"x",
        "systems/noh1/0051/000-dddddddddddd.webp": b"x",
        "robots.txt": b"x",
        "systems/noh5/0051/not-a-slice.webp": b"x",
    })
    assert list_published("noh5", CREDS) == {51: {0: "c" * 12}}


def test_content_type_for_rejects_unknown_suffix():
    with pytest.raises(ValueError, match="refusing"):
        upload.content_type_for(Path("a.jpg"))
