"""Inventory, reports and the audit's real cached-event boundary."""
import json

from pipeline.typeset import events
from pipeline.typeset import proofread as p
from pipeline.typeset.lilypond import load_pin
from pipeline.typeset.render import source_hash


def test_inventory_excludes_only_current_review_hashes(tmp_path):
    text = '\\version "2.26.0"\n{ c d }\n'
    (tmp_path / 'a.ly').write_text(text)
    (tmp_path / 'b.ly').write_text(text)
    current = source_hash(text)
    manifest = {'parts': [{'file': 'a.ly', 'target': 'piece:a', 'hash': current},
                          {'file': 'b.ly', 'target': 'piece:b', 'hash': current}]}
    reviewed = {'reviewed': {'typeset:a.ly': {'was': 'old'}, 'typeset:b.ly': {'was': current}}}
    catalog = {'pieces': []}
    items = p.inventory(manifest, reviewed, catalog, {}, [], src=tmp_path)
    assert [i['file'] for i in items] == ['a.ly']
    assert items[0]['stratum'] == 'no-gabc'


def test_pilot_is_deterministic_and_covers_all_nonempty_strata():
    rows = [{'file': f'{kind}-{i}.ly', 'stratum': kind} for kind in
            ('perfect', 'near', 'different', 'no-gabc', 'unscored') for i in range(20)]
    selected = p.select_pilot(rows, 30)
    assert len(selected) == 30
    assert {i['stratum'] for i in selected} == {'perfect', 'near', 'different', 'no-gabc', 'unscored'}
    assert selected == p.select_pilot(list(reversed(rows)), 30)
    assert len(p.select_pilot(rows, 0)) == 100


def cached_case(tmp_path, steps=(0, 1, 2), gabc='(c4) A(jkl) (::)'):
    src = tmp_path / 'src'
    src.mkdir()
    text = '\\version "2.26.0"\n{ c d e }\n'
    (src / 'a.ly').write_text(text)
    cache = tmp_path / 'events'
    cache.mkdir()
    key = events.cache_key(text, load_pin().version)
    rows = [f'{i}/4\tup:chant\tnote\t{n}\t0\t0\t2\t0\t1\t1/4\t3:{i+1}' for i, n in enumerate(steps)]
    (cache / f'{key}.tsv').write_text('\n'.join(rows))
    item = {'file': 'a.ly', 'target': 'piece:a', 'hash': source_hash(text), 'gabc': gabc,
                'chant_id': 1, 'stratum': 'perfect', 'scans': []}
    return p.audit_one(item, src=src, cache=cache)


def test_cached_audit_checks_complete_tail_and_records_provenance(tmp_path):
    row = cached_case(tmp_path, gabc='(c4) A(jklm) (::)')
    assert row['status'] == 'differences'
    assert any(d['operation'] == 'insert' for d in row['discrepancies'])
    assert row['gabc_hash'] and row['event_key'] and row['source_hash']
    assert row['discrepancies'][0]['ours_context'][0]['origin'].startswith('2:')


def test_cached_clean_does_not_mean_fully_proofread(tmp_path):
    row = cached_case(tmp_path)
    assert row['status'] == 'melody-agrees'
    assert row['full_proofread'] is False
    assert row['ours_notes'] == 3


def test_no_gabc_is_explicit_without_running_lilypond(tmp_path):
    row = p.audit_one({'file': 'a.ly', 'hash': 'h', 'gabc': None, 'scans': []}, src=tmp_path)
    assert row['status'] == 'no-reference'
    assert row['full_proofread'] is False


def test_scan_span_has_all_systems_until_next_part():
    piece = {'slug': 'a', 'systems': ['noh1/0001/000', 'noh1/0001/001', 'noh1/0002/000'],
             'sections': [{'kind': 'introit', 'system': 0}, {'kind': 'gradual', 'system': 2}]}
    assert p.scan_span(piece, 'part:a/introit') == ['noh1/0001/000', 'noh1/0001/001']
    assert p.scan_span(piece, 'part:a/missing') == []


def test_html_report_escapes_source_and_writes_structured_packets(tmp_path):
    report = {'summary': {'differences': 1}, 'items': [{'file': '<script>x</script>',
              'status': 'differences', 'full_proofread': False, 'flags': ['<unsafe>'],
              'discrepancies': [], 'source_excerpt': '<img src=x onerror=alert(1)>', 'scans': []}]}
    path = p.write_report(report, tmp_path)
    html = path.read_text()
    assert '<script>x</script>' not in html
    assert '&lt;script&gt;x&lt;/script&gt;' in html
    assert '&lt;img' in html
    assert json.loads((tmp_path / 'report.json').read_text()) == report
    assert len(list((tmp_path / 'packets').glob('*.json'))) == 1


def test_stale_manifest_is_blocked_before_extraction(tmp_path):
    text = '\\version "2.26.0"\n{ c d }\n'
    (tmp_path / 'a.ly').write_text(text)
    row = p.audit_one({'file': 'a.ly', 'hash': '0' * 32, 'gabc': '(c4) A(jk)', 'scans': []}, src=tmp_path)
    assert row['status'] == 'blocked'
    assert 'stale' in row['flags'][0]


def test_difference_kind_distinguishes_repeated_attacks_from_changed_pitch():
    from pipeline.typeset.proof_notes import Note, NoteSequence
    ours = NoteSequence((Note(0), Note(1), Note(2)))
    repeated = NoteSequence((Note(0), Note(1), Note(1), Note(2)))
    changed = NoteSequence((Note(0), Note(3), Note(2)))
    assert p.difference_kind(ours, repeated, 0) == 'repeated-attacks'
    assert p.difference_kind(ours, changed, 0) == 'pitch-or-order'
    assert p.difference_kind(ours, NoteSequence((Note(0), Note(1), Note(2), Note(3))), 0) == 'ending-or-extra-section'


def test_cli_accepts_reproducible_pilot_and_exact_file_selection():
    from pipeline.cli import build_parser
    args = build_parser().parse_args(['typeset-proofread', '--limit', '0', '--file', 'vol-1/x.ly'])
    assert args.limit == 0 and args.file == ['vol-1/x.ly']


def test_acknowledged_file_with_changed_current_source_is_not_excluded(tmp_path):
    text = '\\version "2.26.0"\n{ c d }\n'
    (tmp_path / 'a.ly').write_text(text)
    manifest = {'parts': [{'file': 'a.ly', 'target': 'piece:a', 'hash': '0' * 32}]}
    reviewed = {'reviewed': {'typeset:a.ly': {'was': '0' * 32}}}
    rows = p.inventory(manifest, reviewed, {'pieces': []}, {}, [], src=tmp_path)
    assert len(rows) == 1 and rows[0]['manifest_stale']
