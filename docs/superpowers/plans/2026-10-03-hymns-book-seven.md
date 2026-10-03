# Hymns index, Book VII processing, and day-page references

Status: proposed; awaiting the owner's approval. No implementation or uploads have started.

## Goal and agreed request

Add a home-page Hymns box linking to all hymns across the processed books; slice and process Book VII and include its hymns; identify other pages that use or refer to those hymns and add verified links or accompaniment references to help an organist prepare the complete day.

This is an extension of the existing catalog, publication pipeline, and Vespers pages. Use their conventions rather than create a parallel catalog. Implement in this isolated worktree after approval. Do not modify another agent's checkout, merge, or deploy as part of this plan.

## Findings from read-only inspection

- Worktree: `/Users/npadley/.codex/worktrees/hymns-book-seven-plan/nova-organi-harmonia-online`, based on `dd8acc16da7742454c88880b60f497b693d29864` from the owner's current branch, `fix/broken-typeset-2`.
- `pdf-source/NOH7 Varia.pdf` exists and has 274 PDF pages. The printed index is PDF page 274. It contains hymns, sequences, antiphons, responses, litanies, psalms, and Benediction music; it is not exclusively hymns.
- `noh7` is absent from `data/volumes.yml`, the catalog, and published manifests. The earlier Vespers plan deferred Book VII and provides useful context, but does not replace this approval.
- Book VIII already contributes 59 named hymn occurrences to `data/catalog.json`. They link to hymn starts inside office pieces.
- `web/src/lib/catalog.ts::hymnIndex()` currently collects only jump targets of kind `hymn`. Printed sections of kind `hymn` become jump targets of kind `part`, so this helper is not yet a comprehensive hymn index.
- `web/src/pages/[division]/index.astro` uses that helper only on the Vespers index. The home page is `web/src/pages/index.astro`.
- The stored lineup has 468 main Vespers pages and 110 I Vespers pages. Its missing hymn accompaniment is `O prima, Virgo, pródita`, on 14 Assumption pages across those two groups. Whether Book VII has a suitable accompaniment remains unverified.
- `web/src/lib/references.ts` already recognizes Roman volume VII, but that recognition does not establish that a specific catalog entry refers to VII.
- The publish and catalog-rebuild workflow inputs currently omit `noh7`.

## Proposed design

Create `/hymns/` as an A–Z index derived from the corrected catalog. Add a Hymns card to the existing home-page box grid, labelled as an index across the books. Each entry shows title, book/office, printed page, and any reviewed tone or variant, and links to its actual piece or hymn anchor. Preserve multiple settings of the same hymn; remove only duplicate representations of the same source occurrence. Retain the existing Vespers hymn list using the same index logic.

Process the complete musical contents of VII into its existing `varia` division, giving non-hymn material its correct genre. Include only verified hymn classifications on `/hymns/`. Do not label the mixed printed index heading as proof that every entry is a hymn. Standalone hymn metadata should use the existing `hymn` genre where supported; extend any schema/validator that lacks it consistently.

Use reviewed associations to connect VII to other pages. Keep a suitable existing VIII accompaniment as the primary source. Where VII supplies a verified missing accompaniment, use its exact system range in the lineup. Where VII provides an alternate setting, add a labelled link rather than silently replacing the current setting. Day pages expose relevant hymn links in their Office/Vespers context, without putting Office hymns into the Mass Proper or its export.

Deliver a reference report covering both existing explicit citations and newly identified liturgical matches. A title match is a candidate until the words, usage, and setting are checked. Retain honest missing-music notes when VII does not resolve a gap; adding hymns alone cannot guarantee every component of every day is available.

## Tasks after approval

### 1. Register and review Book VII

Files: `data/volumes.yml`, new `data/index-noh7.proposed.yml` and `data/index-noh7.yml`, `data/derived-offsets.json`; targeted `pipeline/indexextract/` changes only if the mixed alphabetical index requires them.

- Confirm the source checksum, first and last musical pages, and printed pagination from the scan. Register only the approved source PDF, excluding introductory material and the index from music publication.
- Run `uv run noh offset --volume noh7 --segments` and `uv run noh index-extract --volume noh7 --alphabetical --division varia`.
- Review each index entry against the scan, including ditto marks, repeated titles, alternate tones, and entries under Litaniae/Psalmi. Correct the proposal into the reviewed index; record uncertainties rather than accept OCR guesses.
- Record exact hymn starts and ends, including multiple compositions on a page and hymn/versicle boundaries. Preserve printed text and variant labels.
- Add focused parser/catalog tests if processing VII requires changed behavior. Verify page mapping with `uv run noh crosscheck --volume noh7`.

### 2. Slice and catalogue the whole book

Files: new `data/published/noh7.json`, `data/catalog.base.json`, `data/catalog.json`, `data/review-queue.json`, any reviewed `data/sections/noh7.yml` needed for accurate boundaries, and persisted margin data used by existing rebuilds.

- Slice a pilot batch with `uv run noh publish --volume noh7 --pages <reviewed-pilot-pages>`; inspect overlays and crops for clipped staves, missing text, shared-page boundaries, and faint print.
- Process the remaining musical pages in explicit batches, covering the entire musical body. Use page-specific staff-finder settings only where scan inspection demonstrates a need.
- Run `uv run noh catalog --volume noh7`, review catalog boundaries/classification, and apply corrections through reviewed inputs or `data/corrections.yml`, not edits to generated catalog files.
- Check that every printed index entry is accounted for, hymn links point inside the right setting, and unrelated volumes remain present.
- Prepare an upload manifest and dry-run the reviewed batches. Upload their additive image assets to R2 during approved implementation using the existing publication command and write-if-absent policy. Verify every catalogued VII system has its expected published derivatives before claiming the book is available.
- Keep production site deployment separate from asset upload; do not merge or deploy the site without a subsequent instruction.

### 3. Build the cross-book Hymns page and home-page box

Files: `web/src/lib/catalog.ts`, `web/src/lib/catalog.test.ts`, new `web/src/pages/hymns/index.astro`, `web/src/pages/index.astro`, and the existing division index if needed.

- Extend `hymnIndex()` to include embedded `piece.hymns`, verified printed hymn sections, and standalone hymn pieces from every volume.
- Return enough source metadata for title, source/office, printed page, and variant labels. Use existing `pieceHref()`, `hymnAnchor()`, and section anchors; verify anchors actually rendered by the piece page.
- Deduplicate by source location/setting, not title. Preserve settings with identical titles, disambiguating by book and variant. Skip invalid/unplaced starts rather than generate broken anchor links.
- Add meaningful tests for all three hymn representations, multiple tones, identical titles in different books, duplicate representations, invalid references, and stable alphabetical ordering.
- Render `/hymns/` with the site's existing typography and responsive list patterns, and add the linked home-page box. Keep the existing Vespers hymn list working.

### 4. Audit references and connect verified day/office uses

Files: new `docs/reports/2026-10-03-book-seven-hymn-references.md`; reviewed hymn association data, preferably new `data/vespers/hymns-noh7.yml` if VII fallback mappings cannot be expressed cleanly in the existing reviewed files; targeted `pipeline/vespers/` and `web/src/lib/` code/tests.

- Search the corrected catalog's references, rubric text, reviewed sections, Vespers offices, vendored office texts, and both lineup groups for VII page citations and VII hymn usage. Inspect the emitted routes as well as source files, since many pages are generated from data.
- Build a report with hymn/setting, VII printed page, affected route or day key, existing reference or gap, proposed link/source, and evidence status. Separate explicit VII citations, confirmed liturgical matches, alternate settings, and unresolved candidates; include hymns with no current page use.
- Cross-check text spelling variants and historical hymn revisions. Check the Assumption gap specifically; do not assume `O gloriosa Virginum` or another Marian hymn is interchangeable with `O prima, Virgo, pródita`.
- For confirmed missing accompaniments, map the exact VII system range into the existing Vespers hymn item and preserve its correction target. For alternate settings, add a source-labelled link. Derive relevant day-page links from these reviewed associations.
- Adjust volume attribution and missing-source wording where a page now uses both VII and VIII. Preserve I/II Vespers distinctions and the 1962 calendar keys.
- Add tests for a confirmed VII fallback, an unresolved match remaining a note, an alternate setting preserving the current default, invalid system references, and day links staying outside the Mass export. Select real hymn/date fixtures only after scan review establishes the matches.
- Rebuild `uv run noh vespers-lineup`, `uv run noh chants`, and `uv run noh apply-corrections` as appropriate. Report before/after hymn coverage and remaining gaps.

### 5. Make Book VII reproducible and verify the result

Files: `.github/workflows/publish.yml`, `.github/workflows/catalog-rebuild.yml`, related workflow tests if applicable, and relevant README/editing documentation.

- Add `noh7` to workflow choices and the rebuild-all list; audit other hard-coded volume lists that could omit it.
- Verify a fresh rebuild consumes the committed VII inputs and published manifest without dropping other agents' volume data. When integrating later, regenerate shared outputs from the combined reviewed inputs rather than resolve generated JSON by hand.
- Run `uv run pytest`; run `pnpm test`, `pnpm typecheck`, and `pnpm build` in `web/`. The build must pass its Pagefind and link/reachability checks.
- Inspect the home card, hymn index, representative VII pieces, and affected day/I/II Vespers pages at desktop and narrow widths. Verify hymn anchor navigation, images, and PDF exports, including a mixed VII/VIII office.
- Deliver the reference report, processed book/hymn counts, resolved and unresolved gaps, upload verification, and a focused worktree diff for review. No production merge/deployment in this plan.

## Review focus and acceptance criteria

- Every reviewed hymn occurrence across all processed books is discoverable from `/hymns/`, with a working target and enough metadata to distinguish settings.
- VII's non-hymn entries are catalogued and reachable without polluting the Hymns index.
- Printed/PDF pagination and system boundaries are verified; no introductory/reference-edition material is published as music.
- A verified VII hymn can complete the hymn slot of an existing office and its export; unverified text or melody matches cannot silently replace music.
- The report identifies explicit references and confirmed additional uses separately, lists affected pages, and explains remaining gaps.
- Existing home-page boxes, VIII hymn links, other volume catalogs, correction targets, and Mass exports continue to work.
- Generated-data changes are scoped and reviewed before integration with other agents' work. Uploads must be verified; site publication remains a separate action.

## Approval requested

Approve this plan to begin implementation in the isolated worktree, including processing the complete musical contents of VII, verified cross-page hymn links, and additive upload of the reviewed VII image assets. The implementation will use the existing pipeline and site rather than create separate publishing infrastructure.

Approved by the user on 2026-10-03. Implemented in the managed isolated worktree.
Book VII contains mixed genres and a damaged composite scan. No verified VII
replacement exists for the current missing Assumption hymn; related settings
are linked without replacing the existing VIII score. The reference report
records all affected routes and remaining source gaps.
