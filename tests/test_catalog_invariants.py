"""Pure-data invariants over data/catalog.json. Runs in CI in seconds."""

import json
from itertools import pairwise
from pathlib import Path

import pytest

from pipeline.catalog import SCHEMA_VERSION
from pipeline.offset import PageMap, Segment

CAT = json.loads(Path("data/catalog.json").read_text(encoding="utf-8"))
REVIEW = json.loads(Path("data/review-queue.json").read_text(encoding="utf-8"))
PIECES = CAT["pieces"]
PAGE_MAPS = {vol: PageMap(tuple(Segment(**s) for s in meta["page_map"]))
             for vol, meta in CAT["volumes"].items()}
GENRES = {"asperges", "mass_ordinary", "credo", "tonus", "kyrie", "gloria",
          "sanctus", "agnus", "requiem", "absolutio", "exsequiis", "proper"}
MOVEMENTS = {"kyrie", "gloria", "credo", "sanctus", "agnus", "ite"}


def test_schema_version_matches_the_writer():
    assert CAT["schema_version"] == SCHEMA_VERSION


def test_piece_ids_and_slugs_are_unique_across_volumes():
    ids = [p["id"] for p in PIECES]
    slugs = [p["slug"] for p in PIECES]
    assert len(ids) == len(set(ids))
    assert len(slugs) == len(set(slugs)), "a slug is a URL and must be unique site-wide"


def test_noh5_keeps_its_46_pieces():
    assert sum(1 for p in PIECES if p["volume"] == "noh5") == 46


def test_every_piece_belongs_to_a_recorded_volume():
    assert {p["volume"] for p in PIECES} <= set(CAT["volumes"])


def test_no_two_pieces_claim_the_same_system():
    seen: dict[str, str] = {}
    for piece in PIECES:
        for ref in piece["systems"]:
            assert ref not in seen, f"{ref} claimed by {seen[ref]} and {piece['id']}"
            seen[ref] = piece["id"]


def test_page_ranges_are_ordered_and_in_bounds():
    for piece in PIECES:
        first, last = piece["printed_pages"]
        assert 1 <= first <= last <= PAGE_MAPS[piece["volume"]].last_printed, piece["id"]


def test_pdf_pages_follow_the_recorded_page_map():
    for piece in PIECES:
        page_map = PAGE_MAPS[piece["volume"]]
        first, last = piece["printed_pages"]
        mapped = [p for n in range(first, last + 1) if (p := page_map.to_pdf(n)) is not None]
        assert piece["pdf_pages"] == [min(mapped), max(mapped)], piece["id"]


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


def test_review_status_is_consistent_with_systems_and_index():
    unconfirmed = {(r["volume"], r["piece"]) for r in REVIEW if r["kind"] == "index_unverified"}
    for piece in PIECES:
        confident = piece["systems"] and (piece["volume"], piece["slug"]) not in unconfirmed
        assert piece["review_status"] == ("verified" if confident else "review"), piece["id"]


def test_attached_movements_are_confident_and_well_formed():
    """Only confident detections may be published; the rest belong in the review
    queue. An organist opening 'Gloria' and finding the Sanctus is worse than one
    opening 'Missa I' and scrolling."""
    queued = {(r["piece"], r["ref"]) for r in REVIEW if r["kind"] == "uncertain_movement"}
    for piece in PIECES:
        for m in piece["movements"]:
            assert m["movement"] in MOVEMENTS, piece["id"]
            assert m["ref"] in piece["systems"], f"{piece['id']}: movement outside piece"
            if m.get("placed") == "order":
                # Placed because the Mass must contain it; a person checks it.
                assert (piece["slug"], m["ref"]) in queued, f"{piece['id']}: {m['movement']} unqueued"
            else:
                # Confident: a strong match, or a fair one beside a printed mode number.
                floor = 0.51 if m.get("mode_marker") else 0.66
                assert m["score"] >= floor, f"{piece['id']}: unconfident movement published"


WITHOUT_GLORIA = {"XVI", "XVII", "XVIII"}


@pytest.mark.parametrize("piece", [p for p in PIECES if p["genre"] == "mass_ordinary"
                                   and p["division"] == "kyriale"], ids=lambda p: p["label"])
def test_every_kyriale_mass_has_its_movements_once_in_order(piece):
    """Kyrie, Gloria, Sanctus, Agnus Dei -- no Gloria in the ferial Masses XVI-XVIII."""
    found = [m["movement"] for m in piece["movements"] if m["movement"] != "ite"]
    expected = ["kyrie", *([] if piece["label"] in WITHOUT_GLORIA else ["gloria"]), "sanctus", "agnus"]
    assert found == expected
    assert piece["movements"][0]["ref"] == piece["systems"][0], "the Kyrie opens the Mass"


def test_there_are_eighteen_kyriale_masses():
    labels = [p["label"] for p in PIECES if p["genre"] == "mass_ordinary" and p["division"] == "kyriale"]
    assert len(labels) == 18


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


def _duplicate_scans(vol: str) -> set[int]:
    """PDF pages that repeat a printed page already scanned (NOH1 prints 96 twice,
    NOH3 375-376): the first scan is the one catalogued."""
    page_map = PAGE_MAPS[vol]
    twice = {pdf for seg in page_map.segments for pdf in range(seg.first_pdf, seg.last_pdf + 1)
             if page_map.to_pdf(pdf - seg.offset) != pdf}
    # Inserts between segments (NOH4's 162i, 163i) -- each recorded for review.
    recorded = {tuple(r["pdf_pages"]) for r in REVIEW if r["kind"] == "unmapped_pages"
                and r["volume"] == vol}
    inserts = {pdf for gap in page_map.gaps if gap in recorded for pdf in range(gap[0], gap[1] + 1)}
    return twice | inserts


def _sliced(vol: str) -> set[str]:
    duplicates = _duplicate_scans(vol)
    return {f"{vol}/{f.parent.name}/{f.name.split('@')[0]}"
            for f in Path(f"build/systems/{vol}").glob("*/*@2x.png")
            if int(f.parent.name) not in duplicates}


def _built_volumes() -> list[str]:
    built = [v for v in CAT["volumes"] if Path(f"build/systems/{v}").exists()]
    if not built:
        pytest.skip("slices not built; run `noh publish --volume <vol>`")
    return built


def test_every_sliced_system_is_claimed_by_a_piece():
    """A system that exists on disk but that no piece references is music dropped
    on the floor: it is in the volume, it renders nowhere, and nothing else in CI
    notices.

    This caught two real gaps. The last index entry ended at its own start page
    for want of a following entry, stranding printed 181-184; and an entry with
    an explicit range that stopped short of the next entry orphaned 145-146.
    """
    claimed = {ref for piece in PIECES for ref in piece["systems"]}
    for vol in _built_volumes():
        unclaimed = sorted(_sliced(vol) - claimed)
        assert unclaimed == [], f"{len(unclaimed)} systems claimed by no piece: {unclaimed[:8]}"


def test_no_piece_references_a_missing_slice():
    for vol in _built_volumes():
        claimed = {ref for piece in PIECES if piece["volume"] == vol for ref in piece["systems"]}
        dangling = sorted(claimed - _sliced(vol))
        assert dangling == [], f"{len(dangling)} references with no slice: {dangling[:8]}"


def test_extended_ranges_are_recorded_for_review():
    """Extending a piece past the end its index states is a judgement call, so it
    goes to review rather than happening silently."""
    for entry in (r for r in REVIEW if r["kind"] == "range_extended"):
        assert entry["resolved"][1] > entry["stated"][1]
        assert entry["why"]


DIVISIONS = {"kyriale", "temporale", "sanctorale", "commune", "defunctorum", "vesperale", "varia"}


def test_every_piece_has_a_known_division():
    for piece in PIECES:
        assert piece["division"] in DIVISIONS, piece["id"]


def test_every_day_key_exists_in_the_1962_calendar():
    """A day key the calendar does not know would link a date to nothing."""
    vocabulary = json.loads(Path("data/calendar/days.json").read_text(encoding="utf-8"))
    for piece in PIECES:
        for key in piece["days"]:
            assert key in vocabulary, f"{piece['id']}: unknown calendar key {key}"
