# ENG review: Phase 1 source-independent identities

Spec: `docs/superpowers/specs/2026-10-22-source-independent-identities.md`. Spot-checked against `pipeline/catalog.py:618`, `corrections.py:272`/`_outputs`, `sections.py:57-70`, `catalog.ts:456`, `regenerate.sh`, `mei/versions.py:26-27`, `web/package.json`.

Verified: IDs are `{vol}-{slug}` (catalog.py:618) and corrections key on slug (corrections.py:272). `suffix` is key, then `n`, then variant (sections.py:57). `volumeLabel` falls back to NOH (catalog.ts:456). `versions.py:26-27` hashes only extractor and converter files, so a sidecar outside the MEI package cannot stale approvals.

## Scorecard
| Dimension | Score |
|---|---|
| Data flow | 6 |
| Failure modes | 5 |
| Edge cases | 6 |
| Test matrix | 7 |
| Rollback | 7 |

Overall 6.2. Parity and rollback are strong. The model is over-built for one source, and the ledger/replay interplay is under-specified.

## Findings

1. **BLOCKER: the ledger/replay cycle is only half-solved (§6 l.342-343, §5 l.318-322).**
   - "Ledger loads without the snapshot" fixes target resolution. Allocation still needs the effective section inventory (`sections.target` over reviewed lists plus overlay), which exists only after `apply()` (corrections.py:904).
   - The spec lets `corrections-batch` allocate a keyed row and save "overlay and ledger changes atomically". It never says where in the replay that allocation runs.
   - The "compare old and new ordered section inventories" check has no stated "old" input.
   - Edit: in §5 add "Allocation is a post-replay step. `correct`/`correct-batch` write only the overlay, then call `identities allocate` against the replayed catalogue. Replay and `_outputs` never read the snapshot. The 'old' inventory is the ledger's per-entry locator `{slug, kind, key|n|variant}`, not git history."

2. **BLOCKER: ledger locators and `gradual:2` are incoherent (§5 l.131, 311-317).**
   - The ledger is "never regenerated", yet it holds `locator: Origin` JSON Pointers into `catalog.json`. Those pointers shift on every catalogue regen.
   - `part:x/gradual:2` is positional. The spec "pins the legacy target to its original item" but legacy replay resolves by position (sections.py:68), so ledger and legacy meaning diverge after an insert.
   - Changing a row from `n` to `key` changes the target without changing identity. That case is unmentioned.
   - Edit: replace "`locator: Origin|null`" with "`locator: {slug, kind, key|null, n|null, variant|null}`, the legacy section spelling at allocation, updated only by `rebind`". Add: "Check fails if any active `legacy_key` resolves to a different row ordinal or to none. A `n`→`key` change is a rebind."

3. **SHOULD-FIX: UUIDv5 from a birth seed plus a permanent ledger is redundant (§5 l.262-270).**
   - Once the ledger exists it is the authority. Determinism only matters at bootstrap.
   - Edit: add "UUIDv5 is used only by `bootstrap`, so two empty-directory runs match. After that the ledger is the sole authority. `allocate` need not be reproducible from seeds, only from ledger plus inputs." Alternatively drop UUIDv5 for random UUIDs after bootstrap.

4. **SHOULD-FIX: ledger merge conflicts are undefined (§6 l.410-415, AGENTS.md merge rule).**
   - Corrections batches merge themselves. Two concurrent batches allocating IDs conflict in `ledger.json`.
   - `migration.json` holds `input_sha256` of `catalog.json`, so it conflicts on every correction PR.
   - "Take main's copy and regenerate" does not work for a non-regenerable ledger.
   - Edit: in §6 add "Ledger is append-only, sorted by ID, one entry per line. Merge rule: union both sides, then run `identities check`. Drop `input_sha256` for generated files from `migration.json`. Keep source-file hashes only."

5. **SHOULD-FIX: "canonical input, legacy storage" should not be in Phase 1 (§7, card C).**
   - Nothing consumes `target:tgt_…`. It adds a Worker/Pages deployment-ordering hazard, a `tgt_` ledger class and a 2-day card, and creates a second spelling for every dedupe path (migrations 0004/0006/0007).
   - Edit: move §7 canonical-input rows and card C to "Deferred to the pilot". Keep only the `identities resolve` read-only lookup. Phase 1 corrections are untouched, so the D1 and Worker sections shrink to one sentence.

6. **SHOULD-FIX: the model is over-specified for zero second sources (§3-4, §9).**
   - Cut: `asg_` assignments, `Capabilities`, LilyPond/MEI representation unions, and the §9 refactors (hyphenated keys, `_candidate_rank`).
   - Keep: sources/editions, items, works, settings, scan representations, ledger, aliases, parity and address tools.
   - Edit: in §3 mark Assignment and LilyPond/MEI representation rows "Reserved". Cut card S to the `volumeLabel` fix and edition policy for related hymns only. The 10-15 person-days in §15 overrun the stated 2-3 weeks.

7. **SHOULD-FIX: card dependencies and parallelism (§15 l.814-817).**
   - S "depends on M" yet only needs `sources.yml`/`parse_ref`. C and S both touch ref validation, `pipeline/sections.py` (`_REF`), `corrections.py` `coerce` and `scans.ts`.
   - I owns `pipeline/catalog.py`, but M and C need hooks there.
   - Edit: say "M's first deliverable is `source_refs.py` + `sources.yml` + schema, merged to the coordinator branch before C/S start". Assign `sections.py` to exactly one card. Add `pipeline/catalog.py` hooks to M.

8. **SHOULD-FIX: some proving commands are not runnable as written (§15).**
   - B's `compare_identity_dist` builds two trees, but a worktree has no `web/.env` and `pnpm build` refuses without `PUBLIC_ASSET_BASE` (CLAUDE.md). The card names no values.
   - Edit: "export the public defaults from `scripts/check.sh`".
   - "Pinned initial fixture" is undefined; say "`data/` at the baseline commit".
   - The `node …check-deploy-budget.ts web/dist` proof needs a production build, which the spec says is not run in a worktree.

9. **NIT:** run the identity refresh after `regenerate.sh` step 8 (`corrections --lapsed` can change `reviewed.json`). Make recording the stale-MEI and old-address baselines the first step of card B.

## Scope-changing issues
- **Defer canonical input and the `tgt_` handles (finding 5).** This removes the card C critical path and all Worker/D1 deploy-order risk.
- **Shrink the graph to what a consumer reads (finding 6).** Assignments and LilyPond/MEI representations are not needed until a second source exists.
