"""Resolve the Ordinary Form's pinned GR1974 assignments against printed NOH sections."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

from pipeline.doc_paths import docs_path, docs_reference
from pipeline.jgabc import load_sources

ROOT = Path(__file__).resolve().parent.parent
OCCASIONS = ROOT / "data/ordinary-form/occasions.yml"
OVERRIDES = ROOT / "data/ordinary-form/overrides.yml"
BASELINE = ROOT / "data/ordinary-form/coverage-baseline.json"
GENERATED = ROOT / "data/ordinary-form-propers.json"
COVERAGE = ROOT / "data/ordinary-form-coverage.json"
REVIEW_MANIFEST = ROOT / "data/ordinary-form/review-manifest.yml"
RANKS = {"triduum", "privileged", "solemnity", "feast-of-the-lord", "sunday", "feast", "memorial", "weekday"}
COLORS = {"g", "w", "v", "r"}
SEASONS = {"advent", "christmas", "lent", "triduum", "easter", "ordinary"}
KINDS = {"introitus": "introit", "graduale": "gradual", "alleluia": "alleluia",
         "tractus": "tract", "sequentia": "sequence", "offertorium": "offertory",
         "communio": "communion"}
RULES = {"fixed": {"month", "day"}, "easter": {"offset"}, "advent": {"week"},
         "ordinary": {"week"}, "special": {"name"}}
SPECIAL_NAMES = {"holy-family", "second-christmas", "epiphany", "baptism", "ascension",
                 "corpus-christi", "christ-the-king"}


def _load_yaml(path: Path, fallback: Any) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else fallback


def load_inputs() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    occasions = _load_yaml(OCCASIONS, [])
    overrides_doc = _load_yaml(OVERRIDES, {"occasions": []})
    return occasions, _index_overrides(overrides_doc)


def validate_cycle_review_coverage(occasions: list[dict[str, Any]],
                                   assignments: dict[str, Any]) -> tuple[int, int]:
    """Require truthful, slot-scoped attribution for every documented cycle map."""
    manifest = _load_yaml(REVIEW_MANIFEST, {})
    required = manifest.get("cycle_sensitive_assignments", {}) if isinstance(manifest, dict) else {}
    expected_occasions = required.get("occasion_count")
    expected_slots = required.get("slot_count")
    if (not isinstance(expected_occasions, int) or isinstance(expected_occasions, bool) or
            not isinstance(expected_slots, int) or isinstance(expected_slots, bool) or
            expected_occasions <= 0 or expected_slots <= 0):
        raise ValueError("review manifest must pin positive cycle-sensitive occasion and slot counts")
    sensitive: dict[str, list[str]] = {}
    for name, proper in assignments.items():
        if not isinstance(proper, dict):
            continue
        normalized_name = name.replace("\u00ad", "")
        for slot, year_map in proper.items():
            if not isinstance(year_map, dict) or not set(year_map) <= set("ABC"):
                continue
            cycle_rows = [year_map.get(year, []) for year in "ABC"]
            if any(rows != cycle_rows[0] for rows in cycle_rows[1:]):
                sensitive.setdefault(normalized_name, []).append(slot)
    for name, slots in sensitive.items():
        slots.sort(key=lambda slot: list(KINDS).index(slot) if slot in KINDS else len(KINDS))
    expected_total = sum(map(len, sensitive.values()))
    if (len(sensitive), expected_total) != (expected_occasions, expected_slots):
        raise ValueError("pinned source no longer matches the review manifest's cycle-sensitive scope")

    mapped: dict[str, dict[str, Any]] = {}
    for row in occasions:
        name = row.get("jgabc")
        if name is None:
            continue
        normalized_name = name.replace("\u00ad", "")
        if normalized_name in mapped:
            raise ValueError(f"duplicate source-review vocabulary entry: {normalized_name}")
        mapped[normalized_name] = row

    for name, row in mapped.items():
        reviews = row.get("source_reviews", [])
        if not isinstance(reviews, list):
            raise TypeError(f"{name}: source_reviews must be an array")
        claimed_slots: list[str] = []
        for review in reviews:
            if not isinstance(review, dict):
                raise TypeError(f"{name}: invalid source review attribution")
            reviewer, review_date = review.get("reviewer"), review.get("date")
            evidence, citation, scope = review.get("evidence"), review.get("citation"), review.get("scope")
            if not isinstance(reviewer, str) or not reviewer.strip():
                raise ValueError(f"{name}: source review requires reviewer attribution")
            try:
                if not isinstance(review_date, str) or date.fromisoformat(review_date).isoformat() != review_date:
                    raise ValueError
            except ValueError as exc:
                raise ValueError(f"{name}: source review date must be ISO YYYY-MM-DD") from exc
            if not isinstance(evidence, str) or not evidence.strip():
                raise ValueError(f"{name}: source review requires an evidence path")
            external = docs_reference(evidence)
            evidence_root = docs_path(ROOT) if external is not None else ROOT
            evidence_path = (evidence_root / (external if external is not None else evidence)).resolve()
            if not evidence_path.is_relative_to(evidence_root.resolve()):
                raise ValueError(f"{name}: source review evidence path escapes its repository")
            # CI has no private docs clone. Check evidence files when it is available.
            if (external is None or evidence_root.is_dir()) and not evidence_path.is_file():
                raise ValueError(f"{name}: source review evidence path does not exist in the repository")
            parsed_citation = urlparse(citation) if isinstance(citation, str) else None
            if not parsed_citation or parsed_citation.scheme != "https" or not parsed_citation.netloc:
                raise ValueError(f"{name}: source review requires an HTTPS citation")
            if not isinstance(scope, dict) or not scope:
                raise ValueError(f"{name}: source review requires a nonempty scope")
            cycle_slots = scope.get("cycle_sensitive_slots", [])
            if (not isinstance(cycle_slots, list) or
                    any(not isinstance(slot, str) or slot not in KINDS for slot in cycle_slots) or
                    len(cycle_slots) != len(set(cycle_slots))):
                raise ValueError(f"{name}: invalid cycle-sensitive source review scope")
            claimed_slots.extend(cycle_slots)
        slots = sensitive.get(name, [])
        if set(claimed_slots) != set(slots) or len(claimed_slots) != len(slots):
            raise ValueError(f"{name}: cycle-sensitive source review scope must match the documented slots")
    return len(sensitive), expected_total


def _index_overrides(doc: Any) -> dict[str, dict[str, Any]]:
    if isinstance(doc, dict) and "occasions" in doc:
        indexed: dict[str, dict[str, Any]] = {}
        for row in doc.get("occasions") or []:
            key = str(row["occasion"])
            indexed.setdefault(key, {})[str(row["slot"])] = row
        return indexed
    return doc if isinstance(doc, dict) else {}


def _validate_occasion(row: dict[str, Any]) -> None:
    key = row.get("key")
    if not isinstance(key, str) or not key:
        raise ValueError("occasion key must be a nonempty string")
    if row.get("rank") not in RANKS:
        raise ValueError(f"{key}: invalid rank {row.get('rank')!r}")
    if row.get("color") not in COLORS:
        raise ValueError(f"{key}: invalid liturgical color {row.get('color')!r}")
    if not all(isinstance(row.get(name), str) and row[name] for name in ("title_en", "title_la")):
        raise ValueError(f"{key}: bilingual titles are required")
    rule = row.get("calendar")
    if rule is not None:
        if not isinstance(rule, dict) or rule.get("kind") not in RULES:
            raise ValueError(f"{key}: invalid calendar rule")
        allowed = {"kind"} | RULES[rule["kind"]]
        if set(rule) != allowed:
            raise ValueError(f"{key}: invalid calendar rule fields")
        if rule["kind"] == "special" and rule["name"] not in SPECIAL_NAMES:
            raise ValueError(f"{key}: unknown special calendar rule")
        for field in RULES[rule["kind"]]:
            if (rule["kind"] == "special" and not isinstance(rule[field], str)) or (
                    rule["kind"] != "special" and
                    (not isinstance(rule[field], int) or isinstance(rule[field], bool))):
                raise TypeError(f"{key}: calendar rule values must be integers")
        if rule["kind"] == "fixed" and (not 1 <= rule["month"] <= 12 or not 1 <= rule["day"] <= 31):
            raise ValueError(f"{key}: fixed date out of range")
        if rule["kind"] == "advent" and not 1 <= rule["week"] <= 4:
            raise ValueError(f"{key}: Advent week out of range")
        if rule["kind"] == "ordinary" and not 2 <= rule["week"] <= 33:
            raise ValueError(f"{key}: Ordinary Time week out of range")
        if rule["kind"] == "easter" and not -46 <= rule["offset"] <= 68:
            raise ValueError(f"{key}: Easter offset out of range")
    for field in ("omit_slots", "inherit_cycle_slots"):
        slots = row.get(field, [])
        if not isinstance(slots, list) or any(slot not in KINDS for slot in slots):
            raise ValueError(f"{key}: {field} must list chant slots")
        if slots and not row.get("weekday_of"):
            raise ValueError(f"{key}: {field} applies only to a weekday_of occasion")
    if "rubric_en" in row and (not isinstance(row["rubric_en"], str) or not row["rubric_en"]):
        raise ValueError(f"{key}: rubric_en must be a nonempty string")
    semantic = row.get("semantic_kinds", {})
    if not isinstance(semantic, dict) or any(slot not in KINDS or kind not in set(KINDS.values())
                                              for slot, kind in semantic.items()):
        raise ValueError(f"{key}: invalid semantic chant-kind map")
    if semantic and not row.get("semantic_kind_source"):
        raise ValueError(f"{key}: semantic chant-kind map requires a cited source")


def _assignment_rows(value: Any, key: str, slot: str, source: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise TypeError(f"{key}.{slot}: expected an assignment array from {source}")
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("id"), int) or isinstance(item.get("id"), bool):
            raise TypeError(f"{key}.{slot}: invalid GregoBase assignment type")
        if not isinstance(item.get("incipit"), str):
            raise TypeError(f"{key}.{slot}: chant incipit must be a string")
        if "seasons" in item and (not isinstance(item["seasons"], list) or not item["seasons"] or
                                  set(item["seasons"]) - SEASONS):
            raise ValueError(f"{key}.{slot}: invalid seasons filter")
        if "kind" in item and item["kind"] not in set(KINDS.values()):
            raise ValueError(f"{key}.{slot}: invalid semantic chant kind")
    return value


def _by_year(value: Any, key: str, slot: str) -> dict[str, list[dict[str, Any]]]:
    if isinstance(value, dict):
        if not value or set(value) - {"A", "B", "C"}:
            raise ValueError(f"{key}.{slot}: year map must use A/B/C")
        return {year: _assignment_rows(rows, key, slot, "jgabc") for year, rows in value.items()}
    if isinstance(value, list) and value and all(isinstance(item, dict) and "years" in item for item in value):
        out = {year: [] for year in "ABC"}
        for item in value:
            years = item.get("years")
            if not isinstance(years, list) or not years or set(years) - set("ABC"):
                raise ValueError(f"{key}.{slot}: override years must be a nonempty subset of A/B/C")
            for year in "ABC":
                if year in years:
                    out[year].append(item)
        return {year: _assignment_rows(rows, key, slot, "override") for year, rows in out.items()}
    return {year: _assignment_rows(value, key, slot, "jgabc") for year in "ABC"}


def _slot_order(slot: str) -> str:
    return KINDS[slot]


def _catalog_matches(catalog: dict[str, Any], chant_id: int) -> tuple[list[dict[str, Any]], list[str]]:
    good: list[dict[str, Any]] = []
    unresolved: list[str] = []
    volume_data = catalog.get("volumes", {})
    volumes = set(volume_data) if isinstance(volume_data, dict) else {v.get("id") for v in volume_data}
    for piece in catalog.get("pieces", []):
        systems = piece.get("systems") or []
        for section in piece.get("sections") or []:
            if section.get("gregobase_id") != chant_id:
                continue
            ref = section.get("ref")
            export_range = _section_range(piece, section)
            if (section.get("placed") == "order" or not isinstance(ref, str) or
                    "/" not in ref or ref.split("/", 1)[0] not in volumes or
                    not isinstance(section.get("system"), int) or
                    section["system"] < 0 or section["system"] >= len(systems) or
                    systems[section["system"]] != ref or export_range is None):
                unresolved.append(f"https://gregobase.selapa.net/chant.php?id={chant_id}")
                continue
            good.append({"piece": piece, "section": section, "export_range": export_range})
    return good, sorted(set(unresolved))


def _section_range(piece: dict[str, Any], section: dict[str, Any]) -> dict[str, int] | None:
    """A printed section runs from its first system to the next printed section or piece end."""
    systems = piece.get("systems") or []
    start = section.get("system")
    if (not isinstance(start, int) or isinstance(start, bool) or start < 0 or
            start >= len(systems) or section.get("ref") != systems[start]):
        return None
    starts = sorted({s["system"] for s in piece.get("sections") or []
                     if isinstance(s.get("system"), int) and not isinstance(s.get("system"), bool) and
                     s["system"] > start and s["system"] < len(systems) and
                     s.get("placed") != "order"})
    end = starts[0] if starts else len(systems)
    return {"start": start, "end": end} if end > start else None


def _section_variant(section: dict[str, Any]) -> str:
    """Mirror catalog.ts parsePart's key/n/variant precedence."""
    key = section.get("key")
    if key:
        return str(key)
    number = section.get("n")
    if number:
        return str(number)
    return str(section.get("variant") or "")


def _own_day(row: dict[str, Any]) -> str | None:
    """Use only an explicitly reviewed OF-to-EF calendar mapping."""
    day = row.get("owned_day")
    return day if isinstance(day, str) and day else None


def _candidate_rank(candidate: dict[str, Any], slot: str, occasion: dict[str, Any],
                    semantic_kind: str | None = None) -> tuple[Any, ...]:
    piece, section = candidate["piece"], candidate["section"]
    own_day = _own_day(occasion)
    owned = int(own_day is not None and own_day in (piece.get("days") or []) and
                own_day not in (piece.get("linked_days") or []))
    kind = int(section.get("kind") == (semantic_kind or _slot_order(slot)))
    pages = piece.get("printed_pages") or [10**9]
    volume = str(piece.get("volume", ""))
    volume_number = int(volume[3:]) if volume.startswith("noh") and volume[3:].isdigit() else 10**9
    return (-kind, -owned, volume_number, min(pages), piece.get("slug", ""), section.get("ref", ""),
            _section_variant(section))


def _override_values(overrides: dict[str, Any], key: str) -> dict[str, Any]:
    values: dict[str, Any] = {}
    override_slots = overrides.get(key, {})
    if isinstance(override_slots, dict):
        for slot, override in override_slots.items():
            if not isinstance(override, dict) or not override.get("reviewed"):
                raise ValueError(f"{key}.{slot}: override must record reviewed attribution")
            if not override.get("source"):
                raise ValueError(f"{key}.{slot}: override must record its source")
            values[slot] = override.get("assignments", override.get("rows", []))
    return values


def _slot_values(name: str | None, assignments: dict[str, Any], overrides: dict[str, Any],
                 key: str) -> dict[str, Any]:
    proper = assignments.get(name, {}) if name is not None else {}
    slot_values = dict(proper) if isinstance(proper, dict) else {}
    slot_values.update(_override_values(overrides, key))
    return slot_values


def _weekday_slot_values(row: dict[str, Any], base: dict[str, Any], assignments: dict[str, Any],
                         overrides: dict[str, Any]) -> dict[str, Any]:
    """A weekday Mass is its Sunday's chants with the printed weekday substitutions.

    A base slot whose chant changes with the Sunday cycle is usually a Sunday-only
    choice, so inheriting one must be stated in inherit_cycle_slots."""
    key = row["key"]
    base_name = base.get("jgabc")
    base_values = _slot_values(None if base_name is None else base_name.replace("\u00ad", ""),
                               assignments, overrides, base["key"])
    own = _override_values(overrides, key)
    omitted = set(row.get("omit_slots", []))
    if omitted & set(own):
        raise ValueError(f"{key}: a slot cannot be both omitted and substituted")
    values: dict[str, Any] = {}
    for slot, value in base_values.items():
        if slot in omitted or slot in own:
            continue
        by_year = _by_year(value, key, slot)
        if (any(by_year.get(year) != by_year.get("A") for year in "BC") and
                slot not in row.get("inherit_cycle_slots", [])):
            raise ValueError(f"{key}.{slot}: inherits a cycle-sensitive Sunday slot; "
                             "substitute it or list it in inherit_cycle_slots")
        values[slot] = value
    values.update(own)
    return values


def _source_assignment_rows(name: str, assignments: dict[str, Any], overrides: dict[str, Any], key: str,
                            semantic_kinds: dict[str, str] | None = None,
                            slot_values: dict[str, Any] | None = None) -> tuple[dict[str, Any], list[str]]:
    if slot_values is None:
        slot_values = _slot_values(name, assignments, overrides, key)
    semantic_kinds = semantic_kinds or {}
    out: dict[str, Any] = {}
    empty: list[str] = []
    for slot, value in slot_values.items():
        if slot not in KINDS:
            raise ValueError(f"{key}: unknown slot {slot!r}")
        year_rows = _by_year(value, key, slot)
        if slot in semantic_kinds:
            semantic_kind = semantic_kinds[slot]
            if semantic_kind not in set(KINDS.values()):
                raise ValueError(f"{key}.{slot}: invalid reviewed semantic kind")
            year_rows = {year: [{**chant, "kind": semantic_kind} for chant in rows]
                         for year, rows in year_rows.items()}
        if all(not rows for rows in year_rows.values()):
            empty.append(slot)
            continue
        grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
        normalized_by_year: dict[str, list[tuple[Any, ...]]] = {}
        for year in "ABC":
            occurrences: dict[tuple[Any, ...], int] = {}
            normalized_by_year[year] = []
            for option, row in enumerate(year_rows.get(year, [])):
                seasons = tuple(row.get("seasons", []))
                semantic_kind = row.get("kind")
                identity = (row["id"], row["incipit"], seasons, semantic_kind)
                occurrences[identity] = occurrences.get(identity, 0) + 1
                sig = (*identity, occurrences[identity])
                normalized_by_year[year].append(sig)
                part = grouped.setdefault(sig, {"slot": slot, "variant": "", "years": [],
                                                "gregobase_id": row["id"], "incipit": row["incipit"],
                                                "option_by_year": {}})
                if seasons:
                    part["seasons"] = list(seasons)
                if semantic_kind:
                    part["kind"] = semantic_kind
                if year not in part["years"]:
                    part["years"].append(year)
                part["option_by_year"].setdefault(year, option)
        year_specific = any(set(normalized_by_year[year]) != set(normalized_by_year["A"])
                            for year in "BC")
        # Assign variants once after merging years by chant identity. Reordered
        # alternatives then merge, while repeated identical rows remain distinct.
        for part in grouped.values():
            option_index = part["option_by_year"][part["years"][0]]
            option_variant = "" if option_index == 0 else str(option_index + 1)
            part.pop("option_by_year")
            part["variant"] = f"year-{part['years'][0].lower()}" if year_specific else ""
            if option_variant:
                part["variant"] = f"{part['variant']}-{option_variant}" if part["variant"] else option_variant
        for part in grouped.values():
            if part.get("seasons"):
                season_variant = "season-" + "-".join(part["seasons"])
                part["variant"] = f"{part['variant']}-{season_variant}" if part["variant"] else season_variant
        out[slot] = list(grouped.values())
    return out, empty


def _identity(row: dict[str, Any]) -> str:
    return json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def build_propers(catalog: dict[str, Any], occasions: list[dict[str, Any]], assignments: dict[str, Any],
                  overrides: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    keys: set[str] = set()
    source_names: set[str] = set()
    normalized_assignments: dict[str, Any] = {}
    for name, value in assignments.items():
        normalized = name.replace("\u00ad", "")
        if normalized in normalized_assignments:
            raise ValueError(f"jgabc source name normalization collision: {normalized}")
        normalized_assignments[normalized] = value
    for name in normalized_assignments:
        # Every source name must be explicitly mapped; the source keys are not public keys.
        if not any(row.get("jgabc") == name for row in occasions):
            raise ValueError(f"unmapped jgabc source occasion: {name}")
    results: list[dict[str, Any]] = []
    assignment_ids: list[str] = []
    mapping_ids: list[str] = []
    matched_by_slot: dict[str, int] = {}
    total_by_slot: dict[str, int] = {}
    cross_kind: list[dict[str, Any]] = []
    unresolved: set[str] = set()
    unexportable: set[str] = set()
    by_key = {row.get("key"): row for row in occasions}
    for row in occasions:
        _validate_occasion(row)
        key, name = row["key"], row.get("jgabc")
        base = by_key.get(row.get("weekday_of")) if row.get("weekday_of") else None
        if row.get("weekday_of") and (base is None or base.get("weekday_of") or name is not None):
            raise ValueError(f"{key}: weekday_of must name a non-weekday occasion and replace jgabc")
        if key in keys:
            raise ValueError(f"duplicate stable key: {key}")
        keys.add(key)
        if name is not None:
            name = name.replace("\u00ad", "")
            if name not in normalized_assignments:
                raise ValueError(f"occasion {key} names absent jgabc source {name!r}")
            source_names.add(name)
        semantic = row.get("semantic_kinds")
        slot_values = None
        if base is not None:
            semantic = {**base.get("semantic_kinds", {}), **(semantic or {})}
            slot_values = _weekday_slot_values(row, base, normalized_assignments, overrides)
        by_slot, empty_slots = _source_assignment_rows(name, normalized_assignments, overrides, key,
                                                       semantic, slot_values)
        parts: list[dict[str, Any]] = []
        for slot, _kind in KINDS.items():
            for part in by_slot.get(slot, []):
                identity = {"occasion": key, "slot": slot, "variant": part["variant"],
                            "years": part["years"], "gregobase_id": part["gregobase_id"]}
                if "seasons" in part:
                    identity["seasons"] = part["seasons"]
                if "kind" in part:
                    identity["kind"] = part["kind"]
                assignment_ids.append(_identity(identity))
                total_by_slot[slot] = total_by_slot.get(slot, 0) + 1
                candidates, unresolved_urls = _catalog_matches(catalog, part["gregobase_id"])
                if candidates:
                    unexportable.update(unresolved_urls)
                else:
                    unresolved.update(unresolved_urls)
                if not candidates:
                    unresolved.add(f"https://gregobase.selapa.net/chant.php?id={part['gregobase_id']}")
                candidates.sort(key=lambda c: _candidate_rank(c, slot, row, part.get("kind")))
                lender = None
                if candidates:
                    picked = candidates[0]
                    piece, section = picked["piece"], picked["section"]
                    lender = {"slug": piece["slug"], "ref": section["ref"], "part": section["kind"],
                              "variant": _section_variant(section)}
                    matched_by_slot[slot] = matched_by_slot.get(slot, 0) + 1
                    if section.get("kind") != (part.get("kind") or _kind):
                        cross_kind.append({"occasion": key, "slot": slot, "part": section.get("kind"),
                                           "gregobase_id": part["gregobase_id"]})
                mapping = {**identity, "lender": lender}
                if candidates:
                    mapping["export_range"] = candidates[0]["export_range"]
                if lender is not None:
                    mapping_ids.append(_identity(mapping))
                parts.append({**part, "lender": lender})
        result = {"key": key, "title_en": row["title_en"], "title_la": row["title_la"],
                  "rank": row["rank"], "color": row["color"], "calendar": row.get("calendar"),
                  "reviewed": bool(row.get("reviewed", False)),
                  "source_reviews": row.get("source_reviews", []),
                  "assignment_status": "mapped" if parts or empty_slots else "unmapped",
                  "parts": parts, "empty_slots": empty_slots}
        if row.get("rubric_en"):
            result["rubric_en"] = row["rubric_en"]
        results.append(result)
    if len(source_names) != len(normalized_assignments):
        raise ValueError("occasion vocabulary does not map every jgabc source name")
    matched = sum(matched_by_slot.values())
    total = sum(total_by_slot.values())
    source = load_sources()[1]["source"]
    coverage = {"schema_version": 1, "source": source, "matched": matched,
                "total": total, "matched_by_slot": dict(sorted(matched_by_slot.items())),
                "total_by_slot": dict(sorted(total_by_slot.items())),
                "matched_by_occasion": {key: sum(p["lender"] is not None for p in item["parts"])
                                        for key, item in ((i["key"], i) for i in results)},
                "unmapped_occasions": [i["key"] for i in results if i["assignment_status"] == "unmapped"],
                "cross_kind_matches": cross_kind, "unresolved_gregobase_urls": sorted(unresolved),
                "unexportable_candidate_urls": sorted(unexportable),
                "assignment_ids": sorted(assignment_ids), "mapping_ids": sorted(mapping_ids)}
    doc = {"schema_version": 1, "source": source, "occasions": results}
    return doc, coverage


def validate_coverage(actual: dict[str, Any], baseline: dict[str, Any]) -> None:
    if baseline.get("schema_version") != 1:
        raise ValueError("unsupported coverage baseline schema")
    if actual.get("matched", 0) < baseline.get("minimum_matched", 0):
        raise ValueError("matched coverage fell below its reviewed minimum")
    if actual.get("total", 0) < baseline.get("minimum_total", 0):
        raise ValueError("total denominator fell below its reviewed floor")
    if not set(baseline.get("assignments", [])) <= set(actual.get("assignment_ids", [])):
        raise ValueError("assignment identity changed; review and migrate the coverage baseline")
    if not set(baseline.get("mappings", [])) <= set(actual.get("mapping_ids", [])):
        raise ValueError("mapping identity changed; review and migrate the coverage baseline")


def serialize(doc: dict[str, Any]) -> bytes:
    return (json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def run(catalog_path: Path | None = None, check: bool = False) -> dict[str, Any]:
    catalog_path = catalog_path or ROOT / "data/catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    occasions, overrides = load_inputs()
    _, novus = load_sources()
    assignments = novus["proprium"]
    validate_cycle_review_coverage(occasions, assignments)
    doc, coverage = build_propers(catalog, occasions, assignments, overrides)
    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else {
        "schema_version": 1, "minimum_matched": 0, "minimum_total": 0, "assignments": [], "mappings": []}
    validate_coverage(coverage, baseline)
    if check:
        if (coverage["matched"] > baseline.get("minimum_matched", 0) or
                coverage["total"] > baseline.get("minimum_total", 0) or
                set(coverage["assignment_ids"]) != set(baseline.get("assignments", [])) or
                set(coverage["mapping_ids"]) != set(baseline.get("mappings", []))):
            raise ValueError("coverage improved or gained identities; review and advance coverage-baseline.json")
        for path, value in ((GENERATED, doc), (COVERAGE, coverage)):
            if not path.exists() or path.read_bytes() != serialize(value):
                raise ValueError(f"{path.name} is stale; run uv run noh ordinary-form")
    else:
        GENERATED.write_bytes(serialize(doc))
        COVERAGE.write_bytes(serialize(coverage))
    return coverage


__all__ = ["build_propers", "load_inputs", "run", "validate_coverage", "validate_cycle_review_coverage"]
