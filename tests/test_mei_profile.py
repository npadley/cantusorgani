"""Tests for ConversionProfile.load and the checked-in accompaniment-v1 profile."""
import copy
import json
from pathlib import Path

import pytest

from pipeline.typeset.mei.model import FEATURE_FAMILIES, ConversionProfile

REPO_ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = REPO_ROOT / "data" / "typeset" / "mei" / "profiles" / "accompaniment-v1.json"


def _load_raw() -> dict:
    return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))


def _write_variant(tmp_path: Path, mutate) -> Path:
    raw = copy.deepcopy(_load_raw())
    mutate(raw)
    path = tmp_path / "accompaniment-v1.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    return path


def test_load_checked_in_profile_returns_22_rules_in_family_order():
    profile = ConversionProfile.load(PROFILE_PATH)

    assert profile.id == "accompaniment-v1"
    assert profile.version == 1
    assert profile.mei_version == "5.0"
    assert profile.lyric_place == "above"
    assert profile.container_policy == "common-onset"
    assert isinstance(profile.rules, tuple)
    assert len(profile.rules) == 22
    assert tuple(rule.family for rule in profile.rules) == FEATURE_FAMILIES


def test_load_checked_in_profile_marks_engraving_only_families():
    profile = ConversionProfile.load(PROFILE_PATH)
    status = {rule.family: rule.status for rule in profile.rules}

    assert status["divisio-maior"] == "engraving-only"
    assert status["note-shift"] == "engraving-only"
    assert status["manual-spacing"] == "engraving-only"
    engraving_only = {family for family, s in status.items() if s == "engraving-only"}
    assert engraving_only == {"divisio-maior", "note-shift", "manual-spacing"}


def test_load_missing_family_raises_value_error(tmp_path):
    path = _write_variant(tmp_path, lambda raw: raw["rules"].pop(3))

    with pytest.raises(ValueError, match="missing"):
        ConversionProfile.load(path)


def test_load_duplicate_family_raises_value_error(tmp_path):
    path = _write_variant(tmp_path, lambda raw: raw["rules"].append(copy.deepcopy(raw["rules"][0])))

    with pytest.raises(ValueError, match="duplicate"):
        ConversionProfile.load(path)


def test_load_invalid_status_raises_value_error(tmp_path):
    def mutate(raw):
        raw["rules"][0]["status"] = "maybe"

    path = _write_variant(tmp_path, mutate)

    with pytest.raises(ValueError, match="status"):
        ConversionProfile.load(path)


def test_load_wrong_mei_version_raises_value_error(tmp_path):
    def mutate(raw):
        raw["meiVersion"] = "4.0.1"

    path = _write_variant(tmp_path, mutate)

    with pytest.raises(ValueError, match="meiVersion"):
        ConversionProfile.load(path)
