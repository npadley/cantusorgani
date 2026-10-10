"""Deterministic MEI 5.0 encoder (card A3c).

``encode_score(ir, profile)`` turns a ``ScoreIR`` into unmetered MEI: one ``<measure>`` per span
between consecutive IR boundary onsets (safe or not), invisible barlines except at chant
divisions, one ``<layer>`` per IR layer, and hidden tuplets for scaled durations.

Events that cross a measure boundary are emitted whole in the measure where they start, with a
``sustain-split-pending`` diagnostic; card A3d replaces that with real tie splitting.

IR event ids such as ``0e0000`` begin with a digit and so are not XML NCNames. The MEI id of an
event is therefore ``mei_id(event.id)``; ``EncodedScore.provenance`` maps it back.

The XML is written by a small serializer (sorted attributes, two-space indent) so the bytes depend
only on the IR and the profile.
"""

from __future__ import annotations

import hashlib
import re
from bisect import bisect_right
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import PurePosixPath

from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.model import (
    BoundaryManifestEntry,
    ConversionProfile,
    EncodedScore,
    Event,
    FeatureDecision,
    LayerDef,
    LyricSyllable,
    PrintedAccidental,
    ScoreIR,
    rational_to_str,
)

MEI_NS = "http://www.music-encoding.org/ns/mei"
EVENT_ID_PREFIX = "ev"
SENTINEL_SPLIT_PENDING = "sustain-split-pending"

_NCNAME_START = re.compile(r"^[A-Za-z_]")
_CAESURA_GLYPHS = {"minima": "U+E8F3", "maior": "U+E8F4"}
_RIGHT_BARLINE = {"finalis": "dbl", "maxima": "single"}
_SHARP_ORDER = "fcgdaeb"
_FLAT_ORDER = "beadgcf"
_WRITTEN = {"sharp": "s", "flat": "f", "natural": "n", "double-sharp": "x", "double-flat": "ff"}
_GESTURAL = {-2: "ff", -1: "f", 0: "n", 1: "s", 2: "ss"}


# --- tiny XML tree and serializer ----------------------------------------------------------------


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[_Node] = field(default_factory=list)
    text: str | None = None

    def add(self, tag: str, text: str | None = None, **attrs: str) -> _Node:
        child = _Node(tag, dict(attrs), [], text)
        self.children.append(child)
        return child


def _escape_text(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _escape_attr(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace('"', "&quot;")
        .replace("\n", "&#10;")
        .replace("\r", "&#13;")
        .replace("\t", "&#9;")
    )


def _serialize(root: _Node) -> bytes:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>']

    def write(node: _Node, depth: int) -> None:
        pad = "  " * depth
        attrs = "".join(f' {k}="{_escape_attr(v)}"' for k, v in sorted(node.attrs.items()))
        if node.text is not None and not node.children:
            lines.append(f"{pad}<{node.tag}{attrs}>{_escape_text(node.text)}</{node.tag}>")
        elif not node.children:
            lines.append(f"{pad}<{node.tag}{attrs}/>")
        else:
            lines.append(f"{pad}<{node.tag}{attrs}>")
            for child in node.children:
                write(child, depth + 1)
            lines.append(f"{pad}</{node.tag}>")

    write(root, 0)
    return ("\n".join(lines) + "\n").encode("utf-8")


# --- helpers --------------------------------------------------------------------------------------


def mei_id(event_id: str) -> str:
    """The xml:id of an IR event: the IR id itself when it is an NCName, otherwise prefixed."""
    return event_id if _NCNAME_START.match(event_id) else EVENT_ID_PREFIX + event_id


def _key_signature(fifths: int) -> str:
    if fifths == 0:
        return "0"
    if not -7 <= fifths <= 7:
        raise ValueError(f"key signature of {fifths} accidentals is not representable")
    return f"{abs(fifths)}{'s' if fifths > 0 else 'f'}"


def _key_alter(fifths: int, step: str) -> int:
    if fifths > 0 and step in _SHARP_ORDER[:fifths]:
        return 1
    if fifths < 0 and step in _FLAT_ORDER[:-fifths]:
        return -1
    return 0


def _title(source_path: str) -> str:
    name = PurePosixPath(source_path).name
    return name.removesuffix(".ly")


def _diagnostic(
    message: str,
    code_detail: str,
    *,
    location: SourceLocation | None = None,
    event_ids: tuple[str, ...] = (),
    **extra: str,
) -> Diagnostic:
    details = tuple(sorted({"code": code_detail, **extra}.items()))
    return Diagnostic(
        code="UNSUPPORTED_FEATURE",
        severity="error",
        message=message,
        source_location=location,
        event_ids=event_ids,
        details=details,
    )


def _wordpos(syllables: list[LyricSyllable]) -> dict[str, tuple[str | None, bool]]:
    """syllable id -> (wordpos, extender) for the non-blank syllables of one lyrics context."""
    result: dict[str, tuple[str | None, bool]] = {}
    in_word = False
    for syllable in syllables:
        if syllable.text == "":
            if syllable.hyphen_after:
                in_word = True
            continue
        if in_word and syllable.hyphen_after:
            position: str | None = "m"
        elif in_word:
            position = "t"
        elif syllable.hyphen_after:
            position = "i"
        else:
            position = None
        result[syllable.id] = (position, syllable.extender_after)
        in_word = syllable.hyphen_after
    return result


# --- the encoder ---------------------------------------------------------------------------------


def encode_score(ir: ScoreIR, profile: ConversionProfile) -> EncodedScore:
    diagnostics: list[Diagnostic] = []
    status = {rule.family: rule.status for rule in profile.rules}

    # Families the profile marks unsupported are reported once per occurrence.
    for use in ir.features:
        if status.get(use.family) == "unsupported":
            diagnostics.append(
                _diagnostic(
                    f"feature family {use.family!r} is unsupported by profile {profile.id}",
                    "unsupported-family",
                    location=use.location,
                    event_ids=use.event_ids,
                    family=use.family,
                )
            )
        if use.family in ("key-change", "clef-change") and status.get(use.family) != "unsupported":
            diagnostics.append(
                _diagnostic(
                    f"{use.family} has no position in the IR, so it cannot be encoded",
                    "change-without-position",
                    location=use.location,
                    event_ids=use.event_ids,
                    family=use.family,
                )
            )

    staff_index = {staff.id: staff.index for staff in ir.staves}
    staff_fifths = {staff.id: staff.key_fifths for staff in ir.staves}
    layers_by_staff: dict[str, list[LayerDef]] = {staff.id: [] for staff in ir.staves}
    for layer in sorted(ir.layers, key=lambda lyr: lyr.ordinal):
        layers_by_staff[layer.home_staff_id].append(layer)
    home_staff = {layer.id: layer.home_staff_id for layer in ir.layers}
    event_by_id = {event.id: event for event in ir.events}

    xml_ids: dict[str, str] = {}
    for event in ir.events:
        key = mei_id(event.id)
        if key in xml_ids:
            raise ValueError(f"duplicate MEI id {key!r}")
        xml_ids[key] = event.id
    mei_of = {event.id: mei_id(event.id) for event in ir.events}

    # --- measures -------------------------------------------------------------------------------
    total = ir.total_duration
    points = {Fraction(0), total, *(b.onset for b in ir.boundaries)}
    for boundary in ir.boundaries:
        if not 0 < boundary.onset <= total:
            raise ValueError(f"boundary {boundary.id} at {boundary.onset} lies outside (0, {total}]")
    ordered = sorted(points)
    if len(ordered) == 1:
        ordered = [Fraction(0), Fraction(0)]
    measure_count = len(ordered) - 1
    starts = ordered[:-1]
    measure_ids = [f"m{k + 1:03d}" for k in range(measure_count)]

    def measure_of(onset: Fraction) -> int:
        return min(bisect_right(starts, onset) - 1, measure_count - 1)

    ending_at = {ordered[k + 1]: k for k in range(measure_count)}
    boundary_by_onset = {b.onset: b for b in ir.boundaries}

    # --- per-event decoration ------------------------------------------------------------------
    hidden_rests = {eid for use in ir.features if use.family == "hidden-rest" for eid in use.event_ids}

    tie_from_previous: set[str] = set()
    last_in_layer: dict[str, Event] = {}
    for event in ir.events:
        previous = last_in_layer.get(event.layer_id)
        if previous is not None and previous.tie_to_next:
            if event.kind == "note":
                tie_from_previous.add(event.id)
            else:
                diagnostics.append(
                    _diagnostic(
                        "tie runs into a rest or skip",
                        "dangling-tie",
                        location=previous.location,
                        event_ids=(previous.id,),
                    )
                )
        last_in_layer[event.layer_id] = event
    for event in last_in_layer.values():
        if event.tie_to_next:
            diagnostics.append(
                _diagnostic("tie has no following note", "dangling-tie", location=event.location, event_ids=(event.id,))
            )

    contexts: list[str] = []
    for syllable in ir.lyrics:
        if syllable.lyrics_context not in contexts:
            contexts.append(syllable.lyrics_context)
    position_by_context: dict[str, dict[str, tuple[str | None, bool]]] = {
        context: _wordpos([s for s in ir.lyrics if s.lyrics_context == context]) for context in contexts
    }
    markers_by_syllable: dict[str, list[str]] = {}
    for marker in ir.entry_markers:
        markers_by_syllable.setdefault(marker.syllable_id, []).append(marker.text)
    verses: dict[str, dict[int, _Node]] = {}
    for syllable in ir.lyrics:
        labels = markers_by_syllable.get(syllable.id, [])
        if syllable.text == "" and not labels:
            continue
        if syllable.anchor_event_id is None or syllable.anchor_event_id not in event_by_id:
            diagnostics.append(
                _diagnostic(
                    "lyric syllable has no anchor note",
                    "lyric-unanchored",
                    location=syllable.location,
                )
            )
            continue
        anchor = event_by_id[syllable.anchor_event_id]
        if anchor.kind != "note":
            diagnostics.append(
                _diagnostic(
                    "lyric syllable is anchored to a rest or skip",
                    "lyric-anchor-not-note",
                    location=syllable.location,
                    event_ids=(anchor.id,),
                )
            )
            continue
        number = contexts.index(syllable.lyrics_context) + 1
        verse = verses.setdefault(anchor.id, {}).get(number)
        if verse is None:
            verse = _Node("verse", {"n": str(number), "place": profile.lyric_place})
            verses[anchor.id][number] = verse
        for text in labels:
            verse.add("label", text)
        if syllable.text == "":
            # A blank syllable that carries an entry marker still needs a <syl> (a verse requires one).
            verse.add("syl")
        else:
            position, extender = position_by_context[syllable.lyrics_context][syllable.id]
            attrs: dict[str, str] = {}
            if position is not None:
                attrs["wordpos"] = position
            if extender:
                attrs["con"] = "u"
            elif syllable.hyphen_after:
                attrs["con"] = "d"
            verse.children.append(_Node("syl", attrs, [], syllable.text))

    def tie_attr(event: Event) -> str | None:
        incoming = event.id in tie_from_previous
        if event.tie_to_next and incoming:
            return "m"
        if event.tie_to_next:
            return "i"
        if incoming:
            return "t"
        return None

    def accidental_attrs(event: Event) -> dict[str, str]:
        assert event.pitch is not None
        attrs: dict[str, str] = {}
        printed: PrintedAccidental = event.printed_accidental
        if printed != "none":
            attrs["accid"] = _WRITTEN[printed]
        alter = event.pitch.alter
        if alter.denominator != 1 or alter not in (-2, -1, 0, 1, 2):
            raise ValueError(f"event {event.id}: alteration {alter} is not representable")
        key_alter = _key_alter(staff_fifths[event.staff_id], event.pitch.step)
        if alter != 0 or key_alter != 0:
            attrs["accid.ges"] = _GESTURAL[int(alter)]
        return attrs

    def event_node(event: Event) -> _Node:
        attrs: dict[str, str] = {"xml:id": mei_of[event.id], "dur": str(2**event.notated.log)}
        if event.notated.dots:
            attrs["dots"] = str(event.notated.dots)
        cross_staff = event.staff_id != home_staff[event.layer_id]
        if cross_staff:
            attrs["staff"] = str(staff_index[event.staff_id])
        if event.kind == "skip" or (event.kind == "rest" and event.id in hidden_rests):
            return _Node("space", attrs)
        if event.kind == "rest":
            return _Node("rest", attrs)
        assert event.pitch is not None
        attrs.update(pname=event.pitch.step, oct=str(event.pitch.octave))
        attrs.update(accidental_attrs(event))
        if not event.stem_visible:
            attrs["stem.visible"] = "false"
        if event.notehead == "hidden":
            attrs["visible"] = "false"
        elif event.notehead == "quilisma":
            attrs["head.visible"] = "false"
        tie = tie_attr(event)
        if tie is not None:
            attrs["tie"] = tie
        node = _Node("note", attrs)
        for number in sorted(verses.get(event.id, {})):
            node.children.append(verses[event.id][number])
        return node

    # --- distribute events and control events over measures ------------------------------------
    by_layer_measure: dict[tuple[str, int], list[Event]] = {}
    for event in ir.events:
        k = measure_of(event.onset)
        by_layer_measure.setdefault((event.layer_id, k), []).append(event)
        if event.onset + event.duration > ordered[k + 1]:
            crossed = next(b for b in ir.boundaries if b.onset == ordered[k + 1])
            diagnostics.append(
                _diagnostic(
                    "event crosses a measure boundary and is emitted whole until the split card lands",
                    SENTINEL_SPLIT_PENDING,
                    location=event.location,
                    event_ids=(event.id,),
                    crosses=crossed.id,
                )
            )

    controls: list[list[_Node]] = [[] for _ in range(measure_count)]
    for span in ir.spans:
        if span.kind == "tie":
            continue
        start = event_by_id.get(span.start_event_id)
        end = event_by_id.get(span.end_event_id)
        if start is None or end is None:
            diagnostics.append(
                _diagnostic(f"{span.kind} {span.id} refers to an unknown event", "span-unknown-event")
            )
            continue
        tag = "slur" if span.kind == "slur" else "gliss"
        attrs = {
            "xml:id": span.id,
            "startid": "#" + mei_of[start.id],
            "endid": "#" + mei_of[end.id],
        }
        if span.kind == "voice-line":
            attrs["lform"] = "dotted"
        controls[measure_of(start.onset)].append(_Node(tag, attrs))

    for event in ir.events:
        if event.notehead == "quilisma":
            controls[measure_of(event.onset)].append(
                _Node(
                    "mordent",
                    {"xml:id": "q" + mei_of[event.id], "startid": "#" + mei_of[event.id], "form": "upper"},
                )
            )

    division_layers: dict[Fraction, list[str]] = {}
    for division in ir.divisions:
        division_layers.setdefault(division.onset, []).append(division.layer_id)
    for boundary in ir.boundaries:
        if boundary.division not in _CAESURA_GLYPHS:
            continue
        k = ending_at[boundary.onset]
        wanted = [
            lid for lid in division_layers.get(boundary.onset, []) if lid in home_staff
        ] or [layer.id for layer in ir.layers[:1]]
        layer_id = wanted[0]
        candidates = by_layer_measure.get((layer_id, k), []) or [
            e for (lid, mk), evs in sorted(by_layer_measure.items()) if mk == k and home_staff[lid] == home_staff[layer_id] for e in evs
        ]
        if not candidates:
            diagnostics.append(
                _diagnostic(
                    "division has no event to attach to",
                    "division-without-anchor",
                    event_ids=(),
                    boundary=boundary.id,
                )
            )
            continue
        anchor = candidates[-1]
        controls[k].append(
            _Node(
                "caesura",
                {
                    "xml:id": "c" + boundary.id,
                    "startid": "#" + mei_of[anchor.id],
                    "staff": str(staff_index[home_staff[layer_id]]),
                    "glyph.auth": "smufl",
                    "glyph.num": _CAESURA_GLYPHS[boundary.division],
                },
            )
        )

    # --- document ------------------------------------------------------------------------------
    root = _Node("mei", {"xmlns": MEI_NS, "meiversion": "5.0"})
    file_desc = root.add("meiHead").add("fileDesc")
    file_desc.add("titleStmt").add("title", _title(ir.source_path))
    file_desc.add("pubStmt")
    score = root.add("music").add("body").add("mdiv").add("score")
    score_def = score.add("scoreDef", **{"mnum.visible": "false"})
    staff_grp = score_def.add("staffGrp", symbol="brace", **{"bar.thru": "true"})
    for staff in sorted(ir.staves, key=lambda s: s.index):
        staff_grp.add(
            "staffDef",
            n=str(staff.index),
            lines="5",
            **{
                "clef.shape": staff.clef_shape,
                "clef.line": str(staff.clef_line),
                "keysig": _key_signature(staff.key_fifths),
            },
        )
    section = score.add("section")

    for k in range(measure_count):
        end = ordered[k + 1]
        boundary = boundary_by_onset.get(end)
        division = boundary.division if boundary else None
        measure = section.add(
            "measure",
            **{
                "xml:id": measure_ids[k],
                "n": str(k + 1),
                "metcon": "false",
                "right": _RIGHT_BARLINE.get(division or "", "invis"),
            },
        )
        for staff in sorted(ir.staves, key=lambda s: s.index):
            staff_node = measure.add("staff", n=str(staff.index))
            for number, layer in enumerate(layers_by_staff[staff.id], start=1):
                layer_node = staff_node.add("layer", n=str(number))
                parent = layer_node
                current_scale: Fraction | None = None
                for event in by_layer_measure.get((layer.id, k), []):
                    scale = event.notated.scale
                    if scale == 1:
                        parent = layer_node
                        current_scale = None
                    elif scale != current_scale:
                        parent = layer_node.add(
                            "tuplet",
                            num=str(scale.denominator),
                            numbase=str(scale.numerator),
                            **{"num.visible": "false", "bracket.visible": "false"},
                        )
                        current_scale = scale
                    parent.children.append(event_node(event))
        measure.children.extend(controls[k])
        if boundary is not None and boundary.source_break and end != total:
            section.add("sb")

    # --- manifest, decisions, provenance -----------------------------------------------------
    entries = tuple(
        BoundaryManifestEntry(
            boundary_id=b.id,
            onset=rational_to_str(b.onset),
            measure_id=measure_ids[ending_at[b.onset]],
            safe=b.safe,
            source_break=b.source_break,
            division=b.division,
            after_text=b.after_text,
        )
        for b in ir.boundaries
    )
    counts: dict[str, int] = {}
    for use in ir.features:
        counts[use.family] = counts.get(use.family, 0) + 1
    decisions = tuple(
        FeatureDecision(family=rule.family, status=rule.status, occurrences=counts.get(rule.family, 0))
        for rule in profile.rules
    )

    xml = _serialize(root)
    return EncodedScore(
        xml=xml,
        artifact_sha256=hashlib.sha256(xml).hexdigest(),
        boundaries=entries,
        feature_decisions=decisions,
        provenance=dict(xml_ids),
        diagnostics=tuple(diagnostics),
    )
