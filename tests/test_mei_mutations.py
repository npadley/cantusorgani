"""Card A4c: mutation suite proving the semantic oracle catches real musical damage.

Each test encodes a real pilot (Kyrie IX, or Agnus XI where a mutation needs printed accidentals or
voice-line noteheads), applies exactly one change to the MEI, and runs
``compare_scores(normalize_ir(ir), normalize_mei(mutated, provenance))``. A test passes only when the
expected code is reported *and* the difference names the affected source event id (or layer and onset).
"""

from __future__ import annotations

from collections.abc import Callable
from itertools import pairwise

import pytest
from lxml import etree

from pipeline.typeset.mei.model import SemanticDifference
from pipeline.typeset.mei.normalize import normalize_ir, normalize_mei
from pipeline.typeset.mei.validate import compare_scores
from tests.test_mei_normalize import pilot

M = "{http://www.music-encoding.org/ns/mei}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
SPLIT = "split-continuation"

Mutation = Callable[[etree._Element, dict[str, str]], None]


# --- helpers --------------------------------------------------------------------------------


def run(fixture: str, mutate: Mutation | None = None) -> list[SemanticDifference]:
    """Apply ``mutate(root, provenance)`` to a fresh copy of the pilot MEI and compare to the source."""
    ir, encoded = pilot(fixture)
    root = etree.fromstring(encoded.xml)
    provenance = dict(encoded.provenance)
    if mutate is not None:
        mutate(root, provenance)
    mutated = etree.tostring(root, xml_declaration=True, encoding="UTF-8")
    return compare_scores(normalize_ir(ir), normalize_mei(mutated, provenance))


def with_code(diffs: list[SemanticDifference], code: str) -> list[SemanticDifference]:
    return [d for d in diffs if d.code == code]


def layer_elements(root: etree._Element, staff: str, layer: str) -> list[etree._Element]:
    """Every <layer> of one staff/layer number, in measure order."""
    return [
        lyr
        for measure in root.iter(M + "measure")
        for st in measure.findall(M + "staff")
        if st.get("n") == staff
        for lyr in st.findall(M + "layer")
        if lyr.get("n") == layer
    ]


def layer_notes(root: etree._Element, staff: str, layer: str) -> list[etree._Element]:
    return [n for lyr in layer_elements(root, staff, layer) for n in lyr.iter(M + "note")]


def by_id(root: etree._Element, xml_id: str) -> etree._Element:
    found = root.xpath(f"//*[@xml:id='{xml_id}']")
    assert len(found) == 1
    return found[0]


def is_attack(note: etree._Element) -> bool:
    return note.get("type") != SPLIT


def pname_oct(note: etree._Element) -> tuple[str | None, str | None, str | None]:
    return note.get("pname"), note.get("oct"), note.get("accid.ges")


def sid(prov: dict[str, str], note: etree._Element) -> str:
    return prov[note.get(XML_ID)]  # type: ignore[index]


# --- unmutated baselines --------------------------------------------------------------------


@pytest.mark.parametrize("fixture", ["F1", "F3"])
def test_compare_scores_unmutated_pilot_reports_nothing(fixture: str) -> None:
    assert run(fixture) == []


# --- the sixteen mutations ------------------------------------------------------------------


def test_compare_scores_removed_layer_reports_voice_missing() -> None:
    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        for lyr in layer_elements(root, "2", "2"):
            lyr.getparent().remove(lyr)

    hits = with_code(run("F1", mutate), "VOICE_MISSING")
    assert [d.layer_key for d in hits] == ["2.2"]


def test_compare_scores_changed_pname_reports_pitch_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        note = next(
            n for n in layer_notes(root, "1", "1") if is_attack(n) and n.get("pname") == "e"
        )
        note.set("pname", "d")
        target["id"] = sid(prov, note)

    hits = with_code(run("F1", mutate), "PITCH_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)


def test_compare_scores_shifted_onset_reports_onset_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        # Insert a 1/64 hidden space before the second note of the first layer: every later event
        # in that layer moves by 1/64.
        notes = layer_notes(root, "1", "1")
        space = etree.Element(M + "space", dur="64")
        space.set(XML_ID, "mut-space")
        notes[1].addprevious(space)
        target["id"] = sid(prov, notes[1])

    diffs = run("F1", mutate)
    hits = with_code(diffs, "ONSET_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)
    assert any(d.layer_key == "1.1" and target["id"] in d.source_event_ids for d in hits)


def test_compare_scores_dotted_note_reports_onset_mismatch_for_later_events() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        notes = layer_notes(root, "1", "1")
        notes[0].set("dots", "1")
        target["next"] = sid(prov, notes[1])

    hits = with_code(run("F1", mutate), "ONSET_MISMATCH")
    assert any(target["next"] in d.source_event_ids for d in hits)


def test_compare_scores_shortened_final_note_reports_duration_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        last = layer_notes(root, "2", "2")[-1]
        assert last.get("dur") == "2"
        last.set("dur", "4")
        target["id"] = prov[last.get(XML_ID)]  # type: ignore[index]

    hits = with_code(run("F1", mutate), "DURATION_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)
    assert all(d.layer_key == "2.2" for d in hits if target["id"] in d.source_event_ids)


def test_compare_scores_every_layer_ending_short_reports_ending_missing() -> None:
    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        for staff, layer in (("1", "1"), ("1", "2"), ("2", "1"), ("2", "2")):
            last = layer_notes(root, staff, layer)[-1]
            last.set("dur", "8" if last.get("dur") == "4" else "4")

    diffs = run("F1", mutate)
    assert with_code(diffs, "ENDING_MISSING")
    assert with_code(diffs, "DURATION_MISMATCH")


def test_compare_scores_collapsed_repeated_attack_reports_attack_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        notes = layer_notes(root, "1", "1")
        first, second = next(
            (a, b)
            for a, b in pairwise(notes)
            if is_attack(a)
            and is_attack(b)
            and a.get("next") is None
            and a.get("tie") is None
            and pname_oct(a) == pname_oct(b)
            and a.get("dur") == b.get("dur")
            and a.get("dots") == b.get("dots")
            and b.getparent() is a.getparent()
            and prov[a.get(XML_ID)] != prov[b.get(XML_ID)]  # type: ignore[index]
        )
        second.set("type", SPLIT)
        second.set("prev", "#" + first.get(XML_ID))  # type: ignore[operator]
        first.set("next", "#" + second.get(XML_ID))  # type: ignore[operator]
        target["id"] = sid(prov, second)

    hits = with_code(run("F1", mutate), "ATTACK_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)


def test_compare_scores_verse_moved_to_neighbour_reports_lyric_anchor_mismatch() -> None:
    ids: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        notes = layer_notes(root, "1", "1")
        i = next(
            i
            for i, n in enumerate(notes[:-1])
            if n.find(M + "verse") is not None
            and n.find(M + "verse/" + M + "label") is None
            and notes[i + 1].find(M + "verse") is None
            and is_attack(notes[i + 1])
        )
        verse = notes[i].find(M + "verse")
        notes[i + 1].append(verse)  # moves it, text unchanged
        ids["from"], ids["to"] = sid(prov, notes[i]), sid(prov, notes[i + 1])

    hits = with_code(run("F1", mutate), "LYRIC_ANCHOR_MISMATCH")
    assert any(ids["from"] in d.source_event_ids and ids["to"] in d.source_event_ids for d in hits)


def test_compare_scores_changed_lyric_text_reports_lyric_text_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        note = next(
            n for n in layer_notes(root, "1", "1") if n.find(M + "verse/" + M + "syl") is not None
        )
        syl = note.find(M + "verse/" + M + "syl")
        syl.text = (syl.text or "") + "X"
        target["id"] = sid(prov, note)

    hits = with_code(run("F1", mutate), "LYRIC_TEXT_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)


def test_compare_scores_dropped_final_double_bar_reports_division_mismatch() -> None:
    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        last = list(root.iter(M + "measure"))[-1]
        assert last.get("right") == "dbl"
        last.set("right", "invis")

    ir, _ = pilot("F1")
    diffs = run("F1", mutate)
    hits = with_code(diffs, "DIVISION_MISMATCH")
    assert any("finalis" in d.detail and d.onset == normalize_ir(ir).total_duration for d in hits)


def _ticks(root: etree._Element) -> list[etree._Element]:
    return list(root.iter(M + "dir"))


def test_compare_scores_dropped_divisio_minima_reports_division_mismatch() -> None:
    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        for tick in _ticks(root):
            tick.getparent().remove(tick)

    hits = with_code(run("F1", mutate), "DIVISION_MISMATCH")
    assert any("missing minima at" in d.detail and d.onset is not None for d in hits)


def test_compare_scores_divisio_minima_missing_from_one_staff_reports_division_mismatch() -> None:
    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        bass = next(t for t in _ticks(root) if t.get("staff") == "2")
        bass.getparent().remove(bass)

    hits = with_code(run("F1", mutate), "DIVISION_MISMATCH")
    assert [d.detail.split(" at ")[0] for d in hits] == ["missing minima mark on staff 2"]


def test_compare_scores_removed_entry_marker_reports_entry_marker_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        label = next(root.iter(M + "label"))
        note = label.getparent().getparent()
        target["id"] = sid(prov, note)
        label.getparent().remove(label)

    hits = with_code(run("F1", mutate), "ENTRY_MARKER_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)


def test_compare_scores_removed_tie_reports_tie_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        tie = next(root.iter(M + "tie"))
        target["id"] = prov[tie.get("startid").removeprefix("#")]  # type: ignore[union-attr]
        tie.getparent().remove(tie)

    hits = with_code(run("F1", mutate), "TIE_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)


def test_compare_scores_removed_slur_reports_slur_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        slur = next(root.iter(M + "slur"))
        target["start"] = prov[slur.get("startid").removeprefix("#")]  # type: ignore[union-attr]
        slur.getparent().remove(slur)

    hits = with_code(run("F1", mutate), "SLUR_MISMATCH")
    assert any(target["start"] in d.source_event_ids and "missing" in d.detail for d in hits)


def test_compare_scores_removed_printed_accidental_reports_accidental_display_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        note = root.xpath("//m:note[@accid]", namespaces={"m": M[1:-1]})[0]
        del note.attrib["accid"]  # accid.ges (sounding pitch) stays
        target["id"] = sid(prov, note)

    hits = with_code(run("F3", mutate), "ACCIDENTAL_DISPLAY_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)
    assert not with_code(run("F3", mutate), "PITCH_MISMATCH")


def test_compare_scores_broken_split_chain_reports_attack_and_duration_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        cont = next(n for n in layer_notes(root, "1", "2") if n.get("type") == SPLIT)
        del cont.attrib["prev"]
        target["cont"] = sid(prov, cont)

    diffs = run("F1", mutate)
    attack = with_code(diffs, "ATTACK_MISMATCH")
    assert any(target["cont"] in d.source_event_ids and "continuation" in d.detail for d in attack)
    # the head no longer absorbs its continuation, so it is also too short
    assert any(target["cont"] in d.source_event_ids for d in with_code(diffs, "DURATION_MISMATCH"))


def test_compare_scores_unhidden_voice_line_note_reports_notehead_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        note = next(n for n in layer_notes(root, "2", "3") if n.get("visible") == "false")
        del note.attrib["visible"]
        target["id"] = sid(prov, note)

    hits = with_code(run("F3", mutate), "NOTEHEAD_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)


def test_compare_scores_note_id_absent_from_provenance_is_reported_unmapped() -> None:
    """A note that carries a lyric and a slur loses its id: both spans and lyrics become unmapped."""
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        note = next(
            n for n in layer_notes(root, "1", "1") if n.find(M + "verse/" + M + "syl") is not None
        )
        target["id"] = sid(prov, note)
        del prov[note.get(XML_ID)]  # type: ignore[arg-type]
        note.set(XML_ID, "rogue-id")

    diffs = run("F1", mutate)
    unmapped = [d for d in diffs if "unmapped:" in d.detail]
    assert unmapped
    assert any(
        d.code == "LYRIC_TEXT_MISMATCH" or d.code == "LYRIC_ANCHOR_MISMATCH" for d in unmapped
    )
    assert any(d.code == "SLUR_MISMATCH" for d in unmapped)


def test_compare_scores_bare_note_id_absent_from_provenance_is_reported() -> None:
    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        note = next(
            n
            for n in layer_notes(root, "1", "2")
            if is_attack(n) and n.get("next") is None and n.get("tie") is None
        )
        note.set(XML_ID, "rogue-id")

    diffs = run("F1", mutate)
    assert [d for d in diffs if "unmapped converted event" in d.detail and d.layer_key == "1.2"]
    assert {d.code for d in diffs} == {"RENDER_EVENT_MISSING"}
    assert len(diffs) == 2  # the unmapped converted event, and its source event with no counterpart


# --- split normalisation --------------------------------------------------------------------


def _chain_middle(root: etree._Element) -> etree._Element:
    return next(
        n
        for n in layer_notes(root, "1", "2")
        if n.get("type") == SPLIT and n.get("dur") == "2" and n.get("next") is not None
    )


def test_compare_scores_resplit_sustain_into_two_continuations_is_equivalent() -> None:
    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        mid = _chain_middle(root)  # dur 1/2, between a head and a tail
        mid_id = mid.get(XML_ID)
        tail = by_id(root, mid.get("next").removeprefix("#"))  # type: ignore[union-attr]
        first, second = (
            etree.Element(mid.tag, dict(mid.attrib)),
            etree.Element(mid.tag, dict(mid.attrib)),
        )
        for frag, new_id in ((first, mid_id + "a"), (second, mid_id + "b")):  # type: ignore[operator]
            frag.set("dur", "4")
            frag.set(XML_ID, new_id)
            prov[new_id] = prov[mid_id]  # type: ignore[index]
        first.set("next", "#" + second.get(XML_ID))  # type: ignore[operator]
        second.set("prev", "#" + first.get(XML_ID))  # type: ignore[operator]
        mid.addprevious(first)
        mid.addprevious(second)
        mid.getparent().remove(mid)
        head = by_id(root, mid.get("prev").removeprefix("#"))  # type: ignore[union-attr]
        head.set("next", "#" + first.get(XML_ID))  # type: ignore[operator]
        tail.set("prev", "#" + second.get(XML_ID))  # type: ignore[operator]

    assert run("F1", mutate) == []


def test_compare_scores_continuation_leaving_a_gap_is_reported() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        mid = _chain_middle(root)
        mid.set("dur", "4")  # half becomes quarter: the next fragment starts later than this ends
        target["id"] = sid(prov, mid)

    diffs = run("F1", mutate)
    assert diffs
    assert any(target["id"] in d.source_event_ids for d in diffs)
    assert {d.code for d in diffs} & {"DURATION_MISMATCH", "ATTACK_MISMATCH"}


def test_compare_scores_continuation_overlapping_its_successor_is_reported() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        mid = _chain_middle(root)
        mid.set("dur", "1")  # half becomes whole: it now runs past the next fragment's start
        target["id"] = sid(prov, mid)

    diffs = run("F1", mutate)
    assert diffs
    assert any(target["id"] in d.source_event_ids for d in diffs)
    assert {d.code for d in diffs} & {"DURATION_MISMATCH", "ONSET_MISMATCH", "ATTACK_MISMATCH"}


# --- A5e: scaled accompaniment sustains --------------------------------------------------------


def _first_fragment_in_tuplet(root: etree._Element) -> etree._Element:
    """A split first fragment of a scaled sustain: written head kept, length given by a hidden tuplet."""
    return next(
        n
        for n in root.iter(M + "note")
        if n.get("next") and n.get("type") != SPLIT and n.getparent().tag == M + "tuplet" and n.get("dur") == "2"
    )


def test_compare_scores_scaled_first_fragment_without_its_tuplet_reports_duration_mismatch() -> None:
    target: dict[str, str] = {}

    def mutate(root: etree._Element, prov: dict[str, str]) -> None:
        note = _first_fragment_in_tuplet(root)
        tuplet = note.getparent()
        target["id"] = sid(prov, note)
        if len(tuplet) == 1:
            tuplet.addprevious(note)
            tuplet.getparent().remove(tuplet)
        else:  # shared wrapper: give the note its own unscaled position
            tuplet.addprevious(note)

    hits = with_code(run("F1", mutate), "DURATION_MISMATCH")
    assert any(target["id"] in d.source_event_ids for d in hits)
