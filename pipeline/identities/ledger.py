"""Permanent allocation store. Only bootstrap is allowed to derive UUIDv5 IDs."""
import json
import uuid
from pathlib import Path

from .inventory import inventory
from .model import NAMESPACE, read, validate

PREFIXES = {'source': 'src', 'edition': 'edn', 'item': 'itm', 'work': 'wrk',
            'setting': 'set', 'representation': 'rep'}


def requests(data):
    registry, units, reps, _extra = inventory(data)
    out = []

    def add(kind, seed, keys=(), locator=None, ordinal=None, links=(), fixed=None):
        out.append({'kind': kind, 'birth_seed': seed, 'state': 'active', 'legacy_keys': list(keys),
                        'locator': locator, 'row_ordinal': ordinal, 'links': list(links), 'changes': [],
                        'fixed': fixed})

    for s in registry['sources']:
        add('source', 'noh' if any(e['adapter'] == 'noh' and e['source_id'] == s['id']
                                 for e in registry['editions']) else s['id'], fixed=s['id'])
    for e in registry['editions']:
        add('edition', e['legacy_volume'] or e['id'], fixed=e['id'],
            links=[('source', 'source', next(o['birth_seed'] for o in out if o.get('fixed') == e['source_id']))])
    work_seeds = set()
    for u in units:
        add('item', u['seed'], u['keys'], u['locator'], u['ordinal'],
            links=[('edition', 'edition', next(e['legacy_volume'] or e['id'] for e in registry['editions']
                                               if e['id'] == u['edition']))] + (
                [('parent', 'item', u['parent'])] if u['parent'] else []))
        if u['classification'] == 'musical-unit':
            if u['work_seed'] not in work_seeds:
                add('work', u['work_seed'])
                work_seeds.add(u['work_seed'])
            for n in range(u['accompaniments']):
                seed = u['work_seed'] if u['accompaniments'] == 1 else f'{u["seed"]}:setting:{n + 1}'
                add('setting', seed, links=[('work', 'work', u['work_seed']), ('item', 'item', u['seed'])])
    for r in reps:
        add('representation', r['seed'], links=[('item', 'item', r['unit'])] if r['unit'] else [])
    return out


def load_ledger(data):
    value = read(Path(data) / 'identities/ledger.json')
    if value is None:
        raise ValueError('missing ledger; run bootstrap explicitly')
    validate_ledger(value, data)
    return value


def validate_ledger(ledger, data):
    validate(ledger, 'ledger', data)
    if ledger['namespace'] != NAMESPACE:
        raise ValueError('unknown ledger namespace')
    ids, seeds, aliases = {}, {}, {}
    for entry in ledger['entries']:
        ident, key = entry['id'], (entry['kind'], entry['birth_seed'])
        if not ident.startswith(PREFIXES[entry['kind']] + '_'):
            raise ValueError(f'incompatible ID owner: {entry}')
        if ident in ids or key in seeds:
            raise ValueError(f'duplicate ID or seed: {entry}; previous: {ids.get(ident) or seeds.get(key)}')
        ids[ident], seeds[key] = entry, entry
        previous = {}
        for change in entry['changes']:
            if any(change['old'].get(k) != v for k, v in previous.items() if k in change['old']):
                raise ValueError(f'conflicting ledger change histories: {ident}')
            previous.update(change['new'])
        if any(entry.get(k) != v for k, v in previous.items()):
            raise ValueError(f'ledger entry disagrees with change history: {ident}')
        for alias in entry['legacy_keys'] if entry['state'] == 'active' else []:
            if alias in aliases:
                raise ValueError(f'duplicate alias {alias}: {aliases[alias]} and {ident}')
            aliases[alias] = ident
    if list(ids) != sorted(ids):
        raise ValueError('ledger entries must be sorted by ID')
    for e in ledger['entries']:
        for link in e['links']:
            if link['id'] not in ids:
                raise ValueError(f'dangling ledger edge: {e["id"]}: {link}')
    return seeds


def bind(ledger, wanted, data, allow_new=False):
    """Join current records using explicit aliases, never reminted birth seeds.

    Nonsection slots use their permanent recorded import keys. A locator rename
    requires an explicit ledger rebind, preserving the original birth seed.
    """
    seeds = validate_ledger(ledger, data)
    by_alias = {k: e for e in ledger['entries'] if e['state'] == 'active' for k in e['legacy_keys']}
    bound = {}
    by_id = {e['id']: e for e in ledger['entries']}
    current = {}
    wanted_keys = set()
    for w in wanted:
        key = (w['kind'], w['birth_seed'])
        if key in wanted_keys:
            raise ValueError(f'duplicate wanted seed: {key}')
        wanted_keys.add(key)
        for alias in w['legacy_keys']:
            if alias in current:
                raise ValueError(f'duplicate wanted legacy key {alias}: {current[alias]} and {w}')
            current[alias] = w
    claimed = {}

    def claim(key, entry):
        previous = claimed.get(entry['id'])
        if previous is not None and previous != key:
            raise ValueError(f'entry {entry["id"]} already bound to {previous}; two wanted rows: {key}')
        claimed[entry['id']] = key
        bound[key] = entry

    def setting_ordinal(row):
        # Historical multi-setting seeds record the printed setting ordinal.
        # A single setting occupies ordinal 1; never decode an opaque ID.
        _prefix, separator, ordinal = row['birth_seed'].rpartition(':setting:')
        return int(ordinal) if separator else 1

    for e in ledger['entries']:
        if e['state'] != 'active' or e['kind'] != 'item':
            continue
        for key in e['legacy_keys']:
            w = current.get(key)
            if w is None:
                raise ValueError(f'missing active legacy key {key}: {e["id"]}; reviewed rebind required')
            if e['locator'] != w['locator']:
                raise ValueError(f'structural locator change {key}: {e["locator"]} -> {w["locator"]}; rebind required')
            if e['locator'] and not e['locator']['key'] and e['row_ordinal'] != w['row_ordinal']:
                raise ValueError(f'structural row change {key}: {e["row_ordinal"]} -> {w["row_ordinal"]}; rebind required')
    for w in wanted:
        key = (w['kind'], w['birth_seed'])
        candidates = {by_alias[a]['id'] for a in w['legacy_keys'] if a in by_alias}
        e = by_id[next(iter(candidates))] if candidates else seeds.get(key)
        if len(candidates) > 1:
            raise ValueError(f'ambiguous legacy selector: {w}')
        if e is None:
            continue
        elif e['state'] != 'active':
            raise ValueError(f'retired slot {key}: {e["id"]}')
        else:
            claim(key, e)
    # After a reviewed rebind, associations in the ledger own works,
    # settings and scan slots. Their old birth seeds are historical evidence.
    for _ in range(3):
        for w in wanted:
            key = (w['kind'], w['birth_seed'])
            if key in bound:
                continue
            candidates = []
            if w['kind'] in ('setting', 'representation'):
                owner = next((bound.get((kind, seed)) for role, kind, seed in w['links']
                              if role == 'item'), None)
                if owner:
                    candidates = [e for e in ledger['entries'] if e['state'] == 'active'
                                  and e['kind'] == w['kind']
                                  and (w['kind'] != 'setting' or setting_ordinal(e) == setting_ordinal(w))
                                  and any(
                                      l['role'] == 'item' and l['id'] == owner['id'] for l in e['links'])]
            elif w['kind'] == 'work':
                for setting in wanted:
                    if setting['kind'] != 'setting' or ('work', 'work', w['birth_seed']) not in setting['links']:
                        continue
                    existing = bound.get(('setting', setting['birth_seed']))
                    if existing:
                        work_id = next(l['id'] for l in existing['links'] if l['role'] == 'work')
                        candidates += [e for e in ledger['entries'] if e['id'] == work_id]
            candidates = {e['id']: e for e in candidates}
            if len(candidates) > 1:
                raise ValueError(f'ambiguous ledger associations: {key}: {sorted(candidates)}')
            if candidates:
                claim(key, next(iter(candidates.values())))
    if not allow_new:
        for w in wanted:
            key = (w['kind'], w['birth_seed'])
            if key not in bound:
                raise ValueError(f'unallocated {key}')
    # An extra numbered row can renumber every following row without moving
    # their ordinal. Do not approve such a positional-family extension implicitly.
    old_families = {(e['locator']['slug'], e['locator']['kind']) for e in ledger['entries']
                    if e['state'] == 'active' and e['locator'] and e['locator']['n']}
    for w in wanted:
        loc = w['locator']
        if (w['kind'], w['birth_seed']) not in bound and loc and loc['n'] and (
                loc['slug'], loc['kind']) in old_families:
            raise ValueError(f'structural numbered insertion {loc}; reviewed rebind required')
    return bound


def ledger_bytes(value):
    lines = [json.dumps(e, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
             for e in value['entries']]
    return ('{\n  "schema_version": 1,\n  "namespace": ' + json.dumps(NAMESPACE)
            + ',\n  "entries": [\n' + ',\n'.join(lines) + '\n  ]\n}\n').encode()


def _allocate(data, initial):
    data = Path(data)
    wanted = requests(data)
    path = data / 'identities/ledger.json'
    previous = read(path)
    if initial and previous and previous.get('entries'):
        raise ValueError('bootstrap refuses a nonempty ledger')
    ledger = {'schema_version': 1, 'namespace': NAMESPACE, 'entries': []} if initial else load_ledger(data)
    bound = bind(ledger, wanted, data, allow_new=True)
    before = len(ledger['entries'])
    for w in wanted:
        key = (w['kind'], w['birth_seed'])
        if key in bound:
            continue
        prefix = PREFIXES[w['kind']]
        # The only UUIDv5 invocation in the identities implementation.
        ident = w['fixed'] or prefix + '_' + str(
            uuid.uuid5(uuid.UUID(NAMESPACE), prefix + '\0' + w['birth_seed']) if initial else uuid.uuid4())
        entry = {k: v for k, v in w.items() if k != 'fixed'}
        entry['id'] = ident
        entry['links'] = []
        ledger['entries'].append(entry)
        bound[key] = entry
    for w in wanted:
        entry = bound[w['kind'], w['birth_seed']]
        expected = [{'role': role, 'id': bound[kind, seed]['id']} for role, kind, seed in w['links']]
        if entry['links'] and entry['links'] != expected:
            raise ValueError(f'incompatible owners: {entry}; expected {expected}')
        entry['links'] = expected
    ledger['entries'].sort(key=lambda e: e['id'])
    validate_ledger(ledger, data)
    # Validate the entire prospective projection before persisting allocations.
    from .projection import project
    project(data, ledger)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = ledger_bytes(ledger)
    if not path.exists() or path.read_bytes() != content:
        path.write_bytes(content)
    alias_path = data / 'identities/aliases.yml'
    if not alias_path.exists():
        alias_path.write_text('schema_version: 1\naliases: []\n', encoding='utf-8')
    return len(ledger['entries']) - before


def bootstrap(data, adapter='noh'):
    _require_adapter(data, adapter)
    count = _allocate(data, initial=True)
    path = Path(data) / 'identities/aliases.yml'
    if not path.exists():
        path.write_text('schema_version: 1\naliases: []\n', encoding='utf-8')
    return count


def allocate(data, adapter='noh'):
    _require_adapter(data, adapter)
    return _allocate(data, initial=False)


def _require_adapter(data, adapter):
    from pipeline.source_refs import load_sources
    if adapter not in {e['adapter'] for e in load_sources(Path(data))['editions']}:
        raise ValueError(f'unknown adapter {adapter}')


def rebind(data, ident, to, *, reason):
    """Explicitly bind one item to a current legacy locator, retaining history.

    For a top-level item, to is {slug, kind: piece, key: null, n: null,
    variant: null}; section locators use the exact legacy spelling. Several
    reviewed rebinds may be needed before the graph passes check again.
    """
    if not reason.strip():
        raise ValueError('rebind requires a reason')
    data = Path(data)
    ledger = load_ledger(data)
    entry = next((e for e in ledger['entries'] if e['id'] == ident and e['state'] == 'active'), None)
    if entry is None or entry['kind'] != 'item':
        raise ValueError(f'unknown or retired item ID: {ident}')
    candidates = [w for w in requests(data) if w['kind'] == 'item' and (
        w['locator'] == to or (to.get('kind') == 'piece' and
                              'piece:' + to['slug'] in w['legacy_keys']))]
    if len(candidates) != 1:
        raise ValueError(f'ambiguous or missing rebind locator: {to}')
    target = candidates[0]
    fields = ['locator', 'row_ordinal', 'legacy_keys']
    old = {k: entry[k] for k in fields}
    new = {k: target[k] for k in fields}
    entry['changes'].append({'old': old, 'new': new, 'reason': reason})
    entry.update(new)
    validate_ledger(ledger, data)
    (data / 'identities/ledger.json').write_bytes(ledger_bytes(ledger))


def retire(data, ids, *, reason):
    """Record reviewed tombstones as one transaction; never delete allocations."""
    if not reason.strip():
        raise ValueError('retirement requires a reason')
    data = Path(data)
    ledger = load_ledger(data)
    selected = set(ids)
    found = {e['id'] for e in ledger['entries'] if e['id'] in selected and e['state'] == 'active'}
    if found != selected:
        raise ValueError(f'unknown or already retired IDs: {selected - found}')
    for e in ledger['entries']:
        if e['state'] == 'active' and e['id'] not in selected and any(l['id'] in selected for l in e['links']):
            raise ValueError(f'active allocation still owns retired slot: {e["id"]}')
        if e['id'] in selected:
            e['changes'].append({'old': {'state': 'active'}, 'new': {'state': 'retired'}, 'reason': reason})
            e['state'] = 'retired'
    validate_ledger(ledger, data)
    from .projection import project
    project(data, ledger)
    (data / 'identities/ledger.json').write_bytes(ledger_bytes(ledger))
