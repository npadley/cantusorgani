# Autoplan Review: 2026-09-07-noh5-kyriale-pilot-plan.md

**Date**: 2026-09-07
**Plan**: `docs/claudekit/plans/2026-09-07-noh5-kyriale-pilot-plan.md`
**Reviewers**: ceo-reviewer, eng-reviewer, design-reviewer, devex-reviewer (parallel)

## Overall Scores

| Reviewer | Overall | Lowest dimension |
|---|---|---|
| CEO | 5.0/10 | Demand reality: 2/10 |
| ENG | 4.2/10 | Rollback & migration: 2/10 |
| DESIGN | 3.8/10 | Visual consistency: 3/10; Accessibility: 3/10 |
| DEVEX | 2.8/10 | Time to Hello World / CLI ergonomics / Docs: 2/10 |

### Full scorecards

**CEO** — Ambition 5, Problem clarity 5, Wedge focus 7, Demand reality 2, Future-fit 6
**ENG** — Data flow 5, Failure modes 5, Edge cases & invariants 5, Test matrix 4, Rollback 2
**DESIGN** — Hierarchy 5, Visual consistency 3, State coverage 4, Accessibility 3, Polish 4
**DEVEX** — TTHW 2, CLI 2, Error copy 4, Docs 2, Magical moments 4

## Critical Issues (worst first)

| Reviewer | Dimension | Score | Issue | Status |
|---|---|---|---|---|
| CEO | Demand reality | 2 | 33 tasks, no user validation anywhere; "user" appears nowhere in the plan | Fixed (Tasks 0, 34) |
| ENG | Rollback | 2 | No rollback story; R2 objects overwritten in place under stable URLs; `CREATE IF NOT EXISTS` with no down-migrations | Fixed (Task 33 contract, content-hashed R2) |
| DEVEX | TTHW | 2 | No README, no runnable command; seeing one page requires implementing Tasks 1–4 by hand | Fixed (Task 32b, Task 0b) |
| DEVEX | CLI | 2 | Task 12 invokes `pipeline.cli`, which no task defines | Fixed (Task 0a) |
| DEVEX | Docs | 2 | Only doc artefact was `data/LICENSES.md`; dataset not reproducible by a stranger | Fixed (Task 32b, provenance fields) |
| DESIGN | Visual consistency | 3 | No typography, colour, spacing or token task existed in Phase 6 | Fixed (Task 23a) |
| DESIGN | Accessibility | 3 | Only `aria-label` + per-slice alt noise; nothing on keyboard, contrast, zoom, print | Fixed (Task 25 steps 3–6) |
| ENG | Test matrix | 4 | Three tests passed while the behaviour they name was broken | Fixed (ENG 14–16, 20) |
| DESIGN | State coverage | 4 | Loading/empty/error/offline/unverified states named in design doc, unimplemented in plan | Fixed (Task 25 step 3) |

## Verified blocking defects

Traced by hand against the plan before applying. The plan could not have executed
as written.

1. **`group_systems` failed its own test.** Test data gives `height=48`,
   threshold `120`, actual gap `152` → returns 2 systems where the test asserts 1.
   Worse, any ratio loose enough to pass would merge adjacent systems, because the
   inter-system gap is exactly where the Latin text sits.
2. **`loadCatalog` shipped `undefined` to every template.** Python emitted
   `schema_version`/`printed_pages`; TypeScript declared `schemaVersion`/
   `printedPages` behind `as unknown as Catalog`. Compiles, then fails at runtime.
3. **The corrections form could never submit.** Pages and Worker are different
   origins; a JSON POST preflights with `OPTIONS`; the handler answered `405`.

Four more confirmed:

4. **Blank pages silently rotated −5°** — `best_score = -1.0` with strict `>`
   means the first angle tested wins on a variance tie.
5. **`to_bboxes` split each system's Latin text across two slices** while
   `test_boxes_never_overlap` still passed — the exact failure Task 11 exists to
   prevent.
6. **The offset sampler's `body[len(body)//5:]` equals 46 only by coincidence**
   with NOH5's offset; wrong for every other volume.
7. **Task 12's fixture list mixed printed and PDF page numbers**, so Missa I was
   never actually in the fixture set and only 3 of 12 pages were labelled.

## Strengths (all reviewers)

- [CEO, ENG, DEVEX] Offset discipline — derived, voted, confidence-scored,
  hard-gated — kills the highest-damage bug class. Unchanged by this review.
- [CEO, ENG] Task 15's decision to hand-transcribe the measurably degraded index
  rather than fight OCR is correct engineering judgement.
- [CEO, ENG, DEVEX] Task 12 is a real stop-the-line gate in the right place.
- [CEO, DESIGN, DEVEX] `unverified` with `display: true` — "show it, but labelled,
  never silently drop" — encodes editorial honesty as a test.
- [DESIGN] Task 11 protects the actual reading unit (text above staff, mode left).
- [ENG] Task 30's revalidate-on-the-way-out defends against data that entered D1
  before a schema tightening.
- [DEVEX] `data/LICENSES.md` written before the ingest code — the right order.

## Applied fixes (all 16 bundles selected; 47 edits, 0 stale matches)

**Pipeline correctness** — `group_systems` rewritten to positional grouping with a
gap-ordering assertion; `group_staves` given absolute spacing bounds (was a 50%
"tolerance"); `find_staff_lines` given vertical closing and peak-relative
thresholding; `estimate_skew` given a blank-page tie guard; `to_bboxes` stops above
the next system's text line; `read_folio` refuses ambiguous readings; offset sampler
reads `first_body_pdf_page` from `volumes.yml`.

**Contracts** — explicit snake_case→camelCase catalog mapping with `schema_version`
check; `review_status` split from `chant.status`; `RecordStatus` added to `Piece`.

**Tests** — skew test now actually rotates; fixture list corrected to PDF page
numbers with all 12 labelled; dead param replaced with three real folio cases; new
invariants for unclaimed systems, dangling refs and reading order.

**Worker** — Turnstile `siteverify` wired; CORS preflight, Origin allowlist,
content-type check; D1-based rate limiting replacing the non-atomic KV limiter;
`CORRECTIONS_ENABLED` kill switch; `toPublicRow` emits validated values; API errors
name legal fields and expected patterns.

**Durability** — content-hashed R2 keys (write-if-absent); full rollback contract
table; versioned D1 migrations with down-scripts; persisted `derived-offsets.json`;
pytest `source` markers so CI skips the 230 MB-dependent tests.

**DevEx** — new Task 0a (`noh` CLI with manifests and resume), Task 0b
(`noh doctor` preflight), Task 32b (README + REPRODUCING + `.dev.vars.example`),
segmentation overlay and contact sheet, source provenance fields.

**Design** — new Task 23a (tokens, type scale, dark-mode scan inversion for organ
consoles, forbidden-patterns list); `SystemStack` rewritten with intrinsic
dimensions and a single figcaption; four states specified; reading affordances,
print stylesheet and keyboard/focus added; exact published copy for every pairing
and record status; full export and search state copy.

**Strategy** — Goal rewritten as a problem statement; Task 0 (recruit named
organists), Task 34 (three real services before NOH1), Task 35 (bulk export,
Internet Archive deposit, Zenodo DOI, continuity doc).

## Skipped fixes

**CEO fix 5 — defer all of Phase 7 (corrections) until after launch.** Not applied.
The author explicitly chose Approach 3 in the design phase in order to accept
corrections from day one ("once I put this up, I'd like to start taking corrections
immediately"). The reviewer's reasoning — that a rate-limited corrections API
protects an empty mailbox — is sound in the abstract but overrides a decision the
author already made with that trade-off in view. Recorded here rather than applied.

## Resulting plan

35 tasks (was 33), 2,473 lines (was 1,782).
