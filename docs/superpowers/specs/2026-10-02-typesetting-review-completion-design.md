# Complete public review and invited-editor typesetting

Status: approved by the user on October 2, 2026. This updates the source-editor
stage of `origin/feat/typesetting-2ykxyb`'s September 28 design and plan against
current main and the corrections compatibility branch. It does not replace the
existing corrections Worker, admin queue, rendering pipeline or publication flow.

## Outcome and scope

Readers can report catalogue errors and errors in the displayed typeset music.
Invited editors can inspect the entire printed scan, fix the source, preview it,
and publish a checked correction from the browser. Reader notes stay private.
A report becomes resolved only after its actual fix merges. Production readiness
includes the separately deployed Worker and its shared D1 database.

The user requested all outstanding work on October 2. The bounded lifecycle fixes
and full scan comparison are implemented on `codex/corrections-compatibility`.
The remaining source editor and preview/publication subsystem need this written
update because their original plan predates migrations 0004 and 0005 and does not
specify versioned public music reports or their resolution links.

## Decisions already implemented

- Migration 0004 gives pending reports target-aware identity.
- Migration 0005 links reader section reports to their approved editor correction.
  Reports remain pending while that fix is approved or queued, become resolved on
  merge, and return to the actionable queue if the fix is withdrawn.
- Duplicate is a separate public outcome. Withdrawal and cancelled reader batches
  preserve evidence and link to an existing pending twin rather than violating
  the unique index. Canonical field aliases and legacy null piece targets match.
- Cancelled editor batches return to approved, so section fixes can be republished.
- Pending triage mutations check that no resolution link was added concurrently.
- Proofreading shows all systems in the matched span with lazy image loading.
- Reader notes are excluded from GitHub batch artifacts and public status.

Historical duplicate reasons are not converted into links by guessing at prose.
The release audit must identify any such section reports for explicit reconciliation.

## Public typeset reports

Add a report action beside each displayed transcription. It identifies
`typeset:<file>` and the displayed render hash, rather than a catalogue field.
The form asks for an enumerated issue: notation, lyrics, layout or other; detailed
explanations go in the existing private note. Catalogue corrections keep their
current flow. Typeset reports use a dedicated `issue` field and the existing
`seen` column for the render hash. Stored public projection accepts only a checked
filename, issue enumeration and hash; no arbitrary music source or note renders.

Worker intake, public form and admin validation share the filename and issue rules.
The target catalogue supplies file labels and current render hashes. A typeset
report remains identifiable if the file retires or its drawing changes. Editors
see the reported hash and current hash, with a stale-version warning. Duplicate
identity includes render version for these reports: identical issue categories on
successive drawings are different reports. The catalogue-field index semantics
remain unchanged. This needs a new migration after 0005.

An editor opens the source screen from the report. The report links to an immutable
approved source correction on that same file. The resolution mechanism from 0005
is extended to this case and resolves only after publication merges. A proofreading
acknowledgment alone cannot resolve a music-error report.

## Source editor and durable drafts

Use bundled CodeMirror 6 on an Access-protected admin source screen. Show complete
matched scans above the editor and preview beside it. Broken/unmatched files still
open; show their current error and candidate context. Phone layout stacks panels.

Load source from the repository through the GitHub App, restricted to known files
under `data/typeset/src/`. Store per-editor drafts in D1 with file, text, GitHub base
blob SHA, content hash and timestamps. Limit text to 60 KiB measured as UTF-8 bytes.
Never use the drawing's 32-character render hash as the source revision: publishing
compares the Git blob SHA against current main.

Save validates source immediately with a TypeScript port of the existing Python
source checker, verified against shared fixtures. Validation is defense in depth;
rendering remains isolated. Saving a draft does not approve or publish it.

Approving a source correction freezes an immutable snapshot, so further typing
cannot change an already approved/queued edit. The approved row references the
snapshot; source text stays out of public report projection. Withdrawal preserves
the editor's draft and reopens any linked reader report. Only the draft's owner
can save or approve it; normal invited-editor publication can publish approved
snapshots just as it publishes current corrections.

## GitHub preview

Retain the original design's GitHub Actions preview, avoiding a second renderer.
Preview saves and validates the draft, then dispatches `typeset-preview` as the App.
Allow one active preview per editor and at most 20/hour. Persist a preview lease in
D1, with bounded expiry and release on completion/failure; separate concurrent
requests cannot both acquire it.

The preview cache key includes filename, source bytes, approved include/configuration
revision and renderer version. Identical source in different include contexts must
not share a misleading preview. The browser polls public `result.json` every five
seconds for up to four minutes, keeps its draft on failure and offers retry.

Use two jobs. Rendering has no repository write permission or secrets; LilyPond
runs with no network, time/output limits and the current source/SVG checks. Only
allow approved includes. The upload job receives artifacts, never executes the
submitted source, verifies the SVG again and writes immutable
`typeset-preview/<key>/wide.svg` and `result.json` to R2. Result contains success or
bounded error text with line numbers and melody comparison. Keep the existing R2
pruner limited to production typeset assets; a separate lifecycle rule expires
preview objects after 14 days.

## Publication and conflict handling

Extend the existing Publish batch; do not introduce a separate merge workflow.
Claim approved rows/snapshots with conditional database transitions. Read current
main, check each source snapshot's base blob SHA, and refuse stale drafts before
creating a branch. Show current source and draft together for explicit reconciliation;
never silently overwrite or automatically merge LilyPond text.

Create `corrections/<batch>` from the checked main commit through GitHub's Git Data
API, commit source snapshots there, then dispatch `corrections-batch` with the batch
branch and source descriptors. Validate the branch name in both API and workflow.
The workflow checks out that branch, records ordinary catalogue/review corrections
on top, renders source changes and checks melody and SVG. Support source-only and
mixed batches. Existing structural-change/large-batch owner holds remain in force.

Failures preserve snapshots and reader notes, return queued changes to approved and
provide the existing retry path. GitHub retries/webhooks are idempotent. The merge
webhook accepts source corrections and resolves linked reports with the actual
merge SHA. Current private reader-note exclusion applies to every batch payload,
PR description, workflow summary and committed corrections record.

## Release and evidence

Production read-only inspection on October 2 confirmed migrations 0001–0003 are
applied. Migrations 0004 and 0005 are currently local. Aggregate inspection
found seven accepted and four rejected reports, no pending/approved/queued reports,
and no historical section duplicates to reconcile. Latest successful site build
is main `31965cf7d0c8083bac839b599bb0b1e1e6660be8`, GitHub run 36935764314.
The latest Worker deployment listed is version
`57e4d600-1e2f-402a-a92f-6cd03f24d5ae` at 100%, deployed September 28.

Before production release: export D1; apply all migrations; deploy the separate
corrections Worker; deploy Pages/workflows in their documented order; establish R2
preview expiry; verify Access/editor bindings, App permissions, webhook delivery and
public report privacy. Repository-dispatch workflows must exist on the default
branch before an end-to-end production preview can run. Keep release changes in a
reviewable PR and record any final deployment approval separately.

Acceptance checks use actual migrations and public projection, shared Python/TS
source fixtures, mocked external API boundaries and browser flows against disposable
D1. Cover report versions, ownership, concurrent preview leases, stale source,
source-only/mixed batches, dispatch failures, cancelled PR retry, resolved public
status and zero private-note leakage. In staging, edit a broken file, preview its
repair and publish it through the complete GitHub/R2/webhook path before inviting
users. Record deployed Worker version, Pages commit, migration names and the checked
publication run. A build alone does not establish production readiness.

## Remaining sequence

1. Review this written update, then write the detailed implementation plan using
   the user's selected native execution method in this checkout.
2. Add versioned public typeset reports and their admin resolution paths.
3. Implement durable drafts, source checker parity and the source editor.
4. Implement preview leases, isolated preview workflow and R2 results.
5. Extend source publication and stale-base conflict handling.
6. Verify the complete lifecycle, reconcile historical reports, then coordinate
   migrations, Worker/Pages deployment and staging/production checks.
