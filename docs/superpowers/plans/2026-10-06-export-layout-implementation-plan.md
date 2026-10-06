# Export Layout Implementation Plan and Agent Handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reviewed Kyrie IX export editor, then enable additional scores through reproducible conversion and review.

**Architecture:** LilyPond remains the master; a build-time converter produces versioned MEI and evidence. Approved derivatives feed a lazy-loaded browser renderer whose canonical pages drive both preview and vector PDF. Existing reading, matching, and quick export remain independent.

**Tech Stack:** Python 3.12+, pinned LilyPond, MEI schema validation; Astro/TypeScript, Verovio WASM, Vitest, Playwright, existing pdf-lib, and a vector-PDF adapter selected by a fidelity spike.

**Spec:** [Export layout editor design](../specs/2026-10-06-export-layout-editor-design.md).

## Global Constraints

- “LilyPond remains the authoritative source; MEI is a generated, reviewed derivative used for browser layout.”
- “The first public release is a reviewed pilot starting with **Missa IX, Kyrie IX**, not an automatic migration of the whole catalogue.”
- “Every unsupported musical feature blocks approval.”
- “No visitor-supplied source is compiled.”
- “Do not silently rasterize typeset notation or use browser print as a substitute for a reliable Download PDF action.”
- “Each selected part starts on a new page in the first release.”
- Default paper remains Letter, orientation Portrait; preserve `EXPORT_CEILING = 300` source systems.
- Production UI implementation follows approval of the complete editor mockups. Planning, audit, and fidelity proofs can proceed before that approval.

## Review Focus

1. A converter appears correct after dropping a voice or lyric association: A2/A4 require mutation failures with localized diagnostics.
2. A previously approved conversion changes through an include or tool update: A5/C1 require full dependency/version invalidation.
3. Manual breaks conflict with a sustained event or page cap: A3/B4 preserve rational sustain and reject impossible constraints.
4. An old worker result or failed asset becomes a downloadable preview: B7/B9 test out-of-order completion and explicit recovery.
5. PDF fonts or fixed-page fitting differ from preview: B2/B5/B6 test accents, glyph references, aspect ratio, and physical dimensions.

---

## 1. How to execute this packet

Read the spec, this coordination document, and **only the assigned subsystem/task**. The detailed plans are:

| Plan | Deliverable | Tasks |
| --- | --- | --- |
| [A: Conversion and evidence](2026-10-06-mei-conversion-plan.md) | Audited catalogue, exact IR, Kyrie IX MEI, validation/review packet | A1–A6 |
| [B: Editor and matching PDF](2026-10-06-export-editor-plan.md) | Approved mockups, browser layout, vector PDF, integration | B1–B10 |
| [C: Publication and rollout](2026-10-06-export-rollout-plan.md) | Isolated CI, approved manifests, performance gates, conversion batches | C1–C4 |

Treat task boundaries as review boundaries, not independent branches of an untested implementation. Commit each accepted task. An implementer marks checkboxes only after recording the specified evidence. A reviewer reports findings before the next dependent task starts.

Suggested order:

```text
A1 audit → A2 extraction → A3 encoding → A4 semantic validation → A5 evidence
                  B1 mockups ────────────────────────────────┐
                  B2 PDF/font spike ← A3 pilot               │
A5 → A6 approved-artifact contract → B3 selection/settings    │
A3 + B2 + B3 → B4 layout → B5 sanitization → B6 composition  │
B4 + B6 → B7 worker/controller → B8 UI ← approved B1 ────────┘
B8 → B9 integration → B10 browser/PDF acceptance
A6 → C1 publication isolation
B10 + C1 → C2 release measurements → C3 Kyrie pilot → C4 batches
```

B1 can run while A1–A3 are underway; it produces reviewable mockups, not the live editor. B2 starts with the checked-in pilot derivative from A3, including its unresolved diagnostics. C1 may run after A6 without waiting for UI. **No task may publish an unapproved conversion.**

## 2. Cost-conscious agent allocation

Use a lower-cost coding agent for bounded tasks with fixed contracts and fixtures. Reuse that agent within a subsystem for adjacent accepted tasks; do not pay to reload the entire repository for each checkbox. Give an independent reviewer the diff, task, contracts, and evidence—not the implementer's reasoning transcript.

| Work | Default assignment | Escalation trigger |
| --- | --- | --- |
| Audit, settings, selection, preferences, markup, CI plumbing | Lower-cost implementer + independent bounded review | Existing behavior changes or contract ambiguity |
| Extraction, rational normalization, lyric anchoring, safe breaks | Implementer comfortable with music data + independent semantic reviewer | Two unsuccessful fixes; undocumented compiler behavior; lost musical meaning |
| SVG/font/PDF proof and constraint solver | Implementer comfortable with rendering + independent visual/geometry review | Unsupported SVG/font behavior; disagreement between preview and PDF |
| Additional conversions using accepted rules | Batch conversion agent + separate evidence reviewer | New feature family, semantic difference, unsupported command |
| Final integration | One coordinator + fresh whole-change reviewer | Any unresolved release gate |

These are roles, not claims about a model's price or ability. Start with the user's chosen economical models. Escalate a **specific failing task and evidence**, rather than rerunning the whole project on a more expensive model.

Do not parallelize agents that own the same files. A coordinator owns `pipeline/cli.py`, `ExportBar.astro`, dependency lockfiles, manifest integration, and workflow integration. Other agents propose changes to these in their handoff or wait for explicit ownership. Each future implementation agent uses an isolated worktree; commits are integrated serially after review. Conversion batch agents write separate score-digest directories and decision files.

### Implementation prompt template

> Implement task **[ID]** from **[plan path]** against **[base commit]**. Read the linked spec, coordination contracts, repository instructions, and this task. Own only **[file list]**. Previous accepted dependencies are **[commit IDs]**. Follow its failing-test/implementation/verification steps. Preserve the global constraints. Do not publish, approve conversions, broaden supported notation, or modify unrelated exports. If the contract cannot be met, report a localized blocker with a minimal fixture; do not weaken a check. Return the commit, changed files, exact commands/results, artifact paths, and remaining risks. Stop after this task for independent review.

### Review prompt template

> Independently review task **[ID]**, spec requirements **[sections]**, and diff **[base..head]**. Verify its interface and acceptance tests; run the targeted checks. Look especially at **[task review focus]**. For conversion/rendering tasks inspect the evidence, not merely passing counters. Report actionable findings with file/line and reproduction. Separate blockers from accepted documented engraving differences. Return `accept`, `changes required`, or `blocked`, with commands/results. Do not grant public conversion approval or fix implementation in the same review.

### Conversion-batch prompt template

> Convert only score IDs **[explicit list]** using converter/profile **[versions]** and accepted feature inventory **[path]**. Run extraction, encoding, schema/semantic checks, and evidence generation. Do not edit generated MEI. Write one result/diagnostic packet per score. Existing accepted rules may be applied automatically; new musical constructs remain unsupported until separately implemented and reviewed. Return counts by state and all blockers. No catalogue manifest changes or public uploads.

## 3. Shared contracts—freeze before downstream work

Contract changes require a coordinator review and rerunning every consumer's tests. Version fields are explicit; JSON uses stable sorted serialization. Hashes are SHA-256 of bytes or documented canonical JSON, never Git HEAD alone.

### Conversion contract

`ScoreIR` and its JSON schema live in `pipeline/typeset/mei/model.py` and `data/typeset/mei/schemas/score-ir-v1.json`. All rationals serialize as reduced strings (`"7/8"`, `"0/1"`), never floats. Include:

- `schemaVersion`, score/source identity, dependency digest, extractor/profile versions;
- staff/layer identities, score definitions, musical events and source locations;
- each event's stable revision-local ID, onset, duration, notated duration/scaling, kind, resolved pitch, printed accidental/notehead/stem, lyric anchors, and span references;
- ties/slurs, clef/key changes, entry markers, divisions, supported cross-staff relationships;
- boundary IDs with onset, source-break classification, safe/unsafe status and reason;
- feature inventory and diagnostic references.

IDs must survive a layout change for the same revision. They need not survive changed source; revision binding prevents unsafe reuse. Matching's existing `Events` projection is unchanged.

`ConversionRecord` has `state: unsupported | failed | needs-review | approved`, source/dependency digest, artifact hashes, all tool/schema/profile versions, diagnostic codes, evidence matrix, and reviewer/decision metadata. `ConversionManifest` maps existing catalogue targets plus their original render hashes to approved digests and capability flags. Match validity remains controlled by existing `typeset.ts` rules.

### Browser contract

Define these exported types in `web/src/lib/export-layout/types.ts`:

```ts
type PartKind = 'mei' | 'scan' | 'fixed';
type BreakOverride = { boundaryId: string; sourceRevision: string; kind: 'system' | 'page' };
type LayoutSettings = {
  version: 1; paper: 'letter' | 'a4' | 'a5'; orientation: 'portrait' | 'landscape';
  marginMm: number; staff: 'small' | 'medium' | 'large';
  musicFont: 'leipzig' | 'bravura'; textFont: 'serif' | 'sans';
  lyrics: 'small' | 'medium' | 'large'; spacing: 'compact' | 'normal' | 'spacious';
  maxSystems: null | number; linePolicy: 'original' | 'automatic';
};
```

`ExportPart` is a discriminated union, sharing `id`, `label`, `sourceRevision`, headings/rubrics/credits, and **source** selection references. MEI parts carry approved artifact/capability/boundary metadata; scans carry ordered original PNG references; fixed parts carry original PDF references. Never use reflowed system counts as selection indices.

`LayoutRequest` contains revision token, ordered parts, settings, and overrides by part. `LayoutResult` contains that token, ordered part IDs, input/settings/font/renderer digests, effective anchors, diagnostics, and `CanonicalPage[]`. Each page specifies `widthMm`, `heightMm`, part identity, printable/content bounds, heading/footer geometry and:

- MEI: sanitized complete-page SVG plus actual system count and safe-boundary geometry;
- scan: original-image placements and complete-image system count;
- fixed: source PDF/page index and proportional placement transform; system count unavailable unless verified metadata exists.

Paper preview and PDF consume the **same page geometry**. Fixed preview uses a lazy PDF preview adapter; copying original PDF pages into export retains vectors. Scan/fixed composition never invokes a second pagination algorithm at export time. Fixed-layout parts cannot honor a reflow system cap; show that capability limitation rather than guessing counts.

Worker protocol: `{type:'layout', request:LayoutRequest}`, `{type:'cancel', token:number}`, responses `{type:'progress', token, ...}`, `{type:'result', token, result}`, `{type:'error', token, partId?, code, message}`. PDF requests carry an immutable current `LayoutResult`, not mutable settings. Cancellation is cooperative where possible; terminate/recreate a stuck worker and reject its token. Transfer PDF byte buffers.

## 4. Working and verification conventions

- Establish a clean execution worktree and inspect applicable `AGENTS.md` before implementation. Do not base new feature work on an unrelated in-progress branch without coordinator selection.
- Python setup: `uv sync --extra dev`; pinned LilyPond setup follows `docs/TYPESETTING.md`. Native compiler tests use the existing `lilypond` marker and explicitly report skipped tests.
- Web setup: `cd web` then `pnpm install --frozen-lockfile`. Change dependencies only in their owning task and regenerate `pnpm-lock.yaml` through pnpm.
- A focused failure is an expected assertion/import failure. Syntax errors, missing unrelated tools, or a skipped compiler test are not meaningful red/green evidence.
- Run targeted tests first. Integration gates run `uv run pytest -q -m "not slow"`, `uv run ruff check pipeline tools tests`, and web `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`. Source/slow suites run in the configured CI environment with their assets; do not claim coverage from missing source fixtures.
- Add meaningful mutation, timing, boundary, and PDF geometry tests. Do not manufacture large numbers of tests that merely repeat constants or implementation internals.
- Never commit temporary compiler environments, generated bulk render outputs, secrets, or absolute developer paths. Check in small reproducible fixtures with source attribution and fixture-generation instructions.

## 5. Gates, decision log, and completion record

| Gate | Required evidence | Decision owner |
| --- | --- | --- |
| G0 interface | B1 complete desktop/narrow mockups; controls and mixed sources | User |
| G1 musical fidelity | A1–A5 schema/semantic/mutation results and visual packet | Independent reviewer recommendation; designated maintainer approval |
| G2 rendering/PDF | B2/B10 font, vector, six paper/orientation and manual-break matrix | Independent rendering reviewer |
| G3 resources/security | C1/C2 isolated CI, bounded jobs, measured desktop/tablet limits | Coordinator/reviewer |
| G4 pilot enablement | Current approved provenance, all integration checks, rollback tested | Designated maintainer |

Keep decisions in `docs/superpowers/plans/export-layout-decisions.md` during execution: date, task, evidence, options, choice, compatibility impact, approver. Specifically record extractor strategy, MEI schema distribution/hash, renderer package/version, font assets/licenses, PDF adapter, safe-boundary normalization, and measured production limits. These proofs are implementation tasks; their outcomes are not assumed by this plan.

Every handoff records task/base/head, changed files, contracts consumed/produced, commands with exit status, fixtures/artifacts, review findings and resolution, and next unblocked task. A failed proof stops its dependents while independent work continues. Retaining current exports is the fallback if the fidelity gate cannot pass.

## 6. Scope-to-task coverage

| Spec section | Owning tasks |
| --- | --- |
| 1–3 outcome, current behavior, scope | A1/A6/B3/B9/C3 |
| 4 controls, availability, manual breaks | B1/B3/B4/B8 |
| 5 preview, workers, canonical pages, PDF | B2/B4–B7/B10 |
| 6 audit, extraction, encoding, validation, publication | A1–A6/C1/C4 |
| 7 bundling, sanitization, ceilings, recovery, preferences | B3/B5/B7/B9/C2 |
| 8 acceptance and measurements | A4/A5/B10/C2–C4 |
| 9 staged delivery and mockup approval | B1 and G0–G4 |

This packet is ready for design/plan review. It authorizes no catalogue migration, public publishing, or production coding by itself; execution begins with the user's selected agents after review.
