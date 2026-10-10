"""Turn the ``listen_full`` TSV (contracts section 4) into exact staves, layers and events.

Everything here is pure parsing: it never runs LilyPond (card A2a adds ``run_listener``).
All arithmetic is on ``fractions.Fraction``; no binary floating point is used.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from fractions import Fraction
from typing import Literal, cast

from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.model import (
    Event,
    EventKind,
    LayerDef,
    LayerRole,
    NotatedDuration,
    Notehead,
    Pitch,
    PrintedAccidental,
    StaffDef,
    Step,
)

# Number of fields after the kind column, per row kind (contracts section 4).
FIELD_COUNTS: dict[str, int] = {
    "version": 2,
    "staff": 1,
    "voice": 2,
    "key": 2,
    "clef": 3,
    "note": 9,
    "rest": 2,
    "skip": 2,
    "head": 3,
    "rhead": 2,
    "stem": 2,
    "acc": 2,
    "col": 3,
    "tie": 1,
    "slur": 2,
    "gliss": 1,
    "div": 2,
    "break": 1,
    "lyric": 3,
    "hyphen": 1,
    "extender": 1,
}

_RATIONAL = re.compile(r"^-?\d+(/\d+)?$")
_INT = re.compile(r"^-?\d+$")
_STEPS = ("c", "d", "e", "f", "g", "a", "b")
_VOICE_COMMANDS = ("voiceOne", "voiceTwo", "voiceThree", "voiceFour", "none")
_ACCIDENTALS = {
    "natural": "natural",
    "sharp": "sharp",
    "flat": "flat",
    "double-sharp": "double-sharp",
    "double-flat": "double-flat",
}
_UNESCAPES = {"\\": "\\", "t": "\t", "n": "\n", "r": "\r"}


@dataclass(frozen=True)
class Row:
    onset: Fraction
    layer: str
    staff: str
    kind: str
    fields: tuple[str, ...]


def _unescape(text: str) -> str:
    if "\\" not in text:
        return text
    out: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text) and text[i + 1] in _UNESCAPES:
            out.append(_UNESCAPES[text[i + 1]])
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def _rational(text: str, context: str) -> Fraction:
    """Parse an exact rational ("3/8", "0", "-1"); anything else (decimals, "x@y") raises."""
    if not _RATIONAL.match(text):
        raise ValueError(f"{context}: not an exact rational: {text!r}")
    denominator = text.split("/")[1] if "/" in text else "1"
    if int(denominator) == 0:
        raise ValueError(f"{context}: zero denominator: {text!r}")
    return Fraction(text)


def _int(text: str, context: str) -> int:
    if not _INT.match(text):
        raise ValueError(f"{context}: not an integer: {text!r}")
    return int(text)


def parse_rows(tsv: str) -> list[Row]:
    """Parse and validate listener output. Raises ValueError naming the 1-based line."""
    lines = tsv.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    rows: list[Row] = []
    for number, line in enumerate(lines, start=1):
        where = f"line {number}"
        columns = line.split("\t")
        if len(columns) < 4:
            raise ValueError(f"{where}: expected at least 4 tab-separated columns, got {len(columns)}")
        onset_text, layer, staff, kind = columns[:4]
        if "@" in onset_text:
            raise ValueError(f"{where}: grace-note onset {onset_text!r} is not supported")
        onset = _rational(onset_text, f"{where} onset")
        if kind not in FIELD_COUNTS:
            raise ValueError(f"{where}: unknown row kind {kind!r}")
        fields = columns[4:]
        if len(fields) != FIELD_COUNTS[kind]:
            raise ValueError(
                f"{where}: {kind} row needs {FIELD_COUNTS[kind]} fields, got {len(fields)}"
            )
        rows.append(Row(onset, layer, staff, kind, tuple(_unescape(f) for f in fields)))
    if not rows or rows[0].kind != "version":
        raise ValueError("line 1: first row must be a version row")
    return rows


def extractor_version(rows: list[Row]) -> str:
    return rows[0].fields[0]


def lilypond_version(rows: list[Row]) -> str:
    return rows[0].fields[1]


# --- staves ---------------------------------------------------------------------------


def _clef(glyph: str, position: str) -> tuple[Literal["G", "F", "C"], int]:
    match = re.match(r"^clefs\.([GFC])", glyph)
    if not match:
        raise ValueError(f"unsupported clef glyph {glyph!r}")
    pos = _int(position, "clef position")
    # LilyPond staff-position 0 is the middle line (line 3); each line is 2 positions.
    return cast("Literal['G', 'F', 'C']", match.group(1)), (pos + 6) // 2


def build_staves(rows: list[Row]) -> tuple[StaffDef, ...]:
    first_clef: dict[str, tuple[Literal["G", "F", "C"], int]] = {}
    first_key: dict[str, int] = {}
    for row in rows:
        if row.kind == "clef" and row.staff not in first_clef:
            first_clef[row.staff] = _clef(row.fields[0], row.fields[1])
        elif row.kind == "key" and row.staff not in first_key:
            first_key[row.staff] = _int(row.fields[0], "key fifths")
    staves: list[StaffDef] = []
    for row in rows:
        if row.kind != "staff":
            continue
        if row.staff not in first_clef:
            raise ValueError(f"staff {row.staff!r} has no clef row")
        shape, line = first_clef[row.staff]
        staves.append(
            StaffDef(
                id=row.staff,
                index=_int(row.fields[0], "staff index"),
                clef_shape=shape,
                clef_line=line,
                key_fifths=first_key.get(row.staff, 0),
            )
        )
    return tuple(sorted(staves, key=lambda s: s.index))


# --- layers ---------------------------------------------------------------------------


def build_layers(rows: list[Row]) -> tuple[LayerDef, ...]:
    chant = {r.staff for r in rows if r.kind == "lyric" and r.staff != "-"}
    heads: dict[str, list[bool]] = defaultdict(list)
    for row in rows:
        if row.kind == "head":
            heads[row.layer].append(row.fields[0] == "1")
    layers: list[LayerDef] = []
    for row in rows:
        if row.kind != "voice":
            continue
        command = row.fields[1]
        if command not in _VOICE_COMMANDS:
            raise ValueError(f"voice {row.layer!r}: unknown voice command {command!r}")
        role: LayerRole
        if row.layer in chant:
            role = "chant"
        elif heads[row.layer] and all(heads[row.layer]):
            role = "voice-line"
        else:
            role = "accompaniment"
        layers.append(
            LayerDef(
                id=row.layer,
                home_staff_id=row.staff,
                ordinal=_int(row.fields[0], "voice ordinal"),
                voice_command=cast("Literal['voiceOne','voiceTwo','voiceThree','voiceFour','none']", command),
                role=role,
            )
        )
    return tuple(sorted(layers, key=lambda layer: layer.ordinal))


# --- events ---------------------------------------------------------------------------


def _location(text: str, context: str) -> SourceLocation:
    parts = text.rsplit(":", 2)
    if len(parts) != 3 or not _INT.match(parts[1]) or not _INT.match(parts[2]):
        raise ValueError(f"{context}: bad source location {text!r}")
    return SourceLocation(parts[0], int(parts[1]), int(parts[2]))


def notated_from_duration(dur: Fraction) -> NotatedDuration:
    """Notated value for a rest or skip, which the TSV gives only as a duration.

    A duration of 2**-log * (2 - 2**-dots) (log 0..8, dots 0..3) is represented exactly with
    scale 1. Any other duration (tuplets, breves, sums) keeps the smallest power-of-two base not
    below it (log clamped at 0, the whole note) with no dots, and ``scale = dur / base``, so a
    triplet quarter (1/6) is a quarter with scale 2/3 and a breve (2) is a whole with scale 2.
    """
    if dur <= 0:
        raise ValueError(f"non-positive duration {dur}")
    for log in range(9):
        base = Fraction(1, 2**log)
        for dots in range(4):
            if base * (2 - Fraction(1, 2**dots)) == dur:
                return NotatedDuration(log, dots, Fraction(1))
    log = 0
    while Fraction(1, 2 ** (log + 1)) >= dur:
        log += 1
    base = Fraction(1, 2**log)
    return NotatedDuration(log, 0, dur / base)


def _notehead(head: Row | None) -> Notehead:
    if head is None:
        return "normal"
    if head.fields[0] == "1":
        return "hidden"
    if head.fields[1] == "quilisma":
        return "quilisma"
    return "normal"


def _end(onset: Fraction, dur: Fraction) -> Fraction:
    return onset + dur


def build_events(
    rows: list[Row], source_path: str
) -> tuple[tuple[Event, ...], tuple[Diagnostic, ...]]:
    """Events from note/rest/skip rows, plus VOICE_ENDS_UNEQUAL when layers end apart.

    Acknowledger rows (head, rhead, stem, acc) are keyed by (onset, layer, loc), never adjacency.
    ``tie`` rows carry the column of the tie sign rather than the note, so they are keyed by
    (onset, layer). A stem is looked up by loc, then by (onset, layer) for the other notes of a
    chord; no stem row (skips) means not visible. ``source_path`` is accepted for symmetry with
    A2c, which reports repo-relative paths; locations come from the TSV itself.
    """
    layers = {layer.id: layer for layer in build_layers(rows)}
    by_loc: dict[tuple[str, Fraction, str, str], Row] = {}
    by_onset: dict[tuple[str, Fraction, str], Row] = {}
    acc_any_layer: dict[tuple[Fraction, str], Row] = {}
    ties: set[tuple[Fraction, str]] = set()
    for row in rows:
        if row.kind in ("head", "rhead", "stem", "acc"):
            loc = row.fields[-1]
            if row.layer == "-":
                acc_any_layer[(row.onset, loc)] = row
            else:
                by_loc[(row.kind, row.onset, row.layer, loc)] = row
                by_onset.setdefault((row.kind, row.onset, row.layer), row)
        elif row.kind == "tie":
            ties.add((row.onset, row.layer))

    staff_ids = {r.staff for r in rows if r.kind == "staff"}
    staged: list[tuple[Fraction, int, int, Event]] = []
    per_layer: dict[str, list[Row]] = defaultdict(list)
    for row in rows:
        if row.kind in ("note", "rest", "skip"):
            if row.layer not in layers:
                raise ValueError(f"{row.kind} row for unknown layer {row.layer!r}")
            if row.staff not in staff_ids:
                raise ValueError(f"{row.kind} row on unknown staff {row.staff!r}")
            per_layer[row.layer].append(row)

    ends: dict[str, tuple[Fraction, str]] = {}
    for layer_id, layer_rows in per_layer.items():
        layer = layers[layer_id]
        for seq, row in enumerate(sorted(layer_rows, key=lambda r: r.onset)):
            kind = cast(EventKind, row.kind)
            loc_text = row.fields[-1]
            location = _location(loc_text, f"{row.kind} at {row.onset}")
            pitch: Pitch | None = None
            if kind == "note":
                step, alter, octave, log, dots, sn, sd, dur_text = row.fields[:8]
                if step not in _STEPS:
                    raise ValueError(f"note at {row.onset}: bad step {step!r}")
                dur = _rational(dur_text, "note dur")
                pitch = Pitch(
                    cast(Step, step), _rational(alter, "note alter"), _int(octave, "note octave")
                )
                scale = _rational(f"{_int(sn, 'scale_num')}/{_int(sd, 'scale_den')}", "note scale")
                notated = NotatedDuration(_int(log, "log"), _int(dots, "dots"), scale)
            else:
                dur = _rational(row.fields[0], f"{row.kind} dur")
                notated = notated_from_duration(dur)
            key = (row.onset, layer_id, loc_text)
            head = by_loc.get(("head", *key))
            stem: Row | None = None
            if kind != "skip":
                stem = by_loc.get(("stem", *key)) or by_onset.get(("stem", row.onset, layer_id))
            acc = by_loc.get(("acc", *key)) or acc_any_layer.get((row.onset, loc_text))
            accidental = "none"
            if acc is not None:
                accidental = _ACCIDENTALS.get(acc.fields[0], "none")
            event = Event(
                id=f"{layer.ordinal}e{seq:04d}",
                layer_id=layer_id,
                staff_id=row.staff,
                kind=kind,
                onset=row.onset,
                duration=dur,
                notated=notated,
                pitch=pitch,
                printed_accidental=cast(PrintedAccidental, accidental),
                notehead=_notehead(head) if kind == "note" else "normal",
                stem_visible=stem is not None and stem.fields[0] == "0",
                tie_to_next=kind == "note" and (row.onset, layer_id) in ties,
                location=location,
            )
            staged.append((row.onset, layer.ordinal, seq, event))
            end = _end(row.onset, dur)
            if layer_id not in ends or end >= ends[layer_id][0]:
                ends[layer_id] = (end, event.id)

    staged.sort(key=lambda item: item[:3])
    events = tuple(item[3] for item in staged)

    diagnostics: list[Diagnostic] = []
    if len({end for end, _ in ends.values()}) > 1:
        ordered = sorted(ends.items(), key=lambda kv: layers[kv[0]].ordinal)
        diagnostics.append(
            Diagnostic(
                code="VOICE_ENDS_UNEQUAL",
                severity="warning",
                message=f"layers of {source_path} end at different onsets",
                event_ids=tuple(event_id for _, (_, event_id) in ordered),
                details=tuple(sorted((layer_id, f"{end.numerator}/{end.denominator}") for layer_id, (end, _) in ordered)),
            )
        )
    return events, tuple(diagnostics)


def total_duration(events: tuple[Event, ...]) -> Fraction:
    """Maximum over events of onset + duration (zero for no events)."""
    return max((e.onset + e.duration for e in events), default=Fraction(0))
