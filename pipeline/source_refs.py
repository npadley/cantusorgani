"""Registered scan references and reviewed source metadata.

Parsing checks syntax and registry membership only. Callers must check actual
system membership and adapter-specific page bounds before using a scan ref.
"""

import json
import re
from collections.abc import Collection
from pathlib import Path
from typing import TypedDict

import yaml


class SourceRef(TypedDict):
    volume: str
    pdf_page: int
    index: int


_REF = r"([a-z][a-z0-9-]{0,63})/([0-9]{4})/([0-9]{3})"
_RANGE = re.compile(rf"({_REF})-({_REF})")


def parse_ref(text: str, known_sources: Collection[str]) -> SourceRef:
    """Return a registered scan address, or raise ValueError; never trim input."""
    match = re.fullmatch(_REF, text)
    if match is None:
        raise ValueError(f"invalid source ref: {text!r}")
    volume, page, index = match.groups()
    if volume not in known_sources:
        raise ValueError(f"unknown source key: {volume!r}")
    return {"volume": volume, "pdf_page": int(page), "index": int(index)}


def parse_range(text: str, known_sources: Collection[str]) -> tuple[SourceRef, SourceRef]:
    """Return inclusive first/last parsed refs; reject cross-source/backwards ranges.

    Match two complete refs rather than splitting on source-key hyphens.
    Equal endpoints are valid (one system).
    """
    match = _RANGE.fullmatch(text)
    if match is None:
        raise ValueError(f"invalid source range: {text!r}")
    first = parse_ref(match[1], known_sources)
    last = parse_ref(match[5], known_sources)
    if first["volume"] != last["volume"]:
        raise ValueError(f"source range runs across two sources: {text!r}")
    if (first["pdf_page"], first["index"]) > (last["pdf_page"], last["index"]):
        raise ValueError(f"source range runs backwards: {text!r}")
    return first, last


def _validate_schema(value, schema, definitions: dict, path: str = "sources.yml") -> None:
    """Validate the JSON Schema vocabulary used by the M1 registry, offline.

    No JSON Schema library is a pipeline dependency. Keep the schema as the
    authority for fields/types; fail closed on unsupported validation keywords
    so M2 cannot accidentally add a constraint that this loader ignores.
    """
    if schema is False:
        raise ValueError(f"{path}: schema is reserved for M2")
    if schema is True:
        return
    supported = {
        "$schema", "$id", "$comment", "$defs", "title", "description", "$ref",
        "type", "const", "enum", "required", "properties", "additionalProperties",
        "items", "minLength", "pattern",
    }
    if unknown := schema.keys() - supported:
        raise ValueError(f"{path}: unsupported schema keywords: {sorted(unknown)}")
    if "$ref" in schema:
        ref = schema["$ref"]
        prefix = "#/$defs/"
        if not ref.startswith(prefix) or ref[len(prefix):] not in definitions:
            raise ValueError(f"{path}: unsupported schema reference: {ref}")
        _validate_schema(value, definitions[ref[len(prefix):]], definitions, path)
    types = {
        "object": lambda v: isinstance(v, dict),
        "array": lambda v: isinstance(v, list),
        "string": lambda v: isinstance(v, str),
        "integer": lambda v: type(v) is int,
        "boolean": lambda v: type(v) is bool,
        "null": lambda v: v is None,
    }
    if "type" in schema:
        allowed = schema["type"]
        allowed = [allowed] if isinstance(allowed, str) else allowed
        if not any(types[kind](value) for kind in allowed):
            raise ValueError(f"{path}: expected {' or '.join(allowed)}")
    if "const" in schema and value != schema["const"]:
        raise ValueError(f"{path}: expected {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: expected one of {schema['enum']!r}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            raise ValueError(f"{path}: string must not be empty")
        if "pattern" in schema and re.fullmatch(schema["pattern"], value) is None:
            raise ValueError(f"{path}: invalid format: {value!r}")
    if isinstance(value, dict):
        if missing := set(schema.get("required", [])) - value.keys():
            raise ValueError(f"{path}: missing fields: {sorted(missing)}")
        properties = schema.get("properties", {})
        if (schema.get("additionalProperties") is False
                and (unknown := value.keys() - properties.keys())):
            raise ValueError(f"{path}: unknown fields: {sorted(unknown)}")
        for key, child in properties.items():
            if key in value:
                _validate_schema(value[key], child, definitions, f"{path}/{key}")
    if isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            _validate_schema(item, schema["items"], definitions, f"{path}/{index}")


def load_sources(data_dir: Path) -> dict:
    """Load sources.yml, validate its schema and resolve source/scan links.

    Return the reviewed snake_case document. Null scan keys are valid for
    editions such as numbered hymnals that have no PDF or system addresses.
    """
    data_dir = Path(data_dir)
    schema = json.loads((data_dir / "schema/identities.json").read_text())
    registry = yaml.safe_load((data_dir / "identities/sources.yml").read_text())
    _validate_schema(registry, schema, schema["$defs"])
    source_ids = [source["id"] for source in registry["sources"]]
    edition_ids = [edition["id"] for edition in registry["editions"]]
    legacy_volumes = [e["legacy_volume"] for e in registry["editions"]
                      if e["legacy_volume"] is not None]
    for label, keys in (("source id", source_ids), ("edition id", edition_ids),
                        ("legacy_volume", legacy_volumes)):
        seen = set()
        for key in keys:
            if key in seen:
                raise ValueError(f"sources.yml: duplicate {label}: {key}")
            seen.add(key)
    volumes = yaml.safe_load((data_dir / "volumes.yml").read_text())["volumes"]
    for edition in registry["editions"]:
        if edition["source_id"] not in source_ids:
            raise ValueError(f"{edition['id']}: unknown source_id: {edition['source_id']}")
        key = edition["scan_registry_key"]
        if key is not None and key not in volumes:
            raise ValueError(f"{edition['id']}: unknown volumes.yml scan_registry_key: {key}")
    return registry
