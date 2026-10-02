# Corrections compatibility implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user chooses delegated execution. Steps use checkbox syntax for tracking.

**Goal:** Keep public reports distinct, compatible with the current catalogue, and visible throughout invited-editor review and publication.

**Architecture:** Retain the existing public Worker, shared D1 database, Pages admin and GitHub publication workflow. Add a target-aware index migration and reconcile public status with canonical stored fields without weakening intake validation or publishing private notes. Use current catalogue data to exercise compatibility across boundaries.

**Tech stack:** TypeScript, Astro, Cloudflare Workers/D1, Vitest, Node SQLite and Playwright.

**Spec:** [Corrections readiness audit](/Users/npadley/.codex/visualizations/2026/09/29/01a0ed15-775f-7cf1-8af8-796f433443bd/corrections-audit-2026-10-01.md); `docs/EDITING.md`; `data/schema/corrections.json`.

## Global constraints

- Public reports; invited editors review and publish through the existing workflow.
- Free-text submitter notes remain private. Browser output uses textContent.
- Preserve existing D1 records; use a new migration, leaving migrations 0001–0003 unchanged.
- Preserve the public intake field names and existing API row keys.
- No live migration, deployment, main merge or typeset source-editor implementation in this change.

## Review focus

- Legacy null targets and explicit piece targets represent the same deduplication identity.
- Distinct sections and Vespers items remain independent when values coincide.
- Reader reports survive admin normalization, approval, queueing and acceptance.
- Current catalogue keys/genres and Mass sections remain reportable.
- Unknown or malformed stored data is excluded; private notes never enter public output.

### Task 1: Preserve distinct reports

**Files:** Create `workers/corrections/migrations/0004_target_deduplication.sql`; modify `web/src/lib/admin/testing.ts`; add migration regression coverage under `web/src/lib/admin/`.

**Interfaces:** Consume real migrations and `testDb(upTo)`; retain the existing `idx_corrections_dedupe` name with identity `(COALESCE(target, 'piece:' || piece_id), field, proposed)` for pending rows.

- [ ] Write tests that upgrade a populated migration-0003 database, preserve its records, allow equal-valued reports for different parts/Vespers items, reject same-target duplicates, and equate null with explicit piece targets. Approved records must not block new pending reports.
- [ ] Run the new migration tests and confirm the existing index causes the expected collision failure.
- [ ] Add migration 0004 and include it in the test database migration list. Discuss rollback constraints: restoring the old index may fail after distinct reports have been stored; never discard those reports automatically.
- [ ] Run migration and existing admin tests, then commit this deliverable on the implementation branch.

### Task 2: Reconcile intake and public status with current data

**Files:** Modify `workers/corrections/src/schema.ts`, `workers/corrections/src/status.ts`, their tests; add catalogue/lifecycle regressions under `web/src/lib/admin/` where real catalogue and approval dependencies already load.

**Interfaces:** Keep `parseCorrection(input)` as the public intake boundary and `toPublicRow(StoredRow): PublicRow | null` as the stored-row projection. Translate canonical `printed_pages`/`start_system`/target-specific `chant` into public names before boundary validation. Validate editor-normalized title/incipit against the canonical shared plain-text schema rather than silently dropping valid editor punctuation. Preserve unknown-field rejection and note omission.

- [ ] Write failing tests for all seven rejected catalogue targets, a 30-character valid key and an over-limit key, and every current catalogue genre including proper.
- [ ] Write failing status tests for canonical field aliases across approved, queued and accepted states, legacy null targets, valid editor-normalized text, invalid values and private-note omission.
- [ ] Add an integration test that submits/seeds a real reader report, invokes actual admin approval, and projects the stored row through the Worker serializer. Cover page ranges and section start/chant fields.
- [ ] Run the tests and verify expected boundary failures before implementation.
- [ ] Align variant length to 30 and add proper to the controlled genre set. Implement canonical stored-row projection without broadening unauthenticated intake unnecessarily.
- [ ] Run Worker tests/typecheck and admin lifecycle/catalogue regressions, then commit.

### Task 3: Make public reporting and status context accurate

**Files:** Modify `web/src/pages/corrections/index.astro`; add focused coverage in `web/e2e/site.e2e.ts` or a dedicated corrections e2e file.

**Interfaces:** Consume existing `/corrections/targets.json` and catalogue option data. Enable section reporting for Proper and Mass ordinary pieces, including missing sections. Retain fixed-target source ownership. Display the human-readable target label, with the raw target as a fallback if no longer in the current catalogue.

- [ ] Write browser regressions selecting a Kyriale Mass and submitting section context, rendering two equal-valued reports for distinct targets, and verifying hostile queue text stays text and private notes are absent.
- [ ] Run the regressions against the unchanged page and confirm disabled-section/missing-context failures.
- [ ] Update section eligibility, queue labels and explanatory copy using createElement/textContent. Avoid coupling queue availability to successful target-label lookup.
- [ ] Run affected browser checks and full web tests/typecheck, then commit.

### Task 4: Document release and verify the complete change

**Files:** Modify `docs/ADMIN-SETUP.md`; update this plan's checkboxes with evidence.

**Interfaces:** Use existing `pnpm migrate:remote` and `pnpm deploy` scripts in `workers/corrections`. Site CI deploys Pages separately.

- [ ] Document backup, migration, Worker deployment and Pages merge/deployment sequence, with compatibility and rollback limits. Correct the claim that all migrations only add.
- [ ] Document post-deploy report/approval/public-status checks and private-note handling; do not execute live writes during implementation.
- [ ] Run the complete Worker and web unit suites, Worker/web typechecks and affected browser regressions. Report environmental blockers separately from code failures.
- [ ] Review the complete diff for schema privacy, migration preservation, target ownership and scope; record results and leave a reviewable implementation branch.

## Deferred discussion

Typeset-file music-error reports, full scan comparison and the larger source editor/draft/render service remain separate follow-on decisions. This change addresses the existing corrections lifecycle first.
