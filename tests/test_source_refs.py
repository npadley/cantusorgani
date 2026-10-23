"""Shared scan-ref contract and the reviewed source registry (Phase 1 M1)."""

import copy
import json
import shutil
import uuid
from pathlib import Path

import pytest
import yaml

from pipeline.source_refs import load_sources, parse_range, parse_ref

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
FIXTURES = ROOT / "tests/fixtures/identities/model"
CASES = json.loads((FIXTURES / "ref-cases.json").read_text())


@pytest.mark.parametrize("case", CASES["refs"], ids=lambda case: case["name"])
def test_parse_ref_shared_contract(case):
    if "error" in case:
        with pytest.raises(ValueError):
            parse_ref(case["text"], set(CASES["known_sources"]))
    else:
        assert parse_ref(case["text"], set(CASES["known_sources"])) == case["result"]


@pytest.mark.parametrize("case", CASES["ranges"], ids=lambda case: case["name"])
def test_parse_range_shared_contract(case):
    if "error" in case:
        with pytest.raises(ValueError):
            parse_range(case["text"], set(CASES["known_sources"]))
    else:
        assert list(parse_range(case["text"], set(CASES["known_sources"]))) == case["result"]


def test_load_sources_noh_registry_validates_and_preserves_labels():
    registry = load_sources(DATA)
    namespace = uuid.uuid5(uuid.NAMESPACE_URL, "https://cantusorgani.org/identity/v1")
    source = registry["sources"][0]
    assert source["id"] == "src_" + str(uuid.uuid5(namespace, "src\0noh"))
    assert source["licence_reference"] == "data/LICENSES.md"
    volumes = yaml.safe_load((DATA / "volumes.yml").read_text())["volumes"]
    editions = registry["editions"]
    assert len(editions) == 7
    assert [edition["id"] for edition in editions] == sorted(e["id"] for e in editions)
    assert {e["legacy_volume"] for e in editions} == set(volumes)
    for edition in editions:
        key = edition["legacy_volume"]
        assert edition["id"] == "edn_" + str(uuid.uuid5(namespace, "edn\0" + key))
        assert edition["source_id"] == source["id"]
        assert edition["title"] == volumes[key]["title"]
        assert edition["citation_label"] == f"Nova Organi Harmonia, part {volumes[key]['part']}"
        assert edition["scan_registry_key"] == key
        assert edition["rights_state"] == "cleared"
        assert edition["rights_reference"] == "data/LICENSES.md"
        assert edition["policy"]["show_related_hymns"] == (key == "noh8")
        assert edition["policy"]["borrow_whole_reference"] == (key != "noh7")
    eighth = next(e for e in editions if e["legacy_volume"] == "noh8")
    assert eighth["policy"]["related_hymns_heading"] == "Related hymn settings in Book VII"


@pytest.fixture
def registry_dir(tmp_path):
    (tmp_path / "identities").mkdir()
    (tmp_path / "schema").mkdir()
    shutil.copy(DATA / "schema/identities.json", tmp_path / "schema/identities.json")
    shutil.copy(DATA / "identities/sources.json", tmp_path / "identities/sources.json")
    shutil.copy(DATA / "volumes.yml", tmp_path / "volumes.yml")
    return tmp_path


def write_registry(data_dir, registry):
    (data_dir / "identities/sources.json").write_text(json.dumps(registry))


def test_load_sources_missing_scan_registry_key_fails(registry_dir):
    registry = load_sources(registry_dir)
    registry["editions"][0]["scan_registry_key"] = "missing-scan"
    write_registry(registry_dir, registry)
    with pytest.raises(ValueError, match="missing-scan"):
        load_sources(registry_dir)


@pytest.mark.parametrize("mutation", [
    "unknown-top-field", "unknown-source-field", "unknown-edition-field", "unknown-policy-field",
    "missing-source-field", "missing-edition-field", "missing-policy-field", "bad-version",
    "boolean-version", "bad-source-id", "bad-edition-id", "bad-rights", "bad-policy-type",
    "bad-source-key", "bad-sort-order", "dangling-source", "duplicate-source-id",
    "duplicate-edition-id", "duplicate-volume", "empty-title", "null-sources",
])
def test_load_sources_invalid_registry_fails(registry_dir, mutation):
    registry = load_sources(registry_dir)
    source = registry["sources"][0]
    edition = registry["editions"][0]
    policy = edition["policy"]
    if mutation == "unknown-top-field":
        registry["unexpected"] = True
    elif mutation == "unknown-source-field":
        source["unexpected"] = True
    elif mutation == "unknown-edition-field":
        edition["sha256"] = "must stay in volumes.yml"
    elif mutation == "unknown-policy-field":
        policy["unexpected"] = True
    elif mutation == "missing-source-field":
        del source["licence_reference"]
    elif mutation == "missing-edition-field":
        del edition["scan_registry_key"]
    elif mutation == "missing-policy-field":
        del policy["reference_group"]
    elif mutation == "bad-version":
        registry["schema_version"] = 2
    elif mutation == "boolean-version":
        registry["schema_version"] = True
    elif mutation == "bad-source-id":
        source["id"] = "src_noh"
    elif mutation == "bad-edition-id":
        edition["id"] = "edn_noh1"
    elif mutation == "bad-rights":
        edition["rights_state"] = "public-domain"
    elif mutation == "bad-policy-type":
        policy["borrow_whole_reference"] = "false"
    elif mutation == "bad-source-key":
        edition["legacy_volume"] = "UPPER"
    elif mutation == "bad-sort-order":
        edition["sort_order"] = 1.5
    elif mutation == "dangling-source":
        edition["source_id"] = "src_00000000-0000-4000-8000-000000000000"
    elif mutation == "duplicate-source-id":
        registry["sources"].append(copy.deepcopy(source))
    elif mutation == "duplicate-edition-id":
        registry["editions"].append(copy.deepcopy(edition))
    elif mutation == "duplicate-volume":
        registry["editions"][1]["legacy_volume"] = edition["legacy_volume"]
    elif mutation == "empty-title":
        edition["title"] = ""
    elif mutation == "null-sources":
        registry["sources"] = None
    write_registry(registry_dir, registry)
    with pytest.raises(ValueError):
        load_sources(registry_dir)


def test_load_sources_numbered_hymnal_without_pdf_pages_validates(registry_dir):
    shutil.copy(FIXTURES / "numbered-hymnal/sources.json", registry_dir / "identities/sources.json")
    (registry_dir / "volumes.yml").write_text("volumes: {}\n")
    registry = load_sources(registry_dir)
    edition = registry["editions"][0]
    assert edition["legacy_volume"] is None
    assert edition["scan_registry_key"] is None
    assert edition["part"] is None
    assert edition["rights_state"] == "unknown"
    # The full graph gate belongs to M2; these locators are its non-PDF input.
    items = json.loads((FIXTURES / "numbered-hymnal/items.json").read_text())
    assert [item["locator"]["item_number"] for item in items] == ["1", "2"]
    assert all("pdf_pages" not in item["locator"] for item in items)
    assert all("system_refs" not in item["locator"] for item in items)


def test_schema_completed_identity_documents_validate():
    from pipeline.identities import build
    from pipeline.identities.model import validate

    result = build(DATA, write=False)
    validate(json.loads((DATA / 'identities/ledger.json').read_text()), 'ledger', DATA)
    for name in ('snapshot', 'aliases', 'migration'):
        validate(result[f'{name}.json'], name, DATA)
    source = yaml.safe_load((DATA / 'identities/aliases.yml').read_text())
    validate(source, 'aliasSource', DATA)


def test_load_sources_preserves_reviewed_notes(registry_dir):
    registry = load_sources(registry_dir)
    registry['sources'][0]['notes'] = 'Reviewed source metadata.'
    registry['editions'][0]['notes'] = 'Registered scans only.'
    write_registry(registry_dir, registry)
    assert load_sources(registry_dir) == registry
