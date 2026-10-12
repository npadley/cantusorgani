"""Ornament attachment, semantic mutations and profile gating."""
from dataclasses import replace
from pathlib import Path

import pytest
from lxml import etree

from pipeline.typeset.mei.encode import encode_score
from pipeline.typeset.mei.extract import ir_from_rows, parse_rows
from pipeline.typeset.mei.model import ConversionProfile, ScoreIR
from pipeline.typeset.mei.normalize import normalize_ir, normalize_mei
from pipeline.typeset.mei.schema import load_schema_bundle, validate_schema
from pipeline.typeset.mei.validate import compare_scores

ROOT = Path(__file__).resolve().parents[1]
NS = {'m': 'http://www.music-encoding.org/ns/mei'}


def ornament_ir(direction='0', kind='prall'):
    text = (ROOT / 'tests/fixtures/mei/extraction/kyrie_IX.tsv').read_text()
    # First chant note is on up; first bass note shares its onset, proving layer attachment.
    text += f'0\tup:chant\tup\tart\t{kind}\t{direction}\tdata/typeset/src/vol-5/missa-ix/kyrie_IX.ly:1:1\n'
    return ir_from_rows(parse_rows(text), 'kyrie_IX.ly', '0' * 64)


def converted(ir):
    return encode_score(ir, ConversionProfile.load(ROOT / 'data/typeset/mei/profiles/accompaniment-v1.json'))


@pytest.mark.parametrize(('direction', 'place'), [('0', 'above'), ('1', 'above'), ('-1', 'below')])
def test_encode_score_prall_direction_attached_to_chant(direction, place):
    ir = ornament_ir(direction)
    encoded = converted(ir)
    root = etree.fromstring(encoded.xml)
    ornaments = root.xpath('//m:mordent[@type="prall"]', namespaces=NS)
    assert len(ornaments) == 1
    o = ornaments[0]
    assert (o.get('form'), o.get('staff'), o.get('place')) == ('upper', '1', place)
    assert encoded.provenance[o.get('startid')[1:]] == '0e0000'
    assert ir.ornaments[0].event_id == '0e0000'
    assert ScoreIR.from_dict(ir.to_dict()) == ir
    assert not validate_schema(encoded.xml, load_schema_bundle())
    assert compare_scores(normalize_ir(ir), normalize_mei(encoded.xml, encoded.provenance)) == []


@pytest.mark.parametrize('mutation', ['drop', 'move', 'quilisma', 'lower', 'staff', 'place'])
def test_compare_scores_mutated_prall_reports_difference(mutation):
    ir = ornament_ir()
    encoded = converted(ir)
    root = etree.fromstring(encoded.xml)
    o = root.xpath('//m:mordent[@type="prall"]', namespaces=NS)[0]
    if mutation == 'drop':
        o.getparent().remove(o)
    elif mutation == 'move':
        o.set('startid', '#ev0e0001')
    elif mutation == 'quilisma':
        del o.attrib['type']
    else:
        o.set({'lower': 'form', 'staff': 'staff', 'place': 'place'}[mutation],
              {'lower': 'lower', 'staff': '2', 'place': 'below'}[mutation])
    differences = compare_scores(normalize_ir(ir), normalize_mei(etree.tostring(root), encoded.provenance))
    assert any(d.code == 'ORNAMENT_MISMATCH' for d in differences)


def test_ir_from_rows_unknown_articulation_stays_unknown():
    ir = ornament_ir(kind='accent')
    assert any(d.code == 'UNKNOWN_FEATURE' and 'accent' in d.message for d in ir.diagnostics)


def test_encode_score_prall_on_quilisma_keeps_both_kinds():
    ir = ornament_ir()
    ir = replace(ir, events=(replace(ir.events[0], notehead='quilisma'), *ir.events[1:]))
    encoded = converted(ir)
    root = etree.fromstring(encoded.xml)
    assert len(root.xpath('//m:mordent', namespaces=NS)) == 2
    assert compare_scores(normalize_ir(ir), normalize_mei(encoded.xml, encoded.provenance)) == []


def test_ir_from_rows_prall_on_ambiguous_chord_stays_unknown():
    text = (ROOT / 'tests/fixtures/mei/extraction/kyrie_IX.tsv').read_text()
    text += ('0\tup:chant\tup\tnote\te\t0\t5\t2\t0\t1\t1\t1/4\tx.ly:1:2\n'
             '0\tup:chant\tup\tart\tprall\t0\tx.ly:1:3\n')
    ir = ir_from_rows(parse_rows(text), 'x.ly', '0' * 64)
    assert not ir.ornaments
    assert any(d.code == 'UNKNOWN_FEATURE' and 'prall' in d.message for d in ir.diagnostics)


@pytest.mark.parametrize('remove_glyph', [False, True])
def test_precheck_packet_prall_missing_glyph_reports_finding(tmp_path, remove_glyph):
    import shutil

    from pipeline.typeset.mei.cli import convert_command
    from pipeline.typeset.mei.evidence import build_evidence, run_node_renderer
    from pipeline.typeset.mei.precheck import precheck_packet

    class Runner:
        version = '2.26.0'

        def run(self, args, cwd, includes, timeout):
            shutil.copy(ROOT / 'tests/fixtures/mei/extraction/al_dominus_regnavit__exsultet.csv.tsv', cwd / 'out.listen.tsv')
            return True, ''

    packet = tmp_path / 'packet'
    source = ROOT / 'data/typeset/src/vol-1/al_dominus_regnavit__exsultet.csv.ly'
    assert convert_command(source, packet, Runner(), tmp_path / 'build') == 0
    build_evidence(packet, None, packet / 'evidence', node_runner=run_node_renderer,
                   lilypond_svg=lambda _s, _w: None, scan_images=lambda _t: [])
    if remove_glyph:
        svg = packet / 'evidence/cases/letter-p-orig/letter-p-orig-p1.svg'
        root = etree.parse(str(svg))
        groups = root.xpath('//*[local-name()="g" and @class="mordent prall"]')
        assert groups
        for group in groups:
            for child in list(group):
                group.remove(child)
        root.write(str(svg))
    findings = precheck_packet(packet)['letter-p-orig']
    assert any('ornament' in f for f in findings) == remove_glyph


@pytest.mark.lilypond
def test_run_listener_real_pralls_preserves_note_attachments():
    from pipeline.typeset.mei.extract import PinnedLilyPondRunner, run_listener
    source = ROOT / 'data/typeset/src/vol-1/al_dominus_regnavit__exsultet.csv.ly'
    ir = ir_from_rows(parse_rows(run_listener(source, PinnedLilyPondRunner())), str(source.relative_to(ROOT)), '0' * 64)
    assert [(o.kind, o.event_id, o.place) for o in ir.ornaments] == [
        ('prall', '0e0006', 'above'), ('prall', '0e0025', 'above'),
        ('prall', '0e0045', 'above'), ('prall', '0e0166', 'above'),
    ]


@pytest.mark.lilypond
@pytest.mark.parametrize(('music', 'place'), [
    (r"\voiceTwo c'4\prall d'4", 'below'),
    (r"\override Script.direction = #DOWN c'4\prall d'4", 'below'),
    (r"c'4_\prall d'4", 'below'),
    (r"c'4^\prall d'4", 'above'),
])
def test_run_listener_resolved_script_direction_preserves_placement(tmp_path, music, place):
    from pipeline.typeset.mei.extract import PinnedLilyPondRunner, run_listener
    source = tmp_path / 'direction.ly'
    source.write_text('\\version "2.26.0"\n\\score { \\new Staff = "down" { ' + music + ' } }\n')
    ir = ir_from_rows(parse_rows(run_listener(source, PinnedLilyPondRunner())), str(source), '0' * 64)
    assert len(ir.ornaments) == 1
    assert ir.ornaments[0].place == place


@pytest.mark.lilypond
def test_run_listener_note_local_chord_prall_stays_unknown(tmp_path):
    from pipeline.typeset.mei.extract import PinnedLilyPondRunner, run_listener
    source = tmp_path / 'chord.ly'
    source.write_text('\\version "2.26.0"\n\\score { \\new Staff { <c\'\\prall e\'>4 <c\' e\'>4 } }\n')
    ir = ir_from_rows(parse_rows(run_listener(source, PinnedLilyPondRunner())), str(source), '0' * 64)
    assert any(d.code == 'UNKNOWN_FEATURE' and 'prall' in d.message for d in ir.diagnostics)
