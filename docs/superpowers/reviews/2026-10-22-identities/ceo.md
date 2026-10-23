# CEO review: Phase 1 source-independent identities

Limits: the redesign brief §5 could not be read (no git access in this session); the other inputs were read.

Scorecard (0-10): Ambition 6 | Problem clarity 7 | Wedge focus 5 | Demand reality 4 | Future-fit 6. Overall 5.6.

- Ambition: right target (P15), but it proves "NOH round-trips", not "a second source fits".
- Problem clarity: the seams in §9 are real and well evidenced. The one-sentence problem is buried in §1.
- Wedge: three PRs, six cards and eight data files, plus a Worker deploy-order problem. Not one job.
- Demand: no evidence anyone consumes the output in Phase 1. Maintainer question 3 (the pilot items) is left open, "no answer needed".
- Future-fit: aliases and the ledger constrain nothing. But `Locator` is PDF-page-shaped and nothing tests a non-PDF source.

## Findings

1. **BLOCKER: no exit test that the model fits a non-NOH source.** Every acceptance check (§§11, 13) proves NOH parity. A model can pass all of them and still be NOH-shaped: `Locator` carries `pdf_pages` and `system_refs`, and an edition is "one volume". §9 only uses an in-memory fixture for ref parsing. Edit: in §13 add a row "Foreign-shape dry run": a hand-written fixture in a scratch directory (a hymnal with no PDF page map, hymn numbers as locators, one text with two tunes, one tune with two accompaniments). It must validate against `identities.json`, allocate IDs and resolve aliases. Make it an acceptance gate in card M. Never add it to production data.

2. **BLOCKER: Phase 1 is sized as one ambitious phase, but the cards are too thin.** Card M (2-3 days) holds the whole of §6: ledger, bootstrap, 576 items, Vespers, OF, MEI, typeset and replay checks. Card I is 2-3 days. The "10-15 person-days" total is not credible, and the 2-3 week cap is the maintainer's. Edit: in §15 add "Cut line: if M exceeds 5 days, ship the ledger, `sources.yml` and top-level items first, then sections and Vespers children, then assignments and relations (below)."

3. **SHOULD-FIX: cut canonical correction input (§7, card C) from Phase 1.** It has no consumer: nobody sends `target:tgt_...` yet. It forces three-way contract tests, an alias table bundled into the Worker and a deploy-order document. Keep only `resolve_target` in Python, used by replay tests, and the generated alias table. Edit: replace §7's "Entry point" table with "Phase 1b, after the pilot decides whether editors need canonical links", and drop card C's Worker and admin file paths. State that the `tgt_` namespace is reserved.

4. **SHOULD-FIX: narrow the parity harness (§11).** Do keep: file-list diff, HTML byte diff, JSON payload diff, address resolution and the existing e2e export suite against the dist. Drop: rasterised PDF comparison, frozen-clock child processes and the bijective bundle normaliser. No export code changes. Edit: in §11, replace "Compare page count, MediaBoxes, text, music order and rendered PDF pages at fixed DPI" with "Run existing export e2e and compare the selection payloads and the output of `verify-export-pdf.ts`."

5. **SHOULD-FIX: assignments (`asg_`) and `relations` are speculative in Phase 1.** Nothing reads them, and the calendars are already authoritative. Edit: in §3 move "Assignment" to the "Reserve" column. Keep only the EF/OF/Vespers lender links needed to resolve `borrows`.

6. **SHOULD-FIX: reserve a path to cross-source equality.** Works are never merged (correct), yet `Relation.kind` has no way to record a reviewed or candidate match. Edit: in §4 add `candidate-same-work` and `same-work` to `Relation.kind`, with `status` and `evidence` required, and generate none in Phase 1. Also add `rights_state` (`unknown|cleared|withdrawn`) to Edition, because takedown handling is flagged as unsolved in the platform report §3.

7. **SHOULD-FIX: make the pilot a dependency, not a footnote.** Edit: in §16 question 3, replace "No answer is needed to migrate NOH" with "Answer before card M starts; the items shape the finding 1 fixture."

8. **NIT: UUIDv5 from seeds plus a ledger is two mechanisms.** The ledger is the authority; the seed derivation only makes bootstrap reproducible. Keep it, but say so in one line in §5.

9. **NIT: the deploy guard (§12) is fine and independent.** Add a line that the 15k warning is 3x today's 5,018 files, so it is a tripwire, not a plan. The real scaling answer is the platform report §6.

10. **NIT: §1 spends five lines on PR #155 provenance.** Move it to §15.

## Scope-changing issues

- No public URL change. Zero redirect rules and zero new routes hold up.
- New maintainer decisions needed: (a) defer canonical correction input to Phase 1b (finding 3); (b) name the 20-50 pilot items now (finding 7); (c) land PR #155 so P14-P16 exist on `main` before implementation.
