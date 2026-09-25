"""Error and boundary paths across the pipeline: evaluate, catalog, folio, offset,
publish, references and index. Happy paths live in each module's own test file;
these cover what happens when things go wrong."""

import json

import pytest
import yaml

from pipeline import folio as folio_mod
from pipeline import offset as offset_mod
from pipeline.index import IndexEntry, load_index, resolve_ranges, stated_end
from pipeline.offset import OffsetResult

# ---------------------------------------------------------------- evaluate ---

@pytest.mark.source
@pytest.mark.slow
def test_write_overlay_writes_an_annotated_png(tmp_path):
    from pipeline.evaluate import write_overlay
    out = write_overlay("noh5", 229, dest_dir=tmp_path)
    assert out.exists() and out.suffix == ".png"


@pytest.mark.source
@pytest.mark.slow
def test_write_contact_sheet_reports_matches_and_escapes_notes(tmp_path):
    from pipeline.evaluate import write_contact_sheet
    sheet = write_contact_sheet("noh5", [229, 231], dest_dir=tmp_path)
    html = sheet.read_text()
    assert "2/2 pages match their hand label" in html
    assert "<script" not in html.lower()


@pytest.mark.source
@pytest.mark.slow
def test_write_contact_sheet_unlabelled_page_is_flagged(tmp_path):
    from pipeline.evaluate import write_contact_sheet
    html = write_contact_sheet("noh5", [228], dest_dir=tmp_path).read_text()
    assert "not hand-labelled" in html


@pytest.mark.source
@pytest.mark.slow
def test_analyse_page_odd_staff_count_is_captured_not_raised():
    """PDF 180 detects 11 staves (one bass staff missed). A bad page is a review
    entry, so analyse_page records the error instead of crashing the run."""
    from pipeline.evaluate import analyse_page, count_systems
    result = analyse_page("noh5", 180)
    assert result.error is not None and "not a multiple" in result.error
    assert result.system_count == 0
    with pytest.raises(ValueError):
        count_systems("noh5", 180)


# ----------------------------------------------------------------- catalog ---

@pytest.fixture
def small_index(tmp_path):
    """Two entries at the end of the volume: builds in seconds, still exercises
    range resolution to the last body page."""
    doc = {"volume": "noh5", "sections": [{"name": "Missa pro Defunctis", "entries": [
        {"label": "II", "title": "Absolutio pro Defunctis", "genre": "absolutio", "page": 178},
        {"label": "III", "title": "In Exsequiis Defunctorum", "genre": "exsequiis", "page": 180},
    ]}]}
    path = tmp_path / "index-small.yml"
    path.write_text(yaml.safe_dump(doc))
    return path


@pytest.mark.source
@pytest.mark.slow
def test_build_catalog_small_index_resolves_last_entry_to_volume_end(small_index):
    from pipeline.catalog import build_catalog
    catalog, _review = build_catalog("noh5", small_index)
    last = catalog["pieces"][-1]
    assert last["printed_pages"] == [180, 184], "final entry must run to the last body page"
    assert len(last["systems"]) == len(last["system_assets"]) == len(last["system_aspect"])


@pytest.mark.source
@pytest.mark.slow
def test_build_catalog_unpaired_pieces_are_queued_for_review(small_index):
    from pipeline.catalog import build_catalog
    _catalog, review = build_catalog("noh5", small_index)
    unpaired = {r["piece"] for r in review if r["kind"] == "unpaired"}
    assert "missa-pro-defunctis-ii" in unpaired


@pytest.mark.source
@pytest.mark.slow
def test_write_catalog_writes_both_files(small_index, tmp_path):
    from pipeline.catalog import write_catalog
    cat_path, rev_path = write_catalog("noh5", tmp_path, small_index)
    assert json.loads(cat_path.read_text())["schema_version"] == 1
    assert isinstance(json.loads(rev_path.read_text()), list)


# ------------------------------------------------------------------- folio ---

def test_read_folio_without_tesseract_raises_with_install_command(monkeypatch):
    monkeypatch.setattr(folio_mod.shutil, "which", lambda _name: None)
    with pytest.raises(folio_mod.TesseractUnavailable, match="brew install tesseract"):
        folio_mod.read_folio("noh5", 229)


@pytest.mark.source
def test_read_folio_dual_without_tesseract_requires_explicit_downgrade(monkeypatch):
    """Single-source reading is a recorded decision, never a silent default: the
    embedded layer alone is 83.8% accurate and its errors are confident ones."""
    monkeypatch.setattr(folio_mod.shutil, "which", lambda _name: None)
    with pytest.raises(folio_mod.TesseractUnavailable):
        folio_mod.read_folio_dual("noh5", 229)
    reading = folio_mod.read_folio_dual("noh5", 229, require_both=False)
    assert reading.sources == ("embedded",)
    assert reading.agreement is False
    assert reading.embedded == 183


# ------------------------------------------------------------------ offset ---

def test_load_offset_missing_file_names_the_command(tmp_path):
    with pytest.raises(RuntimeError, match="noh offset --volume noh5"):
        offset_mod.load_offset("noh5", path=tmp_path / "absent.json")


def test_load_offset_unknown_volume_is_an_error(tmp_path):
    store = tmp_path / "offsets.json"
    store.write_text(json.dumps({"noh1": {"offset": 25}}))
    with pytest.raises(RuntimeError, match="no derived offset"):
        offset_mod.load_offset("noh5", path=store)


def test_derive_offset_sample_larger_than_body_is_refused():
    with pytest.raises(RuntimeError, match="body pages to sample"):
        offset_mod.derive_offset("noh5", sample_size=10_000)


def test_derive_offset_no_agreed_folio_explains_likely_causes(monkeypatch):
    monkeypatch.setattr(offset_mod, "read_folio_dual", lambda *a, **k:
                        folio_mod.FolioReading(None, False, None, None, "", ("embedded",)))
    with pytest.raises(RuntimeError, match="Likely causes"):
        offset_mod.derive_offset("noh5", sample_size=5)


def test_assert_consistent_disagreements_are_listed_in_the_error():
    result = OffsetResult(offset=46, confidence=0.6, samples=15, disagreements=[(99, 12)])
    with pytest.raises(ValueError, match=r"\(99, 12\)"):
        offset_mod.assert_consistent("noh5", result)


# ----------------------------------------------------------------- publish ---

def test_load_manifest_unsliced_page_returns_none(tmp_path):
    from pipeline.publish import load_manifest
    assert load_manifest("noh5", 51, dest=tmp_path) is None


def test_load_manifest_malformed_systems_returns_none(tmp_path):
    from pipeline.publish import load_manifest
    page = tmp_path / "0051"
    page.mkdir()
    (page / "manifest.json").write_text(json.dumps({"systems": "oops"}))
    assert load_manifest("noh5", 51, dest=tmp_path) is None


def test_asset_stem_uses_the_first_twelve_hash_characters():
    from pipeline.publish import asset_stem
    assert asset_stem("noh5", 51, 0, "0123456789abcdef" * 4) == "systems/noh5/0051/000-0123456789ab"


@pytest.mark.source
@pytest.mark.slow
def test_upload_plans_three_variants_per_system_with_hashed_keys(tmp_path):
    from pipeline.publish import upload_plans
    plans = upload_plans("noh5", 229, dest=tmp_path)
    assert len(plans) == 5 * 3
    assert all("-" in p.key.rsplit("/", 1)[1] for p in plans), "keys must carry a hash"
    assert {p.key.rsplit(".", 1)[1] for p in plans} == {"webp", "png"}


@pytest.mark.source
@pytest.mark.slow
def test_slice_systems_writes_a_manifest_matching_the_slices(tmp_path):
    from pipeline.publish import load_manifest, slice_systems
    slices = slice_systems("noh5", 229, dest=tmp_path)
    manifest = load_manifest("noh5", 229, dest=tmp_path)
    assert [m["sha256"] for m in manifest] == [s.sha256 for s in slices]
    assert [(m["width"], m["height"]) for m in manifest] == [(s.width, s.height) for s in slices]


# -------------------------------------------------------------- references ---

def test_load_references_missing_registry_is_empty(tmp_path):
    from pipeline.references import load_references
    assert load_references(tmp_path / "absent.yml") == {}


def test_reference_path_points_into_pdf_source():
    from pipeline.references import load_references
    assert load_references()["ccw"].path.parent.name == "pdf-source"


# ------------------------------------------------------------------- index ---

def entry(slug: str, page: int, last_page: int | None = None) -> IndexEntry:
    return IndexEntry(slug=slug, section="S", label=slug, title=slug, genre="kyrie",
                      page=page, last_page=last_page, incipit=None)


def test_resolve_ranges_last_entry_without_volume_bound_keeps_stated_end():
    ranges = resolve_ranges([entry("a", 1), entry("b", 5, last_page=7)])
    assert ranges[-1][1:] == (5, 7)


def test_resolve_ranges_explicit_range_short_of_next_entry_is_extended():
    """Gloria 139-144 then Sanctus 147 orphaned 145-146; the gap belongs to Gloria."""
    ranges = resolve_ranges([entry("gloria", 139, 144), entry("sanctus", 147)], 150)
    assert ranges[0][1:] == (139, 146)


def test_stated_end_distinguishes_stated_from_resolved():
    assert stated_end(entry("x", 139, 144)) == 144
    assert stated_end(entry("y", 5)) is None


def test_load_index_duplicate_slug_after_disambiguation_is_an_error(tmp_path):
    """Two identical labels are disambiguated by page (the second becomes -p3); a
    third on the same page cannot be, and must fail rather than overwrite."""
    same = {"label": "A", "title": "t", "genre": "kyrie", "page": 3}
    doc = {"sections": [{"name": "S", "entries": [same, same, same]}]}
    path = tmp_path / "dup.yml"
    path.write_text(yaml.safe_dump(doc))
    with pytest.raises(ValueError, match="duplicate index slug"):
        load_index("x", path)


# ------------------------------------------------- catalog failure branches ---

def write_index(tmp_path, entries, name="index.yml"):
    path = tmp_path / name
    path.write_text(yaml.safe_dump({"sections": [{"name": "S", "entries": entries}]}))
    return path


@pytest.mark.source
@pytest.mark.slow
def test_build_catalog_range_past_stated_end_is_queued_as_extended(tmp_path):
    """Gloria's printed range stops at 144 but Sanctus starts at 147: the gap is
    claimed, and the judgement call is recorded rather than made silently."""
    from pipeline.catalog import build_catalog
    index = write_index(tmp_path, [
        {"label": "Gloria", "title": "Gloria I. II. III.", "genre": "gloria",
         "page": 139, "last_page": 144},
        {"label": "Sanctus", "title": "Sanctus I. II. III.", "genre": "sanctus", "page": 147},
    ])
    catalog, review = build_catalog("noh5", index)
    extended = [r for r in review if r["kind"] == "range_extended"]
    assert extended and extended[0]["stated"] == [139, 144]
    assert extended[0]["resolved"] == [139, 146]
    assert catalog["pieces"][0]["printed_pages"] == [139, 146]


@pytest.mark.source
@pytest.mark.slow
def test_build_catalog_page_beyond_volume_is_reported_with_no_systems(tmp_path):
    from pipeline.catalog import build_catalog
    index = write_index(tmp_path, [
        {"label": "X", "title": "Beyond the book", "genre": "kyrie", "page": 190},
    ])
    catalog, review = build_catalog("noh5", index)
    kinds = {r["kind"] for r in review}
    assert "page_out_of_range" in kinds
    assert "no_systems" in kinds
    assert catalog["pieces"][0]["review_status"] == "review"


@pytest.mark.source
@pytest.mark.slow
def test_build_catalog_unconfident_movement_goes_to_review_not_catalog(tmp_path):
    """PDF 52's Kyrie continuation scores 0.739 with no mode number: plausible, not
    confident. It must reach the review queue and never a published movement."""
    from pipeline.catalog import build_catalog
    index = write_index(tmp_path, [
        {"label": "I", "title": "Missa Tempore Paschali", "genre": "mass_ordinary", "page": 5},
        {"label": "II", "title": "In Festis Solemnibus 1", "genre": "mass_ordinary", "page": 7},
    ])
    catalog, review = build_catalog("noh5", index)
    uncertain = [r for r in review if r["kind"] == "uncertain_movement"]
    assert any(r["pdf_page"] == 52 and r["movement"] == "kyrie" for r in uncertain)
    published = {(m["pdf_page"], m["system"]) for m in catalog["pieces"][0]["movements"]}
    assert all((r["pdf_page"], r["system"]) not in published for r in uncertain)


@pytest.mark.source
@pytest.mark.slow
def test_build_catalog_unverified_pairing_is_published_flagged_and_queued(tmp_path):
    """'Ite XV/XVI' is a plausible but unconfirmed match for Missa XV's dismissal.
    It is shown with a warning AND queued -- never hidden, never labelled verified."""
    from pipeline.catalog import build_catalog
    index = write_index(tmp_path, [
        {"label": "XV", "title": "In Festis Simplicibus", "incipit": "Dominator Deus",
         "genre": "mass_ordinary", "page": 84},
        {"label": "XVI", "title": "In Feriis per annum", "genre": "mass_ordinary", "page": 89},
    ])
    catalog, review = build_catalog("noh5", index)
    ite = [c for c in catalog["pieces"][0]["chant"] if c["movement"] == "ite"]
    assert ite and ite[0]["status"] == "unverified"
    assert any(r["kind"] == "unverified_pairing" and r["chant_id"] == ite[0]["id"]
               for r in review)


@pytest.mark.source
@pytest.mark.slow
def test_build_catalog_unsliced_pages_fall_back_to_computed_boxes(tmp_path, monkeypatch):
    """Before slicing, no manifest exists: dimensions come from the computed boxes
    and the asset key is empty, so the site uses its local path."""
    from pipeline import publish as publish_mod
    from pipeline.catalog import build_catalog
    monkeypatch.setattr(publish_mod, "BUILD", tmp_path / "no-slices-here")
    index = write_index(tmp_path, [
        {"label": "III", "title": "In Exsequiis Defunctorum", "genre": "exsequiis", "page": 183},
    ])
    catalog, _ = build_catalog("noh5", index)
    piece = catalog["pieces"][0]
    assert piece["systems"], "systems are still detected without a manifest"
    assert set(piece["system_assets"]) == {""}
    assert all(w > 0 and h > 0 for w, h in piece["system_aspect"])
