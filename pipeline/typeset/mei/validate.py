"""Semantic comparison of a source score against its MEI conversion (card A4b).

``compare_scores`` takes two ``NormalizedScore`` values (source side from ``normalize_ir``, converted
side from ``normalize_mei``) and reports every difference with a contracts ``DiagnosticCode``.
``validate_conversion`` is the whole check for one conversion: schema, normalise both sides, compare.

Alignment inside a layer: converted events are matched to source events by ``source_event_id`` (an
attack is preferred over a continuation sharing the id). Source events left over are then paired, in
order, with converted events that carry no usable id. Anything still unpaired is reported:

- source event with no converted counterpart: ``RENDER_EVENT_MISSING``;
- extra converted event (no source counterpart, id unknown, or a non-attack continuation left
  standing alone): ``ATTACK_MISMATCH``, because what the page shows is an attack the source lacks.

A change of kind (note, rest, skip) is reported as ``PITCH_MISMATCH`` (pitch present versus absent, or
rest versus skip) with the kinds in the detail. Voice-line glissandi are ``SLUR_MISMATCH`` with
``voice-line`` in the detail. A converted total that is longer than the source is a
``DURATION_MISMATCH`` on the whole score.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Sequence
from fractions import Fraction

from lxml import etree

from pipeline.typeset.mei.diagnostics import BLOCKING, Diagnostic
from pipeline.typeset.mei.model import (
    EncodedScore,
    NormalizedEvent,
    NormalizedScore,
    SchemaBundle,
    ScoreIR,
    SemanticDifference,
    ValidationReport,
)
from pipeline.typeset.mei.normalize import normalize_ir, normalize_mei

NORMALIZER_VERSION = "a4a-1"
COMPARER_VERSION = "a4b-1"


def _ids(*values: str | None) -> tuple[str, ...]:
    return tuple(v for v in values if v is not None)


def _diff(
    code: str,
    detail: str,
    layer_key: str | None = None,
    onset: Fraction | None = None,
    ids: tuple[str, ...] = (),
) -> SemanticDifference:
    return SemanticDifference(code, layer_key, onset, ids, detail)


def _align(
    source: Sequence[NormalizedEvent], converted: Sequence[NormalizedEvent]
) -> tuple[list[tuple[NormalizedEvent, NormalizedEvent]], list[NormalizedEvent], list[NormalizedEvent]]:
    by_id: dict[str, list[int]] = {}
    for index, event in enumerate(converted):
        if event.source_event_id is not None:
            by_id.setdefault(event.source_event_id, []).append(index)
    used: set[int] = set()
    pairs: dict[int, int] = {}
    for si, event in enumerate(source):
        candidates = [i for i in by_id.get(event.source_event_id or "", []) if i not in used]
        if not candidates:
            continue
        pick = next((i for i in candidates if converted[i].is_attack), candidates[0])
        used.add(pick)
        pairs[si] = pick
    source_ids = {e.source_event_id for e in source if e.source_event_id is not None}
    loose = [
        i
        for i, e in enumerate(converted)
        if i not in used and (e.source_event_id is None or e.source_event_id not in source_ids)
    ]
    for si in (i for i in range(len(source)) if i not in pairs):
        if not loose:
            break
        pick = loose.pop(0)
        used.add(pick)
        pairs[si] = pick
    matched = [(source[si], converted[ci]) for si, ci in sorted(pairs.items())]
    missing = [source[si] for si in range(len(source)) if si not in pairs]
    extra = [converted[i] for i in range(len(converted)) if i not in used]
    return matched, missing, extra


def _compare_layer(key: str, source: Sequence[NormalizedEvent], converted: Sequence[NormalizedEvent]) -> list[SemanticDifference]:
    out: list[SemanticDifference] = []
    matched, missing, extra = _align(source, converted)
    for s, c in matched:
        ids = _ids(s.source_event_id, c.source_event_id)
        ids = tuple(dict.fromkeys(ids))
        at = s.onset
        if s.kind != c.kind or s.pitch != c.pitch:
            out.append(_diff("PITCH_MISMATCH", f"{s.kind} {s.pitch} became {c.kind} {c.pitch}", key, at, ids))
        if s.onset != c.onset:
            out.append(_diff("ONSET_MISMATCH", f"onset {s.onset} became {c.onset}", key, at, ids))
        if s.duration != c.duration:
            out.append(_diff("DURATION_MISMATCH", f"duration {s.duration} became {c.duration}", key, at, ids))
        if s.is_attack != c.is_attack:
            out.append(_diff("ATTACK_MISMATCH", f"is_attack {s.is_attack} became {c.is_attack}", key, at, ids))
        if s.notehead != c.notehead:
            out.append(_diff("NOTEHEAD_MISMATCH", f"notehead {s.notehead} became {c.notehead}", key, at, ids))
        if s.printed_accidental != c.printed_accidental:
            out.append(
                _diff(
                    "ACCIDENTAL_DISPLAY_MISMATCH",
                    f"printed accidental {s.printed_accidental} became {c.printed_accidental}",
                    key,
                    at,
                    ids,
                )
            )
    for s in missing:
        out.append(_diff("RENDER_EVENT_MISSING", f"{s.kind} at {s.onset} has no converted event", key, s.onset, _ids(s.source_event_id)))
    for c in extra:
        what = "continuation fragment left standing" if not c.is_attack else "converted attack with no source event"
        out.append(_diff("ATTACK_MISMATCH", f"{what} at {c.onset}", key, c.onset, _ids(c.source_event_id)))
    return out


def _both_ways(
    source: Sequence[tuple[object, ...]], converted: Sequence[tuple[object, ...]]
) -> tuple[list[tuple[object, ...]], list[tuple[object, ...]]]:
    missing = Counter(source) - Counter(converted)
    extra = Counter(converted) - Counter(source)
    return sorted(missing.elements(), key=repr), sorted(extra.elements(), key=repr)


def compare_scores(source: NormalizedScore, converted: NormalizedScore) -> list[SemanticDifference]:
    out: list[SemanticDifference] = []
    where: dict[str, tuple[str, Fraction]] = {}
    for key, events in source.layers.items():
        for e in events:
            if e.source_event_id is not None:
                where.setdefault(e.source_event_id, (key, e.onset))

    def located(code: str, detail: str, ids: tuple[str, ...], onset: Fraction | None = None) -> SemanticDifference:
        spot = next((where[i] for i in ids if i in where), None)
        return _diff(code, detail, spot[0] if spot else None, onset if onset is not None else (spot[1] if spot else None), ids)

    for key in sorted(source.layers):
        if key not in converted.layers:
            out.append(_diff("VOICE_MISSING", f"layer {key} is absent from the conversion", key))
    for key in sorted(converted.layers):
        if key not in source.layers:
            out.append(_diff("VOICE_EXTRA", f"layer {key} does not exist in the source", key))
    for key in sorted(source.layers.keys() & converted.layers.keys()):
        out.extend(_compare_layer(key, source.layers[key], converted.layers[key]))

    missing_spans, extra_spans = _both_ways(source.spans, converted.spans)
    for label, spans in (("missing", missing_spans), ("extra", extra_spans)):
        for kind, start, end in spans:  # type: ignore[misc]
            code = "TIE_MISMATCH" if kind == "tie" else "SLUR_MISMATCH"
            detail = f"{label} {kind} span {start} -> {end}"
            out.append(located(code, detail, (start, end)))

    missing_div, extra_div = _both_ways(source.divisions, converted.divisions)
    for label, divisions in (("missing", missing_div), ("extra", extra_div)):
        for kind, onset in divisions:  # type: ignore[misc]
            out.append(_diff("DIVISION_MISMATCH", f"{label} {kind} at {onset}", None, onset))

    missing_m, extra_m = _both_ways(source.entry_markers, converted.entry_markers)
    for label, markers in (("missing", missing_m), ("extra", extra_m)):
        for text, anchor in markers:  # type: ignore[misc]
            out.append(located("ENTRY_MARKER_MISMATCH", f"{label} entry marker {text!r}", _ids(anchor)))

    missing_l, extra_l = _both_ways(source.lyrics, converted.lyrics)
    missing_l, extra_l = list(missing_l), list(extra_l)
    for s in list(missing_l):
        same_anchor = next((c for c in extra_l if c[1] == s[1]), None)  # type: ignore[index]
        if same_anchor is not None:
            missing_l.remove(s)
            extra_l.remove(same_anchor)
            out.append(located("LYRIC_TEXT_MISMATCH", f"lyric {s[0]!r} became {same_anchor[0]!r}", _ids(s[1])))  # type: ignore[arg-type,index]
    for s in list(missing_l):
        same_text = next((c for c in extra_l if c[0] == s[0]), None)  # type: ignore[index]
        if same_text is not None:
            missing_l.remove(s)
            extra_l.remove(same_text)
            out.append(
                located(
                    "LYRIC_ANCHOR_MISMATCH",
                    f"lyric {s[0]!r} moved from {s[1]} to {same_text[1]}",  # type: ignore[index]
                    _ids(s[1], same_text[1]),  # type: ignore[arg-type,index]
                )
            )
    for label, rest in (("missing", missing_l), ("extra", extra_l)):
        for text, anchor in rest:  # type: ignore[misc]
            out.append(located("LYRIC_TEXT_MISMATCH", f"{label} lyric {text!r}", _ids(anchor)))

    if converted.total_duration < source.total_duration:
        out.append(
            _diff(
                "ENDING_MISSING",
                f"converted total {converted.total_duration} is shorter than source {source.total_duration}",
                None,
                converted.total_duration,
            )
        )
    elif converted.total_duration > source.total_duration:
        out.append(
            _diff(
                "DURATION_MISMATCH",
                f"converted total {converted.total_duration} is longer than source {source.total_duration}",
                None,
                converted.total_duration,
            )
        )
    return out


def _blocking(diagnostics: Sequence[Diagnostic]) -> bool:
    return any(d.severity == "error" and d.code in BLOCKING for d in diagnostics)


def validate_conversion(ir: ScoreIR, encoded: EncodedScore, schema: SchemaBundle) -> ValidationReport:
    """Schema check, normalise both sides, compare. ``eligible`` also requires that neither the
    extraction (``ir.diagnostics``) nor the encoder left a blocking error diagnostic."""
    from pipeline.typeset.mei.schema import validate_schema

    schema_diagnostics = tuple(validate_schema(encoded.xml, schema))
    schema_ok = not schema_diagnostics
    differences: tuple[SemanticDifference, ...] = ()
    try:
        converted = normalize_mei(encoded.xml, encoded.provenance)
        differences = tuple(compare_scores(normalize_ir(ir), converted))
        readable = True
    except (ValueError, etree.XMLSyntaxError) as exc:
        readable = False
        differences = (_diff("SCHEMA_INVALID", f"MEI cannot be normalised: {exc}"),)
    eligible = (
        schema_ok
        and readable
        and not differences
        and not _blocking(encoded.diagnostics)
        and not _blocking(ir.diagnostics)
    )
    ir_json = json.dumps(ir.to_dict(), sort_keys=True, separators=(",", ":"))
    return ValidationReport(
        schema_ok=schema_ok,
        schema_diagnostics=schema_diagnostics,
        semantic_differences=differences,
        eligible=eligible,
        hashes={
            "ir": hashlib.sha256(ir_json.encode("utf-8")).hexdigest(),
            "mei": hashlib.sha256(encoded.xml).hexdigest(),
            "schema": schema.sha256,
        },
        tool_versions={
            "schema_validator": schema.validator,
            "lxml": ".".join(str(n) for n in etree.LXML_VERSION),
            "normalizer": NORMALIZER_VERSION,
            "comparer": COMPARER_VERSION,
        },
    )
