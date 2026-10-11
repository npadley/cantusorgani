# Ordinary Form Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution status (2026-10-11):** Tasks 1–9 are implemented and verified. The original per-step checklists below remain the implementation recipe; the execution record at the end records the actual grouped work and verification.

**Goal:** Let organists select a date in 2024–2050 under the Ordinary Form calendar and find the 1974 Graduale's chants and their NOH accompaniments.

**Architecture:** Vendor and validate the assignments in Python, resolve them against printed catalogue sections, and commit deterministic JSON. A separate TypeScript projection builds synthetic borrowed-only Pieces and static occasion pages; a pure calendar engine supplies the interactive date page. The existing catalogue, correction targets, score composition and PDF assets remain the source of music ownership.

**Tech Stack:** Python 3.12+, PyYAML, pytest; TypeScript, Astro, Vitest, Playwright; existing pnpm/uv workflows. No calendar dependency and no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-11-ordinary-form-calendar-design.md` (read it alongside this plan).

## Global Constraints

- Sundays and solemnities plus every explicitly named Triduum, Ash Wednesday, feast and memorial exception; no further saints’ feasts or memorials.
- “For any date 2024–2050, under any switch setting” the occasion and Sunday cycle must be correct.
- “General Roman Calendar: Epiphany on 6 January, Ascension and Corpus Christi on their Thursdays.”
- Header labels: “Extraordinary Form (1962)” and “Ordinary Form”; narrow labels “EF (1962)” and “OF”, with full accessible names.
- Existing `/calendar/` URL and EF rubric text remain unchanged; OF routes use `ordinary-form`.
- jgabc literals are never executed; generated assignments are never hand-edited.
- Match by exact GregoBase ID; missing chants are never substituted by title similarity.
- “Not in Nova Organi Harmonia”, “chants not yet mapped”, “Calendar settings changed”, and the weekday rubric copy use the spec's wording.
- Synthetic pieces never enter `allPieces()`, 1962 indexes, admin queues or review data.
- Available eligible lender typeset music is reused automatically inline and in PDF export, with existing proofreading status, source correction targets, scan switches and fallback behavior; no duplicate OF transcription or manifest entries.
- Settings use query parameters and localStorage inside try/catch; the page works without storage.
- National proper calendars, readings, Graduale Simplex and additional weekday propers remain outside this work.

## Review Focus

1. Different borrower variants sharing one lender/ref must produce distinct anchors, export selections and source correction targets (Task 5).
2. A catalogue change that retains the matched count but removes assignments or changes a lender must fail freshness/identity checks (Task 3).
3. Equal-rank solemnity collisions and privileged weekdays with no published proper must still resolve precedence correctly (Task 4).
4. A shared URL must reproduce defaults even when the recipient has saved transfers or storage throws (Tasks 7–8).
5. Empty assignment arrays, unmapped overrides and unexportable printed sections must remain distinct and never masquerade as resolved music (Tasks 2–3 and 6).

---

## Confirmed calendar decisions and implementation notes

The overall design fits this repository. There is no `PiecePage.astro` shared component: the existing score page is `web/src/pages/piece/[slug].astro`. `musicView()` and `exportSegments()` already accept lender lists and borrow by ref. The implementation needs a few small compatibility changes rather than a second score/export engine.

The user confirmed the calendar policy decisions below. Task 1 records their source-backed fixtures and implementation contracts; these decisions no longer require clarification. Source verification still must be performed.

- **Confirmed scope:** keep the explicit §3 exceptions, including Presentation of the BVM and Birth of the BVM; import every upstream occasion, schedule the explicit §3 list as named exceptions, and do not add further memorials. Each vocabulary row needs an explicit scheduling rule or `calendar: null`; Christmas Mass variants and vigils are separately reachable assignments, not competing daytime celebrations.
- **Feasts of the Lord:** “Elsewhere they are omitted that year” must distinguish an impeded feast from a feast occurring on an ordinary weekday. Confirmed: retain fixed weekday celebrations when precedence permits, and omit them when a higher-ranked day actually impedes them.
- **Precedence is richer than the vocabulary ranks:** Holy Week weekdays and Easter-octave weekdays occupy table position 2 even without an occasion page. Advent 17–24, Christmas-octave weekdays and Lenten weekdays occupy position 9. Model these background ranks independently from `occasion`. All Souls is a special commemoration at position 3; do not transfer it as an ordinary solemnity. Confirmed equal-rank policy: follow published authoritative precedence/transfer directives and documented exceptions, with citations and regression tests. Never use YAML order or guess; unresolved source rules block release.
- **Soft hyphens:** removing U+00AD from upstream `Twenty­first Sunday` yields `Twentyfirst Sunday`, not the example's `Twenty-first Sunday`. Follow the specified removal and use the actual normalized key in YAML; titles and stable slugs remain separately authored. Reject normalization collisions.
- **Assignments:** upstream IDs are decimal strings; arrays can contain several choices or be empty. A/B/C affects more slots than the research summary suggests. Preserve every supplied alternative and every year map; do not hard-code a small list of year-dependent communions. The source's Easter-season `graduale` labels and chant incipits also need review against the book before deciding presentation or defaults.
- **Weekday fallback:** `otWeek` alone cannot identify the preceding Sunday's actual celebration (Trinity, transferred Corpus Christi or a solemnity). Confirmed: add `precedingSundayOccasion: string | null` to `OfDay`, computed from the resolved calendar, including Sunday solemnities. If the preceding Sunday was outside Ordinary Time, show the rubric without suggesting an unrelated chant set. Never recursively fall back across seasons.
- **Christmas selection:** keep Christmas Day as the daytime `occasion`; add `christmas-vigil` as the evening `vigil` on December 24. Link Night/Dawn/Day Mass options on December 25 without implying clock-based selection. Confirmed: each option has its own assignments or the honest unmapped notice; no automatic clock-based selection.
- **Confirmed transfer presets:** General Roman = `jan6/thursday/thursday`; Sunday transfers = `sunday/sunday/sunday`; derive Custom for other combinations. Keep the individual switches, General Roman default and reset. Presets update effective settings without adding a full US calendar or a separate national-rules mode. Serialize only effective settings; derive the displayed preset after URL/storage loading.
- **Coverage ratchet:** comparing regeneration with a baseline overwritten by the same command cannot catch a regression. Keep a separately reviewed `coverage-baseline.json`, compare both counts and exact assignment identities, and verify generated files without rewriting them in `check.sh`. The quoted 357/387 is research context, not an established build baseline.
- **Borrowed composition:** current segment IDs use borrower slug + lender slug + start index, so variants can collide. `sectionName()` ignores `label` on most kinds, and `musicView()` inherits the lender's title. Fix these for OF year/alternative labels and incipits while retaining lender-based `sourceTarget`. The existing missing-reference notice otherwise claims a fake printed page for an unresolved OF slot.

Primary references for review and fixtures:

- [Universal Norms and precedence table, especially §§59–60](https://www.liturgyoffice.org.uk/Calendar/Info/Days.shtml): distinguish celebration rank from unscheduled privileged weekdays.
- [USCCB annual calendars](https://www.usccb.org/resources/liturgical-calendar-dioceses-united-states-america) and [2025 calendar](https://www.usccb.org/resources/2025cal.pdf): dated checks, including transferred Immaculate Conception. Treat US national additions and diocesan Ascension exceptions as outside the three-switch model.
- [Upstream OF assignments](https://github.com/bbloomf/jgabc/blob/master/propersdatanovus.js): pin a commit before importing; current source confirms string IDs, alternatives and year maps.
- Graduale Romanum (1974), CMAA scan: locate and record the exact edition, scan URL and printed page for each reviewed assignment during Task 1; do not treat the upstream file as authoritative evidence of correctness.

## Workspace and baseline

Planning worktree: `/Users/npadley/.codex/worktrees/ordinary-form-calendar-plan/nova-organi-harmonia-online`, created through the Codex native worktree tool from `codex/alleluia-verse-matches`, commit `e10b85d`. The spec is committed and travels with this checkout. The active checkout has unrelated agent-memory changes and an untracked review directory; neither was copied or edited.

Focused baseline: 79 tests passed in `tests/test_jgabc.py` and `tests/test_calendar_coverage.py`, using the existing checkout's Python environment. Pytest could not write its cache in the managed worktree under the current sandbox. Full setup/build/browser checks were not run for this documentation-only task. At implementation start, use this attached worktree, create `codex/ordinary-form-calendar` if it is still detached, run `uv sync --frozen`, frozen pnpm installs in `web` and `workers/corrections`, and `cd web && pnpm exec playwright install chromium`; then run `scripts/check.sh --quick` before editing implementation code. Record existing failures separately from this feature.

## File and data contracts

Hand-authored files:

- `data/ordinary-form/occasions.yml`: stable keys, source names, bilingual titles, ranks, colors, scheduling rules, review citations.
- `data/ordinary-form/overrides.yml`: per-occasion, per-slot replacement assignments and reviewed attribution; missing entries remain allowed.
- `data/ordinary-form/coverage-baseline.json`: ratchet floor and covered assignment identities, advanced only after review.
- `data/ordinary-form/calendar-fixtures.json`: dated external evidence and source metadata; fixtures never generated by the engine under test.
- `docs/superpowers/reviews/2026-10-11-ordinary-form-source-review.md`: coverage of the source checks and any proposed upstream reports.

Generated files: `data/jgabc-novus-propers.json`, `data/ordinary-form-propers.json`, `data/ordinary-form-coverage.json`. Keep each JSON schema explicitly validated at its consumer.

Resolved document schema version 1: `{schema_version, source, occasions: [...]}`. Each occasion contains `{key, title_en, title_la, rank, color, calendar, reviewed, assignment_status, parts}`. `assignment_status` is `mapped` or `unmapped`; an explicitly empty slot is not an unresolved part. A part is `{slot, variant, years, gregobase_id, incipit, lender}` as specified; `years` is a nonempty ordered subset of A/B/C. `lender` is `{slug, ref, part, variant}` or null. `variant` is stable borrower identity/anchor, not the displayed year label. Derive labels from `years`: `Communion (Years A and C)` for an A/C shared row in the all-years view, and `Communion (Year C)` when entered for cycle C; preserve option numbering independently. `variant` describes the borrower (`""`, `"2"`, `"year-a"`, `"year-a-2"`); lender variants remain independent. Merge identical alternatives across years into one row with multiple `years`, preserving first-seen source order. Do not merge distinct source alternatives by incipit alone.

`calendar` is null or a discriminated rule: `{kind: "fixed", month, day}`, `{kind: "easter", offset}`, `{kind: "advent", week}`, `{kind: "ordinary", week}`, or `{kind: "special", name}`. Special names: `holy-family`, `second-christmas`, `epiphany`, `baptism`, `ascension`, `corpus-christi`, `christ-the-king`. Liturgical Mass variants/vigils use `calendar: null` and explicit links from the calendar engine/UI. Define and validate the exact full key inventory in Task 1.

## Task 1: Lock the calendar and source acceptance fixtures

**Files:** Create the four hand-authored YAML/fixture/review files above. No runtime code changes.

**Interfaces:** Produces the stable occasion keys and reviewed `calendar` rules consumed by Tasks 2 and 4; fixture cases `{date, settings, expected: {occasion, vigil, sundayCycle, weekdayCycle, season, otWeek}, source: {url, page, note}}`.

- [ ] Record the confirmed decisions above in the source review document and fixtures: named exceptions, transfer presets, weekday feast behavior, actual preceding-Sunday fallback, Christmas options and source-backed equal-rank collision handling. Do not reopen these product decisions; research the authoritative rules needed to implement them.
- [ ] Pin jgabc to an exact commit; enumerate every upstream name and the six additional named occasions (Christmas Vigil and Dawn count separately). Specify slugs including `ot-2`–`ot-33`, `christ-the-king`, `st-joseph`, `sacred-heart`, `lateran-dedication`, `second-christmas`, `christmas-vigil`, `christmas-dawn`. Mark missing overrides honestly; no invented reviewer initials.
- [ ] Transcribe dated fixture cases for liturgical years 2025–2030 and edge years outside that window. Include 2024-12-08 Advent 2 / 2024-12-09 Immaculate Conception; 2024-04-08 Annunciation; 2035-03-17 St Joseph; 2025-06-29 Peter & Paul; 2025-11-02 All Souls; Sunday Christmas in 2033 with Holy Family 2033-12-30; transferred Epiphany/Baptism 2024-01-07/08 and 2029-01-07/08; and the January 8 Epiphany case in 2034. Cite each expectation rather than inferring it from another test.
- [ ] Independently identify earliest/latest Easter within 2024–2050 using published tables; include the associated season boundaries. Include each side of Advent 1 for Sunday and weekday cycles, and an equal-rank solemnity collision if one occurs in the supported range.
- [ ] Record source availability for 2025–2030: do not claim unpublished annual ordos were consulted. Use published norms and independently transcribed calendar evidence, and identify future dated corroboration still required.
- [ ] Plan 15 assignment spot checks covering every distinct A/B/C-dependent occasion (if more than 15, increase the sample), four Ordinary Time Sundays, all required new overrides and Triduum/Easter irregularities. Before Task 3, actually check all cases that can change the schema/presentation: year maps, alternatives, empty slots, Easter/Triduum slot labeling and required override structures. Leave the remaining agreed sample and final score/PDF inspection for Task 9. Require no unresolved source discrepancy affecting the data contract at this early gate. Record differences and reviewed initials only after actual checking. Upstream reporting is a release follow-up requiring explicit authorization to send.
- [ ] Commit the reviewed input vocabulary and fixtures: `docs: pin Ordinary Form calendar and chant acceptance cases`.

## Task 2: Vendor the second jgabc source safely

**Files:** Modify `pipeline/jgabc.py`, `pipeline/cli.py`, `tests/test_jgabc.py`; create `tests/fixtures/jgabc-novus.js` and `data/jgabc-novus-propers.json`.

**Interfaces:** Retain existing `fetch()` and EF loading APIs. Add `extract_novus(js: str) -> dict[str, object]`, `load_novus(path: Path = NOVUS_VENDORED) -> dict[str, object]`, and `fetch_all(commit: str | None = None) -> list[tuple[Path, str, int]]`. CLI `jgabc-fetch` calls `fetch_all`; both sources share one resolved commit.

- [ ] Add failing tests `test_novus_extract_ignores_trailing_concat`, `test_novus_normalizes_soft_hyphen_and_string_ids`, `test_novus_rejects_calls_and_bad_assignment_shapes`, `test_normalization_collision_fails`, and `test_fetch_all_failure_leaves_both_files_unchanged`. Assert `Twenty\u00adfirst Sunday` becomes `Twentyfirst Sunday`, ID `"403"` becomes positive integer 403, empty arrays survive, A/B/C arrays survive, embedded calls fail with the source filename/line, and a malformed second source preserves both existing files byte-for-byte. Reject booleans, nondecimal IDs, unknown slot names and opaque values in OF assignments.
- [ ] Run `uv run pytest tests/test_jgabc.py -q`; new tests fail on missing OF APIs while existing EF cases pass.
- [ ] Implement source-aware errors and extraction that validates the end of the selected literal without parsing the trailing helper statement. Preserve EF's existing opaque-variable behavior; OF schema validation is stricter. Prepare and validate both output documents before staging replacement files. Record repo, commit, source path/raw SHA and canonical content SHA; catch download/parser failures in the CLI with both filenames. Keep replacement backups and roll back both outputs if either ordinary filesystem replacement fails; inject a second-replacement failure test. Consumers must validate provenance and equal full commit SHAs across EF/OF documents, catching interrupted refreshes before generation.
- [ ] Run the same test command, then `uv run noh jgabc-fetch --commit <Task-1-SHA>`; require both integrity loaders to pass and document any EF diff caused by updating to the shared commit.
- [ ] Commit: `feat: vendor Ordinary Form jgabc assignments`.

## Task 3: Resolve chants and enforce coverage without a self-resetting baseline

**Files:** Create `pipeline/ordinary_form.py`, `tests/test_ordinary_form.py`, both generated OF JSON files and `data/ordinary-form/coverage-baseline.json`; modify `pipeline/cli.py`, `scripts/regenerate.sh`, `scripts/check.sh`, `.github/workflows/site.yml`, `.github/workflows/catalog-rebuild.yml`, `.github/workflows/publish.yml`, `.github/workflows/corrections-batch.yml`, `tests/test_cli_commands.py`.

**Interfaces:** `build_propers(catalog: dict, occasions: list[dict], assignments: dict, overrides: dict) -> tuple[dict, dict]`; `validate_coverage(actual: dict, baseline: dict) -> None`; CLI `noh ordinary-form` writes deterministic artifacts and prints a report; `noh ordinary-form --check` compares in-memory artifacts with committed bytes and validates the floor without writing.

- [ ] Add failing tests for bidirectional source-name validation, duplicate stable keys, invalid rank/color/rule, unreviewed override rejection, empty slots versus missing assignments, A/B/C grouping and alternative preservation. Overrides replace only named slots and record the source/reviewer; they do not erase other slots.
- [ ] Add parameterized resolution tests: same-kind before cross-kind; own chant before other printed occurrences; volume/page ordering then slug/ref as final ties; never resolve a borrowed citation as a printed source. Require `placed != "order"`, a ref present in the source systems, and a nonempty exportable range. A GregoBase hit without a trustworthy range remains unresolved and is reported separately.
- [ ] Add ratchet tests: a lost matched row fails; dropping a missing row from the denominator fails; a same-count changed assignment identity requires reviewed baseline migration; an improvement passes but `--check` requests the baseline advance; stale lender refs fail freshness. Assignment identity is `(occasion, slot, variant, years, gregobase_id)`. A separate reviewed mapping identity pins lender slug/ref/kind/variant and export start/end; changing it after regeneration requires an explicit reviewed baseline migration, even at the same count. Test catalogue change → regeneration → check, not only stale files.
- [ ] Run `uv run pytest tests/test_ordinary_form.py tests/test_cli_commands.py -q`; require failures for absent implementation.
- [ ] Implement the joins, sorted serialization and reports. Count normalized part rows once, not once per year; include matched/total by slot and occasion, unmapped occasions, cross-kind matches and unresolved GregoBase URLs. Determine own-chant preference from owned/non-linked calendar days and verified whole-piece pairing where present; document the tie-break evidence. Stable rebuilding must not depend on catalogue iteration order.
- [ ] Wire regeneration after the final catalogue overlay; `check.sh` and the independently scripted site CI workflow both run `noh ordinary-form --check` before the web build. Add OF regeneration after the final overlay in catalogue-rebuild, publish and corrections-batch workflows, and include both generated OF files in corrections-batch’s explicit staging list; never automatically stage an altered reviewed baseline. Verify a stale artifact fails the actual CI command. Keep source fetching out of regeneration and checks. Establish the initial floor from actual exportable matches; record why it differs from 357/387 if it does. Regeneration must not rewrite the baseline.
- [ ] Run tests, `uv run noh ordinary-form`, then `uv run noh ordinary-form --check`; run regeneration twice and require no second-pass changes to OF artifacts. Commit: `feat: resolve Ordinary Form chants with coverage guards`.

## Task 4: Compute the independent Ordinary Form calendar

**Files:** Create `web/src/lib/ordinaryForm.ts`, `web/src/lib/ordinaryForm.test.ts`; consume Task 1 fixtures and Task 3 occasion metadata.

**Interfaces:** Export the spec's `OfSettings`, `OfSeason`, `OfDay`, `ofDay(date: LocalDate, settings: OfSettings): OfDay`, with the confirmed `precedingSundayOccasion` extension. Export `DEFAULT_OF_SETTINGS` and `OF_YEARS = [2024, 2050]`. Reuse `LocalDate`, `easter`, `adventStart`, `addDays`, `daysBetween`, `weekday`, `nextSunday` from `liturgy.ts`; do not use EF season/rank logic.

- [ ] Add failing fixture tests with exact dated assertions, including `ofDay({year:2024,month:12,day:9}, DEFAULT_OF_SETTINGS).occasion === "immaculate-conception"`, 2024-04-08 `annunciation`, and 2035-03-17 `st-joseph`. Default/switch Ascension uses Easter +39/+42, Corpus Christi +60/+63, Sacred Heart +68. Check Monday Baptism after transferred January 7/8 Epiphany and correct ordinary numbering after it.
- [ ] Add exhaustive invariants for all 27 years × eight settings: every Sunday has one valid occasion, every returned key exists, transfer results have no conflicting winner, cycle dates change at Advent 1, and vigils have valid static pages. Pin weekday cycle parity to the reviewed liturgical-year rule. Include internal padding years 2023/2051 for boundary calculations without expanding public picker bounds.
- [ ] Add tests for privileged weekdays without pages, Annunciation in Holy Week/Easter octave, St Joseph's special transfer, All Souls on Sunday, impeded feasts and the Task 1 equal-rank decision. Assert season boundaries, OT week before Lent/after Pentecost and weekday fallback to an actual preceding Sunday solemnity; no fallback for Monday immediately after Baptism.
- [ ] Run `cd web && pnpm exec vitest run src/lib/ordinaryForm.test.ts`; require fixture tests to fail before implementation.
- [ ] Build candidates for the date's civil year and resolve transfers in a deterministic year schedule. Background precedence is independent of exported occasions. Cache schedules by year and all three settings inside the module if needed; keep observable behavior pure. Represent Holy Thursday's evening Triduum transition consistently with the date-only spec; state that `season` is the page's day classification, not a time-of-day calculation.
- [ ] Run the task tests and existing `src/lib/liturgy.test.ts`; commit: `feat: compute Ordinary Form dates and transfers`.

## Typeset music acceptance contract

The current architecture supports lender typeset reuse: `musicView()` keeps each printed part's lender `sourceTarget` and maps `systemSources`; `typeset.segments()` resolves those targets through the existing manifest, and `segmentKey()` uses original lender indices. `ExportBar` resolves `ExportSegment.source` through `pieceBySlug()` and calls `exportRuns()` on that real lender. Synthetic Pieces need not enter `allPieces()` for this to work.

Reuse means **eligible existing renders**, following the current unchecked-boundary and proofreading policy. Inline music uses narrow/wide SVGs, retains per-part proofreading notices and correction links to `typeset:<file>`, and offers page-wide/per-part scan switches. PDF export uses the lender's Letter/A4 PDFs for complete eligible ranges, uses scans for partial/ineligible ranges, and follows the displayed scan/typeset choice. Missing/broken renders must follow the existing fallback/error policy and must never silently omit music. Repeated borrower variants sharing a lender have unique export IDs but the same lender-based typeset key; pin their switch synchronization in browser tests. Keep OF year labels separate from source ownership.

## Task 5: Adapt borrowed score composition for year variants

**Files:** Modify `web/src/lib/exportParts.ts`, `web/src/lib/music.ts`, `web/src/lib/catalog.ts` and their `.test.ts` files; modify `web/src/components/SystemStack.astro` and its tests for synchronized repeated lender views; modify `web/src/components/ExportBar.astro` and its tests for conservative group scan-state lookup; extend `web/src/lib/typeset.test.ts` for composed typeset boundaries and export runs.

**Interfaces:** Preserve signatures of `exportSegments`, `musicView`, `partAnchor`, `sectionName`. OF labels/variant keys come from Task 3's contracts; lender source indices and correction targets remain original.

- [ ] Add failing tests with a synthetic borrower containing two year-specific rows that share the same lender/ref: unique segment IDs, unique `communion-year-a`/`communion-year-b` anchors, two selectable segments and exact source stems. Add cross-kind borrowing and two alternatives in one slot. Assert composed headings preserve borrower incipit/label, while `sourceTarget` is `part:<lender>/<printed-kind>:<printed-variant>`.
- [ ] Run `cd web && pnpm exec vitest run src/lib/exportParts.test.ts src/lib/music.test.ts src/lib/catalog.test.ts` and identify the expected new failures.
- [ ] Include borrower part index/identity in borrowed segment IDs. Preserve borrower title and label in composed parts. Honor explicit OF labels in `sectionName()` only under the reviewed OF variant convention; preserve current EF labels and hymn/other rules. Synchronize per-part view changes across every DOM occurrence with the same lender typeset key; propagate render-failure scan state across the group, and make `ExportBar.showsScans()` inspect all matching occurrences: any image error or explicit scan choice exports scans; otherwise use the explicit typeset choice/page preference. Test switching or erroring the second occurrence before both Letter/A4 exports. Keep unique export-selection IDs separate from shared source-view keys. OF parts use their normalized sung order, following the existing Vesperale ordered-parts precedent. Do not feed `OfSeason` into EF `seasonGroup()`.
- [ ] Add typeset regression tests with a deterministic manifest/render fixture: a composed borrower resolves the lender target and narrow/wide SVGs; `segmentKey(composed, start)` equals the lender key; `exportRuns(lender, start, end)` supplies Letter/A4 PDFs for a complete render and scans for partial/unchecked ranges. Include a non-typeset sibling and a repeated year variant; no lookup may use `part:of-<key>/...`.
- [ ] Re-run these tests plus `src/lib/typeset.test.ts` and existing export/TypesetSwitch component tests; verify no EF or Vespers order/default changes. Commit: `fix: preserve borrowed chant variants in scores and exports`.

## Task 6: Build synthetic Pieces and static occasion pages

**Files:** Create `web/src/lib/ordinaryFormPieces.ts`, its `.test.ts`, `web/src/pages/ordinary-form/[key].astro`, `web/src/components/OrdinaryFormPage.test.ts`; extend `SystemStack.astro` and its tests for explicit OF missing-notice and composed-source accessible-caption branches; the current caption uses `volumeLabel(piece)`/`pagesLabel(piece)`, which cannot describe a synthetic volume. Create `web/src/lib/ordinaryFormPageClient.ts` for the cycle-aware static page export initialization described below.

**Interfaces:** `ordinaryFormPieces(): readonly Piece[]`; `ordinaryFormPiece(key: string): Piece | undefined`; `ordinaryFormParts(key: string, cycle: "A" | "B" | "C"): readonly OfResolvedPart[]`; export `OfResolvedPart` matching Task 3 fields in camelCase. `ordinaryFormHref(key: string, cycle?: "A" | "B" | "C"): string` returns `/ordinary-form/<key>/`, adding a validated cycle query when supplied; use it for occasion, vigil and Christmas-option links. Validate the JSON instead of double-casting it. `mountOrdinaryFormPage(root: HTMLElement): void` parses an optional validated `?cycle=A|B|C`, highlights relevant parts and initializes export choices through the existing checkbox change/refresh contract.

- [ ] Add failing adapter tests: all rows produce borrowed parts; `allPieces()` remains identical; part/ref/volume/page resolve to real lenders; year/alternative labels are derived from the row’s `years`, including `Communion (Years A and C)` / `Communion (Year A, option 2)`; cycle C entry shows an A/C shared row as `Communion (Year C)` and excludes the separate B row from initial export selection; unmapped occasions have zero parts and an explicit status. Invalid generated keys/refs/years fail the build with the occasion named.
- [ ] Add failing Astro container tests modeled on `PiecePage.test.ts`: a three-lender score's `data-ref` order equals its export stems; missing OF chant says `Not in Nova Organi Harmonia` and links to GregoBase without a fictitious page 0; unmapped occasion says `chants not yet mapped`; corrections links name lender targets; repeated year variants retain separate anchors. For a lender with an eligible render, assert the inline SVG URLs, proofreading state, original `typeset:<file>` correction URL and export `data-runs` contain the same lender Letter/A4 PDFs; a scans-only sibling still renders its scan systems.
- [ ] Run `cd web && pnpm exec vitest run src/lib/ordinaryFormPieces.test.ts src/components/OrdinaryFormPage.test.ts` and require failures.
- [ ] Build Pieces with stable prefixed IDs/slugs (`of-<key>`), division `ordinary-form`, genre `proper`, empty own systems, empty EF days/linkedDays, source note explaining the 1974 projection, and lender-derived citations. Use neutral required metadata without displaying a synthetic volume or page range, including screen-reader captions: describe the assembled OF occasion and cite real lender sources separately. Never add synthetic entries to `catalog.json` or `pieceBySlug()`.
- [ ] Render the new route with `Layout`, `MovementNav`, `musicView`, `SystemStack`, `TypesetSwitch` and `ExportBar`. Derive export segments from the original borrowed-only Piece and inline music from its composed view. Pass explicit segments if needed; show all year/alternative parts on static pages with clear labels. A calendar link passes its cycle; then initially untick other-year rows while leaving all applicable same-year alternatives selectable and initially ticked. Direct pages without a valid cycle retain the existing all-parts default. Place visible copy next to export explaining the selected cycle or all-years default, and that multiple alternatives are selected until the organist chooses the required chants. Do not silently select a preferred alternative. Test initial checkbox state and the actual selected PDF contents for both entry paths; ensure initialization refreshes export count/button state without altering EF behavior. Use `sourceTarget` for section corrections and omit synthetic whole-piece edit links. Add OF missing notices to the existing notice mechanism while keeping EF wording unchanged.
- [ ] Run task tests plus `PiecePage.test.ts`, `music.test.ts` and typeset source tests; commit: `feat: publish Ordinary Form accompaniment pages`.

## Task 7: Add shareable calendar settings and date results

**Files:** Create `web/src/lib/ordinaryFormSettings.ts`, `.test.ts`, `web/src/pages/calendar/ordinary-form/index.astro`, `web/src/lib/ordinaryFormCalendarClient.ts`.

**Interfaces:** `readOfSettings(query: URLSearchParams, stored: unknown): OfSettings`; `ofQuery(date: LocalDate, settings: OfSettings): URLSearchParams`; `mountOrdinaryFormCalendar(root: HTMLElement): void`; `OfPreset = "general-roman" | "sunday-transfers" | "custom"`; `presetForSettings(settings: OfSettings): OfPreset`; `settingsForPreset(preset: Exclude<OfPreset, "custom">): OfSettings`. Custom is a derived indication, not a third stored settings configuration. Storage key `cantusorgani.ordinary-form.settings.v1`; JSON contains exactly the three validated settings.

- [ ] Add failing settings tests: valid URL values win; the presence of any recognized setting parameter makes omitted/invalid values use defaults, not saved values; with no settings parameters use valid stored values; invalid stored data defaults. `ofQuery()` includes date and all three settings so a shared default link overrides a recipient's saved preferences. Unknown query values are ignored. Reset creates an explicit all-default URL and safely persists defaults. Add assertions that General Roman maps to `jan6/thursday/thursday`, Sunday transfers to `sunday/sunday/sunday`, all six other combinations derive Custom, and URL/storage loading updates the derived preset. Presets preserve the selected date and cycle; individual edits recompute the preset. No redundant preset query/storage value is needed.
- [ ] Run `cd web && pnpm exec vitest run src/lib/ordinaryFormSettings.test.ts`; require failures, then implement the pure parsing/serialization helpers.
- [ ] Implement the Astro page using the EF date picker controls, bounds and styles, with an accessible General Roman / Sunday transfers preset control and derived Custom indication, plus a fieldset/radio pair for each individual setting. Mount the separate client module. Read/write storage inside independent try/catch blocks, render using DOM nodes/textContent, and support browser back/forward. Do not fetch per-year JSON. Keep controls stable during render; announce changed results in an `aria-live="polite"` region and retain focus on the operated control. Associate invalid/range feedback with the date input via `aria-describedby`/`aria-invalid`, and disable boundary navigation appropriately.
- [ ] Render occasion title, bilingual name, color text/swatch, cycles (`Year A · Weekday Year II`), current-cycle parts and year labels. Link resolved chants to lender piece anchors using lender kind/variant and `pieceHref()`; link missing IDs to GregoBase. Place a prominent `View accompaniments for this occasion` link with the occasion heading/list, carrying `?cycle=<current-cycle>` to the synthetic occasion page; retain the individual source links. Show vigils explicitly as evening options and reviewed Christmas Mass choices. Weekdays use the exact spec notices and the resolved preceding-Sunday link.
- [ ] Invalid ISO dates and dates outside the range show an explicit range notice; navigation cannot leave bounds. Today outside the range shows that notice rather than silently choosing another liturgical date. Add changed-settings/reset notice and source footer specifying the General Roman Calendar and only three national variations.
- [ ] Run settings/calendar unit tests and `pnpm exec astro check`; commit: `feat: add Ordinary Form date picker and transfer settings`.

## Task 8: Wire navigation, discovery and browser acceptance checks

**Files:** Modify `web/src/components/Layout.astro`, `web/src/pages/calendar/index.astro`, `web/src/pages/index.astro`, `web/public/llms.txt`, `data/LICENSES.md`, `web/src/pages/about.astro`, `web/src/lib/seo.ts`; create `web/e2e/ordinary-form.e2e.ts`; update existing navigation/discovery/search tests where assertions change.

**Interfaces:** Existing sitemap generator and Pagefind discover rendered indexable pages; no second search index. EF route remains `/calendar/`; OF route `/calendar/ordinary-form/`.

- [ ] Add failing browser tests for desktop and narrow header labels/accessibility, EF heading and unchanged rubric, home link, and the default 2026 cycle result. Exercise both presets, derived Custom for individual edits, all switches, changed/reset state, reload/share in a separate context with opposing saved values, back/forward, invalid query/storage JSON and blocked storage get/set.
- [ ] Add OF typeset browser cases using committed valid SVG/PNG and Letter/A4 PDF fixtures and controlled asset responses, including worker-originated requests and `?export=1`; fail unexpected remote asset requests in deterministic tests: eligible SVGs shown by default; page-wide and per-part scan switches; remembered scan preference on reload; image failure shows the scans; repeated lender keys switch consistently. Capture actual export requests/content for both Letter and A4 to prove typeset PDFs are used in typeset view and scan systems in scan view, with a mixed typeset/scans occasion retaining all music. Verify existing PDF failure behavior without silently dropping a section.
- [ ] Add browser cases for A/B/C chant filtering and alternatives, an unmapped override, an ordinary weekday after a Sunday solemnity, non-ordinary weekday notice, vigil option, and date bounds. Add search test finding an OF page and discovery assertion that every occasion has a canonical sitemap URL. Test a Year B date → composed page → applicable year export, retaining lender typeset PDFs. Add keyboard tests for each radio group/reset, polite result updates and invalid/range input feedback. At a narrow viewport, settings and long year/option labels must wrap, movement anchors must work, selections must remain scrollable and the sticky export bar must not obscure controls or focus. Use named fixed dates, not today's date.
- [ ] Implement header labels using full accessible names and CSS short labels; change EF heading to `Calendar: Extraordinary Form (1962)`. Add the home line `Find the Mass for any date in the Ordinary Form`. Update about/SEO/llms copy that currently promises only a 1962 calendar; distinguish chants assigned by GR1974 from music printed in NOH. Credit jgabc's pinned OF source and Unlicense in LICENSES and explain source correction limits.
- [ ] Run `cd web && pnpm exec astro check && pnpm exec vitest run`; then `pnpm build` and `CI=true pnpm exec playwright test e2e/ordinary-form.e2e.ts e2e/search.e2e.ts e2e/site.e2e.ts`. Require successful build/link/discovery checks, canonical OF URLs and searchable rendered text. Commit: `feat: connect Ordinary Form calendar navigation and discovery`.

## Task 9: Verify source accuracy, composed export and release readiness

**Files:** Update Task 1 source review, reviewed fields/overrides and baseline when justified; add regression cases to the owning tests for any discrepancy. Modify `docs/OPERATIONS.md` with fetch/regeneration/ratchet instructions.

**Interfaces:** Uses all previously defined contracts. No new APIs.

- [ ] Complete the assignment review described in Task 1, recording reviewer initials, scan URL, printed page, slot/year/alternative and outcome. Every year-dependent assignment case and the required overrides must have evidence; expand beyond 15 occasions if needed. Document any GR1974/OCM edition differences explicitly. Prepare upstream discrepancy notes without sending messages unless authorized.
- [ ] Run exhaustive rule/invariant checks for all 216 year/setting schedules and independently verify the sourced fixture set. These are distinct evidence classes; release requires full rule/edge-case fixture coverage and no unexplained disagreement, using accepted normative evidence for future years rather than requiring unpublished annual ordos. Check the calendar's unscheduled privileged weekdays and transferred solemnities against external evidence, not just exhaustive Sunday-count invariants. Keep any unavailable future-ordo corroboration recorded as a limitation.
- [ ] Choose an actual generated occasion with at least three lenders. In the browser verify scan ordering, per-part corrections links and typeset source switches; export a PDF and inspect every section against its lender refs, including a year-specific repeated lender. Verify both Letter and A4 in typeset and scan views, inspecting that eligible lender typeset pages appear in typeset exports and all selected music remains present in mixed/fallback exports. Retain the existing CI predeployment `typeset-check --remote` gate and separately verify real selected lenders’ scan fallback availability and PDF CORS behavior. Mocked export tests do not establish deployed asset availability. Verify the typeset render error path and source correction links; document any existing export failure behavior rather than promising unimplemented fallback. Do not declare this checked from HTML alone.
- [ ] Run `scripts/regenerate.sh`, `uv run noh ordinary-form --check`, and `scripts/check.sh` in the implementation worktree. Require no unexpected generated diff, passing pipeline/worker/web/browser checks, and no synthetic additions to EF indexes/admin/review outputs. Document environment-caused missing source PDF or LilyPond limits separately; do not report skipped checks as passed.
- [ ] Commit legitimate coverage gains together with the updated floor/assignment identities. Update operations documentation, then commit: `docs: verify Ordinary Form sources and release checks`.

## Dependency order and acceptance

Execute Tasks 1–4 in order; Task 5 can follow Task 3, but Task 6 needs both. Task 7 requires Tasks 4 and 6; Tasks 8–9 complete integration. This is one plan because the calendar, resolution and pages jointly deliver one user-visible feature.

Completion requires accurate dated fixtures, all eight settings across the full supported range, reviewed vocabulary/policy, the agreed assignment sample plus every year-dependent case and filled override, a pinned upstream-source trust policy for remaining assignments, deterministic guarded artifacts, correct multi-lender score/PDF export and passing integration checks. A missing NOH chant or explicitly unfilled override is a supported, disclosed outcome. Do not require a complete manual transcription of all assignments: remaining assignments rely on the accepted pinned upstream source. Every filled override and mandatory verification case must be checked; resolve any discrepancy or explicitly exclude/disclose it before release. Unresolved calendar-policy conflicts remain blockers.

Self-review: every design section maps to Tasks 1–9; shared API names and borrower/lender variant distinctions are consistent; all five Review Focus cases have owning tests. The calendar policy decisions above are confirmed and reflected in the spec. Source evidence, full artifact review and execution-method selection precede implementation; no feature code has been started.

## Cross-functional review disposition

CEO, UI/UX and DevOps feedback was verified against the existing code and incorporated: bounded source verification, early schema checks, cycle-aware composed-page entry and explicit alternative selection, dynamic accessibility/mobile acceptance, CI/workflow generation coverage, reviewed lender mappings, refresh rollback and deterministic asset fixtures. Engineering feedback also corrected merged-year labels, shared-key export state and synthetic score captions; final dispositions are recorded in the companion review report. These are plan requirements, not implemented behavior.

## Calendar decision closure (2026-10-11)

The user confirmed all six remaining policy items: keep named exceptions; add transfer-only presets; retain eligible weekday feasts of the Lord; link the actual preceding Sunday without cross-season substitution; offer separate Christmas Mass choices; use authoritative equal-rank directives with cited tests. No calendar product decision remains open. Task 1 still must establish the cited rules and fixtures, and release cannot rely on an unverified collision rule.


## Source-verified implementation refinements (2026-10-11)

GR1974 p553 changes Annunciation's interlectional chants in Paschal time. Parts may include an optional `seasons` availability list using the calendar's season enum and an optional semantic `kind` using the catalogue proper-part vocabulary (`introit`, `gradual`, `alleluia`, `tract`, `sequence`, `offertory`, `communion`). Missing `seasons` means all seasons. The first Paschal Alleluia occupies the `graduale` source slot with `kind: alleluia`; the second occupies `alleluia`. These are consecutive chants, not alternatives. Preserve source-slot order and include these fields in assignment/mapping coverage identities. Other Easter-season first interlectional chants are labeled according to the book rather than the upstream slot's name. Date-to-score links carry validated cycle and season; static pages retain all seasonal options.

The user approved applying the year-specific 2022 John the Baptist transfer provisionally to June 23 in 2033 and 2044. June 23 and 24 in those years must visibly identify the policy as provisional. Future authoritative guidance may supersede it; the source review must not claim a permanent ecclesiastical directive.


The exhaustive collision audit additionally found Thursday Corpus Christi / John the Baptist on 2038-06-24. The user approved provisional Corpus Christi precedence with John the Baptist moved to June 25, disclosed on both affected dates. With Sunday Corpus Christi selected, John remains June 24. This is a product policy awaiting future authoritative corroboration, not a claimed 2038 directive.

## Execution record — 2026-10-11

The user authorized implementation in the isolated `codex/ordinary-form-calendar` worktree and requested cheaper reusable agents. Pipeline, calendar and web workers were reused for integration bugs. A fresh final engineering reviewer inspected the complete implementation and accepted the scoped source-review fix. The earlier CEO/product, UI/UX, DevOps and engineering plan feedback was incorporated before implementation.

- [x] Task 1: Pin vocabulary, source evidence, calendar fixtures and confirmed policy decisions.
- [x] Task 2: Vendor both sources safely at the existing full pinned commit, with parser and rollback regressions.
- [x] Task 3: Generate exact lender mappings and enforce reviewed coverage/assignment/range identities.
- [x] Task 4: Implement calendar precedence, seasons and cycles across all 216 year/setting schedules and every supported date.
- [x] Task 5: Project borrowed sections with distinct assignment anchors and original lender correction/export identities.
- [x] Task 6: Build static occasion scores with cycle/season export selection, typeset reuse and scan fallback.
- [x] Task 7: Implement dated navigation, transfer presets, individual switches, storage and shareable URL state.
- [x] Task 8: Connect both calendar forms, discovery/search, responsive controls and browser regressions.
- [x] Task 9: Review sources, actual live assets and composed exports; complete regeneration and the full verification script.

`scripts/regenerate.sh` and `scripts/check.sh` completed successfully. Final verification: 1,579 Python tests passed (4 skipped, 119 slow tests deselected, 1 expected failure), 900 web tests passed, 86 worker tests passed and 87 browser tests passed. Astro reported zero errors and warnings with five hints. The build found all 1,734 pages reachable without broken internal links. All 440 resolved mappings were checked against the web export contract. Real-asset Letter/A4 mixed and scan exports completed, with the assembled Letter PDF inspected page by page; see the source review for evidence and scope.

Coverage is 440 of 482 part rows. St Joseph, Sacred Heart, Lateran dedication and second Christmas Sunday remain explicitly unmapped, a supported outcome in the specification. The 2033/2044 June 23 and 2038 June 25 John the Baptist transfers remain user-approved, visibly provisional policies. No unpublished annual ordo or human music-editor approval is claimed. Upstream discrepancy notes are prepared; no external message has been sent.

The task recipe's suggested commit sequence is consolidated into coherent documentation, pipeline/data and web commits. The branch and worktree are preserved for review; no merge, push or deployment is part of this execution.
