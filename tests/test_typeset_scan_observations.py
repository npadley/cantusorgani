"""Scan candidates must stay independent and uncertain; reviews are hash-bound."""
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from pipeline.typeset.scan_observations import (
    ScanSettings,
    load_reviewed_observations,
    observe_system,
)


def staff_fixture():
    image = np.full((200, 400), 255, np.uint8)
    for top in (40, 120):
        for y in range(top, top + 41, 10):
            cv2.line(image, (10, y), (390, y), 0, 1)
    cv2.ellipse(image, (80, 75), (7, 3), -15, 0, 360, 0, -1)
    cv2.ellipse(image, (140, 145), (7, 3), -15, 0, 360, 0, 1)
    return image


def test_observe_system_detects_heads_without_expected_score_or_voice_claims():
    evidence = observe_system(staff_fixture(), ScanSettings())
    assert len(evidence.staves) == 2
    assert any(abs(c.x - 80) < 6 and abs(c.y - 75) < 4 for c in evidence.candidates)
    assert any(abs(c.x - 140) < 6 and abs(c.y - 145) < 4 for c in evidence.candidates)
    assert evidence.events == []
    assert "voice" in " ".join(evidence.flags)
    assert not evidence.complete


def test_observe_system_empty_missing_staves_and_faint_print_abstain():
    assert observe_system(np.full((100, 200), 255, np.uint8), ScanSettings()).flags
    image = staff_fixture()
    image[115:] = 255
    assert len(observe_system(image, ScanSettings()).staves) < 2
    assert not observe_system(np.maximum(staff_fixture(), 230), ScanSettings()).complete


def review_document():
    return {"schema_version": 1, "scan_hash": "a" * 64, "reviewer": "fixture-reader",
            "basis": "source-scan", "complete": True, "systems": ["noh4/0247/000"],
            "events": [{"voice": "alto", "kind": "note", "step": 0,
                        "alteration": "0", "onset": "0", "duration": "1/2",
                        "tie_in": False, "tie_out": False,
                        "box": [10, 20, 20, 30], "system": "noh4/0247/000"}]}


def test_load_reviewed_observations_keeps_provenance_and_exact_fractions(tmp_path):
    path = tmp_path / "observations.json"
    path.write_text(json.dumps(review_document()))
    evidence = load_reviewed_observations(path, "a" * 64)
    assert evidence.events[0].duration.numerator == 1
    assert evidence.events[0].duration.denominator == 2
    assert evidence.reviewer == "fixture-reader"
    assert evidence.complete


@pytest.mark.parametrize("change", [
    {"scan_hash": "b" * 64}, {"reviewer": ""}, {"basis": "typeset"},
    {"events": []}, {"schema_version": 2}, {"complete": "yes"},
])
def test_load_reviewed_observations_rejects_stale_or_untrusted_evidence(tmp_path, change):
    path = tmp_path / "observations.json"
    path.write_text(json.dumps(review_document() | change))
    with pytest.raises(ValueError):
        load_reviewed_observations(path, "a" * 64)


def test_partial_review_cannot_claim_unobserved_timing_or_voice(tmp_path):
    document = review_document()
    document["complete"] = False
    document["events"][0].pop("duration")
    path = tmp_path / "partial.json"
    path.write_text(json.dumps(document))
    evidence = load_reviewed_observations(path, "a" * 64)
    assert evidence.events[0].duration is None
    assert not evidence.complete


def test_real_calibration_open_heads_survive_staff_line_removal_without_voice_claims():
    image = cv2.imread(str(Path("tests/fixtures/accompaniment/noh5-0099-000.png")), 0)
    result = observe_system(image, ScanSettings())
    assert any(c.style == "open" and abs(c.x - 612) < 8 and abs(c.y - 328) < 8
               for c in result.candidates)
    assert not result.complete and result.events == []
