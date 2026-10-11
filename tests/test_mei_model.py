"""Tests for pipeline.typeset.mei.model and pipeline.typeset.mei.diagnostics."""
import json
from fractions import Fraction
from typing import get_args

import pytest

from pipeline.typeset.mei.diagnostics import (
    BLOCKING,
    Diagnostic,
    DiagnosticCode,
    SourceLocation,
)
from pipeline.typeset.mei.model import (
    PILOT_FIXTURES,
    Boundary,
    Division,
    EntryMarker,
    Event,
    LayerDef,
    LyricSyllable,
    NotatedDuration,
    Pitch,
    ScoreIR,
    Span,
    StaffDef,
    rational_from_str,
    rational_to_str,
)


class TestRationalConversion:
    """Test rational_to_str and rational_from_str."""

    def test_rational_to_str_reduces(self):
        """Fraction(14,16) reduces to "7/8"."""
        assert rational_to_str(Fraction(14, 16)) == "7/8"

    def test_rational_to_str_zero(self):
        """Fraction(0) converts to "0/1"."""
        assert rational_to_str(Fraction(0)) == "0/1"

    def test_rational_to_str_whole(self):
        """Fraction(3) converts to "3/1"."""
        assert rational_to_str(Fraction(3)) == "3/1"

    def test_rational_to_str_negative(self):
        """Negative fractions work: Fraction(-3, 2) -> "-3/2"."""
        assert rational_to_str(Fraction(-3, 2)) == "-3/2"

    def test_rational_from_str_valid(self):
        """rational_from_str accepts valid reduced rationals."""
        assert rational_from_str("7/8") == Fraction(7, 8)
        assert rational_from_str("0/1") == Fraction(0)
        assert rational_from_str("3/1") == Fraction(3)
        assert rational_from_str("-3/2") == Fraction(-3, 2)

    def test_rational_from_str_rejects_decimal(self):
        """rational_from_str raises ValueError for "0.5"."""
        with pytest.raises(ValueError):
            rational_from_str("0.5")

    def test_rational_from_str_rejects_float_format(self):
        """rational_from_str raises ValueError for "7/8.0"."""
        with pytest.raises(ValueError):
            rational_from_str("7/8.0")

    def test_rational_from_str_rejects_unreduced(self):
        """rational_from_str raises ValueError for "14/16" (not reduced)."""
        with pytest.raises(ValueError):
            rational_from_str("14/16")

    def test_rational_from_str_rejects_zero_denominator(self):
        """rational_from_str raises ValueError for "1/0"."""
        with pytest.raises(ValueError):
            rational_from_str("1/0")

    def test_rational_from_str_rejects_zero_with_wrong_denominator(self):
        """rational_from_str raises ValueError for "0/2" (not canonical zero form)."""
        with pytest.raises(ValueError):
            rational_from_str("0/2")


class TestScoreIRRoundTrip:
    """Test ScoreIR.to_dict() and ScoreIR.from_dict()."""

    def test_score_ir_round_trip(self):
        """A hand-built ScoreIR round-trips through to_dict and from_dict."""
        # Build a minimal but complete ScoreIR
        loc = SourceLocation(filename="test.ly", line=1, column=1)

        ir = ScoreIR(
            schema_version=1,
            source_path="test/file.ly",
            dependency_digest="abc123",
            lilypond_version="2.24.0",
            extractor_version="1.0.0",
            total_duration=Fraction(4, 1),
            staves=(
                StaffDef(
                    id="up",
                    index=1,
                    clef_shape="G",
                    clef_line=2,
                    key_fifths=0,
                ),
            ),
            layers=(
                LayerDef(
                    id="up:chant",
                    home_staff_id="up",
                    ordinal=0,
                    voice_command="none",
                    role="chant",
                ),
                LayerDef(
                    id="up:#1",
                    home_staff_id="up",
                    ordinal=1,
                    voice_command="voiceOne",
                    role="accompaniment",
                ),
            ),
            events=(
                Event(
                    id="0e0000",
                    layer_id="up:chant",
                    staff_id="up",
                    kind="note",
                    onset=Fraction(0),
                    duration=Fraction(1),
                    notated=NotatedDuration(log=2, dots=0, scale=Fraction(1)),
                    pitch=Pitch(step="g", alter=Fraction(0), octave=4),
                    printed_accidental="none",
                    notehead="normal",
                    stem_visible=True,
                    tie_to_next=False,
                    location=loc,
                ),
                Event(
                    id="1e0001",
                    layer_id="up:#1",
                    staff_id="up",
                    kind="skip",
                    onset=Fraction(0),
                    duration=Fraction(1),
                    notated=NotatedDuration(log=2, dots=0, scale=Fraction(1)),
                    pitch=None,
                    printed_accidental="none",
                    notehead="normal",
                    stem_visible=False,
                    tie_to_next=False,
                    location=loc,
                ),
                Event(
                    id="1e0002",
                    layer_id="up:#1",
                    staff_id="up",
                    kind="rest",
                    onset=Fraction(1),
                    duration=Fraction(3),
                    notated=NotatedDuration(log=0, dots=0, scale=Fraction(1)),
                    pitch=None,
                    printed_accidental="none",
                    notehead="normal",
                    stem_visible=False,
                    tie_to_next=False,
                    location=loc,
                ),
            ),
            spans=(
                Span(
                    id="s001",
                    kind="tie",
                    start_event_id="0e0000",
                    end_event_id="0e0001",
                ),
            ),
            lyrics=(
                LyricSyllable(
                    id="ly001",
                    text="Do",
                    onset=Fraction(0),
                    anchor_event_id="0e0000",
                    hyphen_after=False,
                    extender_after=False,
                    lyrics_context="Verse",
                    location=loc,
                ),
            ),
            entry_markers=(
                EntryMarker(
                    id="em001",
                    text="*",
                    syllable_id="ly001",
                    location=loc,
                ),
            ),
            divisions=(
                Division(
                    id="d001",
                    kind="finalis",
                    onset=Fraction(4),
                    layer_id="up:chant",
                    location=loc,
                ),
            ),
            boundaries=(
                Boundary(
                    id="b001",
                    onset=Fraction(4),
                    source_break=True,
                    division="finalis",
                    after_text="Do",
                    safe=True,
                    reason=None,
                ),
            ),
            features=(),
            diagnostics=(
                Diagnostic(
                    code="UNSUPPORTED_FEATURE",
                    severity="warning",
                    message="Some feature is unsupported",
                    source_location=loc,
                    event_ids=("0e0000",),
                    details=(("key", "value"),),
                ),
            ),
        )

        # Round-trip
        ir_dict = ir.to_dict()
        ir2 = ScoreIR.from_dict(ir_dict)

        assert ir2 == ir

    def test_score_ir_to_dict_no_floats(self):
        """json.dumps(ir.to_dict()) contains no float instances."""
        ir = ScoreIR(
            schema_version=1,
            source_path="test.ly",
            dependency_digest="abc",
            lilypond_version="2.24.0",
            extractor_version="1.0.0",
            total_duration=Fraction(1),
            staves=(StaffDef(id="s1", index=1, clef_shape="G", clef_line=2, key_fifths=0),),
            layers=(LayerDef(id="l1", home_staff_id="s1", ordinal=0, voice_command="none", role="chant"),),
            events=(),
            spans=(),
            lyrics=(),
            entry_markers=(),
            divisions=(),
            boundaries=(),
            features=(),
            diagnostics=(),
        )

        ir_dict = ir.to_dict()

        # Walk the dict and check for floats
        def has_floats(obj):
            if isinstance(obj, float):
                return True
            if isinstance(obj, dict):
                return any(has_floats(v) for v in obj.values())
            if isinstance(obj, (list, tuple)):
                return any(has_floats(v) for v in obj)
            return False

        assert not has_floats(ir_dict), "ir.to_dict() should contain no float instances"

        # Verify it's JSON-serializable and produces the same result twice
        json_str1 = json.dumps(ir_dict, sort_keys=True)
        json_str2 = json.dumps(ir_dict, sort_keys=True)
        assert json_str1 == json_str2

    def test_score_ir_camelcase_keys(self):
        """to_dict() uses camelCase keys."""
        ir = ScoreIR(
            schema_version=1,
            source_path="test.ly",
            dependency_digest="abc",
            lilypond_version="2.24.0",
            extractor_version="1.0.0",
            total_duration=Fraction(1),
            staves=(StaffDef(id="s1", index=1, clef_shape="G", clef_line=2, key_fifths=0),),
            layers=(LayerDef(id="l1", home_staff_id="s1", ordinal=0, voice_command="none", role="chant"),),
            events=(),
            spans=(),
            lyrics=(),
            entry_markers=(),
            divisions=(),
            boundaries=(),
            features=(),
            diagnostics=(),
        )

        ir_dict = ir.to_dict()

        # Check for camelCase keys
        assert "schemaVersion" in ir_dict
        assert "sourcePath" in ir_dict
        assert "dependencyDigest" in ir_dict
        assert "lilypondVersion" in ir_dict
        assert "extractorVersion" in ir_dict
        assert "totalDuration" in ir_dict
        assert "schema_version" not in ir_dict
        assert "source_path" not in ir_dict


class TestBLOCKING:
    """Test the BLOCKING frozenset."""

    def test_blocking_contains_all_error_codes_except_geometry(self):
        """BLOCKING equals all DiagnosticCode values except GEOMETRY_CLIPPING and GEOMETRY_COLLISION."""
        all_codes = set(get_args(DiagnosticCode))
        expected = all_codes - {"GEOMETRY_CLIPPING", "GEOMETRY_COLLISION"}

        assert BLOCKING == frozenset(expected), (
            f"BLOCKING should equal all DiagnosticCode values except GEOMETRY_* "
            f"but got {BLOCKING} vs expected {frozenset(expected)}"
        )


class TestPilotFixtures:
    """Test PILOT_FIXTURES."""

    def test_pilot_fixtures_has_exactly_five_paths(self):
        """PILOT_FIXTURES contains exactly five fixture paths."""
        assert len(PILOT_FIXTURES) == 5
        assert all(isinstance(p, str) for p in PILOT_FIXTURES)
