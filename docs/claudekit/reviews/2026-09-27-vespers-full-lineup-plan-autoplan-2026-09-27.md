# Autoplan Review: 2026-09-27-vespers-full-lineup-plan
**Date**: 2026-09-27

## Overall Scores
| Reviewer | Overall | Lowest dimension |
|---|---|---|
| CEO | 5.8/10 | Demand reality: 4/10 |
| ENG | 5.4/10 | Failure modes / edge cases: 4/10 |
| DESIGN | 6.2/10 | Information hierarchy / State coverage: 5/10 |
| DEVEX | 5.6/10 | Time to first result / Docs structure: 4/10 |

## Critical Issues (worst first)
| Reviewer | Dimension | Score | Issue | Fix (preview) |
|---|---|---|---|---|
| CEO | Demand reality | 4 | No evidence of who plays Sunday Vespers, no kill criterion | Demand check + stop point before release 2 |
| ENG | Failure modes | 4 | Wrong anchor Sunday (2026-09-06 is Pent15-0); resumed Epiphany Sundays, Christ the King / All Saints on Sunday, Pent II-III not handled; tone endings single-sourced for feasts | Calendar goldens by date; fixed tone vocabulary |
| DEVEX | Time to first result | 4 | No way to inspect one Sunday from the terminal | `noh vespers-lineup --day` |
| DEVEX | Docs | 4 | No doctor checks or README rebuild order | doctor checks + README section |
| CEO | Scope | 5 | Release 1 pulled in steps 1-4 | Release 1 = step 0 only |
| ENG | Data flow | 5 | "day" undefined; no lineup schema or validator; stale refs unchecked | Lineup contract keyed by date; parseLineup; doctor check |
| ENG | Test matrix | 5 | Steps 4-7 untested | Named test matrix |
| DESIGN | Hierarchy | 5 | ~16 equal h2s, no header | h1 + grouped outline + tone in headings |
| DESIGN | States | 5 | Hidden, unprinted, no-chant, slice-error states undefined | States (a)-(h) |
| DEVEX | Error copy | 5 | Review kinds without messages | Messages per kind |
| ENG | Architecture | 6 | Two calendar authorities; melody check needs OMR; exportSegments reuse collides | Calendar authority; reviewed hymn table; exportLineup |
| ENG | Rollback | 6 | No stated kill switch; release 1 depends on later segmentation | Rollback section; Magnificat openings cut in release 1 |
| DESIGN | Consistency | 6 | SystemStack scale/caption per piece | LineupStack |
| DESIGN | Console | 6 | Scroll back for antiphon repeats; no continuation guidance | Repeat the antiphon; continuation line |
| DEVEX | CLI ergonomics | 6 | vespers-ordo verb vs function mismatch; no vesperale verb | officium-fetch / vesperale-fetch; no ordo file |

## All Strengths
- [CEO] A concrete observed problem; "Verified facts" measured, including the text-only Magnificat that justifies the tone bank.
- [CEO, ENG] "The ordo decides what is sung; NOH is only the music" — 1962 projected onto a 1942 book correctly.
- [ALL] Never guesses: no neighbouring tone, no wrong melody, order-only items hidden.
- [DESIGN, DEVEX] Tone-bank provenance in the organist's terms ("as printed for Advent I, p. 53").
- [ENG, DEVEX] Reuses proven machinery: two-signal segmentation, pinned-commit vendoring, the hand-check bar.
- [DESIGN] Sung order with every gap a visible note; day page keeps its list where no lineup exists.

## Consolidated Fix Checklist
- [x] autoplan-fix-1 — [CEO, ENG] Calendar edge cases and the corrected anchor date (Pent15-0), fixed tone vocabulary
- [x] autoplan-fix-2 — [ENG, DEVEX] Calendar authority, lineup contract (keyed by date, item_key), parseLineup, exportLineup
- [x] autoplan-fix-3 — [ENG] Hymn melody by reviewed table (no OMR)
- [x] autoplan-fix-4 — [ENG] Test matrix for steps 4-7 and rollback
- [x] autoplan-fix-5 — [CEO, ENG] Tight release 1, with Magnificat openings cut from every section for the tone bank
- [x] autoplan-fix-6 — [CEO] Demand evidence and stop point before release 2
- [x] autoplan-fix-7 — [CEO, DESIGN] Console tone line, psalm text (release 2), office-keyed URLs
- [x] autoplan-fix-8 — [DESIGN] Header, grouped outline, tone in headings, compact nav
- [x] autoplan-fix-9 — [DESIGN] LineupStack: one scale across sources, correct captions
- [x] autoplan-fix-10 — [DESIGN] States for every item
- [x] autoplan-fix-11 — [DESIGN] Antiphon repeats and psalm continuation
- [x] autoplan-fix-12 — [DEVEX] `noh vespers-lineup --day`
- [x] autoplan-fix-13 — [DEVEX] Consistent commands (vesperale-fetch; no ordo file)
- [x] autoplan-fix-14 — [DEVEX] Error and review wording
- [x] autoplan-fix-15 — [DEVEX] doctor checks and README section

## Applied fixes
All 15, selected by the owner 2026-09-27. Where two overlapped they were
reconciled: release 1 stays tight but cuts the Magnificat openings from every
NOH8 section so the tone bank exists; URLs are keyed by civil date with `/i/`
reserved for I Vespers; psalm text arrives with the Divinum Officium fetch in
release 2. The open question on psalm text was answered by fix 7 and removed.

## Skipped fixes
None.
