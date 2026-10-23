"""Thin graph and legacy alias projection; never changes compatibility inputs."""
from collections import Counter
from pathlib import Path

from .inventory import inventory
from .ledger import bind, requests
from .model import ADAPTER_VERSION, origin, pointer, read, sha, validate


def source_hashes(data):
    """Reviewed inputs, post-replay catalogue and adapter code; never identity outputs."""
    data = Path(data)
    patterns = ['identities/sources.json', 'identities/ledger.json', 'identities/aliases.yml',
                'identities/legacy-addresses.json', 'schema/identities.json', 'volumes.yml',
                'index-*.yml', 'sections/*.yml', 'corrections.yml', 'rubrics-1962.yml',
                'vespers/*.yml', 'ordinary-form/*.yml', 'hymn-pairings.yml', 'good-friday.json',
                'typeset/src/**/*', 'typeset/mei/records/*.json', 'items.json', 'catalog.json']
    files = {p for pat in patterns for p in data.glob(pat) if p.is_file()}
    result = {'data/' + p.relative_to(data).as_posix(): sha(p) for p in sorted(files)}
    root = Path(__file__).resolve().parents[2]
    for p in sorted((root / 'pipeline/identities').glob('*.py')):
        result[p.relative_to(root).as_posix()] = sha(p)
    for name in ['pipeline/source_refs.py', 'pipeline/sections.py', 'pipeline/typeset/match.py',
                 'pipeline/corrections.py']:
        result[name] = sha(root / name)
    redirects = data.parent / 'web/public/_redirects'
    if redirects.exists():
        result['web/public/_redirects'] = sha(redirects)
    return dict(sorted(result.items()))


def project(data, ledger):
    data = Path(data)
    registry, units, reps, extra = inventory(data)
    bound = bind(ledger, requests(data), data)

    def ident(kind, seed):
        return bound[kind, seed]['id']

    snapshot = dict(schema_version=1, **{k: registry[k] for k in ['sources', 'editions']},
                    works=[], source_items=[], settings=[], representations=[], relations=[])
    aliases = {'schema_version': 1, 'legacy_ids': {}, 'legacy_slugs': {}, 'targets': {}, 'of_lenders': {}, 'addresses': [], 'redirects': []}
    items, unit_settings, works = {}, {}, {}
    unresolved = []
    reference_counts = Counter()

    def alias(key, entity, state='active'):
        row = {'kind': key.split(':', 1)[0], 'entity_id': entity, 'legacy_target': key, 'state': state}
        previous = aliases['targets'].get(key)
        if previous is not None and previous != row:
            raise ValueError(f'duplicate alias {key}: {previous} and {row}')
        aliases['targets'][key] = row

    for u in units:
        item_id = ident('item', u['seed'])
        setting_ids = []
        if u['classification'] == 'musical-unit':
            work_id = ident('work', u['work_seed'])
            if work_id not in works:
                external = [{'authority': 'gregobase', 'value': str(u['chant']), 'status': 'legacy',
                                 'evidence': [u['origin']]}] if u['chant'] else []
                work = {'id': work_id, 'title': u['title'], 'language': 'la' if u['edition'] in {
                    e['id'] for e in registry['editions'] if e['adapter'] == 'noh'} else None,
                            'kind': u['kind'], 'identity_status': 'provisional', 'external_refs': external}
                works[work_id] = work
                snapshot['works'].append(work)
            for n in range(u['accompaniments']):
                seed = u['work_seed'] if u['accompaniments'] == 1 else f'{u["seed"]}:setting:{n + 1}'
                set_id = ident('setting', seed)
                snapshot['settings'].append({'id': set_id, 'work_id': work_id, 'kind': 'organ-accompaniment',
                    'source_item_ids': [item_id], 'attribution': None, 'rights_reference': None,
                    'identity_status': 'provisional'})
                setting_ids.append(set_id)
        item = {'id': item_id, 'edition_id': u['edition'],
                    'parent_id': ident('item', u['parent']) if u['parent'] else None,
                    'classification': u['classification'], 'title': u['title'], 'locator': u['location'],
                    'setting_ids': setting_ids, 'origin': u['origin']}
        snapshot['source_items'].append(item)
        items[u['seed']], unit_settings[u['seed']] = item, setting_ids
        for key in u['keys']:
            alias(key, item_id)
        if u['parent'] is None and u['seed'].startswith('piece:'):
            full = u['seed'][6:]
            slug = u['origin']['legacy_target'][6:]
            if full in aliases['legacy_ids'] or slug in aliases['legacy_slugs']:
                raise ValueError(f'duplicate legacy ID/slug {full}: {slug}')
            aliases['legacy_ids'][full], aliases['legacy_slugs'][slug] = item_id, item_id
    # Old spellings are retained as retired aliases with their complete rebind
    # evidence in the command-managed ledger. Never shadow a new active owner.
    for entry in ledger['entries']:
        for change in entry['changes']:
            for key in change['old'].get('legacy_keys', []):
                if key not in aliases['targets']:
                    alias(key, entry['id'], 'retired')
    for key, seed in extra:
        alias(key, ident('item', seed))

    # Pairing facets select an exact movement or a standalone container, using
    # the replay's legacy syntax independently of the snapshot.
    catalog = read(data / 'catalog.json', {'pieces': []})
    for p in catalog['pieces']:
        top = aliases['legacy_slugs'][p['slug']]
        alias(f'pairing:{p["slug"]}/chant', top)
        for mv in ['kyrie', 'gloria', 'credo', 'sanctus', 'agnus', 'ite']:
            target = aliases['targets'].get(f'movement:{p["slug"]}/{mv}')
            if target or any(c.get('movement') == mv for c in p.get('chant', [])):
                alias(f'pairing:{p["slug"]}/{mv}', target['entity_id'] if target else top)

    for r in reps:
        setting_ids = unit_settings.get(r['unit'], [])
        source_ids = [ident('item', r['unit'])] if r['unit'] else []
        if r.get('target') in aliases['targets']:
            entity = aliases['targets'][r['target']]['entity_id']
            source_ids = [entity]
            setting_ids = next(i['setting_ids'] for i in snapshot['source_items'] if i['id'] == entity)
        snapshot['representations'].append({'id': ident('representation', r['seed']), 'kind': r['kind'],
            'setting_id': setting_ids[0] if len(setting_ids) == 1 else None,
            'source_item_ids': source_ids, 'locator': r['locator'], 'evidence': r['evidence']})
        if r['kind'] == 'lilypond':
            alias('typeset:' + r['locator']['source_path'].removeprefix('data/typeset/src/'),
                  ident('representation', r['seed']))

    # Exact lender resolution includes variant and ref. No incipit matching.
    by_id = {i['id']: i for i in snapshot['source_items']}

    def lender_target(lender):
        return (f'part:{lender["slug"]}/{lender["part"]}'
                + (':' + str(lender['variant']) if lender.get('variant') else ''))

    def lender(l, evidence):
        key = lender_target(l)
        row = aliases['targets'].get(key)
        if not row:
            raise ValueError(f'unresolved active lender {key}: {evidence}')
        item = by_id[row['entity_id']]
        if l.get('ref') and item['locator'].get('system_refs', [])[:1] != [l['ref']]:
            raise ValueError(f'lender ref addresses different item: {l}: {evidence}')
        return item

    def relation(from_id, to_id, kind, evidence):
        existing = next((r for r in snapshot['relations'] if (r['from_id'], r['to_id'], r['kind']) == (
            from_id, to_id, kind)), None)
        if existing:
            if evidence not in existing['evidence']:
                existing['evidence'].append(evidence)
        else:
            snapshot['relations'].append({'from_id': from_id, 'to_id': to_id, 'kind': kind,
                                              'status': 'reviewed', 'evidence': [evidence]})

    of = read(data / 'ordinary-form-propers.json', {'occasions': []})
    for i, occasion in enumerate(of['occasions']):
        for j, part in enumerate(occasion.get('parts', [])):
            key = f'of:{occasion["key"]}/{part["slot"]}' + (
                ':' + part['variant'] if part.get('variant') else '')
            evidence = origin('data/ordinary-form-propers.json', pointer('occasions', i, 'parts', j), key)
            reference_counts['ordinary-form'] += 1
            if key in aliases['of_lenders']:
                raise ValueError(f'duplicate OF slot key: {key}')
            if not part.get('lender'):
                aliases['of_lenders'][key] = {'item_id': None, 'setting_id': None,
                    'legacy_ref': None, 'legacy_target': None, 'state': 'missing'}
                unresolved.append({'legacy_target': key, 'reason': 'existing missing lender; external chant only',
                                       'state': 'external', 'evidence': [evidence]})
                continue
            item = lender(part['lender'], evidence)
            alias(key, item['id'])
            if len(item['setting_ids']) != 1:
                raise ValueError(f'OF lender has no unique setting: {key}: {evidence}')
            aliases['of_lenders'][key] = {'item_id': item['id'],
                'setting_id': item['setting_ids'][0], 'legacy_ref': part['lender']['ref'],
                'legacy_target': lender_target(part['lender'])}
            # OF has no entity while assignments are reserved: the slot lookup
            # records reuse without inventing a borrowing relation endpoint.
    for i, p in enumerate(catalog['pieces']):
        for j, section in enumerate(p.get('sections') or []):
            if not section.get('borrowed_from'):
                continue
            evidence = origin('data/catalog.json', pointer('pieces', i, 'sections', j))
            key = f'part:{p["slug"]}/{section["kind"]}'
            from pipeline.sections import target
            key = target(p['slug'], section)
            borrowed = section['borrowed_from']
            candidates = [u for u in units if (u['origin']['legacy_target'] == 'piece:' + borrowed or
                          (u['locator'] and u['locator']['slug'] == borrowed))
                          and (not section.get('borrowed_ref') or section['borrowed_ref'] in u['refs'])
                          and u['classification'] == 'musical-unit']
            if len(candidates) == 1:
                to = items[candidates[0]['seed']]
                by_id[aliases['targets'][key]['entity_id']]['setting_ids'] = to['setting_ids'][:]
                for s in snapshot['settings']:
                    if s['id'] in to['setting_ids']:
                        s['source_item_ids'].append(aliases['targets'][key]['entity_id'])
                relation(aliases['targets'][key]['entity_id'], to['id'], 'borrows', evidence)
            else:
                unresolved.append({'legacy_target': key, 'state': 'unresolved',
                    'reason': 'existing borrowed citation has no unique reviewed musical unit', 'evidence': [evidence]})

    # Reviewed whole-score citations remain references to the printed source;
    # an undivided litany is not silently promoted to an antiphon setting.
    for p in catalog['pieces']:
        for j, citation in enumerate(p.get('reference_sources', [])):
            if p['volume'] != 'noh7':
                continue
            evidence = origin('data/catalog.json', pointer('pieces', catalog['pieces'].index(p), 'reference_sources', j), 'piece:' + p['slug'])
            candidates = [q for q in catalog['pieces'] if q['slug'] != p['slug'] and q['systems']
                          and q['volume'] == citation['volume'] and not q.get('pagination')
                          and q['printed_pages'][0] <= citation['page'] <= q['printed_pages'][1]]
            exact = [q for q in candidates if q['printed_pages'][0] == citation['page']]
            candidates = exact or candidates
            if len(candidates) == 1:
                relation(aliases['legacy_slugs'][p['slug']], aliases['legacy_slugs'][candidates[0]['slug']], 'borrows', evidence)
            else:
                unresolved.append({'legacy_target': 'piece:' + p['slug'], 'state': 'unresolved',
                    'reason': 'reviewed citation has no unique printed lender', 'evidence': [evidence]})

    # Reviewed chant associations are evidence-bearing external references,
    # including copyrighted/link-only records. They never imply work equality.
    hymn_pairings = read(data / 'hymn-pairings.json', {}).get('pairings', {})
    work_by_id = {w['id']: w for w in snapshot['works']}
    setting_by_id = {s['id']: s for s in snapshot['settings']}
    for ref, pairing in hymn_pairings.items():
        reference_counts['hymn-pairings'] += 1
        candidates = [u for u in units if u['refs'] and u['refs'][0] == ref and u['classification'] == 'musical-unit']
        evidence = origin('data/hymn-pairings.json', pointer('pairings', ref))
        if len(candidates) == 1:
            item = items[candidates[0]['seed']]
            alias('hymn-pairing:' + ref, item['id'])
            if pairing.get('id'):
                for sid in item['setting_ids']:
                    work = work_by_id[setting_by_id[sid]['work_id']]
                    work['external_refs'].append({'authority': 'gregobase', 'value': str(pairing['id']),
                        'status': pairing.get('status', 'unknown'), 'evidence': [evidence]})
        else:
            unresolved.append({'legacy_target': 'hymn-pairing:' + ref, 'state': 'unresolved',
                'reason': 'existing hymn association has no uniquely identified printed unit', 'evidence': [evidence]})
    for family in ['chants.json', 'good-friday.json', 'ordinary-form-coverage.json']:
        value = read(data / family)
        if value is not None:
            reference_counts[family] = len(value)

    links = read(data / 'vespers/hymn-links.json', {})
    for p in catalog['pieces']:
        for j, hymn in enumerate(p.get('hymns') or []):
            candidates = [u for u in units if u['parent'] == 'piece:' + p['id']
                          and hymn['ref'] in u['refs'] and u['kind'] == 'hymn']
            if len(candidates) != 1:
                continue
            for slug in links.get(hymn['title'], []):
                if slug not in aliases['legacy_slugs']:
                    raise ValueError(f'unknown related hymn {slug}')
                relation(items[candidates[0]['seed']]['id'], aliases['legacy_slugs'][slug], 'related-hymn',
                         origin('data/vespers/hymn-links.json', pointer(hymn['title'])))

    # Current review queue identities are editorial facets of their source item.
    queue = read(data / 'review-queue.json', [])
    for i, row in enumerate(queue):
        if row.get('piece') in aliases['legacy_slugs']:
            alias(row['key'], aliases['legacy_slugs'][row['piece']])
        elif row.get('key'):
            edition = next((e for e in registry['editions'] if e['legacy_volume'] == row.get('volume')), None)
            if edition:
                alias(row['key'], edition['id'])

    exceptional = read(data / 'identities/aliases.yml', {'schema_version': 1, 'aliases': []})
    validate(exceptional, 'aliasSource', data)
    all_ids = {e['id'] for e in ledger['entries']}
    exceptional_keys = [r['legacy_target'] for r in exceptional['aliases']]
    if len(exceptional_keys) != len(set(exceptional_keys)):
        raise ValueError('duplicate exceptional alias')
    for row in exceptional['aliases']:
        if row['entity_id'] not in all_ids or not row['evidence']:
            raise ValueError(f'unknown alias entity or missing evidence: {row}')
        alias(row['legacy_target'], row['entity_id'], row['state'])

    # Audit each historical target occurrence, retaining its pointer to the
    # unchanged full record (was/date/notes/fingerprints remain authoritative).
    families = ['corrections.yml', 'corrections-log.json', 'reviewed.json', 'review-queue.json',
                'typeset/parts.yml', 'typeset/manifest.json', 'typeset/review.json',
                'typeset/mei/manifest.json', 'vespers/vespers-lineup.json']
    def audit(value, file, parts=()):
        if isinstance(value, dict):
            for field, child in value.items():
                if field in ('target', 'key') and isinstance(child, str) and ':' in child:
                    reference_counts[file] += 1
                    if child not in aliases['targets']:
                        historical = file in ('reviewed.json', 'corrections-log.json', 'typeset/parts.yml',
                                              'typeset/review.json') or (
                            file == 'corrections.yml' and value.get('field') == 'reviewed')
                        if not historical:
                            raise ValueError(f'unresolved active reference {child}: {file}{pointer(*parts)}')
                        unresolved.append({'legacy_target': child, 'state': 'lapsed',
                            'reason': 'historical target absent from effective inventory; original evidence retained',
                            'evidence': [origin('data/' + file, pointer(*parts, field), child)]})
                if file == 'reviewed.json' and field.startswith(('review:', 'part:', 'movement:', 'piece:', 'typeset:', 'vespers:')):
                    reference_counts[file] += 1
                    if field not in aliases['targets']:
                        unresolved.append({'legacy_target': field, 'state': 'lapsed',
                            'reason': 'historical review fingerprint absent from current queue',
                            'evidence': [origin('data/' + file, pointer(*parts, field), field)]})
                audit(child, file, (*parts, field))
        elif isinstance(value, list):
            for i, child in enumerate(value):
                audit(child, file, (*parts, i))
    for file in families:
        audit(read(data / file), file)

    from .addresses import addresses
    addresses(data, snapshot, aliases, root=data.parent)
    for name in ['works', 'source_items', 'settings', 'representations']:
        snapshot[name].sort(key=lambda r: r['id'])
    snapshot['relations'].sort(key=lambda r: (r['from_id'], r['to_id'], r['kind']))
    counts = {name: len(snapshot[name]) for name in ['works', 'source_items', 'settings', 'relations']}
    counts['representations'] = dict(sorted(Counter(r['kind'] for r in snapshot['representations']).items()))
    report = {'schema_version': 1, 'adapter_version': ADAPTER_VERSION, 'input_sha256': source_hashes(data),
                  'entity_counts': counts, 'alias_counts': {k: len(v) for k, v in aliases.items() if k != 'schema_version'},
                  'reference_counts': dict(sorted(reference_counts.items())),
                  'of_lender_counts': {
                      'resolved': sum(row['item_id'] is not None for row in aliases['of_lenders'].values()),
                      'missing': sum(row['item_id'] is None for row in aliases['of_lenders'].values())},
                  'unresolved': sorted(unresolved, key=lambda r: (r['legacy_target'], r['evidence'][0]['path'],
                                                               r['evidence'][0]['selector']))}
    for value, name in [(snapshot, 'snapshot'), (aliases, 'aliases'), (report, 'migration')]:
        validate(value, name, data)
    validate_edges(snapshot, aliases, ledger)
    return {'snapshot.json': snapshot, 'aliases.json': aliases, 'migration.json': report}


def validate_edges(snapshot, aliases, ledger):
    records = {r['id']: r for name in ['sources', 'editions', 'works', 'source_items', 'settings',
                                      'representations'] for r in snapshot[name]}
    active = {e['id'] for e in ledger['entries'] if e['state'] == 'active'}
    if records.keys() != active:
        raise ValueError(f'ledger/graph coverage mismatch: {records.keys() ^ active}')
    expected = {'edition_id': 'edn_', 'parent_id': 'itm_', 'source_id': 'src_', 'work_id': 'wrk_',
                'setting_id': 'set_', 'source_item_ids': 'itm_', 'setting_ids': 'set_'}
    for r in records.values():
        for field, prefix in expected.items():
            values = r.get(field)
            values = values if isinstance(values, list) else [values] if values else []
            for value in values:
                if value not in records or not value.startswith(prefix):
                    raise ValueError(f'dangling/incompatible graph edge: {r["id"]}/{field}: {value}')
        if r.get('parent_id') == r['id']:
            raise ValueError(f'self parent: {r["id"]}')
    for item in snapshot['source_items']:
        for sid in item['setting_ids']:
            if item['id'] not in records[sid]['source_item_ids']:
                raise ValueError(f'nonreciprocal item/setting edge: {item["id"]}: {sid}')
        if item['parent_id'] and records[item['parent_id']]['edition_id'] != item['edition_id']:
            raise ValueError(f'incompatible parent edition: {item["id"]}')
    for setting in snapshot['settings']:
        for iid in setting['source_item_ids']:
            if setting['id'] not in records[iid]['setting_ids']:
                raise ValueError(f'nonreciprocal setting/item edge: {setting["id"]}: {iid}')
    for representation in snapshot['representations']:
        sid = representation['setting_id']
        if sid and not set(representation['source_item_ids']) <= set(records[sid]['source_item_ids']):
            raise ValueError(f'incompatible representation setting owner: {representation["id"]}')
    for r in snapshot['relations']:
        if r['from_id'] not in records or r['to_id'] not in records or not r['evidence']:
            raise ValueError(f'dangling relation or missing evidence: {r}')
    for key, row in aliases['of_lenders'].items():
        if row['item_id'] is None:
            continue
        item = records.get(row['item_id'])
        setting = records.get(row['setting_id'])
        if item is None or setting is None or row['setting_id'] not in item['setting_ids'] or (
                row['item_id'] not in setting['source_item_ids']):
            raise ValueError(f'dangling/incompatible OF lender: {key}: {row}')
    for key, row in aliases['targets'].items():
        if row['entity_id'] not in records and row['state'] == 'active':
            raise ValueError(f'dangling alias {key}: {row}')

