"""Offline MEI 5.0 schema validation.

Only RelaxNG is checked. The vendored ``mei-CMN.rng`` embeds Schematron rules,
but libxml2 ignores them, so "valid" here means RelaxNG-valid, not Schematron-clean.

Input is treated as hostile: any DOCTYPE or ENTITY declaration is rejected before
(and after) parsing, because RelaxNG alone accepts documents with unexpanded
entity references. Nothing here touches the network or raises on bad input.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from lxml import etree

from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.model import SchemaBundle

DEFAULT_ROOT = Path(__file__).resolve().parents[3] / "data/typeset/mei/schemas/mei-5.0"
ENTRY = "mei-CMN.rng"
_FILENAME = "<mei>"

_cache: dict[tuple[Path, str], etree.RelaxNG] = {}


def _parser() -> etree.XMLParser:
    return etree.XMLParser(
        resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False
    )


def _validator_string() -> str:
    return "lxml-relaxng " + ".".join(str(n) for n in etree.LXML_VERSION[:3])


def _expected_sha(root: Path) -> str:
    text = (root / "SOURCE.md").read_text(encoding="utf-8")
    match = re.search(
        r"\|\s*`" + re.escape(ENTRY) + r"`\s*\|[^|]*\|\s*`([0-9a-f]{64})`\s*\|", text
    )
    if match is None:
        raise ValueError(f"SOURCE.md has no sha256 row for {ENTRY}")
    return match.group(1)


def load_schema_bundle(root: Path = DEFAULT_ROOT) -> SchemaBundle:
    root = Path(root)
    data = (root / ENTRY).read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    expected = _expected_sha(root)
    if actual != expected:
        raise ValueError(f"{ENTRY} sha256 {actual} does not match SOURCE.md {expected}")
    key = (root.resolve(), actual)
    if key not in _cache:
        _cache[key] = etree.RelaxNG(etree.fromstring(data, _parser()))
    return SchemaBundle(root=root, entry=ENTRY, sha256=actual, validator=_validator_string())


def _error(message: str, line: int = 0) -> Diagnostic:
    return Diagnostic(
        code="SCHEMA_INVALID",
        severity="error",
        message=message,
        source_location=SourceLocation(_FILENAME, line, 0),
    )


def validate_schema(xml: bytes, schema: SchemaBundle) -> list[Diagnostic]:
    try:
        upper = xml.upper()
        for marker in (b"<!DOCTYPE", b"<!ENTITY"):
            if marker in upper:
                return [_error(f"{marker.decode()} is not allowed in MEI input")]
        load_schema_bundle(schema.root)  # re-verifies the hash; fills the cache
        relaxng = _cache[(schema.root.resolve(), schema.sha256)]
        try:
            doc = etree.fromstring(xml, _parser()).getroottree()
        except etree.XMLSyntaxError as exc:
            return [_error(f"malformed XML: {exc.msg}", exc.lineno or 0)]
        info = doc.docinfo
        if info.doctype or info.system_url or info.public_id:
            return [_error("DOCTYPE is not allowed in MEI input")]
        if relaxng.validate(doc):
            return []
        return [_error(e.message, e.line) for e in relaxng.error_log]
    except Exception as exc:  # noqa: BLE001  hostile input must never raise
        return [_error(f"cannot validate: {type(exc).__name__}: {exc}")]

