"""Pure-data invariants over data/catalog.json. Runs in CI in seconds."""

import json
from itertools import pairwise
from pathlib import Path

import pytest

from pipeline.catalog import SCHEMA_VERSION

CAT = json.loads(Path("data/catalog.json").read_text(encoding="utf-8"))
REVIEW = json.loads(Path("data/review-queue.json").read_text(encoding="utf-8"))
PIECES = CAT["pieces"]
MAX_PRINTED_PAGE = 185          # NOH5 body ends at printed 185 (PDF 231)
GENRES = {"asperges", "mass_ordinary", "credo", "tonus", "kyrie", "gloria",
          "sanctus", "agnus", "requiem", "absolutio", "exsequiis"}
MOVEMENTS = {"kyrie", "gloria", "credo", "sanctus", "agnus", "ite"}


def test_schema_version_matches_the_writer():
    assert CAT["schema_version"] == SCHEMA_VERSION


def test_piece_ids_are_unique():
    ids = [p["id"] for p in PIECES]
    assert len(ids) == len(set(ids)) == 46


def test_no_two_pieces_claim_the_same_system():
    seen: dict[str, str] = {}
    for piece in PIECES:
        for ref in piece["systems"]:
            assert ref not in seen, f"{ref} claimed by {seen[ref]} and {piece['id']}"
            seen[ref] = piece["id"]


def test_page_ranges_are_ordered_and_in_bounds():
    for piece in PIECES:
        first, last = piece["printed_pages"]
        assert 1 <= first <= last <= MAX_PRINTED_PAGE, piece["id"]


def test_pdf_pages_follow_the_recorded_offset():
    offset = CAT["page_offset"]
    for piece in PIECES:
        assert piece["pdf_pages"] == [piece["printed_pages"][0] + offset,
                                      piece["printed_pages"][1] + offset], piece["id"]


def test_systems_within_a_piece_are_in_reading_order():
    for piece in PIECES:
        assert piece["systems"] == sorted(piece["systems"]), piece["id"]


def test_system_refs_belong_to_the_pieces_page_range():
    for piece in PIECES:
        lo, hi = piece["pdf_pages"]
        for ref in piece["systems"]:
            page = int(ref.split("/")[1])
            assert lo <= page <= hi, f"{piece['id']}: {ref} outside pdf pages {lo}-{hi}"


def test_every_system_has_an_aspect_recorded():
    """Task 25 reserves layout space from these; a missing one reflows the page
    mid-Gloria while slices load."""
    for piece in PIECES:
        assert len(piece["system_aspect"]) == len(piece["systems"]), piece["id"]
        for w, h in piece["system_aspect"]:
            assert w > 0 and h > 0, piece["id"]


def test_genres_are_from_the_controlled_set():
    assert {p["genre"] for p in PIECES} <= GENRES


def test_review_status_is_consistent_with_systems():
    for piece in PIECES:
        expected = "verified" if piece["systems"] else "review"
        assert piece["review_status"] == expected, piece["id"]


def test_attached_movements_are_confident_and_well_formed():
    """Only confident detections may be published; the rest belong in the review
    queue. An organist opening 'Gloria' and finding the Sanctus is worse than one
    opening 'Missa I' and scrolling."""
    for piece in PIECES:
        for m in piece["movements"]:
            assert m["movement"] in MOVEMENTS, piece["id"]
            assert m["score"] >= 0.66, f"{piece['id']}: unconfident movement published"
            assert m["ref"] in piece["systems"], f"{piece['id']}: movement outside piece"


def test_movements_run_in_reading_order():
    for piece in PIECES:
        refs = [m["ref"] for m in piece["movements"]]
        for a, b in pairwise(refs):
            assert a < b, f"{piece['id']}: movements out of order"


def test_pieces_without_systems_are_recorded_in_the_review_queue():
    empty = {p["slug"] for p in PIECES if not p["systems"]}
    queued = {r["piece"] for r in REVIEW if r["kind"] == "no_systems"}
    assert empty == queued


def test_chant_pairings_carry_an_honest_status():
    """Unverified pairings ARE published -- shown with a warning, per the design.
    Hiding them would deny the reader the one thing that lets them catch our
    mistake. What must never happen is an unverified pairing labelled verified."""
    for piece in PIECES:
        for chant in piece["chant"] or []:
            assert chant["source"] == "gregobase"
            assert chant["status"] in {"verified", "unverified"}
            if chant["status"] == "verified":
                assert chant["score"] >= 0.85, f"{piece['id']}: {chant}"
            else:
                assert 0.45 <= chant["score"] < 0.85, f"{piece['id']}: {chant}"


def test_every_unverified_pairing_is_queued_for_review():
    queued = {(r["piece"], r["chant_id"]) for r in REVIEW
              if r["kind"] == "unverified_pairing"}
    for piece in PIECES:
        for chant in piece["chant"] or []:
            if chant["status"] == "unverified":
                assert (piece["slug"], chant["id"]) in queued, f"{piece['id']}: {chant}"


def test_chant_source_attribution_is_recorded():
    """CC BY-SA makes attribution a display obligation, so the licence and source
    must travel with the data, not live only in a docs file."""
    src = CAT["chant_source"]
    assert src["licence"] == "CC BY-SA 4.0"
    assert "gregobase" in src["url"]


def test_requiem_carries_no_ordinary_pairing():
    """Regression: a one-directional repertoire check paired Missa pro Defunctis
    to Kyrie/Gloria/Sanctus I of the Kyriale at 'verified'."""
    requiem = next(p for p in PIECES if p["slug"] == "missa-pro-defunctis-i")
    assert requiem["chant"] == []


@pytest.mark.parametrize("kind", ["uncertain_movement", "no_systems"])
def test_review_entries_name_their_piece(kind):
    for entry in (r for r in REVIEW if r["kind"] == kind):
        assert entry.get("piece"), entry


def test_every_sliced_system_is_claimed_by_a_piece():
    """A system that exists on disk but that no piece references is music dropped
    on the floor: it is in the volume, it renders nowhere, and nothing else in CI
    notices.

    This caught two real gaps. The last index entry ended at its own start page
    for want of a following entry, stranding printed 181-184; and an entry with
    an explicit range that stopped short of the next entry orphaned 145-146.
    """
    sliced = Path("build/systems/noh5")
    if not sliced.exists():
        pytest.skip("slices not built; run `noh publish --volume noh5`")

    on_disk = {
        f"noh5/{f.parent.name}/{f.name.split('@')[0]}"
        for f in sliced.glob("*/*@2x.png")
    }
    claimed = {ref for piece in PIECES for ref in piece["systems"]}
    unclaimed = sorted(on_disk - claimed)
    assert unclaimed == [], f"{len(unclaimed)} systems claimed by no piece: {unclaimed[:8]}"


def test_no_piece_references_a_missing_slice():
    sliced = Path("build/systems/noh5")
    if not sliced.exists():
        pytest.skip("slices not built; run `noh publish --volume noh5`")

    on_disk = {
        f"noh5/{f.parent.name}/{f.name.split('@')[0]}"
        for f in sliced.glob("*/*@2x.png")
    }
    claimed = {ref for piece in PIECES for ref in piece["systems"]}
    dangling = sorted(claimed - on_disk)
    assert dangling == [], f"{len(dangling)} references with no slice: {dangling[:8]}"


def test_extended_ranges_are_recorded_for_review():
    """Extending a piece past the end its index states is a judgement call, so it
    goes to review rather than happening silently."""
    for entry in (r for r in REVIEW if r["kind"] == "range_extended"):
        assert entry["resolved"][1] > entry["stated"][1]
        assert entry["why"]
