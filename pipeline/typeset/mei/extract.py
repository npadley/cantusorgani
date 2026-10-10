"""Turn the ``listen_full`` TSV (contracts section 4) into exact staves, layers and events.

Everything here is pure parsing: it never runs LilyPond (card A2a adds ``run_listener``).
All arithmetic is on ``fractions.Fraction``; no binary floating point is used.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from fractions import Fraction
from itertools import pairwise
from typing import Literal, cast

from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.model import (
    FEATURE_FAMILIES,
    IR_SCHEMA_VERSION,
    Boundary,
    BoundaryReason,
    Division,
    DivisionKind,
    EntryMarker,
    Event,
    EventKind,
    FeatureUse,
    LayerDef,
    LayerRole,
    LyricSyllable,
    NotatedDuration,
    Notehead,
    Pitch,
    PrintedAccidental,
    ScoreIR,
    Span,
    SpanKind,
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


# --- lyrics, spans, divisions, features (card A2c) ---------------------------------


def _loc_or_blank(text: str, context: str) -> SourceLocation:
    """Like ``_location`` but a "-" (no causing event) becomes SourceLocation("-", 0, 0)."""
    if text == "-":
        return SourceLocation("-", 0, 0)
    return _location(text, context)


def build_lyrics(
    rows: list[Row], layers: tuple[LayerDef, ...], events: tuple[Event, ...]
) -> tuple[tuple[LyricSyllable, ...], tuple[EntryMarker, ...], tuple[Diagnostic, ...]]:
    """Syllables, entry markers and LYRIC_UNANCHORED errors.

    The anchor is the first note attack in the lyric's associated layer (the ``staff`` column of
    the lyric row) whose onset equals the lyric's onset. Events of other layers are never used.
    """
    layer_ids = {layer.id for layer in layers}
    attacks: dict[tuple[str, Fraction], Event] = {}
    for event in events:
        if event.kind == "note":
            attacks.setdefault((event.layer_id, event.onset), event)
    hyphens = {(r.layer, r.onset) for r in rows if r.kind == "hyphen"}
    extenders = {(r.layer, r.onset) for r in rows if r.kind == "extender"}

    syllables: list[LyricSyllable] = []
    markers: list[EntryMarker] = []
    diagnostics: list[Diagnostic] = []
    lyric_rows = [r for r in rows if r.kind == "lyric"]
    for index, row in enumerate(sorted(lyric_rows, key=lambda r: r.onset)):
        text, stanza, loc_text = row.fields
        location = _loc_or_blank(loc_text, f"lyric at {row.onset}")
        anchor = attacks.get((row.staff, row.onset)) if row.staff in layer_ids else None
        syllable_id = f"l{index:04d}"
        if anchor is None:
            diagnostics.append(
                Diagnostic(
                    code="LYRIC_UNANCHORED",
                    severity="error",
                    message=f"lyric {text!r} at {row.onset} has no note attack in layer {row.staff!r}",
                    source_location=location,
                )
            )
        syllables.append(
            LyricSyllable(
                id=syllable_id,
                text=text,
                onset=row.onset,
                anchor_event_id=anchor.id if anchor else None,
                hyphen_after=(row.layer, row.onset) in hyphens,
                extender_after=(row.layer, row.onset) in extenders,
                lyrics_context=row.layer,
                location=location,
            )
        )
        if stanza != "-":
            markers.append(
                EntryMarker(
                    id=f"m{len(markers):03d}", text=stanza, syllable_id=syllable_id, location=location
                )
            )
    return tuple(syllables), tuple(markers), tuple(diagnostics)


def build_spans(
    rows: list[Row], events: tuple[Event, ...]
) -> tuple[tuple[Span, ...], tuple[Diagnostic, ...]]:
    """Tie, slur and voice-line spans plus diagnostics (this returns a pair, unlike a bare tuple).

    - slur: start/stop rows paired per layer in order (stops before starts at one onset); the
      endpoints are the layer's first note attack at each row's onset. Unbalanced or unattached
      slurs give an UNKNOWN_FEATURE error.
    - tie: each ``tie_to_next`` note spans to the next later event of its layer with the same
      pitch (repeated attacks without a tie row never form a span); a missing target is an
      UNKNOWN_FEATURE warning.
    - voice-line: a ``gliss`` row in a voice-line-role layer spans from that layer's note at the
      onset to the layer's next note; a gliss in any other layer is an UNKNOWN_FEATURE warning.
    """
    roles = {layer.id: layer.role for layer in build_layers(rows)}
    per_layer: dict[str, list[Event]] = defaultdict(list)
    for event in events:
        per_layer[event.layer_id].append(event)
    spans: list[Span] = []
    diagnostics: list[Diagnostic] = []

    def add(kind: SpanKind, start: Event, end: Event) -> None:
        spans.append(Span(f"sp{len(spans):04d}", kind, start.id, end.id))

    def note_at(layer_id: str, onset: Fraction) -> Event | None:
        return next(
            (e for e in per_layer[layer_id] if e.kind == "note" and e.onset == onset), None
        )

    slurs: dict[str, list[Row]] = defaultdict(list)
    for row in rows:
        if row.kind == "slur":
            slurs[row.layer].append(row)
    for layer_id, layer_rows in slurs.items():
        ordered = sorted(layer_rows, key=lambda r: (r.onset, r.fields[0] == "-1"))
        open_start: Event | None = None
        for row in ordered:
            where = _loc_or_blank(row.fields[1], "slur")
            event = note_at(layer_id, row.onset)
            if event is None:
                diagnostics.append(Diagnostic("UNKNOWN_FEATURE", "error", f"slur at {row.onset} in {layer_id} has no note", where))
            elif row.fields[0] == "-1":
                if open_start is not None:
                    diagnostics.append(Diagnostic("UNKNOWN_FEATURE", "error", f"nested slur start at {row.onset} in {layer_id}", where))
                open_start = event
            elif open_start is None:
                diagnostics.append(Diagnostic("UNKNOWN_FEATURE", "error", f"slur stop without start at {row.onset} in {layer_id}", where))
            else:
                add("slur", open_start, event)
                open_start = None
        if open_start is not None:
            diagnostics.append(Diagnostic("UNKNOWN_FEATURE", "error", f"slur starting at {open_start.onset} in {layer_id} never stops", None, (open_start.id,)))

    for layer_id, layer_events in per_layer.items():
        for i, event in enumerate(layer_events):
            if event.kind != "note" or not event.tie_to_next:
                continue
            target = next(
                (e for e in layer_events[i + 1 :] if e.kind == "note" and e.onset >= event.onset + event.duration),
                None,
            )
            if target is not None and target.pitch == event.pitch:
                add("tie", event, target)
            else:
                diagnostics.append(Diagnostic("UNKNOWN_FEATURE", "warning", f"tie at {event.onset} in {layer_id} has no same-pitch target", event.location, (event.id,)))

    for row in rows:
        if row.kind != "gliss":
            continue
        where = _loc_or_blank(row.fields[0], "gliss")
        if roles.get(row.layer) != "voice-line":
            diagnostics.append(Diagnostic("UNKNOWN_FEATURE", "warning", f"ordinary glissando at {row.onset} in {row.layer}", where))
            continue
        start = note_at(row.layer, row.onset)
        later = [e for e in per_layer[row.layer] if e.kind == "note" and e.onset > row.onset]
        if start is None or not later:
            diagnostics.append(Diagnostic("UNKNOWN_FEATURE", "error", f"voice-line glissando at {row.onset} in {row.layer} lacks a start or end note", where))
        else:
            add("voice-line", start, later[0])
    return tuple(spans), tuple(diagnostics)


_DIVISIONS = ("finalis", "maxima", "maior", "minima")


def build_divisions(rows: list[Row], layers: tuple[LayerDef, ...]) -> tuple[Division, ...]:
    """Divisions from ``div`` rows (kind ``other`` is skipped; see ``division_diagnostics``)."""
    known = {layer.id for layer in layers}
    result: list[Division] = []
    for row in rows:
        if row.kind != "div" or row.fields[0] not in _DIVISIONS:
            continue
        if row.layer not in known:
            raise ValueError(f"div row for unknown layer {row.layer!r}")
        result.append(
            Division(
                id=f"d{len(result):03d}",
                kind=cast(DivisionKind, row.fields[0]),
                onset=row.onset,
                layer_id=row.layer,
                location=_loc_or_blank(row.fields[1], "div"),
            )
        )
    return tuple(result)


def division_diagnostics(rows: list[Row]) -> tuple[Diagnostic, ...]:
    return tuple(
        Diagnostic(
            "UNKNOWN_FEATURE",
            "error",
            f"unrecognised division at {row.onset} in {row.layer}",
            _loc_or_blank(row.fields[1], "div"),
        )
        for row in rows
        if row.kind == "div" and row.fields[0] not in _DIVISIONS
    )


def feature_uses(
    rows: list[Row],
    events: tuple[Event, ...],
    spans: tuple[Span, ...],
    layers: tuple[LayerDef, ...] | None = None,
    lyrics: tuple[LyricSyllable, ...] | None = None,
    entry_markers: tuple[EntryMarker, ...] | None = None,
    divisions: tuple[Division, ...] | None = None,
) -> tuple[FeatureUse, ...]:
    """One FeatureUse per occurrence, in a stable order (family order, then source order).

    Melisma is reported per ``extender`` row only. Hidden stems are reported for every note or
    rest whose stem is not visible (noh2 hides all of them). Key and clef changes are changes of
    value after a staff's first state.
    """
    layers = build_layers(rows) if layers is None else layers
    if lyrics is None or entry_markers is None:
        built_lyrics, built_markers, _ = build_lyrics(rows, layers, events)
        lyrics = built_lyrics if lyrics is None else lyrics
        entry_markers = built_markers if entry_markers is None else entry_markers
    divisions = build_divisions(rows, layers) if divisions is None else divisions

    home = {layer.id: layer.home_staff_id for layer in layers}
    by_key = {(e.onset, e.layer_id, f"{e.location.filename}:{e.location.line}:{e.location.column}"): e for e in events}
    by_id = {e.id: e for e in events}
    found: dict[str, list[FeatureUse]] = {family: [] for family in FEATURE_FAMILIES}

    def use(family: str, location: SourceLocation, *ids: str) -> None:
        found[family].append(FeatureUse(family, location, tuple(ids)))

    for e in events:
        if e.notated.scale != 1 and e.kind == "note":
            use("scaled-duration", e.location, e.id)
        if e.kind != "skip" and not e.stem_visible:
            use("hidden-stem", e.location, e.id)
        if e.kind == "skip":
            use("skip", e.location, e.id)
        if e.staff_id != home[e.layer_id]:
            use("cross-staff", e.location, e.id)
        if e.notehead == "quilisma":
            use("quilisma", e.location, e.id)
    for span in spans:
        start = by_id[span.start_event_id]
        if span.kind == "tie":
            use("tie", start.location, span.start_event_id, span.end_event_id)
        elif span.kind == "slur":
            use("slur", start.location, span.start_event_id, span.end_event_id)
        elif span.kind == "voice-line":
            use("voice-line-glissando", start.location, span.start_event_id, span.end_event_id)
    for layer in layers:
        if layer.role == "voice-line":
            ids = tuple(e.id for e in events if e.layer_id == layer.id)
            first = next((e.location for e in events if e.layer_id == layer.id), SourceLocation("-", 0, 0))
            use("voice-line-voice", first, *ids)
    for row in rows:
        if row.kind == "rhead" and row.fields[0] == "1":
            loc = _loc_or_blank(row.fields[1], "rhead")
            hit = by_key.get((row.onset, row.layer, row.fields[1]))
            use("hidden-rest", loc, *([hit.id] if hit else []))
        elif row.kind == "break":
            use("force-break", _loc_or_blank(row.fields[0], "break"))
        elif row.kind == "col":
            shift, extent, loc_text = row.fields
            loc = _loc_or_blank(loc_text, "col")
            hit = by_key.get((row.onset, row.layer, loc_text))
            ids = [hit.id] if hit else []
            if shift not in ("-", "0"):
                use("note-shift", loc, *ids)
            if extent != "-":
                use("manual-spacing", loc, *ids)
    for division in divisions:
        family = "finalis" if division.kind == "finalis" else f"divisio-{division.kind}"
        use(family, division.location)
    syllable_by_id = {s.id: s for s in lyrics}
    for marker in entry_markers:
        use("stanza-marker", marker.location, *([syllable_by_id[marker.syllable_id].anchor_event_id] if syllable_by_id[marker.syllable_id].anchor_event_id else []))
    for s in lyrics:
        anchor = [s.anchor_event_id] if s.anchor_event_id else []
        if s.text == "":
            use("blank-lyric", s.location, *anchor)
        if s.extender_after:
            use("melisma", s.location, *anchor)
    for kind, family, width in (("key", "key-change", 1), ("clef", "clef-change", 2)):
        previous: dict[str, tuple[str, ...]] = {}
        seen: set[tuple[str, Fraction]] = set()
        for row in rows:
            if row.kind != kind or (row.staff, row.onset) in seen:
                continue
            seen.add((row.staff, row.onset))
            state = row.fields[:width]
            if row.staff in previous and previous[row.staff] != state:
                use(family, _loc_or_blank(row.fields[width], kind))
            previous[row.staff] = state
    return tuple(u for family in FEATURE_FAMILIES for u in found[family])


# --- boundaries (card A2d) -----------------------------------------------------------

_DIVISION_PRIORITY = ("finalis", "maxima", "maior", "minima")


def _after_text(syllables: list[LyricSyllable], onset: Fraction) -> str | None:
    """Last word ending before ``onset`` in the primary (first) lyrics context.

    Take the last non-blank syllable starting before ``onset``, extend backwards while the previous
    syllable has ``hyphen_after``, and join the non-blank texts as printed.
    """
    before = [s for s in syllables if s.onset < onset]
    while before and before[-1].text == "":
        before.pop()
    if not before:
        return None
    first = len(before) - 1
    while first > 0 and before[first - 1].hyphen_after:
        first -= 1
    return "".join(s.text for s in before[first:])


def build_boundaries(
    rows: list[Row],
    layers: tuple[LayerDef, ...],
    events: tuple[Event, ...],
    spans: tuple[Span, ...],
    lyrics: tuple[LyricSyllable, ...],
    divisions: tuple[Division, ...],
) -> tuple[Boundary, ...]:
    """Candidate break points with safety and the preceding printed word.

    Candidates are the note attack onsets of chant-role layers, plus every ``break`` and division
    onset, for 0 < t < total duration. The first failing reason wins:
    not-common-onset (no chant layer attacks at t; only possible for break/division rows),
    sustain-not-splittable (a chant event spans t), slur-crosses, voice-line-crosses,
    lyric-extender-crosses. Accompaniment and voice-line events (notes, rests, skips) that span t
    are splittable (spec 6.3): they do not make t unsafe, and ``splits_at`` lists them for A3d,
    which ties or divides them. A tie crossing t is never a reason.
    """
    total = total_duration(events)
    chant_layers = {layer.id for layer in layers if layer.role == "chant"}
    chant_events = [e for e in events if e.layer_id in chant_layers]
    break_onsets = {r.onset for r in rows if r.kind == "break"}
    division_at: dict[Fraction, str] = {}
    for d in divisions:
        current = division_at.get(d.onset)
        if current is None or _DIVISION_PRIORITY.index(d.kind) < _DIVISION_PRIORITY.index(current):
            division_at[d.onset] = d.kind

    chant_attacks = {e.onset for e in chant_events if e.kind == "note"}
    candidates = chant_attacks | break_onsets | set(division_at)
    candidates = {t for t in candidates if 0 < t < total}

    by_id = {e.id: e for e in events}
    crossing = {
        kind: [(by_id[s.start_event_id].onset, by_id[s.end_event_id].onset) for s in spans if s.kind == kind]
        for kind in ("slur", "voice-line")
    }
    attack_layer = {e.id: e.layer_id for e in events}
    ordered = sorted(lyrics, key=lambda s: s.onset)
    primary = [s for s in ordered if s.anchor_event_id and attack_layer[s.anchor_event_id] in chant_layers]
    if primary:
        primary = [s for s in primary if s.lyrics_context == primary[0].lyrics_context]
    by_context: dict[str, list[LyricSyllable]] = defaultdict(list)
    for syllable in ordered:
        by_context[syllable.lyrics_context].append(syllable)
    extenders = [
        (s.onset, nxt.onset)
        for context in by_context.values()
        for s, nxt in pairwise(context)
        if s.extender_after
    ]

    boundaries: list[Boundary] = []
    for index, t in enumerate(sorted(candidates)):
        reason: BoundaryReason | None = None
        if t not in chant_attacks:
            reason = "not-common-onset"
        elif any(e.onset < t < e.onset + e.duration for e in chant_events):
            reason = "sustain-not-splittable"
        elif any(start < t <= end for start, end in crossing["slur"]):
            reason = "slur-crosses"
        elif any(start < t <= end for start, end in crossing["voice-line"]):
            reason = "voice-line-crosses"
        elif any(start < t < nxt for start, nxt in extenders):
            reason = "lyric-extender-crosses"
        boundaries.append(
            Boundary(
                id=f"b{index:03d}",
                onset=t,
                source_break=t in break_onsets,
                division=cast("DivisionKind | None", division_at.get(t)),
                after_text=_after_text(primary, t),
                safe=reason is None,
                reason=reason,
            )
        )
    return tuple(boundaries)


def splits_at(boundary: Boundary, events: tuple[Event, ...]) -> tuple[str, ...]:
    """Ids of events that start before the boundary and end after it, in event order.

    For a safe boundary these are all accompaniment or voice-line events, which A3d must split.
    """
    t = boundary.onset
    return tuple(e.id for e in events if e.onset < t < e.onset + e.duration)


def ir_from_rows(rows: list[Row], source_path: str, dependency_digest: str) -> ScoreIR:
    """Assemble the whole ScoreIR from parsed listener rows. Pure: no LilyPond, no I/O."""
    staves = build_staves(rows)
    layers = build_layers(rows)
    events, event_diagnostics = build_events(rows, source_path)
    lyrics, markers, lyric_diagnostics = build_lyrics(rows, layers, events)
    spans, span_diagnostics = build_spans(rows, events)
    divisions = build_divisions(rows, layers)
    boundaries = build_boundaries(rows, layers, events, spans, lyrics, divisions)
    features = feature_uses(rows, events, spans, layers, lyrics, markers, divisions)
    return ScoreIR(
        schema_version=IR_SCHEMA_VERSION,
        source_path=source_path,
        dependency_digest=dependency_digest,
        lilypond_version=lilypond_version(rows),
        extractor_version=extractor_version(rows),
        total_duration=total_duration(events),
        staves=staves,
        layers=layers,
        events=events,
        spans=spans,
        lyrics=lyrics,
        entry_markers=markers,
        divisions=divisions,
        boundaries=boundaries,
        features=features,
        diagnostics=(
            *event_diagnostics,
            *lyric_diagnostics,
            *span_diagnostics,
            *division_diagnostics(rows),
        ),
    )
