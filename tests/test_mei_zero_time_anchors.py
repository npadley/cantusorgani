"""Zero-time voice-line endpoints are engraving anchors, not sounding notes."""

from dataclasses import replace
from fractions import Fraction

import pytest
from lxml import etree

from pipeline.typeset.mei.diagnostics import SourceLocation
from pipeline.typeset.mei.encode import encode_score
from pipeline.typeset.mei.model import (
    Event,
    LayerDef,
    NotatedDuration,
    Pitch,
    ScoreIR,
    Span,
    StaffDef,
)
from pipeline.typeset.mei.normalize import normalize_ir, normalize_mei
from pipeline.typeset.mei.schema import load_schema_bundle, validate_schema
from pipeline.typeset.mei.validate import compare_scores
from tests.test_mei_encode import profile

M = '{http://www.music-encoding.org/ns/mei}'
ID = '{http://www.w3.org/XML/1998/namespace}id'


def anchor_ir():
    loc = SourceLocation('anchor.ly', 1, 1)
    def note(eid, layer, onset, duration, pitch, hidden):
        return Event(eid, layer, 'up', 'note', Fraction(onset), Fraction(duration),
                     NotatedDuration(1, 0, Fraction(duration) * 2), Pitch(pitch, Fraction(0), 4),
                     'none', 'hidden' if hidden else 'normal', False, False, loc)
    events = (note('0a', 'chant', 0, 1, 'g', False),
              note('1a', 'line', 0, Fraction(1, 2), 'c', True),
              note('1b', 'line', Fraction(1, 2), 0, 'd', True),
              note('1c', 'line', Fraction(1, 2), Fraction(1, 2), 'e', True))
    return ScoreIR(1, 'anchor.ly', '0' * 64, '2.26.0', 'fixture', Fraction(1),
                   (StaffDef('up', 1, 'G', 2, 0),),
                   (LayerDef('chant', 'up', 0, 'voiceOne', 'chant'),
                    LayerDef('line', 'up', 1, 'voiceTwo', 'voice-line')),
                   events, (Span('gl', 'voice-line', '1a', '1b'),), (), (), (), (), (), ())


def test_zero_time_voice_line_anchor_schema_and_oracle_preserve_timing():
    ir = anchor_ir()
    encoded = encode_score(ir, profile())
    assert validate_schema(encoded.xml, load_schema_bundle()) == []
    root = etree.fromstring(encoded.xml)
    anchor = next(n for n in root.iter(M + 'note') if n.get(ID) == 'ev1b')
    assert (anchor.get('type'), anchor.get('grace'), anchor.get('vel'), anchor.get('visible')) == (
        'voice-line-anchor', 'unacc', '0', 'false')
    assert not root.findall('.//' + M + 'tuplet[@numbase="0"]')
    assert compare_scores(normalize_ir(ir), normalize_mei(encoded.xml, encoded.provenance)) == []


@pytest.mark.parametrize('attribute,value', [('vel', '64'), ('visible', 'true'), ('type', 'changed')])
def test_zero_time_anchor_mutations_cannot_pass_normalization(attribute, value):
    encoded = encode_score(anchor_ir(), profile())
    root = etree.fromstring(encoded.xml)
    anchor = next(n for n in root.iter(M + 'note') if n.get(ID) == 'ev1b')
    anchor.set(attribute, value)
    with pytest.raises(ValueError, match='grace|anchor'):
        normalize_mei(etree.tostring(root), encoded.provenance)


def test_visible_zero_duration_note_is_not_treated_as_voice_line_anchor():
    ir = anchor_ir()
    events = tuple(replace(e, notehead='normal') if e.id == '1b' else e for e in ir.events)
    with pytest.raises(ValueError, match='zero|duration'):
        encode_score(replace(ir, events=events), profile())


@pytest.mark.parametrize('mutation', ['other-role', 'no-voice-line', 'incoming-tie', 'outgoing-tie'])
def test_zero_time_note_requires_an_untied_voice_line_endpoint(mutation):
    ir = anchor_ir()
    if mutation == 'other-role':
        ir = replace(ir, layers=tuple(replace(layer, role='accompaniment') if layer.id == 'line' else layer for layer in ir.layers))
    elif mutation == 'no-voice-line':
        ir = replace(ir, spans=())
    else:
        start, end = ('1a', '1b') if mutation == 'incoming-tie' else ('1b', '1c')
        ir = replace(ir, spans=(*ir.spans, Span('tie', 'tie', start, end)))
    with pytest.raises(ValueError, match='zero|duration'):
        encode_score(ir, profile())


def test_simultaneous_zero_time_anchors_do_not_form_a_sounding_chord():
    ir = anchor_ir()
    extra = replace(ir.events[2], id='1d', pitch=Pitch('f', Fraction(0), 4))
    ir = replace(ir, events=(*ir.events, extra), spans=(*ir.spans, Span('gl2', 'voice-line', '1a', '1d')))
    encoded = encode_score(ir, profile())
    assert validate_schema(encoded.xml, load_schema_bundle()) == []
    assert compare_scores(normalize_ir(ir), normalize_mei(encoded.xml, encoded.provenance)) == []
