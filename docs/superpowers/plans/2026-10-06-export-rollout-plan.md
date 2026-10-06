# Export Publication and Catalogue Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish only current approved conversions, release a bounded Kyrie IX pilot, and expand safely through economical conversion/review batches.

**Architecture:** Secret-free isolated jobs create validated artifacts; a separate upload job verifies their provenance and publishes immutable bytes. The site consumes a separate approved conversion manifest. Pilot measurements determine bounded browser limits before public enablement; subsequent catalogue entries require their own evidence and approval.

**Tech Stack:** Existing GitHub Actions, Python pipeline, immutable R2 asset conventions, Astro build, Playwright/Vitest/pytest, versioned JSON manifests and resource profiles.

**Spec:** [Design](../specs/2026-10-06-export-layout-editor-design.md), §6.5/7–9. [Coordination and gate owners](2026-10-06-export-layout-implementation-plan.md).

## Global Constraints

- “Publish only approved assets to the public editor.”
- “Use the current reviewed segment boundaries and matching rules; a converted file does not automatically establish a catalogue match.”
- “No visitor-supplied source is compiled.”
- “Keep the current quick **Export PDF** action available.”
- “Every score receives a visual check before public customization.”
- Existing export ceiling remains 300 source systems. Additional MEI resource limits require pilot measurements.
- A newly discovered feature family expands the representative matrix before that family is enabled publicly.
- Compiler jobs have no publishing secrets; uploader jobs never execute LilyPond/source code.

## Review Focus

1. Untrusted source or artifact reaches a secret-bearing job: C1 tests isolation and verifies artifacts before upload.
2. Stale approvals survive version/source changes: C1/C3 reject stale records and regenerate the manifest.
3. Large selections crash or stall browsers: C2 derives documented bounds and tests rejection/cancellation.
4. Bulk conversion silently expands feature support or public coverage: C4 separates conversion, review, and approval.
5. Pilot removal breaks original exports: C3 rehearses rollback to scans/fixed outputs without changing selection behavior.

---

## File ownership

| Files | Responsibility |
| --- | --- |
| `pipeline/typeset/mei/publish.py`, `tests/test_mei_publish.py` | Verified immutable publication, no source compilation |
| `.github/workflows/mei-conversion.yml`, `tests/test_mei_workflows.py` | Secret-free conversion/evidence and separated upload |
| `data/typeset/mei/manifest.json`, `resource-profile.json` | Approved capability mapping and measured browser limits |
| `pipeline/typeset/mei/batch.py`, `tests/test_mei_batch.py` | Bounded source lists, resumable digest-keyed batch results |
| `web/scripts/measure-export-layout.ts`, `web/src/lib/export-layout/limits.ts`, tests | Performance harness and browser job admission |
| `docs/TYPESETTING.md`, `docs/superpowers/plans/export-layout-decisions.md` | Operator commands, approvals, measurements, release/rollback |
| `.github/workflows/site.yml`, `pipeline/cli.py`, build manifest wiring | Coordinator-owned integration only |

No agent changes public approval files while simultaneously converting/reviewing the same score. Generated catalogues and evidence remain in build/artifact storage. Track the minimal approved manifest/decision metadata needed to reproduce and invalidate public availability.

## C1. Isolated conversion CI and immutable publication

**Dependencies:** A6. **Owner:** bounded CI/Python implementer; independent security review.

**Interfaces:** `verify_publish_bundle(bundle: Path, expected: PublishInputs) -> VerifiedBundle`; `publish_verified(bundle: VerifiedBundle, store: AssetStore) -> PublishReport`. `AssetStore` wraps existing R2 transport semantics; it cannot compile sources. CLI: `typeset-mei-publish --bundle DIRECTORY --expected INPUTS_JSON`.

**Files:** Create `publish.py`, new workflow/tests; coordinator registers command and connects site manifest validation. Reuse existing publisher transport helpers where possible without importing command paths that trigger compilation.

- [ ] Write failing tests for corrupt MEI/evidence bytes, stale include/version digests, unsafe paths, incomplete matrix, missing approval, immutable-key collision, and mismatched original target render hash. A valid bundle uploads exactly its recorded assets and produces no compiler invocation.

```python
with pytest.raises(PublishBlocked, match="HASH_MISMATCH"):
    verify_publish_bundle(corrupt_bundle, expected_inputs)
assert compiler_spy.call_count == 0
assert fake_store.keys == recorded_immutable_keys
```

Define `PublishBlocked` with structured diagnostics in `publish.py`; the compiler spy and fake store are test fixtures.
- [ ] Add workflow tests matching the existing `test_typeset_workflows.py` pattern: source jobs have `permissions: {}`, no `secrets.*`, no credentialed checkout, sandboxed/network-isolated pinned runner with CPU/file/memory bounds; upload is a separate job, does not execute source or install/run the compiler, and is unavailable to untrusted forks. Validate source revision/ref before execution using existing trusted-preview rules.
- [ ] Run `uv run pytest -q tests/test_mei_publish.py tests/test_mei_workflows.py`; expect failures.
- [ ] Implement digest verification before upload and write-if-absent immutable keys under a distinct MEI conversion prefix. Record source/dependency/tool/schema/profile/renderer/font versions and every asset hash. Upload job treats downloaded artifacts as data; revalidate approval and paths independently. Site build excludes unavailable/stale entries rather than trusting a claimed `approved` string. Integrate new checks without altering existing isolated typeset workflows.
- [ ] Run new tests and `uv run pytest -q tests/test_typeset_workflows.py`. Dry-run with a fake store and then an authorized staging destination; verify uploaded bytes/hash and asset lookup. A dry-run does not authorize production publication.
- [ ] Commit with `ci: isolate and verify approved MEI artifact publication` after independent review.

**Handoff:** Workflow proof, fake-store transcript, immutable key/digest format, and publication/rollback commands. Public upload happens only after designated approval.

## C2. Measured resource admission and performance gate

**Dependencies:** B10 and A1 feature inventory. **Owner:** performance/QA implementer.

**Interfaces:** `checkLayoutBudget(input: BudgetInput, limits: ResourceProfile) -> BudgetDecision`; `ResourceProfile` contains version, max MEI bytes/events/pages, job timeout, aggregate selection limits, measurement provenance, and approved renderer/font/build hashes. Preserve source-system cap independently. `BudgetDecision` is eligible or a specific recoverable limit diagnostic. CLI/harness records timing and artifact sizes; it never invents a successful measurement.

**Files:** Create `limits.ts`, `limits.test.ts`, measurement script, `resource-profile.json`; wire limits into B7 worker admission and cancellation. Document device/browser/version and reproducible harness command in `docs/TYPESETTING.md`.

- [ ] Write failing tests for byte/event/aggregate limits, predicted and actual page ceilings, job timeout, invalid profiles, zero-limit/corrupt data, and cap300 preservation. Assert over-budget requests fail before expensive loading where possible, and actual output overflow is rejected before download.

```ts
expect(checkLayoutBudget(overEventLimit, profile).eligible).toBe(false);
expect(checkLayoutBudget(atVerifiedLimit, profile).eligible).toBe(true);
expect(rendererLoadSpy).not.toHaveBeenCalled(); // rejected before expensive work
```
- [ ] Run `cd web` then `pnpm exec vitest run src/lib/export-layout/limits.test.ts src/lib/export-layout/controller.test.ts`; expect failures.
- [ ] Instrument cold renderer startup, first preview, warm setting change, PDF generation, worker memory where measurable, and total asset bytes. Use Kyrie, the longest supported audited representative, mixed selections, and increasing multi-part loads. Record at least five runs per condition on a desktop and a real tablet browser; include failures, not just medians. When browser memory is unavailable, mark it unavailable and use process/worker instrumentation where supported; do not report invented precision.
- [ ] Set bounded **development-only** defaults before benchmarking: 8 MiB MEI per part, 20,000 extracted events per part, 100 output pages per selection, and a 60-second worker watchdog. These are safety starting points, not demonstrated production capacities. Measure below/at/above them. Derive public limits from the largest stable verified workload with headroom, explain the chosen margin, and record p50/p95/max and memory observations. The coordinator must approve the measured profile; do not ship the provisional profile automatically. If the tablet cannot complete the pilot comfortably, optimize or constrain the pilot before enabling it.
- [ ] Implement admission/cancellation using the approved profile, retry/update guidance, and part-specific errors. Rerun at/above limits and real browser failure/recovery cases; expected: bounded operation, no stale download, no lost settings. Check ordinary reading/quick-export bundle and request counts against baseline.
- [ ] Commit with `perf: bound custom export using measured pilot workloads`; attach measurement results and G3 recommendation.

## C3. Reviewed Kyrie IX pilot, regression checks, and rollback

**Dependencies:** G0–G3, A5 current maintainer approval, B10 acceptance, C1/C2. **Owner:** coordinator.

**Interfaces:** Site consumes a schema/version-validated conversion manifest filtered by current target/render hash. Pilot enablement is controlled by a manifest entry, not replacing LilyPond/scans. Rollback removes the entry and rebuilds; existing original assets remain available.

**Files:** Add only the approved Kyrie record to `data/typeset/mei/manifest.json`, necessary site build wiring, and release instructions/tests. Update manifest fixtures for stale-version/rollback cases.

- [ ] Write failing tests for wrong artifact version/hash, changed target/source, manifest removal, absent resource profile, and custom runtime asset failure. Assert removal disables Kyrie customization while quick export and original scan/fixed routes still work. No reader preference or source correction is written.
- [ ] Run targeted manifest/integration tests and prove the invalid pilot entries are rejected.
- [ ] Assemble the release packet: audit, exact semantic/schema/mutation report, complete representative visual matrix, matching/proofreading separation, verified fonts/vector PDFs, six physical sizes, mixed selection, resource profile, isolated CI and rollback result. Resolve all blockers; accepted engraving differences need named approval. Reconfirm hashes immediately before publication.
- [ ] Run `uv run pytest -q -m "not slow"`, `uv run ruff check pipeline tools tests`, `uv run noh typeset-check`; in web run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`. Run native/source/slow suites in configured CI with their assets. Record skips or unavailable devices as pending gates. Verify existing correction-worker checks required by site CI also pass; do not omit them because the feature does not intentionally change that code.
- [ ] Publish through C1 only with authorized maintainer approval. Smoke-test deployed approved asset headers/hashes, editor startup, one real download, original export, and lazy loading. Rehearse removing the entry in staging. Record release commit, artifacts, and rollback command; commit with `feat: enable reviewed Kyrie IX custom export pilot`.

**Exit:** One current approved public pilot, or a documented blocked release with existing exports preserved. No inferred catalogue-wide approval.

## C4. Bounded catalogue conversion and independent review batches

**Dependencies:** Stable C3 pilot, A1 inventory. **Owner:** conversion agents and separate evidence reviewers.

**Interfaces:** `run_batch(sources: list[Path], profile: ConversionProfile, output: Path) -> BatchReport`; report contains explicit score IDs, digests, statuses, diagnostics, evidence paths, resume/cache decisions, and counts. CLI: `typeset-mei-batch --sources LIST_FILE --out DIRECTORY`. Reuse A2–A5; no parallel alternate converter.

**Files:** Create `batch.py`, tests, CLI dispatch, `docs/TYPESETTING.md` batch/review protocol. Each agent owns its explicit source list and digest directories; coordinator alone integrates approval manifests.

- [ ] Write failing tests for interrupted/resumed batch, changed source/include/version invalidating a cached success, partial failure not aborting unrelated scores, no output overwrite across agents, and unsupported feature never counted approved. Assert counts include every requested nonempty source exactly once by state.

```python
assert report.counts["approved"] == 0  # conversion itself never approves
assert sum(report.counts.values()) == len(requested_nonempty_sources)
assert changed_input.digest != cached_input.digest
```
- [ ] Run `uv run pytest -q tests/test_mei_batch.py`; expect failures.
- [ ] Implement digest-keyed resumable extraction/encoding/validation/evidence with bounded compiler concurrency. Start with a batch of five existing-family scores to measure cost/review time; adjust future size from observed packet complexity, not an arbitrary full-catalogue estimate. Do not add broad auto-approval or silently change feature rules.
- [ ] For each score, an independent reviewer checks all voices/lyrics/spans/divisions/endings and the default plus Letter/Large/Automatic stress layouts against LilyPond and scan context. A new feature gets a separate implementation task, mutation fixture, expanded representative matrix, and fresh profile version before any affected score is approved. Revalidate previously approved scores impacted by changed rules/version.
- [ ] Run tests; reconcile conversion and review counts. Report unsupported/failed/needs-review/approved separately, accepted differences, time/cost per batch if supplied by the execution environment, and blockers by feature family. Maintainer approves individual current records; coordinator publishes through C1 and adds only those manifest entries in a separately reviewable commit.
- [ ] Commit batch tooling with `feat: support resumable reviewed MEI conversion batches`; commit each approved catalogue batch separately with its evidence references.

## Completion and ongoing operating rules

The pilot is complete only when G0–G4 are satisfied; catalogue rollout is incremental rather than a promise to convert every source. Stop a batch when unfamiliar notation appears, preserve its localized fixture, and send that one case to a stronger/domain-capable agent if economical agents cannot resolve it. Reviewers must never approve a score merely because a sibling using the same includes passed.

Version changes require manifest invalidation and affected evidence reruns. Keep original exports as the stable recovery route. Report actual enabled coverage from the audited denominator and current approvals, without treating empty/absent transcriptions as failed conversions.
