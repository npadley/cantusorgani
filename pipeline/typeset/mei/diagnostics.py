from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Severity = Literal["error", "warning", "info"]
DiagnosticCode = Literal[
    # audit / extraction
    "SOURCE_CHECK_FAILED", "UNKNOWN_INCLUDE", "COMPILE_FAILED", "UNKNOWN_FEATURE",
    "LYRIC_UNANCHORED", "VOICE_ENDS_UNEQUAL",
    # encoding
    "UNSUPPORTED_FEATURE", "UNSAFE_BOUNDARY", "SCHEMA_INVALID",
    # validation (A4)
    "VOICE_MISSING", "VOICE_EXTRA", "PITCH_MISMATCH", "ONSET_MISMATCH", "DURATION_MISMATCH",
    "ATTACK_MISMATCH", "TIE_MISMATCH", "SLUR_MISMATCH", "DIVISION_MISMATCH", "ENTRY_MARKER_MISMATCH",
    "ACCIDENTAL_DISPLAY_MISMATCH", "NOTEHEAD_MISMATCH", "ENDING_MISSING", "LYRIC_TEXT_MISMATCH",
    "LYRIC_ANCHOR_MISMATCH", "FRAGMENT_OVERLAP", "FRAGMENT_GAP", "RENDER_EVENT_MISSING",
    # review / manifest / publish
    "STALE_APPROVAL", "MATRIX_INCOMPLETE", "NOT_APPROVED", "HASH_MISMATCH", "UNSAFE_PATH",
    "TARGET_HASH_MISMATCH", "UNMATCHED_TARGET", "ASSET_MISSING", "KEY_COLLISION",
    # evidence geometry (flag for review only, never blocking)
    "GEOMETRY_CLIPPING", "GEOMETRY_COLLISION",
]

@dataclass(frozen=True)
class SourceLocation:
    filename: str      # repo-relative POSIX, e.g. "data/typeset/include/noh2.ily"
    line: int          # 1-based
    column: int        # as LilyPond reports

@dataclass(frozen=True)
class Diagnostic:
    code: DiagnosticCode
    severity: Severity
    message: str
    source_location: SourceLocation | None = None
    event_ids: tuple[str, ...] = ()
    details: tuple[tuple[str, str], ...] = ()   # sorted (key, value) pairs; hashable

# Every error-severity code except GEOMETRY_* blocks approval.
BLOCKING: frozenset[str] = frozenset(
    code for code in [
        # audit / extraction
        "SOURCE_CHECK_FAILED", "UNKNOWN_INCLUDE", "COMPILE_FAILED", "UNKNOWN_FEATURE",
        "LYRIC_UNANCHORED", "VOICE_ENDS_UNEQUAL",
        # encoding
        "UNSUPPORTED_FEATURE", "UNSAFE_BOUNDARY", "SCHEMA_INVALID",
        # validation (A4)
        "VOICE_MISSING", "VOICE_EXTRA", "PITCH_MISMATCH", "ONSET_MISMATCH", "DURATION_MISMATCH",
        "ATTACK_MISMATCH", "TIE_MISMATCH", "SLUR_MISMATCH", "DIVISION_MISMATCH", "ENTRY_MARKER_MISMATCH",
        "ACCIDENTAL_DISPLAY_MISMATCH", "NOTEHEAD_MISMATCH", "ENDING_MISSING", "LYRIC_TEXT_MISMATCH",
        "LYRIC_ANCHOR_MISMATCH", "FRAGMENT_OVERLAP", "FRAGMENT_GAP", "RENDER_EVENT_MISSING",
        # review / manifest / publish
        "STALE_APPROVAL", "MATRIX_INCOMPLETE", "NOT_APPROVED", "HASH_MISMATCH", "UNSAFE_PATH",
        "TARGET_HASH_MISMATCH", "UNMATCHED_TARGET", "ASSET_MISSING", "KEY_COLLISION",
    ]
)
