"""Card A3c: the deterministic MEI encoder, run over the five pilot fixtures without LilyPond."""

from __future__ import annotations

import json
import shutil
import subprocess
from collections import Counter
from fractions import Fraction
from functools import cache
from pathlib import Path

import pytest
from lxml import etree

from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation
from pipeline.typeset.mei.encode import encode_score
from pipeline.typeset.mei.extract import ir_from_rows, parse_rows
from pipeline.typeset.mei.model import (
    Boundary,
    ConversionProfile,
    EncodedScore,
    Event,
    LayerDef,
    NotatedDuration,
    Pitch,
    ScoreIR,
    StaffDef,
    rational_to_str,
)
from pipeline.typeset.mei.schema import load_schema_bundle, validate_schema

ROOT = Path(__file__).resolve().parents[1]
EXTRACTION = ROOT / "tests/fixtures/mei/extraction"
PROFILE = ROOT / "data/typeset/mei/profiles/accompaniment-v1.json"
NS = {"m": "http://www.music-encoding.org/ns/mei"}
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
PILOTS = {
    "F1": ("kyrie_IX.tsv", "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"),
    "F2": ("al_ego_dilecto.csv.tsv", "data/typeset/src/vol-3/al_ego_dilecto.csv.ly"),
    "F3": ("agnus_XI.tsv", "data/typeset/src/vol-5/missa-xi/agnus_XI.ly"),
    "F4": ("ite_Ib.tsv", "data/typeset/src/vol-5/missa-i/ite_Ib.ly"),
    "F5": ("co_inclina_aurem_tuam.csv.tsv", "data/typeset/src/vol-2/co_inclina_aurem_tuam.csv.ly"),
}


@cache
def profile() -> ConversionProfile:
    return ConversionProfile.load(PROFILE)


@cache
def ir_for(tsv: str) -> ScoreIR:
    source = dict(PILOTS.values())[tsv]
    return ir_from_rows(parse_rows((EXTRACTION / tsv).read_text(encoding="utf-8")), source, "0" * 64)


@cache
def encoded(tsv: str) -> EncodedScore:
    return encode_score(ir_for(tsv), profile())


def tree(tsv: str) -> etree._Element:
    return etree.fromstring(encoded(tsv).xml)


def q(root: etree._Element, path: str) -> list[etree._Element]:
    return root.xpath(path, namespaces=NS)


def dur_of(element: etree._Element) -> Fraction:
    """Sounding duration of a note, rest or space, from the MEI alone (tuplet ratio applied)."""
    value = Fraction(1, int(element.get("dur", "1")))
    dots = int(element.get("dots", "0"))
    value *= 2 - Fraction(1, 2**dots)
    parent = element.getparent()
    if parent is not None and parent.tag.endswith("}tuplet"):
        value *= Fraction(int(parent.get("numbase")), int(parent.get("num")))
    return value


def layer_total(layer_events: list[etree._Element]) -> Fraction:
    return sum((dur_of(e) for e in layer_events), Fraction(0))


def mei_ids(tsv: str) -> dict[str, str]:
    return encoded(tsv).provenance


# --- F1-F5 ------------------------------------------------------------------------------------


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_validates_against_pinned_schema(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    assert validate_schema(encoded(tsv).xml, load_schema_bundle()) == []


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_two_encodings_are_byte_identical(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    a = encode_score(ir_for(tsv), profile())
    b = encode_score(ir_for(tsv), profile())
    assert a.xml == b.xml
    assert a == b
    assert len(a.artifact_sha256) == 64


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_measures_have_ids_and_no_meter(fixture: str) -> None:
    root = tree(PILOTS[fixture][0])
    measures = q(root, "//m:measure")
    assert [m.get(XML_ID) for m in measures] == [f"m{i:03d}" for i in range(1, len(measures) + 1)]
    assert all(m.get("metcon") == "false" for m in measures)
    assert q(root, "//m:meterSig | //m:staffDef[@meter.count or @meter.unit or @meter.sym]") == []
    assert q(root, "//m:scoreDef[@meter.count or @meter.unit or @meter.sym]") == []
    assert root.get("meiversion") == "5.0"


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_every_event_has_one_mei_element(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    root = tree(tsv)
    elements = q(root, "//m:note | //m:rest | //m:space")
    originals = [e for e in elements if e.get("type") != "split-continuation"]
    assert len(originals) == len(ir.events)
    by_id = {e.get(XML_ID): e for e in elements}
    assert set(by_id) == set(encoded(tsv).provenance)
    assert sorted(v for k, v in encoded(tsv).provenance.items() if k in {o.get(XML_ID) for o in originals}) == sorted(
        e.id for e in ir.events
    )


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_layer_totals_match_the_ir(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    root = tree(tsv)
    expected: Counter[str] = Counter()
    for event in ir.events:
        expected[event.layer_id] += event.duration  # type: ignore[assignment]
    per_layer: dict[tuple[str, str], list[etree._Element]] = {}
    for staff in q(root, "//m:measure/m:staff"):
        for layer in q(staff, "m:layer"):
            per_layer.setdefault((staff.get("n"), layer.get("n")), []).extend(
                q(layer, ".//m:note | .//m:rest | .//m:space")
            )
    totals = sorted(layer_total(v) for v in per_layer.values())
    assert totals == sorted(expected.values())


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_boundaries_map_to_measures_ending_there(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    result = encoded(tsv)
    root = tree(tsv)
    measure_ids = [m.get(XML_ID) for m in q(root, "//m:measure")]
    safe = [b for b in ir.boundaries if b.safe]
    assert len(result.boundaries) == len(safe)
    for boundary, entry in zip(safe, result.boundaries, strict=True):
        assert entry.boundary_id == boundary.id
        assert entry.onset == rational_to_str(boundary.onset)
        assert entry.after_text == boundary.after_text
        assert (entry.safe, entry.source_break, entry.division) == (
            boundary.safe,
            boundary.source_break,
            boundary.division,
        )
        assert entry.measure_id in measure_ids
    ends = {entry.measure_id for entry in result.boundaries}
    assert len(ends) == len(result.boundaries)


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_division_barlines_follow_the_profile(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    result = encoded(tsv)
    root = tree(tsv)
    right = {m.get(XML_ID): m.get("right") for m in q(root, "//m:measure")}
    for entry in result.boundaries:
        expected = {"finalis": "dbl", "maxima": "single"}.get(entry.division or "", "invis")
        assert right[entry.measure_id] == expected
    # Unsafe boundaries have no barline; the fixtures have no finalis/maxima there.
    ir = ir_for(tsv)
    assert not [b for b in ir.boundaries if not b.safe and b.division in ("finalis", "maxima")]
    assert not [d for d in result.diagnostics if dict(d.details)["code"] == "division-inside-measure"]
    caesuras = Counter(c.get("glyph.num") for c in q(root, "//m:caesura"))
    want = Counter(
        {"minima": "U+E8F3", "maior": "U+E8F4"}[b.division]
        for b in ir.boundaries
        if b.division in ("minima", "maior")
    )
    assert caesuras == want


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_feature_decisions_count_every_family(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    decisions = {d.family: d for d in encoded(tsv).feature_decisions}
    assert list(decisions) == [r.family for r in profile().rules]
    for family, decision in decisions.items():
        assert decision.occurrences == sum(1 for u in ir.features if u.family == family)
        assert decision.status == next(r.status for r in profile().rules if r.family == family)


def test_encode_score_pilot_has_no_diagnostics() -> None:
    for fixture in PILOTS.values():
        assert encoded(fixture[0]).diagnostics == ()


# --- Kyrie IX (F1) -----------------------------------------------------------------------------

KYRIE = "kyrie_IX.tsv"


def test_encode_score_kyrie_counts_notes_and_spaces() -> None:
    root = tree(KYRIE)
    assert len(q(root, "//m:note[not(@type='split-continuation')]")) == 358
    assert len(q(root, "//m:space[not(@type='split-continuation')]")) == 5
    assert q(root, "//m:rest") == []


def test_encode_score_kyrie_mei_ids_are_derived_from_ir_event_ids() -> None:
    ir = ir_for(KYRIE)
    ids = mei_ids(KYRIE)
    # IR ids such as "0e0000" start with a digit, so they are not NCNames and cannot be an xml:id.
    originals = {k: v for k, v in ids.items() if "c" not in k[2:]}
    assert originals == {f"ev{e.id}": e.id for e in ir.events}
    assert all(f"ev{v}" == k or k.startswith(f"ev{v}c") for k, v in ids.items())
    root = tree(KYRIE)
    assert {n.get(XML_ID) for n in q(root, "//m:note[not(@type='split-continuation')]")} == {f"ev{e.id}" for e in ir.events if e.kind == "note"}


def test_encode_score_kyrie_lyrics_are_above_with_word_positions() -> None:
    root = tree(KYRIE)
    verses = q(root, "//m:verse")
    assert verses and all(v.get("place") == "above" and v.get("n") == "1" for v in verses)
    ir = ir_for(KYRIE)
    non_blank = [s for s in ir.lyrics if s.text]
    syls = q(root, "//m:syl")
    # Blank syllables carrying an entry marker keep an empty <syl/>; all others are text only.
    assert [s.text for s in syls if s.text] == [s.text for s in non_blank]
    assert sum(1 for s in syls if not s.text) == 2
    first = syls[0]
    assert (first.text, first.get("wordpos"), first.get("con")) == ("Ky", "i", "d")
    assert (syls[1].text, syls[1].get("wordpos")) == ("ri", "m")
    assert (syls[2].text, syls[2].get("wordpos"), syls[2].get("con")) == ("e", "t", None)
    assert {s.get("wordpos") for s in syls} <= {None, "i", "m", "t"}


def test_encode_score_kyrie_entry_markers_are_labels_in_their_verse() -> None:
    root = tree(KYRIE)
    labels = q(root, "//m:verse/m:label")
    assert [label.text for label in labels] == ["*", "*", "**"]


def test_encode_score_kyrie_source_breaks_follow_the_measures_of_the_boundaries() -> None:
    result = encoded(KYRIE)
    root = tree(KYRIE)
    breaks = q(root, "//m:section/m:sb")
    assert len(breaks) == 5
    expected = {
        entry.measure_id
        for entry in result.boundaries
        if entry.onset in {rational_to_str(Fraction(x)) for x in ("7", "109/8", "85/4", "233/8", "38")}
    }
    assert len(expected) == 5
    preceding = {sb.getprevious().get(XML_ID) for sb in breaks}
    assert preceding == expected
    assert all(sb.getprevious().tag.endswith("}measure") for sb in breaks)


def test_encode_score_kyrie_tuplets_are_hidden_and_totals_exact() -> None:
    root = tree(KYRIE)
    tuplets = q(root, "//m:tuplet")
    assert tuplets
    assert all(t.get("num.visible") == "false" and t.get("bracket.visible") == "false" for t in tuplets)
    for staff in ("1", "2"):
        layers = {layer.get("n") for layer in q(root, f"//m:measure/m:staff[@n='{staff}']/m:layer")}
        for n in layers:
            events = q(root, f"//m:measure/m:staff[@n='{staff}']/m:layer[@n='{n}']//*[self::m:note or self::m:rest or self::m:space]")
            assert layer_total(events) == Fraction(373, 8)


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_measures_are_cut_only_at_safe_boundaries(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    ends = {b.onset for b in ir.boundaries if b.safe} | {ir.total_duration}
    assert len(q(tree(tsv), "//m:measure")) == len(ends)
    assert all(entry.safe for entry in encoded(tsv).boundaries)


def test_encode_score_kyrie_staff_defs_carry_clef_and_key_only() -> None:
    root = tree(KYRIE)
    staff_defs = q(root, "//m:staffGrp/m:staffDef")
    assert [(d.get("n"), d.get("clef.shape"), d.get("clef.line"), d.get("keysig"), d.get("lines")) for d in staff_defs] == [
        ("1", "G", "2", "1s", "5"),
        ("2", "F", "4", "1s", "5"),
    ]
    grp = q(root, "//m:staffGrp")[0]
    assert (grp.get("symbol"), grp.get("bar.thru")) == ("brace", "true")


def test_encode_score_kyrie_ties_and_slurs_follow_the_ir() -> None:
    ir = ir_for(KYRIE)
    root = tree(KYRIE)
    ties = Counter(n.get("tie") for n in q(root, "//m:note[@tie]"))
    assert ties["i"] == ties["t"]
    assert sum(1 for e in ir.events if e.tie_to_next) == ties["i"] + ties["m"]
    slurs = q(root, "//m:slur")
    assert len(slurs) == sum(1 for s in ir.spans if s.kind == "slur") == 59
    for slur in slurs:
        assert slur.get("startid", "").startswith("#ev") and slur.get("endid", "").startswith("#ev")
        assert slur.get(XML_ID)


# --- agnus_XI (F3): cross-staff, voice-line glissandi, printed accidentals --------------------


def test_encode_score_agnus_xi_cross_staff_notes_carry_staff() -> None:
    root = tree("agnus_XI.tsv")
    cross = q(root, "//m:note[@staff][not(@type='split-continuation')]")
    assert len(cross) >= 3
    for note in cross:
        home = note.xpath("ancestor::m:staff/@n", namespaces=NS)[0]
        assert note.get("staff") != home
    assert len(cross) == 3
    assert len(q(root, "//m:space[@staff][not(@type='split-continuation')]")) == 2


def test_encode_score_agnus_xi_voice_line_glissandi_are_dotted_between_hidden_notes() -> None:
    root = tree("agnus_XI.tsv")
    glisses = q(root, "//m:gliss")
    assert len(glisses) == 3
    assert all(g.get("lform") == "dotted" and g.get(XML_ID) for g in glisses)
    hidden = {n.get(XML_ID): n for n in q(root, "//m:note[@visible='false']")}
    assert len(hidden) == 6
    for g in glisses:
        assert g.get("startid")[1:] in hidden and g.get("endid")[1:] in hidden
    layer_ids = {n.xpath("ancestor::m:layer/@n", namespaces=NS)[0] for n in hidden.values()}
    assert layer_ids == {"3"}


def test_encode_score_agnus_xi_printed_naturals_write_accid_and_hidden_rests_are_spaces() -> None:
    root = tree("agnus_XI.tsv")
    assert sum(1 for n in q(root, "//m:note") if n.get("accid") == "n") == 3
    assert q(root, "//m:rest") == []
    assert len(q(root, "//m:space[not(@type='split-continuation')]")) == 11


# --- ite_Ib (F4): quilisma -----------------------------------------------------------------


def test_encode_score_ite_ib_quilisma_is_a_mordent_over_a_hidden_notehead() -> None:
    root = tree("ite_Ib.tsv")
    mordents = q(root, "//m:mordent")
    assert len(mordents) == 1
    assert mordents[0].get("form") == "upper"
    target = mordents[0].get("startid")[1:]
    note = q(root, f"//m:note[@xml:id='{target}']")[0]
    assert note.get("head.visible") == "false"
    ir = ir_for("ite_Ib.tsv")
    quil = next(e for e in ir.events if e.notehead == "quilisma")
    assert target == f"ev{quil.id}"


# --- diagnostics ---------------------------------------------------------------------------


def test_encode_score_unsupported_family_emits_unsupported_feature_with_location() -> None:
    ir = ir_for("ite_Ib.tsv")
    base = profile()
    rules = tuple(
        type(r)(r.family, "unsupported", r.mei) if r.family == "quilisma" else r for r in base.rules
    )
    unsupported = ConversionProfile(
        id=base.id,
        version=base.version,
        mei_version=base.mei_version,
        lyric_place=base.lyric_place,
        container_policy=base.container_policy,
        rules=rules,
    )
    result = encode_score(ir, unsupported)
    hits = [d for d in result.diagnostics if dict(d.details).get("family") == "quilisma"]
    assert len(hits) == 1
    assert hits[0].code == "UNSUPPORTED_FEATURE" and hits[0].severity == "error"
    use = next(u for u in ir.features if u.family == "quilisma")
    assert hits[0].source_location == use.location
    assert hits[0].event_ids == use.event_ids
    decision = next(d for d in result.feature_decisions if d.family == "quilisma")
    assert (decision.status, decision.occurrences) == ("unsupported", 1)


def test_encode_score_supported_profile_has_no_unsupported_family_diagnostics() -> None:
    for fixture in PILOTS.values():
        assert not [d for d in encoded(fixture[0]).diagnostics if "family" in dict(d.details)]


def test_encode_score_diagnostics_are_diagnostic_instances() -> None:
    assert all(isinstance(d, Diagnostic) for d in encoded(KYRIE).diagnostics)


# --- Verovio render check ----------------------------------------------------------------------

WEB = ROOT / "web"
RENDER_JS = """
import { readFileSync } from 'node:fs';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
const mei = readFileSync(process.argv[process.argv.length - 1], 'utf8');
const toolkit = new VerovioToolkit(await createVerovioModule());
toolkit.setOptions({ scale: 100, pageWidth: 2100, pageHeight: 60000, unit: 9, breaks: 'auto',
  xmlIdChecksum: true, header: 'none', footer: 'none', svgViewBox: true, justifyVertically: false });
const loaded = toolkit.loadData(mei);
const ids = []; let text = '';
if (loaded) {
  for (let p = 1; p <= toolkit.getPageCount(); p++) {
    const svg = toolkit.renderToSVG(p);
    text += svg;
    for (const tag of svg.matchAll(/<g\\b[^>]*>/g)) {
      const cls = /class="([^"]*)"/.exec(tag[0]); const id = /\\bid="([^"]*)"/.exec(tag[0]);
      if (cls && id && cls[1].split(' ').includes('note')) ids.push(id[1]);
    }
  }
}
const groups = [...text.matchAll(/<g\\b[^>]*class="note split-continuation"[^>]*?(\\/>|>[\\s\\S]*?<\\/g>)/g)];
console.log(JSON.stringify({ loaded: Boolean(loaded), pages: toolkit.getPageCount(), ids,
  labels: (text.match(/>\\*\\*?</g) || []).length,
  continuations: groups.length, continuationsWithGlyphs: groups.filter((g) => /<use|<path|<text/.test(g[0])).length,
  splitTies: (text.match(/class="tie split-tie/g) || []).length,
  ties: (text.match(/class="tie"/g) || []).length }));
"""


def _render(tmp_path: Path, tsv: str) -> dict[str, object]:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    if not (WEB / "node_modules/verovio").is_dir():
        pytest.skip("web/node_modules/verovio is missing (run pnpm install in web/)")
    mei = tmp_path / "score.mei"
    mei.write_bytes(encoded(tsv).xml)
    # Run from web/ so that the bare specifiers resolve against web/node_modules.
    done = subprocess.run(
        [node, "--input-type=module", "-e", RENDER_JS, str(mei)],
        cwd=WEB,
        capture_output=True,
        text=True,
        timeout=240,
        check=False,
    )
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout.strip().splitlines()[-1])


def test_encode_score_kyrie_loads_and_renders_every_note_in_verovio(tmp_path: Path) -> None:
    result = _render(tmp_path, KYRIE)
    assert result["loaded"] is True
    ir = ir_for(KYRIE)
    expected = {f"ev{e.id}" for e in ir.events if e.kind == "note"}
    assert expected <= set(result["ids"])  # type: ignore[arg-type]
    assert len(expected) == 358


# --- card A3d: splitting events at measure lines ---------------------------------------------------


def _synthetic_ir(*, chant_second_layer: bool = False) -> ScoreIR:
    """Two layers on one staff: a 7/8 sustain over two notes of 3/8 and 1/2, with a safe boundary at 3/8."""
    loc = SourceLocation("x.ly", 1, 1)

    def note(eid: str, layer: str, onset: Fraction, dur: Fraction, log: int, dots: int) -> Event:
        return Event(eid, layer, "up", "note", onset, dur, NotatedDuration(log, dots, Fraction(1)),
                     Pitch("c", Fraction(0), 4), "none", "normal", False, False, loc)

    events = (
        note("0e0000", "up:#1", Fraction(0), Fraction(7, 8), 1, 2),
        note("1e0000", "up:#2", Fraction(0), Fraction(3, 8), 2, 1),
        note("1e0001", "up:#2", Fraction(3, 8), Fraction(1, 2), 1, 0),
    )
    layers = (
        LayerDef("up:#1", "up", 0, "voiceOne", "chant" if chant_second_layer else "accompaniment"),
        LayerDef("up:#2", "up", 1, "voiceTwo", "accompaniment"),
    )
    boundary = Boundary("b000", Fraction(3, 8), False, None, None, True, None)
    return ScoreIR(1, "x/synthetic.ly", "0" * 64, "2.26.0", "t", Fraction(7, 8),
                   (StaffDef("up", 1, "G", 2, 0),), layers, events, (), (), (), (), (boundary,), (), ())


def test_encode_score_sustain_split_keeps_one_attack_and_the_total() -> None:
    result = encode_score(_synthetic_ir(), profile())
    root = etree.fromstring(result.xml)
    layer1 = q(root, "//m:staff/m:layer[@n='1']/m:note")
    assert [n.get(XML_ID) for n in layer1] == ["ev0e0000", "ev0e0000c1"]
    first, cont = layer1
    assert (first.get("dur"), first.get("dots")) == ("4", "1")  # 3/8
    assert (cont.get("dur"), cont.get("dots")) == ("2", None)  # 1/2
    assert first.get("type") is None and first.get("head.visible") is None
    assert cont.get("type") == "split-continuation"
    assert cont.get("head.visible") == "false" and cont.get("stem.visible") == "false"
    assert cont.get("accid") is None
    assert first.get("next") == "#ev0e0000c1" and cont.get("prev") == "#ev0e0000"
    assert q(root, "//m:tie") == [] and first.get("tie") is None and cont.get("tie") is None
    assert sum(dur_of(n) for n in layer1) == Fraction(7, 8)
    assert result.provenance == {
        "ev0e0000": "0e0000", "ev0e0000c1": "0e0000", "ev1e0000": "1e0000", "ev1e0001": "1e0001"
    }
    assert [e.measure_id for e in result.boundaries] == ["m001"]
    assert result.diagnostics == ()
    assert validate_schema(result.xml, load_schema_bundle()) == []


def test_encode_score_chant_event_crossing_a_boundary_is_unsafe_and_dropped() -> None:
    result = encode_score(_synthetic_ir(chant_second_layer=True), profile())
    assert [d.code for d in result.diagnostics] == ["UNSAFE_BOUNDARY"]
    assert result.diagnostics[0].event_ids == ("0e0000",)
    assert result.boundaries == ()
    root = etree.fromstring(result.xml)
    assert len(q(root, "//m:measure")) == 1
    assert q(root, "//*[@type='split-continuation']") == []


EXPECTED_SPLITS: dict[str, tuple[int, int]] = {
    "F1": (75, 81),
    "F2": (58, 69),
    "F3": (17, 62),
    "F4": (9, 9),
    "F5": (12, 12),
}


def _split_events(tsv: str) -> tuple[int, int]:
    root = tree(tsv)
    continuations = q(root, "//*[@type='split-continuation']")
    split = {encoded(tsv).provenance[c.get(XML_ID)] for c in continuations}
    return len(split), len(continuations)


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_continuations_map_back_and_sum_exactly(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    result = encoded(tsv)
    root = tree(tsv)
    safe_onsets = sorted({b.onset for b in ir.boundaries if b.safe})
    expected_pieces = 0
    for event in ir.events:
        end = event.onset + event.duration
        expected_pieces += sum(1 for o in safe_onsets if event.onset < o < end)
    split, continuations = _split_events(tsv)
    assert continuations == expected_pieces and split > 0
    by_event: dict[str, Fraction] = {}
    for element in q(root, "//m:note | //m:space | //m:rest"):
        by_event[result.provenance[element.get(XML_ID)]] = by_event.get(result.provenance[element.get(XML_ID)], Fraction(0)) + dur_of(element)
    assert by_event == {e.id: e.duration for e in ir.events}
    for c in q(root, "//*[@type='split-continuation']"):
        assert c.get(XML_ID).split("c")[0] in result.provenance
        assert c.get("tie") in (None, "i")  # only the real outgoing tie of the last fragment


def test_encode_score_split_counts_per_fixture_are_stable() -> None:
    counts = {k: _split_events(v[0]) for k, v in PILOTS.items()}
    # (events split, continuation fragments)
    assert counts == EXPECTED_SPLITS


def test_encode_score_continuation_keeps_sounding_pitch_without_a_written_accidental() -> None:
    ir = ir_for("agnus_XI.tsv")
    root = tree("agnus_XI.tsv")
    printed = {f"ev{e.id}" for e in ir.events if e.printed_accidental != "none"}
    for continuation in q(root, "//m:note[@type='split-continuation']"):
        assert continuation.get("accid") is None
    assert printed  # the first fragments keep their written accidental
    assert all(q(root, f"//m:note[@xml:id='{i}']")[0].get("accid") for i in printed)


def test_encode_score_kyrie_renders_continuations_without_noteheads_or_ties(tmp_path: Path) -> None:
    result = _render(tmp_path, KYRIE)
    ids = set(result["ids"])  # type: ignore[arg-type]
    ir = ir_for(KYRIE)
    assert {f"ev{e.id}" for e in ir.events if e.kind == "note"} <= ids
    assert result["continuations"] == len(q(tree(KYRIE), "//m:note[@type='split-continuation']"))
    assert result["continuationsWithGlyphs"] == 0
    assert result["splitTies"] == 0
    # Only the score's own ties are drawn (spanning pieces aside).
    assert result["ties"] == sum(1 for e in ir.events if e.tie_to_next)


@pytest.mark.parametrize("fixture", sorted(PILOTS))
def test_encode_score_pilot_last_measure_carries_the_final_division(fixture: str) -> None:
    tsv = PILOTS[fixture][0]
    ir = ir_for(tsv)
    assert any(d.kind == "finalis" and d.onset == ir.total_duration for d in ir.divisions)
    assert q(tree(tsv), "//m:measure")[-1].get("right") == "dbl"
