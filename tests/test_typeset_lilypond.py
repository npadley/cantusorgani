"""The pinned LilyPond: found only at the pinned version, installed only when
its checksum matches."""

import hashlib
import io
import tarfile
from pathlib import Path

import pytest

from pipeline.typeset import lilypond
from pipeline.typeset.lilypond import LilyPondError, Pin, load_pin, platform_key


def pin_for(body: bytes, key: str = "linux-x86_64") -> Pin:
    return Pin(version="2.26.0", builds={key: {"url": "https://example.org/ly.tgz",
                                                "sha256": hashlib.sha256(body).hexdigest()}})


def archive() -> bytes:
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as tar:
        script = b"#!/bin/sh\necho 'GNU LilyPond 2.26.0 (running Guile 3.0)'\n"
        info = tarfile.TarInfo("lilypond-2.26.0/bin/lilypond")
        info.size, info.mode = len(script), 0o755
        tar.addfile(info, io.BytesIO(script))
    return data.getvalue()


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_load_pin_names_a_build_for_each_platform_with_its_checksum():
    pin = load_pin()
    assert pin.version == "2.26.0"
    assert set(pin.builds) == {"linux-x86_64", "darwin-arm64", "darwin-x86_64"}
    assert all(len(b["sha256"]) == 64 for b in pin.builds.values())


@pytest.mark.parametrize(("system", "machine", "key"), [
    ("Linux", "x86_64", "linux-x86_64"), ("Darwin", "arm64", "darwin-arm64"), ("Linux", "aarch64", "linux-arm64"),
])
def test_platform_key_names_the_release_build(system, machine, key):
    assert platform_key(system, machine) == key


def test_install_unpacks_a_checked_archive_and_finds_it(tmp_path, monkeypatch):
    body = archive()
    monkeypatch.setattr("urllib.request.urlopen", lambda url, timeout: FakeResponse(body))
    binary = lilypond.install(pin_for(body), vendor=tmp_path, key="linux-x86_64")
    assert binary == tmp_path / "lilypond-2.26.0" / "bin" / "lilypond"
    monkeypatch.delenv("NOH_LILYPOND", raising=False)
    monkeypatch.setattr(lilypond.shutil, "which", lambda name: None)
    assert lilypond.find(pin_for(body), vendor=tmp_path) == binary


def test_install_refuses_an_archive_that_is_not_the_pinned_one(tmp_path, monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda url, timeout: FakeResponse(b"tampered"))
    with pytest.raises(LilyPondError, match="not the pinned"):
        lilypond.install(pin_for(archive()), vendor=tmp_path, key="linux-x86_64")
    assert list(tmp_path.iterdir()) == []


def test_install_names_the_platforms_it_has(tmp_path):
    with pytest.raises(LilyPondError, match="no pinned LilyPond build for windows-x86_64"):
        lilypond.install(pin_for(b""), vendor=tmp_path, key="windows-x86_64")


def test_find_refuses_another_version_and_says_how_to_install(tmp_path, monkeypatch):
    other = tmp_path / "lilypond"
    other.write_text("#!/bin/sh\necho 'GNU LilyPond 2.24.3'\n")
    other.chmod(0o755)
    monkeypatch.setenv("NOH_LILYPOND", str(other))
    monkeypatch.setattr(lilypond.shutil, "which", lambda name: None)
    with pytest.raises(LilyPondError, match=r"(?s)2\.26\.0 is needed .*is 2\.24\.3.*noh lilypond-install"):
        lilypond.find(pin_for(b""), vendor=tmp_path / "none")


def test_home_is_under_vendor(tmp_path: Path):
    assert lilypond.home(pin_for(b""), tmp_path) == tmp_path / "lilypond-2.26.0"
