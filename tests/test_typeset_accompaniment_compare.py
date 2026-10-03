"""Independent scan readings must catch lower-voice errors, not certify subsets."""
import json
from dataclasses import replace
from fractions import Fraction as F
from pathlib import Path

import pytest

from pipeline.typeset.accompaniment_compare import compare_accompaniment
from pipeline.typeset.scan_observations import (
    ObservedEvent,
    ScanEvidence,
    load_reviewed_observations,
)
from pipeline.typeset.score_events import MusicalEvent, ScoreEvidence


def reference():
    score = ScoreEvidence(events=[
        MusicalEvent("alto", "note", F(0), F(1, 2), 2, F(0), "10:1"),
        MusicalEvent("tenor", "note", F(0), F(1, 2), -3, F(0), "20:1"),
        MusicalEvent("bass", "note", F(0), F(1, 2), -5, F(0), "30:1"),
    ])
    scan = ScanEvidence(events=[
        ObservedEvent("alto", "note", 2, F(0), F(0), F(1, 2), False, False,
                      (10, 10, 20, 20), "noh5/0099/000"),
        ObservedEvent("tenor", "note", -3, F(0), F(0), F(1, 2), False, False,
                      (10, 30, 20, 40), "noh5/0099/000"),
        ObservedEvent("bass", "note", -5, F(0), F(0), F(1, 2), False, False,
                      (10, 50, 20, 60), "noh5/0099/000"),
    ], complete=True, reviewer="independent-reader", systems=["noh5/0099/000"])
    return score, scan


def test_complete_independent_reading_agrees_with_all_required_properties():
    score, scan = reference()
    result = compare_accompaniment(score, scan)
    assert result.status == "agrees"
    assert all(v == "agrees" for v in result.properties.values())
    assert not result.full_proofread


@pytest.mark.parametrize(("field", "value", "property_name"), [
    ("step", 3, "pitch"), ("alteration", F(1, 2), "pitch"),
    ("duration", F(3, 4), "span"), ("onset", F(1, 4), "onset"),
    ("tie_out", True, "ties"), ("kind", "rest", "rests"),
])
def test_typeset_mutations_disagree_with_the_original_scan(field, value, property_name):
    score, scan = reference()
    score.events[0] = replace(score.events[0], **{field: value})
    result = compare_accompaniment(score, scan)
    assert result.status == "discrepancy"
    assert result.properties[property_name] == "differs"
    assert any(d["origin"] == "10:1" and d["box"] == (10, 10, 20, 20)
               for d in result.discrepancies)


def test_swapping_tenor_and_bass_cannot_hide_behind_equal_chord_pitches():
    score, scan = reference()
    score.events[1].voice, score.events[2].voice = "bass", "tenor"
    result = compare_accompaniment(score, scan)
    assert result.status == "discrepancy"
    assert result.properties["voice"] == "differs"


@pytest.mark.parametrize("extra_in_scan", [True, False])
def test_missing_and_extra_notes_or_truncated_endings_cannot_pass(extra_in_scan):
    score, scan = reference()
    if extra_in_scan:
        scan.events.append(replace(scan.events[0], onset=F(1, 2), step=3))
    else:
        score.events.append(replace(score.events[0], onset=F(1, 2), step=3))
    result = compare_accompaniment(score, scan)
    assert result.status == "discrepancy"
    assert result.properties["completeness"] == "differs"


def test_pitch_only_or_machine_candidates_never_establish_ground_truth():
    score, scan = reference()
    scan.events[0] = replace(scan.events[0], duration=None)
    scan.complete = False
    assert compare_accompaniment(score, scan).status == "needs-review"
    assert compare_accompaniment(score, ScanEvidence()).status == "needs-review"


def test_unknown_voice_and_failed_score_cannot_pass():
    score, scan = reference()
    scan.events[0] = replace(scan.events[0], voice=None)
    assert compare_accompaniment(score, scan).status != "agrees"


def test_partial_late_observation_uses_time_anchor_not_first_note():
    score, scan = reference()
    score.events.append(replace(score.events[0], onset=F(1, 2), step=4))
    scan.events = [replace(scan.events[0], onset=F(1, 2), step=4)]
    scan.complete = False
    result = compare_accompaniment(score, scan)
    assert result.status == "needs-review"
    assert result.discrepancies == []


def test_unanchored_partial_observation_never_becomes_a_false_wrong_note():
    score, scan = reference()
    scan.events = [replace(scan.events[0], onset=None, step=4)]
    scan.complete = False
    result = compare_accompaniment(score, scan)
    assert result.status == "needs-review"
    assert result.discrepancies == []


@pytest.mark.lilypond
@pytest.mark.parametrize("name", ["noh1-0033-004", "noh2-0044-002", "noh3-0412-002", "noh5-0099-000"])
def test_real_scan_readings_detect_each_voice_mutation_without_claiming_full_review(name):
    from pipeline.typeset.lilypond import LilyPondError, find
    from pipeline.typeset.score_events import read_score
    try:
        find()
    except LilyPondError:
        pytest.skip("pinned LilyPond not installed")
    path = Path("tests/fixtures/accompaniment") / (name + "-observations.json")
    document = json.loads(path.read_text())
    scan = load_reviewed_observations(path, document["scan_hash"])
    score = read_score(Path("data/typeset/src") / document["file"])
    baseline = compare_accompaniment(score, scan)
    assert baseline.discrepancies == []
    assert baseline.status == "needs-review"
    for observation in scan.events:
        expected = next(e for e in score.events if e.voice == observation.voice
                        and e.onset == observation.onset and e.kind == "note")
        original = expected.step
        expected.step += 1
        changed = compare_accompaniment(score, scan)
        assert changed.status == "discrepancy"
        assert any(d["voice"] == observation.voice and d["property"] == "pitch"
                   and d["system"] == observation.system for d in changed.discrepancies)
        expected.step = original
    score.flags.append("invalid tie")
    assert compare_accompaniment(score, scan).status != "agrees"
