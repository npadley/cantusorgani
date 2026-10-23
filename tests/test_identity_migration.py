"""Corpus migration and unchanged replay/publication boundaries."""
from pathlib import Path

import pytest

from pipeline.identities import build

DATA = Path(__file__).resolve().parents[1] / 'data'


def test_all_noh_containers_and_exact_lender():
    result = build(DATA, out=None, write=False)
    s, a = result['snapshot.json'], result['aliases.json']
    assert len(a['legacy_ids']) == 576
    assert len(s['editions']) == 7
    target = 'part:dominica-iv-adventus/introit'
    lender = a['targets'][target]['entity_id']
    of = a['targets']['of:annunciation/introitus']['entity_id']
    assert lender == of
    assert {i['locator']['pagination'] for i in s['source_items']} >= {'regina', 'pius-x'}
    assert not any(e['id'].startswith('asg_') for e in s['source_items'])


def test_every_mei_record_including_nonapproved_is_referenced():
    s = build(DATA, write=False)['snapshot.json']
    records = list((DATA / 'typeset/mei/records').glob('*.json'))
    refs = {r['locator']['record_path'] for r in s['representations'] if r['kind'] == 'mei'}
    assert refs == {'data/typeset/mei/records/' + p.name for p in records}


def test_upload_plans_and_hashes_do_not_take_identity_ids(tmp_path, monkeypatch):
    """Capture the actual planners with fixture artifacts; never call an uploader."""
    import hashlib
    import inspect
    from types import SimpleNamespace

    from pipeline import publish, upload
    from pipeline.typeset import publish as typeset_publish
    from pipeline.typeset import render
    from pipeline.typeset.mei import publish as mei_publish

    payload = b'pinned raster fixture'
    digest = hashlib.sha256(payload).hexdigest()
    scan_files = []
    for n in range(3):
        path = tmp_path / f'scan-{n}'
        path.write_bytes(payload + bytes([n]))
        scan_files.append(path)
    monkeypatch.setattr(publish, 'slice_systems', lambda *a: [
        SimpleNamespace(ref='noh1/0029/000', sha256=digest, paths=scan_files)])
    text = (DATA / 'typeset/src/vol-5/missa-ix/kyrie_IX.ly').read_text()
    render_hash = render.source_hash(text)
    rendered = tmp_path / 'typeset' / render_hash
    rendered.mkdir(parents=True)
    for name in render.FILES:
        (rendered / name).write_bytes(b'pinned ' + name.encode())
    monkeypatch.setattr(typeset_publish, 'check_file', lambda *a: [])
    monkeypatch.setattr(typeset_publish, 'check_pdf', lambda *a: [])
    plans = []
    def capture(planned, creds):
        assert creds is None
        plans.extend(planned)
        return SimpleNamespace(failed=[], uploaded=0, skipped=0)
    monkeypatch.setattr(upload, 'upload_all', capture)
    mei = b'<mei/>'
    mei_digest = hashlib.sha256(mei).hexdigest()
    artifacts = tmp_path / 'artifacts'
    (artifacts / mei_digest).mkdir(parents=True)
    (artifacts / mei_digest / 'score.mei').write_bytes(mei)
    (artifacts / mei_digest / 'boundaries.json').write_bytes(b'[]\n')
    record = SimpleNamespace(state='approved', artifact_sha256=mei_digest)
    monkeypatch.setattr(mei_publish, 'approval_is_current', lambda *a: True)
    def planned():
        scans = publish.upload_plans('noh1', 29)
        plans.clear()
        assert typeset_publish.publish(rendered.parent)[2] == []
        typeset = [(p.key, hashlib.sha256(p.path.read_bytes()).hexdigest()) for p in plans]
        verified = mei_publish.verify_publish_bundle(artifacts, [record], lambda r: None)
        return {'scan': [(p.key, hashlib.sha256(p.path.read_bytes()).hexdigest()) for p in scans],
                'typeset': typeset, 'mei': verified.files, 'render_hash': render.source_hash(text)}
    before = planned()
    build(DATA, out=tmp_path / 'sidecars')
    after = planned()
    assert before == after
    assert before['scan'][0][0] == f'systems/noh1/0029/000-{digest[:12]}.webp'
    assert {k for k, _ in before['typeset']} == {f'typeset/{render_hash}/{n}' for n in render.FILES}
    assert set(before['mei']) == {f'mei/{mei_digest}/score.mei', f'mei/{mei_digest}/boundaries.json'}
    for function in [publish.r2_key, publish.upload_plans, render.source_hash,
                     typeset_publish.publish, mei_publish.verify_publish_bundle]:
        assert not any('edition' in p for p in inspect.signature(function).parameters)


@pytest.mark.real_sections
def test_replay_never_reads_identity_graph_and_preserves_bytes(tmp_path, monkeypatch):
    from pipeline import corrections
    from pipeline.identities import build

    entries = corrections.load(DATA / 'corrections.yml')
    base = corrections.load_base(DATA / 'catalog.base.json')
    before = corrections.dump(corrections.apply(base, entries))
    original = Path.read_text
    def no_graph(path, *a, **kw):
        assert 'identities' not in path.parts, f'legacy replay tried reading {path}'
        return original(path, *a, **kw)
    monkeypatch.setattr(Path, 'read_text', no_graph)
    assert corrections.dump(corrections.apply(base, entries)) == before
    monkeypatch.setattr(Path, 'read_text', original)
    build(DATA, out=tmp_path)
    assert corrections.dump(corrections.apply(base, entries)) == before
    assert before.encode() == (DATA / 'catalog.json').read_bytes()


def test_every_of_slot_preserves_its_exact_lender_or_missing_state():
    """Wrong slot keys, swapped lenders and guessed missing music must fail."""
    import json

    result = build(DATA, write=False)
    snapshot = result['snapshot.json']
    table = result['aliases.json'].get('of_lenders', {})
    items = {item['id']: item for item in snapshot['source_items']}
    settings = {setting['id']: setting for setting in snapshot['settings']}
    propers = json.loads((DATA / 'ordinary-form-propers.json').read_text())
    assert len(table) == 1016
    missing = 0
    for occasion in propers['occasions']:
        for part in occasion['parts']:
            key = 'of:' + occasion['key'] + '/' + part['slot']
            if part.get('variant'):
                key += ':' + part['variant']
            row = table[key]
            lender = part['lender']
            if lender is None:
                missing += 1
                assert row == {'item_id': None, 'setting_id': None, 'legacy_ref': None,
                               'legacy_target': None, 'state': 'missing'}
                continue
            target = 'part:' + lender['slug'] + '/' + lender['part']
            if lender.get('variant'):
                target += ':' + lender['variant']
            item = items[row['item_id']]
            assert row['legacy_target'] == target
            assert row['legacy_ref'] == lender['ref']
            assert row['item_id'] == result['aliases.json']['targets'][target]['entity_id']
            assert item['origin']['legacy_target'] == target
            assert item['locator']['system_refs'][0] == lender['ref']
            assert item['setting_ids'] == [row['setting_id']]
            assert item['id'] in settings[row['setting_id']]['source_item_ids']
    assert missing == 72
    assert result['migration.json']['of_lender_counts'] == {'resolved': 944, 'missing': 72}
    assert not any(evidence['path'] == 'data/ordinary-form-propers.json'
                   for relation in snapshot['relations'] if relation['kind'] == 'borrows'
                   for evidence in relation['evidence'])


def test_bootstrap_and_initial_ledger_have_no_retired_allocations(tmp_path):
    """Duplicate import routes must share a seed, without cleanup tombstones."""
    import json
    import shutil

    from pipeline.identities import bootstrap

    current = json.loads((DATA / 'identities/ledger.json').read_text())
    assert all(entry['state'] == 'active' for entry in current['entries'])
    target = tmp_path / 'data'
    def ignore(path, names):
        if Path(path).name == 'identities':
            return {'ledger.json', 'snapshot.json', 'aliases.json', 'migration.json'} & set(names)
        return set()
    shutil.copytree(DATA, target, ignore=ignore)
    bootstrap(target)
    fresh = json.loads((target / 'identities/ledger.json').read_text())
    assert all(entry['state'] == 'active' for entry in fresh['entries'])
    assert fresh == current
    result = build(target)
    assert result['aliases.json']['targets'][
        'vespers-source:vespers/vespers-noh8.yml:/sunday_office/hymn']['entity_id'] == (
            result['aliases.json']['targets']['hymn-pairing:noh8/0051/004']['entity_id'])
    for ref in ['noh8/0051/004', 'noh8/0178/000']:
        item_id = result['aliases.json']['targets']['hymn-pairing:' + ref]['entity_id']
        settings = [setting for setting in result['snapshot.json']['settings']
                    if item_id in setting['source_item_ids']]
        assert len(settings) == 1
