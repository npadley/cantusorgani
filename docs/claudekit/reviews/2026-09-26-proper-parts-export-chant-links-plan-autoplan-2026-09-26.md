# Autoplan Review: 2026-09-26-proper-parts-export-chant-links-plan
**Date**: 2026-09-26

## Overall Scores
| Reviewer | Overall | Lowest dimension |
|---|---|---|
| CEO | 6.8/10 | Wedge focus / Demand reality: 5/10 |
| ENG | 5.2/10 | Rollback & migration: 3/10 |
| DESIGN | 5.2/10 | State coverage / Accessibility: 4/10 |
| DEVEX | 5.4/10 | Time to hello world / Error copy: 4/10 |

## Critical Issues (worst first)
| Reviewer | Dimension | Score | Issue | Fix (preview) |
|---|---|---|---|---|
| ENG | Rollback & migration | 3 | No rollback; SCHEMA_VERSION bump would make merge_catalog discard other volumes | Additive `parts`, keep schema 2, `p.parts ?? []`, phased revertible commits |
| DESIGN | State coverage | 4 | Nothing ticked, no parts, over ceiling, stale default date undefined | Explicit states (a)–(f) |
| DESIGN | Accessibility | 4 | No fieldset, stale nav label, unannounced external links, sticky bar covers music | `<details>`/`<fieldset>`, labels, `.sr-only` link text |
| DEVEX | Time to hello world | 4 | Missing GregoBase dump silently yields zero parts | Hard fail, doctor checks, documented run order |
| DEVEX | Error copy | 4 | Messages promised, never written | Exact copy for ceiling, unmapped key, sha mismatch |
| CEO | Wedge focus | 5 | 3 October export blocked behind segmentation | Step 0 ship-first wedge |
| CEO | Demand reality | 5 | Demand evidence unstated | Demand-signal row |
| ENG | Failure modes | 5 | Dump absent; pdf-lib decode memory; parser drift | Risk rows + iPad measurement |
| ENG | Test matrix | 5 | No unit tests named for the critical path | Named segment/parser/link_parts tests; boundary tests |
| DEVEX | CLI ergonomics | 5 | Loose script, no calibration command, `part_`/`parts_` mix | `noh jgabc-fetch`, `--parts-report`, `part_*` |
| DESIGN | Information hierarchy | 5 | Day page has no music to put a nav above | Day page part links to piece anchors |
| ENG | Architecture | 6 | Three part-record shapes; borrowed parts across volumes | One schema; `link_parts` after merge |
| ENG | Edge cases | 6 | Eastertide drops the Gradual too; zero ticked | Rule and state added |
| DESIGN | Polish / consistency | 6–7 | Heading-as-link; ambiguous "(p. 4)"; duplicate ChantPair | Separate "Chant" link; "Introit → St Michael, p. 4"; drop ChantPair |

## All Strengths
- [CEO] Measured facts kill a fake constraint (the 60 cap); two independent signals; refuses to guess; links-only licensing; concrete live "done".
- [ENG] Reuses segment_mass, movement_score_for, jumpTargets; `movements` stays Ordinary-only; strict literal parsing, pinned sha256.
- [DESIGN] Single source of truth for anchors; part selection solves the real dead end; season defaults; PDF part headings.
- [DEVEX] Opens on the real failure message; honest review-queue kinds; intent-revealing test names; careful schema choice.

## Consolidated Fix Checklist
- [x] autoplan-fix-1 — [CEO] Ship-first wedge (step 0)
- [x] autoplan-fix-2 — [ENG] Rollback and phased commits
- [x] autoplan-fix-3 — [CEO] Whole-Mass order in goal; next moves not to block
- [x] autoplan-fix-4 — [CEO] Demand-signal row
- [x] autoplan-fix-5 — [DEVEX, ENG] Hard fail without the dump / jgabc file; doctor checks; risk rows
- [x] autoplan-fix-6 — [ENG] One part schema; `link_parts` after merge
- [x] autoplan-fix-7 — [ENG] Named unit tests; ceiling boundary tests replace memory test
- [x] autoplan-fix-8 — [DEVEX] `noh jgabc-fetch`; `--parts-report`; `part_*` naming
- [x] autoplan-fix-9 — [DESIGN] Day page part links
- [x] autoplan-fix-10 — [DESIGN, ENG] Export states; Eastertide Gradual rule
- [x] autoplan-fix-11 — [DESIGN] Accessibility
- [x] autoplan-fix-12 — [DESIGN] Chant link separate from heading; borrowed label; drop ChantPair
- [x] autoplan-fix-13 — [DEVEX] Exact error copy; review entries carry context
- [x] autoplan-fix-14 — [DEVEX] Docs deliverable (README "Vendored data", doctor)

## Applied fixes
All 14 selected by the owner; 25 edits applied to
`docs/claudekit/plans/2026-09-26-proper-parts-export-chant-links-plan.md`.

## Skipped fixes
None.
