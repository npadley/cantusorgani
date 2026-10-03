"""Pure-data invariants over data/catalog.json. Runs in CI in seconds."""

import json
from itertools import pairwise
from pathlib import Path

import pytest

from pipeline import sections
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
        assert 1 <= first <= last <= PAGE_MAPS[piece["volume"]].last_in(piece.get("pagination")), piece["id"]


def test_pdf_pages_follow_the_recorded_page_map():
    for piece in PIECES:
        page_map = PAGE_MAPS[piece["volume"]]
        first, last = piece["printed_pages"]
        mapped = [p for n in range(first, last + 1)
                  if (p := page_map.to_pdf(n, piece.get("pagination"))) is not None]
        assert piece["pdf_pages"] == [min(mapped), max(mapped)], piece["id"]


def test_an_addendum_piece_names_an_addendum_of_its_volume():
    """Its pages count from the addendum's own title page, so a piece without
    its pagination would send the reader to the wrong page of the book."""
    for piece in PIECES:
        if "pagination" in piece:
            assert piece["pagination"] in CAT["volumes"][piece["volume"]]["addenda"], piece["id"]
            segments = {s.pagination for s in PAGE_MAPS[piece["volume"]].segments}
            assert piece["pagination"] in segments, piece["id"]


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
    """The licence and source travel with the data, not only in a docs file.
    GregoBase is CC0 (its About page, checked 2026-09-26)."""
    src = CAT["chant_source"]
    assert src["licence"] == "CC0"
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
             if page_map.to_pdf(pdf - seg.offset, seg.pagination) != pdf}
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


def test_only_masses_have_movements():
    """An Introit's "Gloria Patri" is not a Gloria; a jump link to it misleads."""
    for piece in PIECES:
        if piece["movements"]:
            assert piece["division"] in {"kyriale", "defunctorum"}, piece["id"]


def test_every_hymn_points_into_its_own_office():
    for piece in PIECES:
        for hymn in piece.get("hymns", []):
            assert hymn["ref"] in piece["systems"], f"{piece['id']}: {hymn['title']}"


def test_every_indexed_hymn_is_attached_or_queued():
    import yaml
    doc = yaml.safe_load(Path("data/index-noh8.yml").read_text(encoding="utf-8"))
    attached = sum(len(p.get("hymns", [])) for p in PIECES if p["volume"] == "noh8")
    queued = sum(1 for r in REVIEW if r["kind"] == "hymn_unplaced" and r["volume"] == "noh8")
    assert attached + queued == len(doc["hymns"])


# ------------------------------------------------------------ Proper parts ---

PART_NAMES = set(sections.KINDS)
PROPER_DIVISIONS = {"temporale", "sanctorale", "commune", "varia"}
BY_SLUG = {p["slug"]: p for p in PIECES}


def _printed(piece):
    return [x for x in piece.get("sections", []) if "borrowed_page" not in x]


def test_only_propers_have_parts():
    """Propers, and the Requiem Mass (a Proper printed with its Ordinary). A
    Mass of the Kyriale has only the rows a person listed for it, each with a
    key of its own (data/sections/noh5.yml: a second Kyrie, its dismissals)."""
    assert {p["division"] for p in PIECES
            if p.get("sections") and p["genre"] not in ("requiem", "mass_ordinary")} <= PROPER_DIVISIONS | {"vesperale"}
    listed = [s for p in PIECES if p["genre"] == "mass_ordinary" for s in p.get("sections") or []]
    assert listed and all(s["kind"] == "other" and s.get("key") and s["placed"] == "reviewed" for s in listed)

    for piece in PIECES:
        if piece["division"] == "vesperale":
            assert {s["kind"] for s in piece.get("sections", [])} <= {"other", "hymn"}


def test_mass_xvii_has_its_second_kyrie_and_both_responses():
    """NOH5 pp. 92 and 95, checked against the scan 2026-09-30."""
    mass = next(p for p in PIECES if p["slug"] == "ordinarium-missae-xvii")
    assert {s["key"]: s["ref"] for s in mass["sections"]} == {
        "kyrie-b": "noh5/0138/005", "deo-gratias-i": "noh5/0141/004", "deo-gratias-vi": "noh5/0141/005"}



def test_requiem_parts_introit_gradual_tract_sequence_offertory_communion():
    """NOH5 pp. 163-177, checked against the scan 2026-09-27. The Introit is
    repeated after its verse (p. 164) and the Gradual opens with the same
    words: neither may take the Gradual's place. The Tract, Absolve Domine,
    opens p. 167 (checked 2026-10-03)."""
    requiem = next(p for p in PIECES if p["slug"] == "missa-pro-defunctis-i")
    shown = {x["kind"]: x["ref"] for x in _printed(requiem) if x["placed"] != "order"}
    assert shown == {"introit": "noh5/0209/000", "gradual": "noh5/0211/001",
                     "tract": "noh5/0213/000", "sequence": "noh5/0215/000", "offertory": "noh5/0220/000",
                     "communion": "noh5/0223/002"}


def test_parts_are_named_run_in_reading_order_and_point_at_their_own_systems():
    for piece in PIECES:
        printed = _printed(piece)
        assert all(x["kind"] in PART_NAMES for x in piece.get("sections", [])), piece["slug"]
        # A reviewed list is in the order printed. Elsewhere the Paschal Alleluia
        # stands in for the Gradual and Alleluia, and may be printed on either side
        # of them.
        reviewed = all(x["placed"] == "reviewed" for x in printed)
        systems = [x["system"] for x in printed if reviewed or x.get("variant") != "paschal"]
        assert systems == sorted(systems), piece["slug"]
        starts = [x["system"] for x in printed]
        assert len(set(starts)) == len(starts), f"two parts start on one system: {piece['slug']}"
        for x in printed:
            assert piece["systems"][x["system"]] == x["ref"], piece["slug"]
            # "hand": corrected in data/corrections.yml; "reviewed": data/sections/.
            assert x["placed"] in {"label", "text", "mode", "order", "inferred", "hand", "reviewed"}


def test_no_part_twice_unless_numbered():
    for piece in PIECES:
        keys = [(x["kind"], sections.suffix(x)) for x in piece.get("sections", [])]
        assert len(keys) == len(set(keys)), piece["slug"]


def test_every_part_placed_by_order_is_queued_for_review():
    queued = {(r["piece"], r["part"]) for r in REVIEW if r["kind"] == "part_by_order"}
    for piece in PIECES:
        for x in _printed(piece):
            if x["placed"] == "order":
                assert (piece["slug"], x["kind"]) in queued, piece["slug"]


def test_borrowed_parts_point_at_a_real_part_or_are_queued():
    unresolved = {(r["piece"], r["part"]) for r in REVIEW if r["kind"] == "part_borrowed_unresolved"}
    for piece in PIECES:
        for x in piece.get("sections", []):
            if "borrowed_page" not in x:
                continue
            if x.get("borrowed_from") is None:
                assert (piece["slug"], x["kind"]) in unresolved, piece["slug"]
                continue
            lender = BY_SLUG[x["borrowed_from"]]
            assert x["borrowed_ref"] in lender["systems"]


@pytest.mark.parametrize(("slug", "expected"), [
    # Hand-verified against the page images, 2026-09-26.
    ("s-theresiae-a-jesu-infante-virginis",
     # With the Paschal Alleluia after the Tract ("ut supra, deinde: Alleluia"), checked 2026-09-29.
     [("introit", 0), ("gradual", 8), ("alleluia", 16), ("tract", 31), ("alleluia", 42), ("offertory", 48),
      ("communion", 55)]),
    ("s-andre-apostoli", [("introit", 0), ("gradual", 7), ("alleluia", 15), ("offertory", 23),
                          ("communion", 28)]),
])
def test_golden_propers_divide_where_the_page_does(slug, expected):
    assert [(x["kind"], x["system"]) for x in _printed(BY_SLUG[slug])] == expected


def test_most_propers_with_music_are_divided():
    """A floor, not a target: a regression in label reading shows here first.
    Measured 2026-09-26: 222 of 286 Propers with music (78%); the rest are
    local or 1942-only feasts jgabc lacks, blessings and processions."""
    propers = [p for p in PIECES if p["division"] in PROPER_DIVISIONS and p["systems"]]
    divided = [p for p in propers if _printed(p)]
    assert len(divided) >= 0.75 * len(propers)


def test_all_credo_ranges_begin_at_their_opening_and_include_the_final_amen():
    """All six boundaries checked visually against NOH5 PDF on 2026-09-30."""
    expected = {
        'ordinarium-missae-credo-i': ('noh5/0144/003', 'noh5/0148/002'),
        'ordinarium-missae-credo-ii': ('noh5/0148/003', 'noh5/0152/002'),
        'ordinarium-missae-credo-iii': ('noh5/0152/003', 'noh5/0156/002'),
        'ordinarium-missae-credo-iv': ('noh5/0156/003', 'noh5/0160/002'),
        'alii-cantus-ad-libitum-credo-v': ('noh5/0200/004', 'noh5/0204/003'),
        'alii-cantus-ad-libitum-credo-vi': ('noh5/0204/004', 'noh5/0208/005'),
    }
    credos = {p['slug']: p for p in PIECES if p['genre'] == 'credo'}
    assert credos.keys() == expected.keys()
    for slug, (first, last) in expected.items():
        assert (credos[slug]['systems'][0], credos[slug]['systems'][-1]) == (first, last)


def test_the_holy_cross_votive_mass_takes_its_tract_from_the_inserted_leaf():
    """NOH4 pp. 162-164: the Tract Adoramus te Christe, sung after Septuagesima, is
    printed on the leaf inserted after p. 163 ("162 bis", "163 bis"; PDF 195-196),
    checked against the scans 2026-10-03."""
    mass = next(p for p in PIECES if p["slug"] == "feria-vi-missa-de-sancta-cruce")
    assert {r.split("/")[1] for r in mass["systems"]} == {"0193", "0194", "0195", "0196", "0197"}
    tract = next(s for s in mass["sections"] if s["kind"] == "tract")
    assert (tract["ref"], tract["gregobase_id"]) == ("noh4/0195/000", 114)
    assert not any(r["kind"] == "unmapped_pages" for r in REVIEW)


def test_no_two_pieces_in_a_volume_share_a_system():
    owner: dict[str, str] = {}
    for piece in PIECES:
        for ref in piece["systems"]:
            assert ref not in owner, f"{ref} is in both {owner[ref]} and {piece['id']}"
            owner[ref] = piece["id"]


def test_a_rubric_only_piece_leaves_its_page_to_the_pieces_either_side():
    by_slug = {p["slug"]: p for p in PIECES}
    assert by_slug["sabbato-post-cineres"]["systems"] == []
    assert by_slug["feria-vi-post-cineres"]["systems"][-1] == "noh1/0194/002"
    assert by_slug["dominica-i-in-quadragesim"]["systems"][0] == "noh1/0194/003"


def test_ash_wednesday_is_one_piece_the_blessing_then_the_mass():
    """NOH1 pp. 152-163, checked against the scan 2026-10-03: the book cites the
    Mass as "Feria IV. Cinerum", so the blessing and "Ad Missam" are one piece."""
    by_slug = {p["slug"]: p for p in PIECES}
    assert "noh1-p156" not in by_slug
    ash = by_slug["feria-iv-cinerum"]
    shown = [(x["kind"], x["ref"]) for x in _printed(ash)]
    assert shown[0] == ("other", "noh1/0179/000")
    assert ("introit", "noh1/0183/005") in shown
    assert shown.index(("introit", "noh1/0183/005")) == 4


def test_a_merged_piece_redirects_its_old_address():
    redirects = Path("web/public/_redirects").read_text(encoding="utf-8")
    assert "/piece/noh1-p156/ /piece/feria-iv-cinerum/ 301" in redirects
