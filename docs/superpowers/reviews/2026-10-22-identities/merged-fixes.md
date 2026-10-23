# Merged fixes from the four reviews

Reviews: [CEO](ceo.md) (5.6), [engineering](eng.md) (6.2), [cloud](cloud.md)
(about 8), [UI/UX](design.md) (7.6). None needs a public URL change. The
coordinator merged the findings below; where reviewers disagreed, the
resolution is stated.

## Scope decisions (reviewer disagreements resolved)

| # | Decision | From | Resolution |
|---|---|---|---|
| D1 | Defer canonical `target:tgt_…` correction input, `tgt_` handles, Worker and admin ingress normalization to the pilot | CEO 3, Eng 5 (cloud 3 and design 6 apply only if kept) | Deferred. Phase 1 keeps a read-only `noh identities resolve <legacy target>` and generated target table for tests and `noh where --ids`. Corrections, admin, the Worker and D1 are untouched except source-neutral ref validation (still in scope: "correction patterns tied to NOH"). Keep a short "Deferred: canonical input" section recording cloud 3's boundaries for the pilot. |
| D2 | Graph size | Eng 6 (cut assignments, LilyPond/MEI reps, capabilities, §9 refactors), CEO 5 (cut assignments), design 1 (assignments need a per-part slot) | Keep sources/editions, items, works, settings, scan **and** LilyPond/MEI representations (the maintainer's scope names them) as thin reference records; drop the `Capabilities` block (read publication state from existing manifests). Assignments become **reserved**: document the future shape, including `slot` = the part key for EF/OF/Vespers so "one chosen setting per part" has an anchor, but generate none. Keep only `borrows` (OF lenders, NOH7 borrowing) and `related-hymn` relations, which the source-neutral hymn links need. §9: keep the seams the maintainer named (volumeLabel and other labels, noh7 hymn filter, `noh\d` correction patterns, ID mismatch) plus the hyphen-splitting range parser; mark the rest (`_candidate_rank`, PART_TO_VOLUME, typeset VOLUME, segmentation) "NOH adapter, unchanged in Phase 1". |
| D3 | Parity harness depth | CEO 4 (narrow), cloud 5 (specify the full runner) | Keep: file-list, byte HTML, JSON payload, sitemap/headers/redirects diffs and address resolution; one baseline-vs-baseline run first to measure nondeterminism, and add a clock freeze only for fields that run proves vary. Drop the bijective bundle normaliser: list changed bundles and require each to be explained. Run the existing export e2e suites (fixture builds) on head, and compare Quick/Customize PDFs with `verify-export-pdf.ts` only on the §11 fixture set, only if export-path bundles differ. No rasterised comparison. Specify ports, public env defaults (from `scripts/check.sh`), fixture builds and the stale-MEI report, as cloud 5 says, and record timings. |

## Fixes to apply

Engineering
- E1 (BLOCKER, eng 1): allocation is a post-replay step. `correct`/`correct-batch`/`apply-corrections` write the overlay only; then `identities allocate` runs against the replayed catalogue. Replay never reads the snapshot. The "old" inventory for the structural check is the ledger locator.
- E2 (BLOCKER, eng 2): ledger locator = `{slug, kind, key|null, n|null, variant|null}` (legacy spelling), changed only by `rebind`, not a JSON Pointer. `check` fails if an active legacy key resolves to a different row or none. `n`→`key` is a rebind.
- E3 (eng 3, CEO 8): UUIDv5 only in `bootstrap`; afterwards the ledger is the sole authority.
- E4 (eng 4): ledger is append-only, sorted by ID, one entry per line; the merge rule is union + `identities check`; document it in the merge section of OPERATIONS. `migration.json` hashes source files only, not generated ones, so it doesn't conflict on every correction PR.
- E5 (eng 7): M's first deliverable is `source_refs.py` + `sources.yml` + schema; S starts after it. One owner for `pipeline/sections.py`; `pipeline/catalog.py` hooks belong to M. Re-check every file allowlist for overlaps after D1/D2.
- E6 (eng 8): runnable proofs: export public defaults from `scripts/check.sh`; "pinned initial fixture" = `data/` at the baseline commit; production-build proofs run with those defaults.
- E7 (eng 9): identity refresh after `regenerate.sh`'s last step (after `corrections --lapsed`). B's first step records the stale-MEI and old-address baselines.

Strategy
- C1 (BLOCKER, CEO 1): add a "foreign-shape dry run" acceptance gate to M: a test-only fixture for a hymnal with numbered items and no PDF pages or system refs, which must load, allocate and validate. That means `Locator.pdf_pages` and `system_refs` are optional and an edition need not be a "volume". Never in production data.
- C2 (BLOCKER, CEO 2): resize the cards honestly after D1/D2 and add a cut line: if M passes 5 days, ship ledger + sources + items/works/settings/scan reps + aliases + parity, and move LilyPond/MEI reps to a follow-up.
- C3 (CEO 6, design 2): reserve cross-source equality: `Relation.kind` adds `candidate-same-work` and `same-work` (status + evidence required, none generated). Add nullable `rights_reference` to Setting, and `rights_state: unknown|cleared|withdrawn` to Edition (NOH: the current state, from data/LICENSES.md).
- C4 (CEO 7): pilot items: keep as a maintainer question; the synthetic fixture (C1) doesn't wait for it, but the pilot must answer it before any second-source import.
- C5 (CEO 9, 10): the guard note (15k is about 3× today); move PR #155 provenance to §15.

Cloud
- K1 (cloud 1): §12 and card G describe PR #158 as built (`web/scripts/check-deploy-size.ts`: Wrangler ignore list, source-only dynamic classification, 25 MiB, separate static/dynamic budgets). Card G is done; list the optional follow-ups (artifact recheck before deploy, `_headers` 100-rule count) under card I.
- K2 (cloud 2): parity checks `_headers` rule count and `_redirects`; note the Wrangler-generated `_routes.json` and check that no static route is newly routed to Functions.
- K3 (cloud 4): writer/check matrix: refresh/check identities after the final writes in corrections-batch (after the typeset manifest regen, and stage sidecars explicitly), catalog-rebuild and publish (after OF generation); MEI conversion and typeset preview are exempt (artifacts only); include MEI record/manifest updates in freshness.
- K4 (cloud 6): make the R2 invariants executable: compare upload plans (scan, typeset and MEI keys) before and after, and assert that edition IDs never replace `vol_id` in key derivation.
- K5 (cloud 7): fail if graph or address-registry content appears in dist or in browser bundles.
- K6 (cloud 8): rollback: record the Pages deployment ID and alias digest, retain the parity artifacts longer than a day, and note that the Worker is untouched in Phase 1 (follows from D1).

UI/UX
- U1 (design 3): label parity covers every source label: `volumeLabel`, the `SystemStack.astro` borrowed-volume caption, the `LineupStack.astro` fallback, `pagesLabel` for the addenda. Unknown edition: fail the build in tests and keep current text for every NOH edition.
- U2 (design 4): state the one-to-many case: one `/piece/<slug>/` container maps to several works; `aliases.addresses.entity_ids` carries them for a future IA; fragments can't be server-redirected, so a later move needs client-side handling or stable anchors.
- U3 (design 5, 8): must-keep coverage: the print stylesheet bundle diff must be read explicitly; add a test that no visible date or credit string changes (for example "1942").
- U4 (design 7): name the source identity block's future fields (collection, book, edition, provenance, citation) and map them to Source/Edition/SourceItem.
