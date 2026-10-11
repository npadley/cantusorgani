from __future__ import annotations

import shutil
import socket
from pathlib import Path

import pytest

from pipeline.typeset.mei.schema import DEFAULT_ROOT, load_schema_bundle, validate_schema

FIXTURE = Path(__file__).parent / "fixtures/mei/kyrie-ix/experiment.mei"


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("network access attempted")

    monkeypatch.setattr(socket, "socket", boom)
    monkeypatch.setattr(socket, "create_connection", boom)
    monkeypatch.setattr(socket, "getaddrinfo", boom)


@pytest.fixture(scope="module")
def bundle():
    return load_schema_bundle()


def test_bundle_metadata(bundle) -> None:
    assert bundle.entry == "mei-CMN.rng"
    assert bundle.validator.startswith("lxml-relaxng ")
    assert len(bundle.sha256) == 64


def test_experiment_valid(bundle) -> None:
    assert validate_schema(FIXTURE.read_bytes(), bundle) == []


def test_bogus_element(bundle) -> None:
    xml = FIXTURE.read_bytes().replace(b"<mdiv>", b"<mdiv><bogus/>", 1)
    diags = validate_schema(xml, bundle)
    assert len(diags) == 1
    d = diags[0]
    assert d.code == "SCHEMA_INVALID" and d.severity == "error"
    assert d.source_location is not None
    assert d.source_location.filename == "<mei>"
    assert d.source_location.line > 0 and d.source_location.column == 0


HOSTILE = {
    "external_dtd": b'<!DOCTYPE mei SYSTEM "http://127.0.0.1:9/x.dtd">',
    "file_entity": b'<!DOCTYPE mei [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
    "http_entity": b'<!DOCTYPE mei [<!ENTITY xxe SYSTEM "http://127.0.0.1:9/e">]>',
    "bomb": (
        b'<!DOCTYPE mei [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">'
        b'<!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;">]>'
    ),
}


@pytest.mark.parametrize("name", sorted(HOSTILE))
def test_hostile_documents(bundle, name: str) -> None:
    src = FIXTURE.read_bytes()
    decl_end = src.index(b"?>") + 2 if src.lstrip().startswith(b"<?xml") else 0
    xml = src[:decl_end] + b"\n" + HOSTILE[name] + b"\n" + src[decl_end:]
    diags = validate_schema(xml, bundle)
    assert [d.code for d in diags] == ["SCHEMA_INVALID"]


def test_malformed_xml(bundle) -> None:
    diags = validate_schema(b"<mei><unclosed></mei>", bundle)
    assert diags and all(d.code == "SCHEMA_INVALID" for d in diags)
    assert diags[0].source_location is not None


def test_empty_and_binary_never_raise(bundle) -> None:
    for blob in (b"", b"\xff\xfe\x00garbage"):
        assert validate_schema(blob, bundle)[0].code == "SCHEMA_INVALID"


def test_tampered_schema_hash_raises(tmp_path: Path) -> None:
    root = tmp_path / "mei-5.0"
    shutil.copytree(DEFAULT_ROOT, root)
    with (root / "mei-CMN.rng").open("ab") as fh:
        fh.write(b"<!-- tampered -->")
    with pytest.raises(ValueError, match="sha256"):
        load_schema_bundle(root)
