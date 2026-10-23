"""Shared deterministic serialization and strict schema validation.

Origins are RFC 6901 JSON Pointers, also used over parsed YAML documents.
"""
import hashlib
import json
from pathlib import Path

import yaml

from pipeline.source_refs import _validate_schema

DATA = Path(__file__).resolve().parents[2] / 'data'
NAMESPACE = '5e3764f4-b31d-566d-84f8-c267bc47eebc'
ADAPTER_VERSION = 'identities/1'


def read(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    text = path.read_text(encoding='utf-8')
    return json.loads(text) if path.suffix == '.json' else yaml.safe_load(text)


def serialized(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + '\n').encode('utf-8')


def pointer(*parts):
    return ''.join('/' + str(p).replace('~', '~0').replace('/', '~1') for p in parts)


def origin(path, selector='', target=None):
    return {'path': path, 'selector': selector, 'legacy_target': target}


def validate(value, definition, data):
    schema = read(Path(data) / 'schema/identities.json')
    _schema(value, schema['$defs'][definition], schema['$defs'], definition)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _schema(value, schema, definitions, path):
    """The small draft-2020 vocabulary used by this project's offline schemas."""
    if '$ref' in schema:
        return _schema(value, definitions[schema['$ref'].split('/')[-1]], definitions, path)
    if 'anyOf' in schema:
        for choice in schema['anyOf']:
            try:
                _schema(value, choice, definitions, path)
                return
            except ValueError:
                pass
        raise ValueError(f'{path}: no matching schema variant: {str(value)[:160]}')
    # M1 rejects unknown schema vocabulary. Validate maps separately, then use
    # its exact type/field checks for the scalar and container envelope.
    fields = {k: v for k, v in schema.items() if k not in ('items', 'properties', 'minItems', 'maxItems')}
    fields['properties'] = {key: {} for key in schema.get('properties', {})}
    additional = fields.get('additionalProperties')
    if isinstance(additional, dict):
        fields.pop('additionalProperties')
    _validate_schema(value, fields, definitions, path)
    if isinstance(value, dict):
        props = schema.get('properties', {})
        for key, child in value.items():
            child_schema = props.get(key, additional if isinstance(additional, dict) else None)
            if child_schema is not None:
                _schema(child, child_schema, definitions, f'{path}/{key}')
    if isinstance(value, list) and (
            len(value) < schema.get('minItems', 0) or
            len(value) > schema.get('maxItems', float('inf'))):
        raise ValueError(f'{path}: invalid array length')
    if isinstance(value, list) and 'items' in schema:
        for i, child in enumerate(value):
            _schema(child, schema['items'], definitions, f'{path}/{i}')
