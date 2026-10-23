"""Permanent identities: allocations are independent of mutable descriptions."""
import copy
import json
import shutil
from pathlib import Path

import pytest
import yaml

from pipeline.identities import allocate, bootstrap, build, check, resolve_target

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'


@pytest.fixture
def model(tmp_path):
    tmp_path = tmp_path / 'data'
    tmp_path.mkdir()
    (tmp_path / 'identities').mkdir()
    (tmp_path / 'schema').mkdir()
    for name in ['schema/identities.json', 'identities/sources.json', 'volumes.yml']:
        shutil.copy(DATA / name, tmp_path / name)
    pieces = json.loads((DATA / 'catalog.json').read_text())['pieces']
    chosen = [copy.deepcopy(p) for p in pieces if p['slug'] in {
        'dominica-i-adventus', 'sabbato-temporum-adventus', 'ordinarium-missae-ix',
        'varia-crudelis-herodes', 'varia-crudelis-herodes-alter-tonus'}]
    (tmp_path / 'catalog.json').write_text(json.dumps({'schema_version': 3, 'pieces': chosen}))
    return tmp_path


def catalog(data):
    return json.loads((data / 'catalog.json').read_text())


def save(data, value):
    (data / 'catalog.json').write_text(json.dumps(value))


def test_bootstrap_example_and_refusal(model):
    bootstrap(model)
    build(model)
    assert resolve_target('part:dominica-i-adventus/introit', model)['entity_id'] == (
        'itm_614a61a9-f6a0-50aa-9d7d-6e4d02d6e7b8')
    with pytest.raises(ValueError, match='nonempty'):
        bootstrap(model)
    check(model)


def test_equal_incipits_and_tones_do_not_merge(model):
    c = catalog(model)
    for p in c['pieces']:
        if p['genre'] == 'hymn':
            p['title'] = 'Identical incipit'
            p['chant'] = [{'id': 123, 'status': 'verified'}]
    save(model, c)
    bootstrap(model)
    s = build(model)['snapshot.json']
    works = [w for w in s['works'] if w['title'] == 'Identical incipit']
    assert len(works) == 2
    assert works[0]['id'] != works[1]['id']
    assert not any(r['kind'] in ('same-work', 'candidate-same-work') for r in s['relations'])
    assert 'assignments' not in s


def test_numbered_description_and_page_changes_keep_ids(model):
    bootstrap(model)
    before = build(model)
    c = catalog(model)
    p = next(p for p in c['pieces'] if p['slug'] == 'sabbato-temporum-adventus')
    p['title'] = 'Corrected heading'
    p['printed_pages'] = [30, 45]
    p['sections'][1]['title'] = 'Corrected incipit'
    c['pieces'].reverse()
    save(model, c)
    after = build(model)
    assert before['aliases.json']['targets'] == after['aliases.json']['targets']
    assert allocate(model) == 0


def test_numbered_insertion_is_structural(model):
    bootstrap(model)
    c = catalog(model)
    p = next(p for p in c['pieces'] if p['slug'] == 'sabbato-temporum-adventus')
    p['sections'].insert(1, {'kind': 'other', 'key': 'new', 'variant': ''})
    save(model, c)
    with pytest.raises(ValueError, match='structural|rebind'):
        allocate(model)


def test_n_to_key_requires_rebind(model):
    bootstrap(model)
    c = catalog(model)
    p = next(p for p in c['pieces'] if p['slug'] == 'sabbato-temporum-adventus')
    row = next(s for s in p['sections'] if s.get('n') == 2)
    del row['n']
    row['key'] = 'second'
    save(model, c)
    with pytest.raises(ValueError, match='rebind|missing'):
        build(model)


def test_allocate_after_effective_catalogue_and_read_only_build(model):
    bootstrap(model)
    old = (model / 'identities/ledger.json').read_bytes()
    c = catalog(model)
    p = copy.deepcopy(c['pieces'][-1])
    p.update(id='noh7-new-hymn', slug='new-hymn', sections=[], movements=[], genre='hymn')
    c['pieces'].append(p)
    save(model, c)
    with pytest.raises(ValueError, match='unallocated'):
        build(model)
    assert (model / 'identities/ledger.json').read_bytes() == old
    assert allocate(model) > 0
    build(model)
    new = resolve_target('piece:new-hymn', model)['entity_id']
    assert new.split('-')[2][0] == '4'
    assert allocate(model) == 0


def test_unknown_retired_and_duplicate_alias_fail(model):
    bootstrap(model)
    build(model)
    with pytest.raises(ValueError, match='unknown'):
        resolve_target('piece:missing', model)
    (model / 'identities/aliases.yml').write_text(yaml.safe_dump({
        'schema_version': 1, 'aliases': [
            {'legacy_target': 'piece:dominica-i-adventus', 'entity_id': 'itm_missing',
             'state': 'active', 'reason': 'conflict', 'evidence': []}]}))
    with pytest.raises(ValueError, match='alias|unknown'):
        build(model)


def test_numbered_hymnal_gate(tmp_path):
    fixture = ROOT / 'tests/fixtures/identities/model/numbered-hymnal'
    (tmp_path / 'identities').mkdir()
    (tmp_path / 'schema').mkdir()
    shutil.copy(DATA / 'schema/identities.json', tmp_path / 'schema/identities.json')
    shutil.copy(fixture / 'sources.json', tmp_path / 'identities/sources.json')
    shutil.copy(fixture / 'items.json', tmp_path / 'items.json')
    (tmp_path / 'volumes.yml').write_text('volumes: {}\n')
    bootstrap(tmp_path, adapter='numbered-hymnal')
    assert allocate(tmp_path, adapter='numbered-hymnal') == 0
    s = build(tmp_path)['snapshot.json']
    assert len(s['works']) == 2
    assert len(s['settings']) == 3
    assert all('pdf_pages' not in i['locator'] for i in s['source_items'])
    assert resolve_target('hymnal:1', tmp_path)['state'] == 'active'
    check(tmp_path)


def test_nonapproved_mei_and_unmatched_lilypond_are_thin_references(model):
    folder = model / 'typeset/mei/records'
    folder.mkdir(parents=True)
    for state in ['failed', 'revoked', 'unpublished', 'needs-review']:
        (folder / (state + '.json')).write_text(json.dumps({
            'state': state, 'target': None, 'render_hash': state,
            'source_path': 'data/typeset/src/unmatched.ly', 'artifact_sha256': None}))
    source = model / 'typeset/src/unmatched.ly'
    source.parent.mkdir(parents=True)
    source.write_text('% fixture, never rendered\n')
    bootstrap(model)
    s = build(model)['snapshot.json']
    reps = [r for r in s['representations'] if r['kind'] != 'scan']
    assert len(reps) == 5
    assert all(r['setting_id'] is None and 'capabilities' not in r for r in reps)
    assert {r['locator']['record_path'].split('/')[-1] for r in reps if r['kind'] == 'mei'} == {
        'failed.json', 'revoked.json', 'unpublished.json', 'needs-review.json'}


def test_nonmusical_containers_do_not_get_works(model):
    bootstrap(model)
    s = build(model)['snapshot.json']
    top = next(i for i in s['source_items'] if i['origin']['legacy_target'] == 'piece:dominica-i-adventus')
    assert top['classification'] == 'container'
    assert top['setting_ids'] == []
    scan = next(r for r in s['representations'] if r['source_item_ids'] == [top['id']])
    assert scan['setting_id'] is None


def test_union_independent_branch_allocations(model, tmp_path):
    bootstrap(model)
    left, right = tmp_path / 'left', tmp_path / 'right'
    shutil.copytree(model, left)
    shutil.copytree(model, right)
    def add_hymn(data, name):
        c = catalog(data)
        p = copy.deepcopy(next(p for p in c['pieces'] if p['genre'] == 'hymn'))
        p.update(id='noh7-' + name, slug=name)
        c['pieces'].append(p)
        save(data, c)
        allocate(data)
        return p
    a, b = add_hymn(left, 'left'), add_hymn(right, 'right')
    c = catalog(model)
    c['pieces'] += [a, b]
    save(model, c)
    from pipeline.identities.ledger import ledger_bytes
    l = json.loads((left / 'identities/ledger.json').read_text())
    r = json.loads((right / 'identities/ledger.json').read_text())
    entries = {e['id']: e for e in [*l['entries'], *r['entries']]}
    l['entries'] = sorted(entries.values(), key=lambda e: e['id'])
    (model / 'identities/ledger.json').write_bytes(ledger_bytes(l))
    build(model)
    check(model)
    assert resolve_target('piece:left', model)['entity_id'] != resolve_target('piece:right', model)['entity_id']


def test_union_collision_reports_both_origins(model):
    bootstrap(model)
    from pipeline.identities.ledger import ledger_bytes
    l = json.loads((model / 'identities/ledger.json').read_text())
    entry = copy.deepcopy(next(e for e in l['entries'] if e['kind'] == 'item'))
    entry['id'] = 'itm_00000000-0000-4000-8000-000000000099'
    l['entries'].append(entry)
    l['entries'].sort(key=lambda e: e['id'])
    (model / 'identities/ledger.json').write_bytes(ledger_bytes(l))
    with pytest.raises(ValueError, match='duplicate.*previous'):
        build(model)


def test_build_keeps_large_projections_outside_sources(model):
    bootstrap(model)
    build(model)
    for name in ('snapshot.json', 'aliases.json'):
        assert not (model / 'identities' / name).exists()
        assert (model.parent / 'build/identities' / name).exists()
    assert (model / 'identities/migration.json').exists()


def test_check_and_resolver_need_no_generated_projections(model):
    bootstrap(model)
    build(model)
    for name in ('snapshot.json', 'aliases.json'):
        (model.parent / 'build/identities' / name).unlink(missing_ok=True)
        (model / 'identities' / name).unlink(missing_ok=True)
    before = {p: p.read_bytes() for p in model.rglob('*') if p.is_file()}
    check(model)
    assert resolve_target('part:dominica-i-adventus/introit', model)['state'] == 'active'
    assert before == {p: p.read_bytes() for p in model.rglob('*') if p.is_file()}


def test_check_stale_migration_never_writes(model):
    bootstrap(model)
    build(model)
    path = model / 'identities/migration.json'
    path.write_text('{}')
    with pytest.raises(ValueError, match='stale'):
        check(model)
    assert path.read_text() == '{}'


def test_explicit_slug_rebind_preserves_work_setting_and_scan_ids(model):
    from pipeline.identities.ledger import rebind
    bootstrap(model)
    before = build(model)
    c = catalog(model)
    p = next(p for p in c['pieces'] if p['slug'] == 'dominica-i-adventus')
    p['slug'] = 'renamed-advent'
    p['id'] = 'noh1-renamed-advent'
    save(model, c)
    ledger = json.loads((model / 'identities/ledger.json').read_text())
    for e in ledger['entries']:
        if e['kind'] == 'item' and any(k.startswith(('piece:dominica-i-adventus', 'part:dominica-i-adventus/')) for k in e['legacy_keys']):
            loc = {**e['locator'], 'slug': 'renamed-advent'} if e['locator'] else {
                'slug': 'renamed-advent', 'kind': 'piece', 'key': None, 'n': None, 'variant': None}
            rebind(model, e['id'], loc, reason='reviewed slug correction')
    after = build(model)
    for family in ['source_items', 'works', 'settings', 'representations']:
        assert {i['id'] for i in before['snapshot.json'][family]} == {
            i['id'] for i in after['snapshot.json'][family]}
    assert resolve_target('part:renamed-advent/introit', model)['entity_id'] == (
        'itm_614a61a9-f6a0-50aa-9d7d-6e4d02d6e7b8')
    with pytest.raises(ValueError, match='retired'):
        resolve_target('part:dominica-i-adventus/introit', model)


def test_reviewed_embedded_hymn_is_one_printed_setting(model):
    c = catalog(model)
    p = next(p for p in c['pieces'] if p['slug'] == 'dominica-i-adventus')
    p['sections'] = []
    p['hymns'] = [{'title': 'Embedded hymn', 'ref': p['systems'][0]}]
    save(model, c)
    (model / 'vespers').mkdir()
    (model / 'vespers/vespers-noh8.yml').write_text(yaml.safe_dump({
        'sunday_office': {'piece': p['slug'], 'hymn': {
            'title': 'Embedded hymn', 'refs': p['systems'][:2]}}}))
    bootstrap(model)
    s = build(model)['snapshot.json']
    children = [i for i in s['source_items'] if i['parent_id'] and i['title'] == 'Embedded hymn']
    assert len(children) == 1
    child = children[0]
    scan = next(r for r in s['representations'] if r['source_item_ids'] == [child['id']])
    assert scan['locator']['system_refs'] == p['systems'][:2]
    assert len(scan['evidence']) == 2


def test_named_keys_stay_bound_when_unambiguous_keyed_row_is_inserted(model):
    bootstrap(model)
    before = build(model)
    c = catalog(model)
    p = next(p for p in c['pieces'] if p['slug'] == 'ordinarium-missae-ix')
    p['sections'].insert(0, {'kind': 'other', 'key': 'rubric', 'variant': ''})
    save(model, c)
    assert allocate(model) == 1  # Unplaced reference: no guessed work/setting.
    after = build(model)
    key = 'part:ordinarium-missae-ix/other:gloria'
    assert before['aliases.json']['targets'][key] == after['aliases.json']['targets'][key]


def test_retired_active_requests_fail(model):
    from pipeline.identities.ledger import ledger_bytes
    bootstrap(model)
    build(model)
    key = 'part:dominica-i-adventus/introit'
    l = json.loads((model / 'identities/ledger.json').read_text())
    e = next(e for e in l['entries'] if key in e['legacy_keys'])
    e['state'] = 'retired'
    (model / 'identities/ledger.json').write_bytes(ledger_bytes(l))
    with pytest.raises(ValueError, match='retired'):
        build(model)


def test_completed_schema_rejects_unknown_fields_and_dangling_edges(model):
    from pipeline.identities.ledger import load_ledger
    from pipeline.identities.model import validate
    from pipeline.identities.projection import validate_edges
    bootstrap(model)
    result = build(model)
    s = result['snapshot.json']
    s['works'][0]['unexpected'] = True
    with pytest.raises(ValueError, match='unknown fields'):
        validate(s, 'snapshot', model)
    del s['works'][0]['unexpected']
    s['settings'][0]['work_id'] = 'wrk_00000000-0000-4000-8000-000000000099'
    with pytest.raises(ValueError, match='dangling'):
        validate_edges(s, result['aliases.json'], load_ledger(model))


def test_card_b_address_inventory_joins_without_queries_as_identity(model):
    bootstrap(model)
    (model / 'identities/legacy-addresses.json').write_text(json.dumps({
        'schema_version': 2, 'routes': [
            {'path': '/about/', 'fragments': ['credits'], 'queries': []},
            {'path': '/admin/review/', 'fragments': [], 'queries': ['kind=part_to_check']},
            {'path': '/piece/feria-iv-cinerum/', 'fragments': [], 'queries': []}],
        'resources': ['/admin/review.json']}))
    a = build(model)['aliases.json']
    assert any(r['path'] == '/about/' and r['fragment'] == 'credits' for r in a['addresses'])
    assert all('?' not in r['path'] and '?' not in r['destination_path'] for r in a['addresses'])


@pytest.mark.parametrize('reverse', [False, True])
def test_captured_redirect_order_does_not_change_validation(model, reverse):
    from pipeline.identities.addresses import addresses

    rules = [dict(zip(('from', 'to', 'status'), line.split(), strict=True))
             for line in (ROOT / 'web/public/_redirects').read_text().splitlines()
             if line.strip() and not line.startswith('#')]
    rules.sort(key=lambda r: r['from'], reverse=reverse)
    (model / 'identities/legacy-addresses.json').write_text(json.dumps({
        'redirects': rules,
        'routes': [{'path': rule['to'].split('?')[0]} for rule in rules],
    }))
    (model.parent / 'web/public').mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / 'web/public/_redirects', model.parent / 'web/public/_redirects')
    addresses(model, {'source_items': [], 'settings': []}, {'legacy_slugs': {}}, root=model.parent)


def test_bind_duplicate_wanted_legacy_keys_raise(model):
    from pipeline.identities.ledger import bind, load_ledger, requests

    bootstrap(model)
    wanted = requests(model)
    duplicate = copy.deepcopy(next(w for w in wanted if w['legacy_keys']))
    duplicate['birth_seed'] = 'different-row'
    wanted.append(duplicate)
    with pytest.raises(ValueError, match='duplicate.*legacy key'):
        bind(load_ledger(model), wanted, model)


def test_bind_two_wanted_rows_cannot_claim_one_entry(model):
    from pipeline.identities.ledger import bind, load_ledger, requests

    bootstrap(model)
    wanted = requests(model)
    setting = copy.deepcopy(next(w for w in wanted if w['kind'] == 'setting'))
    setting['birth_seed'] = 'renamed-setting'
    wanted.append(setting)
    with pytest.raises(ValueError, match='already bound|two wanted'):
        bind(load_ledger(model), wanted, model)


def test_multi_setting_rebind_preserves_ordinals(model):
    from pipeline.identities.ledger import bind, load_ledger, requests

    fixture = ROOT / 'tests/fixtures/identities/model/numbered-hymnal'
    shutil.copy(fixture / 'sources.json', model / 'identities/sources.json')
    shutil.copy(fixture / 'items.json', model / 'items.json')
    (model / 'catalog.json').write_text('{"pieces": []}')
    bootstrap(model, adapter='numbered-hymnal')
    ledger = load_ledger(model)
    wanted = requests(model)
    # Model the request-side rename after a reviewed item rebind: the item
    # still binds by its explicit alias, while work/setting birth seeds differ.
    for w in wanted:
        if w['birth_seed'].startswith('hymnal:1'):
            w['birth_seed'] = w['birth_seed'].replace('hymnal:1', 'renamed:1', 1)
        w['links'] = [(role, kind, seed.replace('hymnal:1', 'renamed:1', 1))
                      for role, kind, seed in w['links']]
    bound = bind(ledger, wanted, model)
    for ordinal in (1, 2):
        old = next(e for e in ledger['entries']
                   if e['kind'] == 'setting' and e['birth_seed'] == f'hymnal:1:setting:{ordinal}')
        assert bound['setting', f'renamed:1:setting:{ordinal}']['id'] == old['id']


def test_input_hash_tracks_post_replay_catalog(model):
    from pipeline.identities.projection import source_hashes

    before = source_hashes(model)
    c = catalog(model)
    c['pieces'][0]['title'] = 'A corrected heading'
    save(model, c)
    after = source_hashes(model)
    assert before['data/catalog.json'] != after['data/catalog.json']


def test_addresses_use_explicit_fixture_root(model, tmp_path):
    from pipeline.identities.addresses import addresses

    root = tmp_path / 'site'
    (root / 'web/public').mkdir(parents=True)
    (root / 'web/public/_redirects').write_text('/old/ /new/ 301\n')
    aliases = {'legacy_slugs': {}}
    addresses(model, {'source_items': [], 'settings': []}, aliases, root=root)
    assert aliases['redirects'] == [{'from': '/old/', 'to': '/new/', 'status': 301}]
