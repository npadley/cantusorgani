"""Permanent identities beside the unchanged legacy catalogue.

Allocate only after legacy replay. Build/check are consumers, never allocators.
"""
from pathlib import Path

from .ledger import allocate, bootstrap, load_ledger
from .model import DATA, read, serialized
from .projection import project

__all__ = ['allocate', 'bootstrap', 'build', 'check', 'resolve_target']


def build(data=DATA, out=None, *, write=True):
    """Project existing derived inputs; write only the three generated sidecars."""
    data = Path(data)
    result = project(data, load_ledger(data))
    if write:
        directory = Path(out) if out is not None else data / 'identities'
        directory.mkdir(parents=True, exist_ok=True)
        for name, value in result.items():
            content = serialized(value)
            path = directory / name
            if not path.exists() or path.read_bytes() != content:
                path.write_bytes(content)
    return result


def check(data=DATA):
    """Recompute in memory, validate all bindings/edges and compare exact bytes."""
    data = Path(data)
    result = build(data, write=False)
    for name, value in result.items():
        path = data / 'identities' / name
        if not path.exists() or path.read_bytes() != serialized(value):
            raise ValueError(f'stale identity sidecar: {name}; run identities build')
    return result['migration.json']


def resolve_target(text, data=DATA):
    """Read-only legacy lookup from ledger and target table, without snapshot."""
    data = Path(data)
    ledger = load_ledger(data)
    table = read(data / 'identities/aliases.json', {}).get('targets', {})
    row = table.get(text)
    if row is None:
        raise ValueError(f'unknown legacy target: {text}')
    direct = [e for e in ledger['entries'] if e['state'] == 'active' and text in e['legacy_keys']]
    if direct and direct[0]['id'] != row['entity_id']:
        raise ValueError(f'alias disagrees with ledger: {text}; {direct[0]}')
    entry = next((e for e in ledger['entries'] if e['id'] == row['entity_id']), None)
    if entry is None or entry['state'] != 'active' or row['state'] != 'active':
        raise ValueError(f'retired or unknown legacy target: {text}; {entry}')
    return row
