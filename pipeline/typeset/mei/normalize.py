"""Independent semantic normalisers (card A4a): the oracle side of MEI validation.

``normalize_ir`` reduces a ``ScoreIR`` to a ``NormalizedScore``. ``normalize_mei`` reads encoded MEI
*bytes* back into the same shape, using only the MEI vocabulary and the provenance map. This module
deliberately imports nothing from ``encode`` or ``extract``: it must not share bugs with the encoder.

Conventions (shared by both sides so they can be compared with ``==``):

- ``layer_key`` is ``f"{staff_index}.{layer_n}"``; ``layer_n`` counts the layers homed on a staff in IR
  layer-ordinal order, from 1 (in MEI: the ``<layer n>`` inside ``<staff n>``). A cross-staff note keeps
  the layer it is written in.
- Spans, lyrics, entry markers and divisions are returned in a canonical order (see each field).
- Lyrics: blank syllables without an entry marker are dropped; syllables of one context on one note
  are concatenated; each lyrics context is one verse number, in order of first appearance.
- Divisions are a set: the same ``(kind, onset)`` in several layers is one division.
- A hidden rest and a skip are both ``skip`` (MEI ``<space>``); see ``normalize_ir``.
- A caesura sits at the end of the fragment its ``startid`` names (the encoder anchors it on the last
  fragment that starts before the boundary).
- A fragment is merged into its predecessor only when the chain is *proven*: ``type="split-continuation"``,
  ``@prev`` names an element whose ``@next`` names it back, same layer, same kind and pitch, the
  predecessor ends exactly where the continuation starts, and provenance agrees. Otherwise the
  fragment stays a separate event with ``is_attack=False``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from fractions import Fraction

from lxml import etree

from pipeline.typeset.mei.model import (
    DivisionKind,
    EventKind,
    NormalizedEvent,
    NormalizedScore,
    Notehead,
    Pitch,
    PrintedAccidental,
    ScoreIR,
    SpanKind,
)

MEI_NS = "http://www.music-encoding.org/ns/mei"
_XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
_M = "{" + MEI_NS + "}"
SPLIT_CONTINUATION = "split-continuation"

_DUR = {
    "maxima": Fraction(8),
    "long": Fraction(4),
    "breve": Fraction(2),
    **{str(2**k): Fraction(1, 2**k) for k in range(12)},
}
_ALTER = {"n": 0, "s": 1, "f": -1, "ss": 2, "x": 2, "ff": -2}
_PRINTED: dict[str, PrintedAccidental] = {
    "s": "sharp",
    "f": "flat",
    "n": "natural",
    "x": "double-sharp",
    "ss": "double-sharp",
    "ff": "double-flat",
}
_RIGHT_DIVISION: dict[str, DivisionKind] = {"dbl": "finalis", "single": "maxima"}
_CAESURA_DIVISION: dict[str, DivisionKind] = {"U+E8F3": "minima", "U+E8F4": "maior"}
_UNSUPPORTED = {"chord", "mRest", "mSpace", "multiRest", "beatRpt", "mRpt", "halfmRpt", "graceGrp"}
_PITCH_STEPS = ("c", "d", "e", "f", "g", "a", "b")


class UnsafeXmlError(ValueError):
    """The document carries a DOCTYPE or entity declaration and is refused unparsed."""


# --- IR side ----------------------------------------------------------------------------------


def normalize_ir(ir: ScoreIR) -> NormalizedScore:
    staff_index = {staff.id: staff.index for staff in ir.staves}
    layer_key: dict[str, str] = {}
    per_staff: dict[str, int] = {}
    for layer in sorted(ir.layers, key=lambda lyr: lyr.ordinal):
        per_staff[layer.home_staff_id] = per_staff.get(layer.home_staff_id, 0) + 1
        layer_key[layer.id] = f"{staff_index[layer.home_staff_id]}.{per_staff[layer.home_staff_id]}"

    # An invisible rest ("hidden-rest" feature) is a <space> in MEI, which cannot say "rest": both are
    # silent and unprinted, so the oracle compares them as the same kind ("skip").
    hidden_rests = {eid for use in ir.features if use.family == "hidden-rest" for eid in use.event_ids}
    grouped: dict[str, list[NormalizedEvent]] = {key: [] for key in layer_key.values()}
    event_by_id = {event.id: event for event in ir.events}
    for event in sorted(ir.events, key=lambda e: e.onset):
        grouped[layer_key[event.layer_id]].append(
            NormalizedEvent(
                layer_key=layer_key[event.layer_id],
                onset=event.onset,
                duration=event.duration,
                kind="skip" if event.id in hidden_rests and event.kind == "rest" else event.kind,
                pitch=event.pitch,
                is_attack=True,
                notehead=event.notehead,
                printed_accidental=event.printed_accidental,
                source_event_id=event.id,
            )
        )

    context_number: dict[str, int] = {}
    for syllable in ir.lyrics:
        context_number.setdefault(syllable.lyrics_context, len(context_number) + 1)
    marked = {marker.syllable_id for marker in ir.entry_markers}
    texts: dict[tuple[str | None, str], str] = {}
    order: dict[tuple[str | None, str], tuple[Fraction, str, int, int]] = {}
    syllable_key: dict[str, tuple[tuple[str | None, str], tuple[Fraction, str, int, int]]] = {}
    for seq, syllable in enumerate(ir.lyrics):
        anchor = event_by_id.get(syllable.anchor_event_id) if syllable.anchor_event_id else None
        where = layer_key[anchor.layer_id] if anchor else ""
        key = (syllable.anchor_event_id, syllable.lyrics_context)
        sort = (anchor.onset if anchor else syllable.onset, where, context_number[syllable.lyrics_context], seq)
        syllable_key[syllable.id] = (key, sort)
        if syllable.text == "" and syllable.id not in marked:
            continue
        texts[key] = texts.get(key, "") + syllable.text
        order.setdefault(key, sort)
    lyrics = tuple((texts[k], k[0]) for k in sorted(texts, key=lambda k: order[k]))

    anchor_of = {s.id: s.anchor_event_id for s in ir.lyrics}
    entry_markers = tuple(
        (m.text, anchor_of[m.syllable_id])
        for m in sorted(ir.entry_markers, key=lambda m: (syllable_key[m.syllable_id][1], m.id))
    )

    spans = tuple(sorted({(s.kind, s.start_event_id, s.end_event_id) for s in ir.spans}))
    divisions = tuple(sorted({(d.kind, d.onset) for d in ir.divisions}, key=lambda d: (d[1], d[0])))
    return NormalizedScore(
        layers={key: tuple(events) for key, events in grouped.items()},
        lyrics=lyrics,
        entry_markers=entry_markers,
        spans=spans,
        divisions=divisions,
        total_duration=ir.total_duration,
    )


# --- MEI side ---------------------------------------------------------------------------------


@dataclass
class _Frag:
    xml_id: str
    layer_key: str
    kind: EventKind
    onset: Fraction
    duration: Fraction
    pitch: Pitch | None
    printed: PrintedAccidental
    hidden: bool
    head_hidden: bool
    continuation: bool
    prev: str | None
    next: str | None
    tie: str | None
    verses: list[etree._Element]
    absorbed: bool = False  # merged into an earlier fragment
    merged_end: Fraction = Fraction(0)

    @property
    def end(self) -> Fraction:
        return self.onset + self.duration


def _parse(xml: bytes) -> etree._Element:
    if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise UnsafeXmlError("MEI with a DOCTYPE or entity declaration is refused")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    root = etree.fromstring(xml, parser)
    if root.getroottree().docinfo.doctype:
        raise UnsafeXmlError("MEI with a DOCTYPE is refused")
    return root


def _local(el: etree._Element) -> str:
    tag = el.tag
    return etree.QName(tag).localname if isinstance(tag, str) else ""


def _ref(value: str | None) -> str | None:
    if value is None:
        return None
    return value.removeprefix("#")


def _pitch(el: etree._Element) -> Pitch:
    step = el.get("pname")
    octave = el.get("oct")
    if step not in _PITCH_STEPS or octave is None:
        raise ValueError(f"note {el.get(_XML_ID)!r} lacks a valid pname/oct")
    code = el.get("accid.ges") or el.get("accid")
    if code is None:
        alter = 0
    elif code in _ALTER:
        alter = _ALTER[code]
    else:
        raise ValueError(f"note {el.get(_XML_ID)!r}: unsupported accidental {code!r}")
    return Pitch(step=step, alter=Fraction(alter), octave=int(octave))  # type: ignore[arg-type]


def _duration(el: etree._Element, ratio: Fraction) -> Fraction:
    dur = el.get("dur")
    if dur not in _DUR:
        raise ValueError(f"{_local(el)} {el.get(_XML_ID)!r} has unsupported @dur {dur!r}")
    base = _DUR[dur]
    dots = int(el.get("dots", "0"))
    return base * (2 - Fraction(1, 2**dots)) * ratio


def normalize_mei(xml: bytes, provenance: Mapping[str, str]) -> NormalizedScore:
    root = _parse(xml)
    frags: list[_Frag] = []
    layer_order: list[str] = []
    measure_ends: list[tuple[Fraction, str]] = []  # (end onset, right) per measure
    measure_start = Fraction(0)

    for measure in root.iter(_M + "measure"):
        position: dict[str, Fraction] = {}
        for s_idx, staff in enumerate(measure.findall(_M + "staff"), start=1):
            staff_n = staff.get("n", str(s_idx))
            for l_idx, layer in enumerate(staff.findall(_M + "layer"), start=1):
                key = f"{staff_n}.{layer.get('n', str(l_idx))}"
                if key not in layer_order:
                    layer_order.append(key)
                position[key] = measure_start
                _walk(layer, Fraction(1), key, position, frags)
        measure_start = max([measure_start, *position.values()])
        measure_ends.append((measure_start, measure.get("right", "")))

    by_id = {f.xml_id: f for f in frags}
    for f in frags:
        f.merged_end = f.end
    root_of: dict[str, _Frag] = {}
    for f in frags:  # document order is time order within a layer
        root_of[f.xml_id] = f
        if not f.continuation or f.prev is None:
            continue
        p = by_id.get(f.prev)
        proven = (
            p is not None
            and p.layer_key == f.layer_key
            and p.next == f.xml_id
            and p.kind == f.kind
            and p.pitch == f.pitch
            and p.end == f.onset
            and provenance.get(p.xml_id) == provenance.get(f.xml_id)
        )
        if proven:
            head = root_of[p.xml_id]  # type: ignore[union-attr]
            head.merged_end = f.end
            head.tie = _merge_tie(head.tie, f.tie)
            f.absorbed = True
            root_of[f.xml_id] = head

    mordents = {
        _ref(el.get("startid"))
        for el in root.iter(_M + "mordent")
        if _ref(el.get("startid"))
    }

    layers: dict[str, list[NormalizedEvent]] = {key: [] for key in layer_order}
    src: dict[str, str | None] = {f.xml_id: provenance.get(f.xml_id) for f in frags}
    head_event: dict[str, NormalizedEvent] = {}
    for f in frags:
        if f.absorbed:
            continue
        if f.hidden and not f.continuation:
            notehead: Notehead = "hidden"
        elif f.xml_id in mordents and f.head_hidden:
            notehead = "quilisma"
        else:
            notehead = "normal"
        event = NormalizedEvent(
            layer_key=f.layer_key,
            onset=f.onset,
            duration=f.merged_end - f.onset,
            kind=f.kind,
            pitch=f.pitch,
            is_attack=not f.continuation,
            notehead=notehead,
            printed_accidental=f.printed,
            source_event_id=src[f.xml_id],
        )
        layers[f.layer_key].append(event)
        head_event[f.xml_id] = event

    # --- spans ---
    def resolve(ref: str | None) -> str:
        if ref is None:
            return "unmapped:"
        mapped = provenance.get(ref)
        return mapped if mapped is not None else f"unmapped:{ref}"

    spans: set[tuple[SpanKind, str, str]] = set()
    for tag, kind in (("slur", "slur"), ("gliss", "voice-line")):
        for el in root.iter(_M + tag):
            spans.add((kind, resolve(_ref(el.get("startid"))), resolve(_ref(el.get("endid")))))  # type: ignore[arg-type]
    for key in layer_order:
        events = [f for f in frags if f.layer_key == key and not f.absorbed]
        for i, f in enumerate(events):
            if f.tie not in ("i", "m") or f.kind != "note":
                continue
            target = next((g for g in events[i + 1 :] if g.kind == "note"), None)
            if target is not None and target.pitch == f.pitch:
                spans.add(("tie", resolve(f.xml_id), resolve(target.xml_id)))

    # --- lyrics ---
    lyric_texts: dict[tuple[str, str], str] = {}
    lyric_order: dict[tuple[str, str], tuple[Fraction, str, int, int]] = {}
    marker_rows: list[tuple[tuple[Fraction, str, int, int], int, str, str]] = []
    seq = 0
    for f in frags:
        for verse in f.verses:
            number = int(verse.get("n", "1"))
            anchor = resolve(f.xml_id)
            sort = (f.onset, f.layer_key, number, seq)
            seq += 1
            text = "".join("".join(s.itertext()) for s in verse.findall(_M + "syl"))
            if verse.findall(_M + "syl"):
                lk = (f.xml_id, str(number))
                lyric_texts[lk] = lyric_texts.get(lk, "") + text
                lyric_order.setdefault(lk, sort)
            for label in verse.findall(_M + "label"):
                marker_rows.append((sort, seq, "".join(label.itertext()), anchor))
                seq += 1
    lyrics = tuple(
        (lyric_texts[k], resolve(k[0])) for k in sorted(lyric_texts, key=lambda k: lyric_order[k])
    )
    entry_markers = tuple((text, anchor) for _, _, text, anchor in sorted(marker_rows, key=lambda r: r[:2]))

    # --- divisions ---
    found: set[tuple[DivisionKind, Fraction]] = set()
    for end, right in measure_ends:
        if right in _RIGHT_DIVISION:
            found.add((_RIGHT_DIVISION[right], end))
    for el in root.iter(_M + "caesura"):
        kind = _CAESURA_DIVISION.get(el.get("glyph.num", ""))
        anchor_frag = by_id.get(_ref(el.get("startid")) or "")
        if kind is not None and anchor_frag is not None:
            found.add((kind, anchor_frag.end))
    divisions = tuple(sorted(found, key=lambda d: (d[1], d[0])))

    total = max((e.onset + e.duration for evs in layers.values() for e in evs), default=Fraction(0))
    return NormalizedScore(
        layers={key: tuple(events) for key, events in layers.items()},
        lyrics=lyrics,
        entry_markers=entry_markers,
        spans=tuple(sorted(spans)),
        divisions=divisions,
        total_duration=total,
    )


def _merge_tie(first: str | None, last: str | None) -> str | None:
    """Tie attribute of a merged chain: incoming from the first fragment, outgoing from the last."""
    incoming = first in ("t", "m")
    outgoing = last in ("i", "m")
    if incoming and outgoing:
        return "m"
    if outgoing:
        return "i"
    if incoming:
        return "t"
    return None


def _walk(
    parent: etree._Element,
    ratio: Fraction,
    key: str,
    position: dict[str, Fraction],
    out: list[_Frag],
) -> None:
    for child in parent:
        name = _local(child)
        if name in _UNSUPPORTED:
            raise ValueError(f"unsupported MEI element <{name}> in layer {key}")
        if name == "tuplet":
            num = int(child.get("num", "0"))
            base = int(child.get("numbase", "0"))
            if num <= 0 or base <= 0:
                raise ValueError("tuplet without positive @num and @numbase")
            _walk(child, ratio * Fraction(base, num), key, position, out)
        elif name in ("note", "rest", "space"):
            duration = _duration(child, ratio)
            kind: EventKind = {"note": "note", "rest": "rest", "space": "skip"}[name]  # type: ignore[assignment]
            accid = child.get("accid")
            out.append(
                _Frag(
                    xml_id=child.get(_XML_ID) or "",
                    layer_key=key,
                    kind=kind,
                    onset=position[key],
                    duration=duration,
                    pitch=_pitch(child) if name == "note" else None,
                    printed=_PRINTED.get(accid, "none") if accid else "none",
                    hidden=child.get("visible") == "false",
                    head_hidden=child.get("head.visible") == "false",
                    continuation=child.get("type") == SPLIT_CONTINUATION,
                    prev=_ref(child.get("prev")),
                    next=_ref(child.get("next")),
                    tie=child.get("tie"),
                    verses=child.findall(_M + "verse"),
                )
            )
            position[key] += duration
        elif name in ("beam", "bTrem", "fTrem", "graceGrp", "ligature"):
            _walk(child, ratio, key, position, out)
