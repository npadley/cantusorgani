# Autoplan Review: 2026-09-27-editing-admin-refactor-plan
**Date**: 2026-09-27

## Overall Scores
| Reviewer | Overall | Lowest dimension |
|---|---|---|
| CEO | 6.2/10 | Demand reality: 5/10 |
| ENG | 4.6/10 | Rollback/migration: 3/10 |
| DESIGN | 4.4/10 | State coverage and Accessibility: 3/10 |
| DEVEX | 5.2/10 | Time to first edit and Error copy: 4/10 |

## Critical Issues (worst first)
| Reviewer | Dimension | Score | Issue | Fix (preview) |
|---|---|---|---|---|
| ENG | Rollback/migration | 3 | No rollback for a bad deploy, a stale correction, migration 0002, or the Access/App setup | A rollback subsection for each phase |
| DESIGN | State coverage | 3 | Only the happy path: no empty queue, conflict, stale target, failed PR, or expired session | Copy and behaviour for each state |
| DESIGN | Accessibility | 3 | Not mentioned; side-by-side layout fails on portrait tablets | WCAG 2.2 AA, keyboard triage, live region, stacked layout |
| ENG | Data flow | 4 | No rule for conflicting or stale overlay entries; a catalog change forces a lineup rebuild (`catalog_sha256`) | `was` field, stale/duplicate detection |
| ENG | Test matrix | 4 | The one overlay test needs the PDFs, so CI cannot run it; nothing for the JWT check, PRs or migration | A tests column in Phasing |
| DEVEX | Time to first edit | 4 | No worked first edit; unclear whether `noh catalog` runs without `pdf-source/` (it does not) | "First edit in five minutes"; no PDFs needed |
| DEVEX | Error copy | 4 | Only "a clear message" | One error template with the next step |
| ENG | Failure/security | 5 | "Duplicate" breaks the D1 CHECK; PRs closed unmerged not handled; unsigned webhook; the App could push to main; `status.ts` drops non-slug targets | Batch lifecycle, HMAC, branch ruleset |
| DEVEX | CLI ergonomics | 5 | Overlay rows hand-written; triage is outside `noh` | `noh correct`, `noh where`, `noh triage` |
| CEO | Demand reality | 5 | The queue size was never checked | Checked: **0 corrections ever received** |
| ENG | Architecture | 6 | `build_catalog` opens the PDFs (catalog.py:372), so CI cannot apply a merged `corrections.yml`: an admin PR would deploy no change | `catalog.base.json` + `noh apply-corrections` (pure JSON) |
| CEO | Scope | 6 | Undecided: Functions vs Worker, token vs App, webhook vs next visit; the public "Edit" control cannot detect a session | Pages Functions, GitHub App, Edit is a plain link |
| CEO | Ambition | 6 | Readers never see their corrections land | A public corrigenda log |

## All Strengths
- [CEO] "Files in git are the truth" and the overlay principle are right, and the silent-loss triage bug was found before it cost anything.
- [CEO, ENG] Owner-only merge plus a JWT check against the Function's own allowlist is defence in depth at no cost.
- [CEO, ENG] The reachability crawl turns a real miss into a permanent check.
- [CEO, ENG] The free-tier reasoning is concrete (direct upload, paths filters, concurrency).
- [ENG] One shared schema is justified: triage's patterns already accept characters `schema.ts` rejects.
- [DESIGN, DEVEX] Recipes organised by symptom match how editors arrive.
- [DESIGN] The scan beside each queue item is the right call for this domain; deep links extend the existing `?piece=&field=` prefill.
- [DEVEX] CI checks on PRs are a safety net for editors who cannot build locally.

## Consolidated Fix Checklist
- [ ] autoplan-fix-1 — [ENG, DEVEX] Apply the overlay without the PDFs: `noh catalog` writes `catalog.base.json`; `noh apply-corrections` (pure JSON/YAML) writes `catalog.json` and rebuilds the lineup; CI checks the outputs are current.
- [ ] autoplan-fix-2 — [ENG, CEO] Overlay rows carry `was`; a stale base value or a repeated (target, field) fails the build. Fix at the source where the source can express it; `noh doctor` lists overlay entries that are now no-ops.
- [ ] autoplan-fix-3 — [DEVEX] CLI verbs `noh correct`, `noh where <url>`, `noh triage` (replacing `tools/triage`), snake_case fields, one error template naming the next step.
- [ ] autoplan-fix-4 — [ENG] Migration 0002 as a table rebuild (new statuses queued/duplicate, `target`, `pr_number`, `editor_email`, `reason`), with a down script; `status.ts` deployed first.
- [ ] autoplan-fix-5 — [ENG, CEO] Batch lifecycle: queued → accepted on merge, back to pending on an unmerged close, via an HMAC-checked webhook; the App pushes only `corrections/*` branches; a `main` ruleset requires a PR, owner approval and CI; no `pull_request_target`; Access covers preview hosts.
- [ ] autoplan-fix-6 — [CEO] Decide: Pages Functions on the existing site; a GitHub App (no token to renew).
- [ ] autoplan-fix-7 — [CEO] The "Edit" control is a plain link to `/admin/edit?target=…`; public pages stay static.
- [ ] autoplan-fix-8 — [ENG] List CI's variables and secrets: `PUBLIC_ASSET_BASE`, `CLOUDFLARE_ACCOUNT_ID`, a Pages:Edit token.
- [ ] autoplan-fix-9 — [DESIGN] Queue item order and look: values first, the proposed value editable; Accept the only filled button; stacked under 60rem; existing Layout/tokens/base styles only.
- [ ] autoplan-fix-10 — [DESIGN] States: empty queue, conflict (409), stale target, failed PR, awaiting merge, expired session, loading.
- [ ] autoplan-fix-11 — [DESIGN] Accessibility: WCAG 2.2 AA, keyboard triage order, live-region announcements, alt text on scan crops, no modals.
- [ ] autoplan-fix-12 — [DESIGN] "Report an error here" at the foot of each item, muted and not printed; the form shows a known target read-only; an unknown target falls back with a status message.
- [ ] autoplan-fix-13 — [DEVEX, DESIGN, CEO] Guide: a first edit in five minutes, a symptom table, File/Change/Command/Confirm per recipe, no PDFs needed, expected output and timings, editor vs maintainer paths, "adding a volume".
- [ ] autoplan-fix-14 — [CEO, ENG] Phasing: the reachability test moves into A; one model of the day may move ahead of D; the module split happens only when a change touches those files; a tests column and a rollback subsection.
- [ ] autoplan-fix-15 — [CEO] A public corrigenda log at `/corrections/log/`, built from `corrections.yml`.
- [ ] autoplan-fix-16 — [CEO] Record the queue size (0 received so far). The CEO's gate (build C only at 5+ corrections a month) is **not** recommended, because the owner wants the admin screen for their own edits and for future editors.

## Applied fixes
All 16 (autoplan-fix-1 … autoplan-fix-16), selected by the owner, applied to the plan on 2026-09-27.

## Skipped fixes
None. The CEO's intake gate for Phase C was declined; only the queue size was recorded (fix 16).
