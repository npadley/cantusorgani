"""P5 measured layout evidence remains advice for human review."""
import json
from pathlib import Path

import pytest

from pipeline.typeset.mei.model import (
    REQUIRED_MATRIX,
    ConversionInputs,
    ConversionRecord,
    ValidationReport,
)
from pipeline.typeset.mei.precheck import precheck_packet
from pipeline.typeset.mei.review import auto_approve


def _packet(tmp_path: Path, *, gaps=(), tie_x=2532, tie_y=19880, draw_tie=True):
    # Literal current in-exsurge large-staff continuation geometry.
    (tmp_path / 'ir.json').write_text(json.dumps({
        'events': [{'id': '1', 'kind': 'note', 'notated': {'log': 3, 'dots': 0},
                    'tieToNext': True, 'staffId': 'up', 'layerId': 'up:chant',
                    'onset': '0/1', 'pitch': {'step': 'c', 'alter': '0/1', 'octave': 4}}],
        'layers': [{'id': 'up:chant', 'homeStaffId': 'up'}], 'lyrics': [],
    }))
    (tmp_path / 'boundaries.json').write_text('[]')
    (tmp_path / 'score.mei').write_text('''<mei xmlns="http://www.music-encoding.org/ns/mei">
      <music><measure xml:id="m1"><note xml:id="ev1" dur="8" next="#ev1c1"/>
      <note xml:id="ev1c1" dur="8"/><note xml:id="ev2" dur="8"/>
      <tie xml:id="t1" startid="#ev1" endid="#ev2"/></measure></music></mei>''')
    tie = f'<g id="t1" class="tie"><path d="M{tie_x},{tie_y} C3000,19500 5000,19500 6000,19880"/></g>' if draw_tie else ''
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg"><g class="system">
      <g id="m1" class="measure"><g id="ev1" class="note"><g class="notehead">
      <use transform="translate(1000,5000)"/></g></g>
      <g id="ev1c1" class="note split-continuation"><g class="notehead">
      <use transform="translate(2172,19940)"/></g></g>
      <g id="ev2" class="note"><g class="notehead"><use transform="translate(6000,19940)"/></g></g>
      {tie}</g></g></svg>'''
    cases = {'cases': []}
    for case in REQUIRED_MATRIX:
        folder = tmp_path / 'evidence' / 'cases' / case.id
        folder.mkdir(parents=True)
        (folder / f'{case.id}-p1.svg').write_text(svg)
        cases['cases'].append({'id': case.id, 'staffHeightMm': 9.6, 'pageCount': 1,
                               'diagnostics': [], 'lyricGaps': list(gaps)})
    (tmp_path / 'evidence' / 'cases' / 'cases.json').write_text(json.dumps(cases))
    return tmp_path, cases


def test_fresh_eighth_continuation_tie_starts_on_head(tmp_path):
    packet, _ = _packet(tmp_path)
    assert not any('tie ' in line for lines in precheck_packet(packet).values() for line in lines)


@pytest.mark.parametrize('patch', [
    {'tie_x': 2624},  # beyond the existing 451.333-unit right bound
    {'tie_x': 2000},  # beyond the left bound
    {'tie_y': 20291},  # wrong pitch, beyond vertical tolerance
    {'draw_tie': False},
])
def test_continuation_endpoint_mutations_remain_review_findings(tmp_path, patch):
    packet, _ = _packet(tmp_path, **patch)
    assert any('tie t1: no piece starts' in line for line in precheck_packet(packet)['letter-p-large-auto'])


def test_close_lyrics_are_visible_without_blocking_autoapproval(tmp_path):
    packet, cases = _packet(tmp_path, gaps=[
        {'page': 2, 'system': 0, 'a': 'no', 'b': 'bis.', 'gapMm': 0.21},
        {'page': 2, 'system': 0, 'a': 'runt', 'b': 'no', 'gapMm': 0.316},
    ])
    findings = precheck_packet(packet)
    warnings = [line for line in findings['letter-p-large-auto'] if 'lyrics:' in line]
    assert len(warnings) == 1
    assert warnings[0].startswith('info:')
    assert 'no' in warnings[0] and 'bis.' in warnings[0] and '0.210 mm' in warnings[0]
    assert 'page 2' in warnings[0] and 'system 1' in warnings[0]
    rec = ConversionRecord(
        source_path='data/typeset/src/test.ly', target='movement:test', render_hash='r' * 32,
        state='needs-review', inputs=ConversionInputs('s', 'i', '2.26.0', 'e', 'c', 'p', 'p1', 'x', '6.3', 'f'),
        artifact_sha256='a' * 64, diagnostics=(), review=None,
        validation=ValidationReport(True, (), (), True, {'mei': 'a' * 64},
                                    {'comparer': 'cmp/1', 'normalizer': 'norm/1'}),
    )
    approved = auto_approve(rec, findings, cases, profile_version=3)
    assert approved.state == 'approved'
    assert approved.auto_review is not None and approved.auto_review.criteria_failed == ()
    assert findings['letter-p-large-auto'] == warnings


@pytest.mark.parametrize('gap', [0.3, 0.316, 0.9])
def test_lyrics_at_or_above_threshold_are_clean(tmp_path, gap):
    packet, _ = _packet(tmp_path, gaps=[{'page': 1, 'a': 'a', 'b': 'b', 'gapMm': gap}])
    assert not any('lyrics:' in line for line in precheck_packet(packet)['letter-p-large-auto'])


def test_negative_gap_reports_actual_overlap(tmp_path):
    packet, _ = _packet(tmp_path, gaps=[{'page': 1, 'a': 'a', 'b': 'b', 'gapMm': -0.12}])
    assert any(line.startswith('info: lyrics:') and '-0.120 mm' in line
               for line in precheck_packet(packet)['letter-p-large-auto'])
