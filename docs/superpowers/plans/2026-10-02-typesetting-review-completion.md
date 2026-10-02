# Typesetting Review Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution in the current checkout is already selected. Steps use checkbox syntax for tracking.

**Goal:** Let readers report versioned music errors and invited editors repair, preview and publish LilyPond source without leaving the browser.

**Architecture:** Extend the existing corrections Worker, D1 admin workflow and GitHub App batch publication. Add durable drafts and immutable approved snapshots, isolated GitHub previews and source commits on the existing corrections batch branch. Reuse the current LilyPond renderer, source checks, SVG checks and merge webhook.

**Tech Stack:** TypeScript, Astro, Cloudflare D1/Pages/Workers, bundled CodeMirror 6, Python, GitHub Actions/App, R2.

**Spec:** `docs/superpowers/specs/2026-10-02-typesetting-review-completion-design.md` — approved October 2.

## Global Constraints

- Work on `codex/corrections-compatibility` in this checkout; main stays unchanged until release integration.
- Reader notes stay private in D1: no dispatch payload, PR summary, public status or committed corrections record may contain them.
- Source text is limited to 60 KiB measured as UTF-8 bytes; source revision is the Git blob SHA, distinct from the drawing hash.
- Only known files under `data/typeset/src/` can be read or edited; includes are allowlisted.
- Preview allows one active lease per editor, at most 20/hour, expires abandoned leases after five minutes and polls every five seconds for at most four minutes.
- Preview key covers filename, source bytes, include/configuration revision and renderer version. R2 prefix `typeset-preview/` expires after 14 days.
- Rendering has no secrets or repository write permission, with no network for LilyPond and bounded time/output; upload never executes source.
- Approved snapshots are immutable; stale bases refuse publication without overwriting or automatically merging source.
- Keep structural-change and large-batch owner holds. Acknowledging proofreading cannot resolve an error report.
- Production migration/deployment/integration approval is a final step after a concrete reviewed implementation; read-only inspection is already authorized.

## Review Focus

- A new drawing of the same file receives a new report identity; retired files and stale reports remain identifiable.
- Two editors or two tabs save/preview/publish concurrently without losing snapshots or admitting two active preview leases.
- Latin lyrics containing denied procedure names remain valid, while equivalent dangerous Scheme/include syntax is rejected consistently in Python and TypeScript.
- GitHub fails after creating a source branch but before dispatch: evidence survives, retry does not overwrite source or silently strand queued rows.
- A source-only batch and a mixed batch follow the same checks, hold rules, cancellation recovery and private-note protections.

## Task 1: Versioned public music reports

**Files:** Modify `data/schema/corrections.json`, `workers/corrections/src/{schema,status,index}.ts`, `web/src/lib/{typeset.ts,admin/typesetData.ts,admin/targets.ts,admin/api.ts,admin/store.ts}`, `web/src/components/SystemStack.astro`, `web/src/pages/corrections/index.astro`; create `workers/corrections/migrations/0006_typeset_reports.sql` and corresponding rollback. Extend Worker schema/status/intake tests, admin deduplication/API tests and `web/e2e/corrections.e2e.ts`.

**Interfaces:** `Correction` and `StoredRow` gain optional `seen: string | null`; public `PublicRow` gains optional `renderHash`. Add `issue` to public fields and `typeset` to intake kinds; shared issues are exactly `notation`, `lyrics`, `layout`, `other`. Typeset targets retain the existing safe filename pattern plus an explicit rejection of `..` segments. Intake requires a 32-character lowercase hex render hash, `pieceId: "typeset"`, checked file target and issue enum. Existing catalogue contracts remain valid. `Render` gains `hash`; typeset catalogue entries gain optional hash.

- [ ] Write regressions for same file/issue/hash dedupe, distinct render versions, unsafe filenames/hashes, missing hash, unknown issue, stored projection and note privacy. Assert `parseCorrection({pieceId:"typeset",target:"typeset:vol-5/x.ly",field:"issue",proposedValue:"lyrics",seen:"a".repeat(32)}).ok === true`; invalid variants are false.
- [ ] Run Worker tests and migrated-D1 admin tests; confirm failures come from the missing versioned contract/index.
- [ ] Implement intake, insert/projection, labels and migration 0006. Rebuild the partial dedupe index with `CASE WHEN field='issue' THEN COALESCE(seen,'') ELSE '' END`; retain 0004 identity for other fields. Make withdrawal compare version for issue twins. No existing reports are deleted.
- [ ] Add report links beside displayed transcriptions, a fixed-target issue form and private explanatory note. Route issue rows to the future source screen; reject direct approval as catalogue edits. Show stale/current render hashes and retain retired file identifiers.
- [ ] Verify Worker tests, web admin/typeset tests and a browser report POST intercepted before external intake. Expected: all pass; public JSON and rendered DOM contain no note. Commit `feat: add versioned typeset error reports`.

## Task 2: Source checker parity and repository source access

**Files:** Create `web/src/lib/admin/sourceCheck.ts`, `web/src/lib/admin/sourceCheck.test.ts`, `tests/fixtures/typeset-source-check.json`; extend `tests/test_typeset_source_check.py`, `web/src/lib/admin/github.ts` and GitHub boundary tests. Shared rule data belongs in `data/schema/typeset-source-check.json`; Python consumes or verifies the same procedure/command/include lists.

**Interfaces:** `checkSource(text: string, allowedIncludes: readonly string[]): readonly {line:number; message:string}[]` mirrors `pipeline.typeset.source_check.check`. `readSource(env: GithubEnv, file: string, ref: string, fetcher?): Promise<{text:string; blobSha:string}>` and `readMain(env: GithubEnv, fetcher?): Promise<{commitSha:string; treeSha:string}>` use App installation tokens. Source API response never exposes a token. Enforce file membership before invoking repository access in later routes.

- [ ] Write shared fixtures for safe Latin, comments/strings, balanced and malformed Scheme, denied procedures/directives, traversal/includes, Unicode and line numbers. Both language tests assert identical expected problems. Add GitHub tests for UTF-8 contents, exact encoded path/ref, authentication failure, missing/oversized/non-file content and invalid SHA.
- [ ] Run `uv run pytest tests/test_typeset_source_check.py -q` and the new web checker/GitHub tests; observe failures for missing port/accessors.
- [ ] Port the existing scanner faithfully, including comment/string blanking and Scheme regions; enforce the 60 KiB byte limit separately from syntax diagnostics. Implement GitHub readers and strict response checks with injected fetch at the network boundary.
- [ ] Run both fixture suites and Worker/web typechecks. Expected: shared fixture parity and source readers pass. Commit `feat: validate and load editable typeset source`.

## Task 3: Durable drafts, immutable approvals and source editor

**Files:** Create migration/rollback `0007_typeset_drafts.sql`, `web/src/lib/admin/typesetStore.ts`, `web/src/lib/admin/typesetApi.ts`, matching tests and `web/src/pages/admin/typeset/edit.astro`; modify admin route delegation/store interfaces, typeset queue links and `web/package.json`/lockfile for bundled CodeMirror 6. Add `web/e2e/typeset-source.e2e.ts`.

**Interfaces:** `SourceDraft {file,text,baseBlobSha,contentHash,revision}`; `SourceSnapshot {correctionId,file,text,baseBlobSha,contentHash}`. `typesetStore(db)` provides `getDraft(email,file)`, `saveDraft(email,draft,expectedRevision): Promise<SourceDraft | null>`, `approveDraft(email,file,expectedRevision,note): Promise<number | null>` and `snapshots(ids): Promise<readonly SourceSnapshot[]>`. Saves use optimistic revisions; snapshots are immutable and transactionally paired with approved `source` correction rows. Extend `D1Like` with batch/transaction support and the real SQLite adapter rather than claiming atomicity from sequential calls.

Routes, all inside existing authentication/origin/rate guards:
`GET /typeset/source?file=...`; `POST /typeset/draft` body `{file,text,baseBlobSha,expectedRevision}`; `POST /typeset/approve` body `{file,expectedRevision,note,reportId?}`. Ownership comes from the authenticated editor. Approving can link a same-file issue report atomically; extend 0005 resolution guards to accept only an editor `source` snapshot, never `reviewed`.

- [ ] Write migrated-D1 tests for save/reload, cross-editor isolation, byte boundaries, stale tab revisions, unknown paths, source-check diagnostics, immutable snapshot after further saves, withdrawal preserving draft and issue-resolution linkage. Assert competing saves with one revision permit exactly one update.
- [ ] Run targeted tests and confirm missing tables/routes cause the expected failures.
- [ ] Implement schema/store/routes, limited source loading and known-file checks. A stale source base returns 409 with the current source and draft for reconciliation; approving a snapshot checks the supplied revision. Editor reasons are labelled public; imported reader notes never prefill that field.
- [ ] Build CodeMirror source screen with full scan context, current error, save and approve actions, conflict view and focusable line diagnostics. Link broken/matched typeset items and issue reports here. Saving does not approve; report resolution awaits merge.
- [ ] Verify store/API tests and browser edit/save/reload/approve/withdraw/conflict flows using injected repository responses at the server boundary in a test-only localhost fixture. Expected: all pass; no external write. Commit `feat: add durable typeset source editing`.

## Task 4: Isolated previews and durable concurrency limits

**Files:** Create migration/rollback `0008_typeset_previews.sql`, `web/src/lib/admin/typesetPreview.ts` and tests, `pipeline/typeset/preview.py`, `tests/test_typeset_preview.py`, `.github/workflows/typeset-preview.yml`; extend `pipeline/cli.py`, typeset API/source page and merge webhook delegation. Reuse `pipeline/typeset/{render,publish,svgcheck,lilypond}.py` and `pipeline/upload.py`.

**Interfaces:** `previewKey(file,text,context): Promise<string>` is SHA-256 over a canonical length-delimited representation. Context is checked main commit/config/includes plus pinned renderer version. `acquirePreview(email,key,now): Promise<{ok:true;leaseId:number} | {ok:false;reason:"active"|"rate"}>` atomically expires old leases, counts admissions in the last hour and inserts a five-minute lease; `releasePreview(key): Promise<number>` releases matching leases idempotently. Admission limit counts attempts before dispatch, so rapid failed dispatches cannot bypass it. `POST /typeset/preview` saves the requested revision and returns `{key,resultUrl}`; existing authenticated routes retain origin checks. A signed `workflow_run` completion for `typeset-preview <key>` releases leases.

Python `render_preview(payload_path: Path, out: Path)` validates file/key/context/text and emits bounded `result.json` plus checked wide SVG. `publish_preview(out: Path, creds=None)` verifies all artifacts and uses write-if-absent R2 uploads under the validated key. It does not execute LilyPond or Scheme.

- [ ] Write lease races, 20th/21st admission, expiry, failed-dispatch cleanup, webhook retry and cache-context separation tests. Write Python tests for malformed payloads, unsafe source, bounded errors, bad SVG, valid render result and upload isolation; add a pinned-LilyPond integration fixture.
- [ ] Run TS/Python suites and observe missing lease/preview behavior failing.
- [ ] Implement leases, key derivation, preview dispatch and workflow. The render job checks out the trusted context without persisted credentials, installs pinned tools and uses the existing `NOH_SANDBOX=1` network isolation. Enforce workflow/job and render limits. The upload job downloads artifacts, rechecks SVG/result/key and uploads using R2 credentials; it never invokes source rendering. Never interpolate submitted text into shell code.
- [ ] Add UI polling every five seconds, maximum four minutes, bounded error/line display, retry and draft retention; suppress superseded results. Document the separate 14-day R2 lifecycle rule.
- [ ] Verify TS lease/API tests, Python preview suites and browser success/error/timeout flows against deterministic result fixtures. Expected: all pass; pinned render fixture passes when LilyPond is available. Commit `feat: preview source edits through isolated GitHub jobs`.

## Task 5: Publish immutable source snapshots in existing batches

**Files:** Create `web/src/lib/admin/typesetPublish.ts` and tests; extend `github.ts`, `api.ts`, `api.test.ts`, `.github/workflows/corrections-batch.yml`, `pipeline/corrections.py`, `pipeline/cli.py`, `tests/test_corrections.py` and source editor conflict UI.

**Interfaces:** Extend `Batch` with optional `branch` and `sources: readonly {correctionId:number; file:string; baseBlobSha:string; contentHash:string}[]`. Source text is in Git commits, not dispatch. `prepareSourceBatch(env,batch,snapshots,fetcher?): Promise<{branch:string;commitSha:string}>` checks all bases at a single captured main commit, creates Git blobs/tree/commit then creates `refs/heads/corrections/<batch>`. Source corrections' `proposed` value is the snapshot hash, not text. A pure source batch has `entries:[]`; ordinary batch contracts remain valid.

- [ ] Write exact Git Data API sequence tests, multibyte source, stale bases (zero mutation), duplicate files, retry/partial API failure, publication claim races and source-only/mixed-batch tests. Assert approved snapshot text survives later draft changes. Add webhook merge/cancel tests resolving linked issue reports and retaining notes, plus payload/summary privacy markers.
- [ ] Run targeted web and Python batch tests; confirm missing source-only/branch handling fails.
- [ ] Claim approved rows/snapshots conditionally; check sources before remote branch mutation. On failure return queued rows to approved with retry context; never overwrite a previously created batch branch. Conflicts return current and approved source text with no silent merge. Handle branch-created/dispatch-failed recovery explicitly with unique batch identity and existing-branch validation.
- [ ] Update the batch workflow to validate payload before choosing checkout ref, support the precreated source branch and write normal corrections on top. Regenerate affected source manifest/review data before checks. Extend `correct_batch` to accept source-only descriptors, validate snapshot files/hashes against branch contents and include source changes in summary/large-batch holds without inventing catalogue fields. Preserve `correct_batch`’s `list[Entry]` return type; extend `batch_summary` with an optional source descriptor argument and count source snapshots in hold thresholds.
- [ ] Verify GitHub boundary tests, migrated API lifecycle tests and Python correction/source-only/mixed tests. Expected: all pass; normal catalogue batching is unchanged and private markers absent. Commit `feat: publish checked source snapshots with corrections batches`.

## Task 6: Completion verification and release handoff

**Files:** Modify `docs/ADMIN-SETUP.md`, approved spec progress and implementation evidence artifact; add browser lifecycle cases to `web/e2e/typeset-source.e2e.ts` and Python workflow-contract checks where behavior is not exercised by existing tests.

**Interfaces:** Release evidence records migrations 0001–0008, Worker version, Pages commit, preview context, publication run and webhook outcome. Remote release uses the existing setup/runbook; no staging success is inferred from local builds.

- [ ] Add complete browser report→editor draft→preview→approve→publish→resolved scenarios with intercepted external boundaries, cancelled retry, stale reconciliation, phone layout and no private-note leakage. Confirm any new end-to-end assertions fail before filling wiring gaps.
- [ ] Run Worker full tests/typecheck; web full tests/Astro check; Python CI subset `uv run pytest -m 'not source' -q`; pinned preview render fixture; affected browser suite; Astro build/Pagefind/link check and Worker dry-run. Temporarily exclude the 1Password `.env` FIFO during Vite checks and restore it with a shell trap; never read or print its contents. Expected: all relevant checks pass; record actual skip/tool limitations.
- [ ] Obtain one fresh whole-branch review under requesting-code-review; fix critical/important findings in one RED→GREEN pass and record decisions. Keep the user-selected native execution; no implementation agents.
- [ ] Commit final wiring/docs and produce a reviewable PR with App permissions, R2 expiry, migration/Worker/Pages order, rollback constraints and staging exercise. Attach every created PR to this chat.
- [ ] Present concrete integration/deployment approval as the final release step. Once authorized, export D1, apply migrations, deploy Worker and Pages/workflows, establish expiry and run staging/production smoke publication. Verify Access, preview/render/upload, webhook and resolved public status; record actual deployment versions. A blocker leaves source/drafts/evidence intact and reports the exact outstanding action.

## Execution record

Plan self-review: every approved spec section is assigned to a task. Tasks 1/3/5
share issue/source resolution; Tasks 2/3/4 share source validation and blob revisions;
Tasks 3/5 share immutable snapshots; Tasks 4/6 share isolated preview acceptance.
These signatures are the pre-flight contract. Existing completed section/withdrawal
and full-scan fixes are dependencies, not tasks to redo. Written plan review is the
remaining pre-implementation handoff; native execution has already been selected.
