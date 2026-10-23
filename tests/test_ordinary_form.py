from __future__ import annotations

import json

import pytest
import yaml

from pipeline.ordinary_form import build_propers, validate_coverage, validate_cycle_review_coverage


def sample_inputs():
    occasions = [
        {"key": "ot-2", "jgabc": "Second Sunday", "title_en": "Second Sunday in Ordinary Time",
         "title_la": "Dominica II per annum", "rank": "sunday", "color": "g",
         "calendar": {"kind": "ordinary", "week": 2}, "reviewed": True},
        {"key": "st-joseph", "jgabc": None, "title_en": "Saint Joseph", "title_la": "Sanctus Ioseph",
         "rank": "solemnity", "color": "w", "calendar": {"kind": "fixed", "month": 3, "day": 19},
         "reviewed": True},
    ]
    assignments = {"Second Sunday": {"introitus": [{"id": 10, "incipit": "Intro"}],
                                     "communio": {"A": [{"id": 11, "incipit": "A"}],
                                                  "B": [{"id": 12, "incipit": "B"}],
                                                  "C": [{"id": 11, "incipit": "A"}]}}}
    catalog = {"volumes": [{"id": "noh1"}], "pieces": [
        {"slug": "second-sunday", "volume": "noh1", "days": ["tempora:Epi2-0"],
         "linked_days": [], "sections": [
             {"kind": "introit", "variant": "", "ref": "noh1/1/0", "gregobase_id": 10,
              "placed": "label", "system": 0, "label": "Intr.", "title": "Intro"},
             {"kind": "communion", "variant": "", "ref": "noh1/1/1", "gregobase_id": 11,
              "placed": "label", "system": 1, "label": "Comm.", "title": "A"},
             {"kind": "communion", "variant": "", "ref": "noh1/1/2", "gregobase_id": 12,
              "placed": "label", "system": 2, "label": "Comm.", "title": "B"},
         ], "systems": ["noh1/1/0", "noh1/1/1", "noh1/1/2"], "printed_pages": [1, 2]},
    ]}
    return catalog, occasions, assignments


def test_build_propers_groups_shared_year_assignments_and_keeps_alternatives():
    catalog, occasions, assignments = sample_inputs()
    resolved, coverage = build_propers(catalog, occasions, assignments, {})
    parts = resolved["occasions"][0]["parts"]
    communions = [part for part in parts if part["slot"] == "communio"]
    assert [(p["variant"], p["years"], p["gregobase_id"]) for p in communions] == [
        ("year-a", ["A", "C"], 11), ("year-b", ["B"], 12)]
    assert coverage["matched"] == 3
    assert coverage["total"] == 3


def test_multi_year_alternative_gets_one_stable_option_variant():
    catalog, occasions, assignments = sample_inputs()
    assignments["Second Sunday"]["communio"] = {
        year: [{"id": 11, "incipit": "A"}, {"id": 12, "incipit": "B"}]
        for year in "ABC"}
    resolved, _ = build_propers(catalog, occasions[:1], assignments, {})
    rows = [part for part in resolved["occasions"][0]["parts"] if part["slot"] == "communio"]
    assert [(part["variant"], part["years"], part["gregobase_id"]) for part in rows] == [
        ("", ["A", "B", "C"], 11), ("2", ["A", "B", "C"], 12)]


def test_same_year_assignment_merges_even_when_alternative_order_changes():
    catalog, occasions, assignments = sample_inputs()
    assignments["Second Sunday"]["communio"] = {
        "A": [{"id": 11, "incipit": "A"}, {"id": 12, "incipit": "B"}],
        "B": [{"id": 11, "incipit": "A"}, {"id": 12, "incipit": "B"}],
        "C": [{"id": 12, "incipit": "B"}, {"id": 11, "incipit": "A"}],
    }
    resolved, _ = build_propers(catalog, occasions[:1], assignments, {})
    rows = [part for part in resolved["occasions"][0]["parts"] if part["slot"] == "communio"]
    by_id = {part["gregobase_id"]: part for part in rows}
    assert by_id[11]["years"] == ["A", "B", "C"]
    assert by_id[12]["years"] == ["A", "B", "C"]


def test_lender_range_spans_all_systems_until_next_printed_section_and_is_ratchet_identity():
    catalog, occasions, assignments = sample_inputs()
    piece = catalog["pieces"][0]
    piece["systems"] = [f"noh1/1/{n}" for n in range(6)]
    piece["sections"][0]["system"] = 1
    piece["sections"][0]["ref"] = "noh1/1/1"
    piece["sections"][1]["system"] = 4
    piece["sections"][1]["ref"] = "noh1/1/4"
    piece["sections"][2]["system"] = 5
    piece["sections"][2]["ref"] = "noh1/1/5"
    _, first = build_propers(catalog, occasions[:1], assignments, {})
    mapping = next(json.loads(value) for value in first["mapping_ids"]
                   if json.loads(value)["slot"] == "introitus")
    assert mapping["export_range"] == {"start": 1, "end": 4}

    piece["sections"][1]["system"] = 3
    piece["sections"][1]["ref"] = "noh1/1/3"
    piece["systems"][3] = "noh1/1/3"
    _, changed = build_propers(catalog, occasions[:1], assignments, {})
    changed_mapping = next(json.loads(value) for value in changed["mapping_ids"]
                           if json.loads(value)["slot"] == "introitus")
    assert changed_mapping != mapping


def test_catalog_n_variant_is_normalized_like_typescript_parser():
    catalog, occasions, assignments = sample_inputs()
    section = catalog["pieces"][0]["sections"][0]
    section["n"] = 1
    section["variant"] = ""
    resolved, _ = build_propers(catalog, occasions[:1], assignments, {})
    assert resolved["occasions"][0]["parts"][0]["lender"]["variant"] == "1"


def test_catalog_match_improvement_does_not_require_a_baseline_migration():
    catalog, occasions, assignments = sample_inputs()
    intro = catalog["pieces"][0]["sections"][0]
    intro["gregobase_id"] = -1
    _, previous = build_propers(catalog, occasions[:1], assignments, {})
    baseline = {"schema_version": 1, "minimum_matched": previous["matched"],
                "minimum_total": previous["total"], "assignments": previous["assignment_ids"],
                "mappings": previous["mapping_ids"]}
    intro["gregobase_id"] = 10
    _, improved = build_propers(catalog, occasions[:1], assignments, {})
    assert improved["matched"] > previous["matched"]
    validate_coverage(improved, baseline)


def test_run_check_detects_stale_artifacts_and_requires_review_for_improvements(tmp_path, monkeypatch):
    from pipeline import ordinary_form

    generated, coverage_path, baseline_path = (tmp_path / "propers.json", tmp_path / "coverage.json",
                                                tmp_path / "baseline.json")
    monkeypatch.setattr(ordinary_form, "GENERATED", generated)
    monkeypatch.setattr(ordinary_form, "COVERAGE", coverage_path)
    monkeypatch.setattr(ordinary_form, "BASELINE", baseline_path)
    result = ordinary_form.run(check=False)
    baseline_path.write_text(json.dumps({"schema_version": 1,
                                         "minimum_matched": result["matched"] - 1,
                                         "minimum_total": result["total"],
                                         "assignments": result["assignment_ids"],
                                         "mappings": result["mapping_ids"]}))
    with pytest.raises(ValueError, match="review and advance coverage-baseline"):
        ordinary_form.run(check=True)
    baseline_path.write_text(json.dumps({"schema_version": 1,
                                         "minimum_matched": result["matched"],
                                         "minimum_total": result["total"],
                                         "assignments": result["assignment_ids"],
                                         "mappings": result["mapping_ids"]}))
    generated.write_text("stale")
    with pytest.raises(ValueError, match="is stale"):
        ordinary_form.run(check=True)


def test_resolved_assignment_is_not_reported_unresolved_for_another_unexportable_candidate():
    catalog, occasions, assignments = sample_inputs()
    rejected = dict(catalog["pieces"][0])
    rejected["slug"] = "unexportable"
    rejected["sections"] = [dict(catalog["pieces"][0]["sections"][0], placed="order")]
    catalog["pieces"].append(rejected)
    _, coverage = build_propers(catalog, occasions[:1], assignments, {})
    assert coverage["unresolved_gregobase_urls"] == []
    assert coverage["unexportable_candidate_urls"]


@pytest.mark.parametrize(("kind", "value"), [("fixed", 3.5), ("easter", -47), ("easter", "-1")])
def test_calendar_rule_values_are_bounded_integers(kind, value):
    catalog, occasions, assignments = sample_inputs()
    calendar = {"kind": kind, "offset": value} if kind == "easter" else {
        "kind": kind, "month": 3, "day": value}
    with pytest.raises((TypeError, ValueError), match="integer|offset|out of range"):
        build_propers(catalog, [dict(occasions[0], calendar=calendar)], assignments, {})


def test_build_propers_keeps_empty_slots_distinct_from_missing_assignments():
    catalog, occasions, assignments = sample_inputs()
    assignments["Second Sunday"]["alleluia"] = []
    resolved, coverage = build_propers(catalog, occasions, assignments, {})
    assert "alleluia" in resolved["occasions"][0]["empty_slots"]
    assert "alleluia" not in resolved["occasions"][0]["parts"]
    assert "communio" in coverage["matched_by_slot"]


def test_build_propers_rejects_duplicate_keys_and_unreviewed_overrides():
    catalog, occasions, assignments = sample_inputs()
    with pytest.raises(ValueError, match="duplicate stable key"):
        build_propers(catalog, occasions + occasions[:1], assignments, {})
    overrides = {"st-joseph": {"introitus": {"id": 20, "incipit": "x", "reviewed": ""}}}
    with pytest.raises(ValueError, match="reviewed"):
        build_propers(catalog, occasions, assignments, overrides)


def test_build_propers_rejects_unmapped_source_names_and_invalid_calendar_metadata():
    catalog, occasions, assignments = sample_inputs()
    with pytest.raises(ValueError, match="unmapped jgabc source"):
        build_propers(catalog, occasions, assignments | {"Unexpected": {}}, {})
    bad = [dict(occasions[0], rank="made-up")]
    with pytest.raises(ValueError, match="rank"):
        build_propers(catalog, bad, assignments, {})


def test_build_propers_requires_exportable_owned_source_section():
    catalog, occasions, assignments = sample_inputs()
    catalog["pieces"][0]["sections"][0]["placed"] = "order"
    resolved, _ = build_propers(catalog, occasions, assignments, {})
    assert resolved["occasions"][0]["parts"][0]["lender"] is None


def test_reviewed_override_replaces_only_its_slot_and_keeps_season_and_semantic_kind():
    catalog, occasions, assignments = sample_inputs()
    overrides = {"ot-2": {"introitus": {"reviewed": "Codex", "source": {"page": 96},
                                         "assignments": [{"id": 99, "incipit": "Alternate",
                                                          "years": ["A", "B", "C"],
                                                          "seasons": ["easter"], "kind": "alleluia"}]}}}
    resolved, coverage = build_propers(catalog, occasions, assignments, overrides)
    parts = resolved["occasions"][0]["parts"]
    intro = next(p for p in parts if p["slot"] == "introitus")
    assert (intro["gregobase_id"], intro["seasons"], intro["kind"]) == (99, ["easter"], "alleluia")
    assert any(p["slot"] == "communio" and p["gregobase_id"] == 11 for p in parts)
    assert any('"seasons"' in identity for identity in coverage["assignment_ids"])


def test_vocabulary_maps_all_upstream_names_and_exact_stable_key_inventory():
    from pathlib import Path

    from pipeline.jgabc import load_novus

    rows = yaml.safe_load(Path("data/ordinary-form/occasions.yml").read_text())
    keys = {row["key"] for row in rows}
    expected = {*(f"advent-{n}" for n in range(1, 5)), *(f"lent-{n}" for n in range(1, 6)),
                "ash-wednesday", "palm-sunday", "holy-thursday", "good-friday", "easter-vigil",
                "easter", *(f"easter-{n}" for n in range(2, 8)), "ascension", "pentecost-vigil",
                "pentecost", "trinity", "corpus-christi", "sacred-heart", "christ-the-king",
                *(f"ot-{n}" for n in range(2, 34)), "christmas-day", "christmas-night",
                "christmas-dawn", "christmas-vigil", "holy-family", "mary-mother-of-god",
                "second-christmas", "epiphany", "baptism", "st-joseph", "annunciation",
                "presentation", "transfiguration", "exaltation-cross", "lateran-dedication",
                "nativity-john-baptist", "peter-paul", "assumption", "all-saints", "all-souls",
                "immaculate-conception", "birth-mary", "presentation-mary",
                "st-stephen", "st-john", "holy-innocents"}
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
    weekdays = {"advent-1-wednesday", "advent-1-thursday", "advent-1-friday", "advent-2-monday",
                "advent-2-tuesday", "advent-2-wednesday", "advent-2-friday", "advent-3-wednesday",
                "advent-3-friday", *(f"advent-late-{d}" for d in days), "advent-dec-19", "advent-dec-20",
                "christmas-octave", "christmas-octave-dec-29", "christmas-before-epiphany",
                "christmas-jan-4", "christmas-jan-7", "christmas-after-epiphany", "christmas-jan-8",
                "ash-thursday", "ash-friday", "ash-saturday",
                *(f"lent-{w}-{d}" for w in range(1, 6) for d in days),
                "holy-monday", "holy-tuesday", "holy-wednesday", *(f"easter-octave-{d}" for d in days),
                *(f"easter-{w}-{d}" for w in (2, 3, 4, 5, 7) for d in days),
                *(f"easter-6-{d}" for d in days[:5]),
                "easter-6-friday-after-ascension", "easter-6-saturday-after-ascension",
                "ot-1", "ot-1-monday", "ot-1-monday-year-1", "ot-1-tuesday-year-1"}
    assert keys == expected | weekdays
    assert {row["key"] for row in rows if row["rank"] == "weekday"} == weekdays
    mapped = {row["jgabc"] for row in rows if row["jgabc"] is not None}
    assert mapped == set(load_novus()["proprium"])


def test_year_sensitive_source_review_scopes_cover_exactly_documented_cycle_slots():
    from copy import deepcopy
    from pathlib import Path

    from pipeline.jgabc import load_novus

    occasions = yaml.safe_load(Path("data/ordinary-form/occasions.yml").read_text())
    assignments = load_novus()["proprium"]
    assert validate_cycle_review_coverage(occasions, assignments) == (40, 60)
    assert all(row.get("reviewed") is False for row in occasions if row.get("source_reviews"))

    missing_scope = deepcopy(occasions)
    reviewed = next(row for row in missing_scope if row.get("source_reviews"))
    reviewed["source_reviews"][0]["scope"]["cycle_sensitive_slots"].pop()
    with pytest.raises(ValueError, match="cycle-sensitive source review"):
        validate_cycle_review_coverage(missing_scope, assignments)

    falsely_expanded = deepcopy(occasions)
    reviewed = next(row for row in falsely_expanded if row.get("source_reviews"))
    required = reviewed["source_reviews"][0]["scope"]["cycle_sensitive_slots"]
    extra = next(slot for slot in ("introitus", "graduale", "alleluia", "tractus", "sequentia",
                                   "offertorium", "communio") if slot not in required)
    required.append(extra)
    with pytest.raises(ValueError, match="cycle-sensitive source review"):
        validate_cycle_review_coverage(falsely_expanded, assignments)

    additional_scope = deepcopy(occasions)
    reviewed = next(row for row in additional_scope if row.get("source_reviews"))
    reviewed["source_reviews"][0]["scope"]["incipit_checks"] = ["recorded separately"]
    reviewed["source_reviews"][0]["reviewer"] = "Codex source review"
    reviewed["source_reviews"][0]["date"] = "2026-10-12"
    reviewed["source_reviews"][0]["citation"] = "https://example.org/review"
    assert validate_cycle_review_coverage(additional_scope, assignments) == (40, 60)


def test_lender_selection_uses_same_kind_then_reviewed_ownership_then_volume_and_page():
    catalog, occasions, assignments = sample_inputs()
    occasions[0]["owned_day"] = "tempora:Epi2-0"
    base = catalog["pieces"][0]
    base["days"] = []

    def lender(slug, volume, page, kind, day=None, borrowed_ref=False):
        ref = f"{volume}/{page:04d}/000"
        return {"slug": slug, "volume": volume, "days": [day] if day else [], "linked_days": [],
                "printed_pages": [page], "systems": [] if borrowed_ref else [ref], "sections": [
                    {"kind": kind, "variant": "", "ref": ref, "gregobase_id": 10,
                     "placed": "label", "system": 0}]}

    candidates = [base, lender("borrowed", "noh1", 1, "introit", "tempora:Epi2-0", True),
                  lender("wrong-kind-owned", "noh1", 1, "gradual", "tempora:Epi2-0"),
                  lender("later-volume", "noh2", 1, "introit"),
                  lender("earlier-page", "noh1", 90, "introit"),
                  lender("owned", "noh1", 120, "introit", "tempora:Epi2-0")]
    catalog["pieces"] = candidates
    resolved, _ = build_propers(catalog, occasions[:1], assignments, {})
    selected = resolved["occasions"][0]["parts"][0]["lender"]
    assert selected["slug"] == "owned"
    catalog["pieces"] = list(reversed(candidates))
    reversed_result, _ = build_propers(catalog, occasions[:1], assignments, {})
    assert reversed_result["occasions"][0]["parts"][0]["lender"] == selected


def test_coverage_rejects_lost_assignment_and_changed_lender_mapping():
    baseline = {"schema_version": 1, "minimum_matched": 2, "minimum_total": 2,
                "assignments": ["a", "b"], "mappings": ["m1", "m2"]}
    with pytest.raises(ValueError, match="assignment identity"):
        validate_coverage({"matched": 2, "total": 2, "assignment_ids": ["a", "c"],
                           "mapping_ids": ["m1", "m2"]}, baseline)
    with pytest.raises(ValueError, match="mapping identity"):
        validate_coverage({"matched": 2, "total": 2, "assignment_ids": ["a", "b"],
                           "mapping_ids": ["m1", "m3"]}, baseline)


def test_coverage_rejects_shrinking_missing_assignment_denominator():
    baseline = {"schema_version": 1, "minimum_matched": 1, "minimum_total": 3,
                "assignments": ["a"], "mappings": ["m"]}
    with pytest.raises(ValueError, match="total denominator"):
        validate_coverage({"matched": 1, "total": 2, "assignment_ids": ["a"],
                           "mapping_ids": ["m"]}, baseline)


def weekday_row(**fields):
    return {"key": "ot-2-monday", "jgabc": None, "title_en": "Monday", "title_la": "Feria II",
            "rank": "weekday", "color": "g", "calendar": None, "weekday_of": "ot-2", **fields}


def weekday_override(slot, chant_id, incipit):
    return {"reviewed": "Claude", "source": {"page": 15},
            "assignments": [{"id": chant_id, "incipit": incipit}]}


def test_weekday_inherits_base_slots_and_applies_its_own_substitutions():
    catalog, occasions, assignments = sample_inputs()
    row = weekday_row(inherit_cycle_slots=["communio"])
    overrides = {"ot-2-monday": {"introitus": weekday_override("introitus", 11, "A")}}
    resolved, _ = build_propers(catalog, occasions + [row], assignments, overrides)
    weekday = next(o for o in resolved["occasions"] if o["key"] == "ot-2-monday")
    intro = [p["gregobase_id"] for p in weekday["parts"] if p["slot"] == "introitus"]
    communions = [(p["years"], p["gregobase_id"]) for p in weekday["parts"] if p["slot"] == "communio"]
    assert intro == [11]
    assert communions == [(["A", "C"], 11), (["B"], 12)]
    sunday = next(o for o in resolved["occasions"] if o["key"] == "ot-2")
    assert [p["gregobase_id"] for p in sunday["parts"] if p["slot"] == "introitus"] == [10]


def test_weekday_must_acknowledge_inherited_cycle_sensitive_slots():
    catalog, occasions, assignments = sample_inputs()
    with pytest.raises(ValueError, match="cycle-sensitive"):
        build_propers(catalog, occasions + [weekday_row()], assignments, {})
    overrides = {"ot-2-monday": {"communio": weekday_override("communio", 11, "A")}}
    resolved, _ = build_propers(catalog, occasions + [weekday_row()], assignments, overrides)
    weekday = next(o for o in resolved["occasions"] if o["key"] == "ot-2-monday")
    assert [p["gregobase_id"] for p in weekday["parts"] if p["slot"] == "communio"] == [11]


def test_weekday_omits_slots_and_carries_its_rubric():
    catalog, occasions, assignments = sample_inputs()
    row = weekday_row(omit_slots=["communio"], rubric_en="Alleluia ad libitum.")
    resolved, _ = build_propers(catalog, occasions + [row], assignments, {})
    weekday = next(o for o in resolved["occasions"] if o["key"] == "ot-2-monday")
    assert {p["slot"] for p in weekday["parts"]} == {"introitus"}
    assert weekday["rubric_en"] == "Alleluia ad libitum."
    assert "rubric_en" not in resolved["occasions"][0]


def test_weekday_base_must_exist_and_cannot_be_a_weekday():
    catalog, occasions, assignments = sample_inputs()
    with pytest.raises(ValueError, match="weekday_of"):
        build_propers(catalog, occasions + [weekday_row(weekday_of="missing")], assignments, {})
    chained = weekday_row(key="ot-2-tuesday", weekday_of="ot-2-monday")
    with pytest.raises(ValueError, match="weekday_of"):
        build_propers(catalog, occasions + [weekday_row(omit_slots=["communio"]), chained], assignments, {})


@pytest.mark.parametrize("state", ["present", "broken", "absent", "escape"])
def test_source_review_private_evidence_checks_available_clone(tmp_path, monkeypatch, state):
    from pathlib import Path

    from pipeline.jgabc import load_novus

    occasions = yaml.safe_load(Path("data/ordinary-form/occasions.yml").read_text())
    clone = tmp_path / "cantusorgani-docs"
    monkeypatch.setattr("pipeline.ordinary_form.docs_path", lambda root: clone)
    if state != "absent":
        clone.mkdir()
    evidence = "review.md" if state != "escape" else "../outside.md"
    if state == "present":
        (clone / evidence).write_text("Reviewed")
    for row in occasions:
        for review in row.get("source_reviews", []):
            review["evidence"] = "cantusorgani-docs/" + evidence
    if state in {"broken", "escape"}:
        with pytest.raises(ValueError, match="evidence path"):
            validate_cycle_review_coverage(occasions, load_novus()["proprium"])
    else:
        assert validate_cycle_review_coverage(occasions, load_novus()["proprium"]) == (40, 60)
