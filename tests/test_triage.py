"""Triage tests.

Corrections arrive from strangers. Nothing here may trust them: the triage tool
revalidates every field against the same rules the Worker applies, and refuses
anything that would invent a piece or write an unexpected shape.
"""

import json
import re
from pathlib import Path

import pytest

from tools.triage.main import (
    FIELD_PATTERNS,
    RejectedCorrection,
    apply_correction,
    coerce,
    validate,
)

WORKER_SCHEMA = Path("workers/corrections/src/schema.ts")


def catalog() -> dict:
    return {
        "pieces": [
            {"id": "noh5-ordinarium-missae-i", "slug": "ordinarium-missae-i",
             "mode": "III", "title": "Missa Tempore Paschali",
             "printed_pages": [5, 10], "pdf_pages": [51, 56], "chant": []},
        ]
    }


def test_apply_updates_a_field_by_id():
    out = apply_correction(catalog(), "noh5-ordinarium-missae-i", "mode", "IV")
    assert out["pieces"][0]["mode"] == "IV"


def test_apply_updates_a_field_by_slug():
    out = apply_correction(catalog(), "ordinarium-missae-i", "mode", "VIII")
    assert out["pieces"][0]["mode"] == "VIII"


def test_apply_rejects_an_unknown_piece():
    """A correction naming a piece that does not exist is a bug or an attack,
    never a reason to create one."""
    with pytest.raises(KeyError):
        apply_correction(catalog(), "does-not-exist", "mode", "IV")


def test_apply_rejects_an_unknown_field():
    with pytest.raises(RejectedCorrection, match="unknown field"):
        apply_correction(catalog(), "ordinarium-missae-i", "systems", "x")


@pytest.mark.parametrize("value", [
    "<script>alert(1)</script>",
    "'; DROP TABLE corrections; --",
    "IX",          # not a valid mode
    "",
    "a" * 300,
])
def test_apply_rejects_bad_mode_values(value):
    with pytest.raises(RejectedCorrection):
        apply_correction(catalog(), "ordinarium-missae-i", "mode", value)


@pytest.mark.parametrize("field", ["title", "incipit", "chant"])
def test_markup_is_refused_in_free_text_fields(field):
    with pytest.raises(RejectedCorrection):
        validate(field, "<img src=x onerror=alert(1)>")


def test_printed_pages_becomes_a_pair_of_integers():
    out = apply_correction(catalog(), "ordinarium-missae-i", "printedPages", "5-11")
    assert out["pieces"][0]["printed_pages"] == [5, 11]


def test_backwards_page_range_is_refused():
    with pytest.raises(RejectedCorrection, match="backwards"):
        coerce("printedPages", "11-5")


def test_genre_is_constrained_to_the_controlled_set():
    validate("genre", "kyrie")
    with pytest.raises(RejectedCorrection):
        validate("genre", "motet")


def test_field_vocabulary_matches_the_worker():
    """The Worker and the triage tool must accept exactly the same fields.

    If they drift, a correction the endpoint accepts becomes one triage refuses,
    and it sits in the queue forever with no explanation.
    """
    source = WORKER_SCHEMA.read_text(encoding="utf-8")
    match = re.search(
        r"export const CORRECTABLE_FIELDS[^=]*=\s*\[(.*?)\]", source, re.DOTALL
    )
    assert match, "could not find CORRECTABLE_FIELDS in the Worker schema"
    worker_fields = set(re.findall(r'"([a-zA-Z]+)"', match.group(1)))
    assert worker_fields == set(FIELD_PATTERNS), (
        f"worker accepts {sorted(worker_fields)}, triage accepts "
        f"{sorted(FIELD_PATTERNS)}"
    )


def test_catalog_round_trips_as_json():
    out = apply_correction(catalog(), "ordinarium-missae-i", "title", "Missa Paschalis")
    assert json.loads(json.dumps(out))["pieces"][0]["title"] == "Missa Paschalis"
