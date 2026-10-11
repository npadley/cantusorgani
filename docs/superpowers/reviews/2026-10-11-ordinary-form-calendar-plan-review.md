# Ordinary Form calendar plan: cross-functional review

Date: 2026-10-11. Scope: implementation plan review only; no feature code implemented.

Plan: `../plans/2026-10-11-ordinary-form-calendar-implementation-plan.md`

Four independent agents reviewed the plan from CEO/product, UI/UX, DevOps and engineering perspectives. Each read the specification and updated typeset acceptance draft; technical reviewers inspected the existing repository. Their initial verdicts requested plan revisions. The coordinator verified code-dependent findings and incorporated the changes below; no second independent approval round was performed.

## Typeset music answer

Yes, the existing architecture supports eligible lender typeset reuse. `musicView()` preserves `sourceTarget` and `systemSources`; `typeset.segments()` resolves the lender's manifest entry, and `segmentKey()` uses the original lender position. `ExportBar` calls `exportRuns()` on the real source Piece. OF synthetic Pieces do not need their own transcriptions or manifest rows.

The plan now explicitly requires narrow/wide inline SVGs, proofreading notices and original correction targets; existing scan preferences; Letter/A4 source PDFs; partial/unchecked-range scans; image/PDF error fallback; mixed typeset/scan exports; and actual PDF verification. These are acceptance requirements, not a claim that OF pages already exist.

## CEO/product findings

| Priority | Finding | Disposition |
|---|---|---|
| P1 | Release wording could require manual review of every assignment despite the specified spot checks. | Bounded the gate: reviewed vocabulary/policy, agreed sample, every year-dependent case and filled override, plus explicit trust in the pinned upstream source for remaining assignments. Unfilled overrides remain disclosed supported outcomes. |
| P2 | Date-selected cycle was lost when entering an all-year static page/export. | Calendar accompaniment links carry the cycle. The page initially unticks other years and explains remaining selected alternatives. Direct links retain an explicit all-years default. |
| P2 | Schema-affecting source discrepancies could emerge only at final verification. | Moved year-map, alternatives, empty-slot and Easter/Triduum structure checks before resolver implementation; retained final sample/PDF verification. |
| P2 | All 216 schedules lacked a bounded external-evidence standard. | Separated exhaustive invariants from independently sourced fixtures; future-year evidence uses accepted norms and recorded limitations, without claiming unpublished ordos were checked. |

Strengths identified: reuse of existing catalogue/score machinery, explicit missing music, identity-based guards, EF isolation and the typeset acceptance contract.

## UI/UX findings

| Priority | Finding | Disposition |
|---|---|---|
| P1 | Static all-year pages select every variant/alternative by default without explanation. | Added cycle-aware initialization for calendar entry, explicit all-years copy for direct entry, and notice that same-year alternatives remain selected until chosen. Actual checkbox/PDF contents must be tested. No automatic preferred alternative is invented. |
| P2 | Dynamic announcements, focus and date errors were underspecified. | Added polite result updates, retained control focus, associated invalid/range feedback and keyboard/boundary tests. |
| P2 | Individual chant source links could obscure the assembled accompaniment destination. | Added a prominent “View accompaniments for this occasion” link carrying the cycle, plus an end-to-end date→score→export journey. |
| P2 | Mobile checks covered only the header. | Added settings/long-label wrapping, movement anchors, scrollable selections and sticky export/focus visibility checks. |

The plan retains all variants on static pages as the spec requires. It changes initial export selection for cycle-qualified links, without adding a new route or hiding access to other variants.

## DevOps findings

| Priority | Finding | Disposition |
|---|---|---|
| P1 | Site CI does not call `scripts/check.sh`; a script-only guard would miss deployment. | Added `noh ordinary-form --check` to `.github/workflows/site.yml` before build, with stale-artifact failure verification. |
| P1 | Automated catalogue/corrections workflows regenerate independently and would leave OF data stale. | Added final-overlay OF generation to catalog-rebuild, publish and corrections-batch; added both generated artifacts to corrections-batch’s explicit staging list. |
| P2 | Assignment identity alone does not guard same-count lender substitution after regeneration. | Added separately reviewed lender/range mapping identity and a change→regenerate→check regression test; baseline migration remains explicit. |
| P2 | Two-file refresh needed a replacement-failure policy. | Added staged replacements with backups/rollback and injected second-replacement failure; consumption validates matching full source commits and provenance. Interrupted updates fail clearly. |
| P2 | Mocked assets do not establish release availability. | Added valid SVG/PNG/PDF fixtures, worker/export request interception and unexpected-network rejection; retained separate remote typeset checks, real fallback-asset availability and PDF CORS verification. |
| Note | Fresh worktree setup needed exact dependency commands. | Specified frozen uv/pnpm setup and Chromium installation. |

Verified against `.github/workflows/site.yml`, `catalog-rebuild.yml`, `publish.yml`, `corrections-batch.yml` and the existing export/PDF code. These changes do not automatically advance reviewed baselines or publish assets from the planning task.

## Engineering findings

| Priority | Finding | Disposition |
|---|---|---|
| P1 | Date-selected cycle lost at static-page export. | Same correction as CEO/UI; added an exact optional-cycle href interface and OF page client contract. Keep all score variants visible, highlight current-cycle applicability and initialize export selection; do not filter away static-page variants or reuse EF season defaults. |
| P1 | Shared lender keys had independently switched DOM copies while export inspected the first copy. | Task 5 owns `SystemStack` and `ExportBar` changes: synchronize view/error states across all occurrences, inspect all matching export-view nodes conservatively, and test the second occurrence. Unique selection IDs stay separate from shared source-view keys. |
| P2 | Reviewed mapping identity excluded lender selection. | Same correction as DevOps, including lender tuple and range. |
| P2 | A/C merged rows could be labelled only “Year A”. | Labels now derive from `years`, while variants remain stable identity/anchors. Added all-years and selected-C assertions. |
| Note | `SystemStack` accessible caption could name a fake synthetic volume/page. | Added a composed-source caption branch with real lender citations and accessible output tests. |

The reviewer proposed filtering score headings to the selected cycle. The coordinator retained all variants to honor the spec's static-page requirement, using highlighting and export defaults to preserve the date-specific journey. Same-year alternatives remain a visible user choice.

## Remaining decisions and limits

Following this review, the user confirmed named exceptions, weekday feast behavior, source-backed equal-rank handling, actual preceding-Sunday fallback, Christmas choices and transfer-only presets. The revised spec and plan record those decisions. The review itself did not approve them; the user did during the subsequent decision discussion.

No implementation tests were added or run for these documentation revisions. Existing code inspection supports the typeset reuse architecture; the planned regression/browser/PDF checks must prove the new OF behavior during implementation. All four requested reviews are complete, and their actionable findings are captured above and in the revised plan.
