# Export Editor and Vector PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users customize approved music, scans, and fixed typeset pages and download a PDF that matches the paper preview.

**Architecture:** Snapshot existing export selection, render approved MEI in a lazy worker, and compose all part types into immutable canonical pages. Preview and PDF consume those same pages. New components/controllers sit beside existing quick export rather than replacing its worker or packing algorithm.

**Tech Stack:** Astro, TypeScript, pinned self-hosted Verovio WASM, Vitest/Playwright, pdf-lib, a vector SVG adapter selected in B2, and a lazy original-PDF preview adapter.

**Spec:** [Design](../specs/2026-10-06-export-layout-editor-design.md), §4–5/7–8. [Shared contracts](2026-10-06-export-layout-implementation-plan.md).

## Global Constraints

- Letter 215.9 × 279.4 mm; A4 210 × 297 mm; A5 148 × 210 mm. Portrait and Landscape for every size.
- One margin value, 8–25 mm; default 12 mm. Staff heights Small 5.6 mm, Medium 7.2 mm, Large 9.6 mm; Medium default.
- Leipzig default; Bravura only after verification. Bundled serif default and bundled sans alternative must share preview/PDF assets and metrics.
- `lyricSize` 3.5/4.5/5.5; `spacingSystem` 2/4/8; default Medium/Normal. Values are versioned and subject to pilot visual approval.
- Maximum systems Automatic or 1–8, never an exact target. Original line breaks default. Each part starts a new page.
- User page breaks → user system breaks → original/automatic policy → page packing under the cap.
- “One canonical layout result supplies both the paper preview and PDF.” No silent rasterization or fallback.
- Preserve deliberate scan selection, quick export, source-system ceiling 300, matching, attribution, and reader preferences.

## Review Focus

1. Selection includes only part of a typeset run or explicitly chooses scans: B3/B9 retain correct source order and representation.
2. Letter/Large/Automatic leaves blank paper before the final system: B4/B8 show actual page frames and continuous-view semantics.
3. Glyph IDs collide or malicious SVG reaches the DOM: B5 namespaces references and rejects active/external content.
4. Rapid settings, stale anchors, blocked storage, or failed workers: B7/B9 retain settings and block incorrect downloads.
5. Fonts, headings, fixed PDF pages, and scan packing diverge in export: B2/B6/B10 compare canonical geometry with actual PDF output.

---

## File ownership and dependencies

New pure modules live in `web/src/lib/export-layout/`, with colocated `.test.ts` files. Responsibilities:

| Modules | Responsibility |
| --- | --- |
| `types.ts`, `settings.ts`, `capabilities.ts`, `selection.ts` | Shared contracts, physical settings, supported controls, source snapshot |
| `fonts.ts`, `vectorPdf.ts` | Verified font assets/metrics and selected SVG-to-vector adapter |
| `mei.ts`, `breaks.ts`, `layout.ts` | Renderer adapter, effective anchors, canonical MEI layout |
| `svg.ts` | Dedicated Verovio sanitization, ID namespaces, bounds |
| `compose.ts`, `fixedPreview.ts`, `pdf.ts` | Scan/fixed/MEI pages, original-PDF preview, exact-page PDF assembly |
| `controller.ts`, `preferences.ts` | Revision state, worker lifecycle, versioned local settings |
| `web/src/workers/export-layout.worker.ts`, `export-layout-pdf.worker.ts` | Lazy rendering and download workers |
| `web/src/components/ExportLayoutEditor.astro`, `ExportPagePreview.astro` | Accessible editor and page frames |
| `web/src/scripts/exportLayout.ts` | DOM bindings and editor lifecycle |
| `web/src/lib/mei.ts` | Conversion manifest lookup separate from existing `typeset.ts` |
| `web/e2e/export-layout.e2e.ts` | Pilot and mixed-source browser acceptance |

Coordinator owns edits to `ExportBar.astro`, dependencies/lockfile, and site build asset integration. Leave existing `pdf.worker.ts` and `pdf.ts` quick-export behavior intact. Bundled renderer/font asset paths are finalized in B2/B4 and documented, with immutable versions and licenses.

## B1. Complete editor mockups for approval

**Dependencies:** Spec only; parallel with conversion. **Owner:** design/prototyping agent.

**Files:** Create `docs/superpowers/mockups/export-layout/editor.html`, `README.md`, and desktop/narrow preview images if helpful. Mockup assets must be self-contained and clearly labeled prototype; no production component changes.

**Interface:** A reviewable prototype that uses the settings/part names from the shared contract. Include desktop settings sidebar, narrow stacked layout, Paper/Music/Breaks groups, selection header, footer Download PDF/Reset layout, keyboard focus, and boundary menu.

- [ ] Before drawing, make a scenario checklist: approved Kyrie; mixed MEI/scan/fixed; two-page Letter/Large/Automatic; manual page break; impossible layout; updating preview; failed asset/recovery; continuous view. Each scenario must be reachable in the prototype.
- [ ] Verify the initial prototype lacks those scenarios, then implement them using actual pilot images where available. Simulated layouts/states must be marked as simulations; do not imply live engraving.
- [ ] Show all six paper/orientation choices, per-part capability labels, margin controls, music/text options, maximum-system copy, and page labels outside paper. Display fixed-layout restrictions and scan selection explicitly.
- [ ] Inspect at desktop and 390px width; check keyboard navigation, page aspect ratios, and readable controls. Record review screenshots and scenario results in `README.md`.
- [ ] Commit mockups with `docs: add export editor approval mockups`, present them to the user, and record approval/revisions in the decision log. **B8 cannot start until G0 is approved.**

## B2. Font metrics and vector-PDF fidelity proof

**Dependencies:** A3 pilot artifact. **Owner:** rendering implementer; independent reviewer.

**Files:** Create `fonts.ts`, `vectorPdf.ts`, corresponding tests, `web/scripts/verify-export-pdf.ts`, small licensed fixtures under `web/src/lib/export-layout/__fixtures__/`; coordinator updates `package.json`/lockfile. Write decision evidence under build outputs.

**Interfaces:** `loadFontProfile(id: FontProfileId) -> Promise<FontProfile>` identifies music/text font bytes, licenses, hashes, and metrics strategy. `svgToVectorPdf(svg: string, page: PhysicalPage, fonts: FontProfile) -> Promise<Uint8Array>`. The adapter creates a one-page vector PDF with exact millimetre-to-point conversion (`mm * 72 / 25.4`).

- [ ] Write failing tests named `exportsAccentsAndReferencedGlyphs`, `usesExactPageDimensions`, and `usesMetricsForChosenTextFont`. Fixture includes `<defs>/<use>`, Leipzig/Bravura symbols, ties/slurs/divisions, and accented Latin headings/lyrics. Assertions include page dimensions within 0.05 pt and no full-page music raster image.
- [ ] Run `cd web` then `pnpm exec vitest run src/lib/export-layout/vectorPdf.test.ts src/lib/export-layout/fonts.test.ts`; expect failures.
- [ ] Evaluate PDFKit/SVG-to-PDFKit in the browser worker, with explicit font mappings and supported SVG features. Establish how the renderer measures the chosen serif/sans text; applying CSS after engraving is insufficient. Pin compatible package/font versions and document licenses. If this adapter fails, evaluate one concrete vector alternative and record the decision before downstream PDF work. If font metrics cannot be made reliable, stop the font feature's dependents and report the failing fixture; do not quietly ship a decorative toggle.
- [ ] Run tests and `node scripts/verify-export-pdf.ts`, following the existing TypeScript script-runtime convention. Render exported pages to images in the QA harness, compare with canonical SVG at the same scale, and inspect all symbols/accents. Report font embedding/path evidence, reference resolution, geometry, and visual differences.
- [ ] Commit verified adapter/dependencies with `feat: prove font-correct vector PDF export`; record the selected adapter and any rejected approach in the decision log.

**Exit:** A tested browser-compatible vector adapter and both verified text/music choices. A spike report without a working adapter is a blocker, not B2 completion.

## B3. Settings, capability lookup, and source selection snapshot

**Dependencies:** A6 contracts; B2 font profile IDs. **Owner:** economical TypeScript implementer.

**Files:** Create `types.ts`, `settings.ts`, `capabilities.ts`, `selection.ts`, `web/src/lib/mei.ts`, colocated tests. Coordinator extracts existing selection data from `ExportBar.astro` into a shared pure helper only where necessary; test the original path unchanged.

**Interfaces:** `normalizeSettings(value: unknown) -> LayoutSettings`; `paperDimensions(settings: LayoutSettings) -> PhysicalPage`; `snapshotSelection(input: SelectionInput, findConversion: ConversionLookup) -> ExportPart[]`; `capabilitiesFor(part: ExportPart) -> PartCapabilities`; `approvedConversionFor(target: string, renderHash: string, manifest: ConversionManifest) -> ApprovedConversion | null`. Define `SelectionInput` from existing checked boxes/segment runs/source-choice data, not DOM queries in pure code.

- [ ] Write failing tests for all dimensions/orientations, defaults and invalid values, margin bounds, cap null/1–8, staff mapping, whole/partial run selection, intentional scans, stale conversion lookup, mixed ordering, and duplicate source references. Assert invalid user data produces safe defaults plus visible diagnostics where meaning changes.
- [ ] Include exact assertions:

```ts
expect(paperDimensions({...defaults, paper:'a5', orientation:'landscape'}))
  .toEqual({widthMm:210, heightMm:148});
expect(parts.map(p => p.kind)).toEqual(['mei', 'scan', 'fixed']);
expect(parts[1].sourceRefs).toEqual(selectedScanRefs);
```

- [ ] Run `pnpm exec vitest run src/lib/export-layout/settings.test.ts src/lib/export-layout/selection.test.ts src/lib/mei.test.ts`; expect failures.
- [ ] Implement physical settings and capability-aware conversion lookup. Staff height maps to renderer `unit` 7/9/12 for the pinned five-line staff geometry; assert physical geometry in B4. Partial typeset runs continue through existing scan semantics unless the conversion exposes a separately approved matching segment. Fixed parts support proportional paper fitting, not staff/font/reflow/cap controls.
- [ ] Run new tests and `pnpm exec vitest run src/lib/exportParts.test.ts src/lib/typeset.test.ts src/components/ExportBar.test.ts`. Expect PASS with existing quick selection unchanged.
- [ ] Commit with `feat: snapshot export sources and version layout settings`.

## B4. MEI rendering and effective-break constraint solver

**Dependencies:** A3 boundary/profile contract, B2 fonts, B3 settings. **Owner:** rendering implementer.

**Files:** Create `mei.ts`, `breaks.ts`, `layout.ts`, tests and measured fixture layouts; bundle versioned renderer/WASM through the approved build path.

**Interfaces:** `resolveBreaks(part: MeiPart, settings: LayoutSettings, overrides: BreakOverride[]) -> EffectiveBreaks`; `renderMei(part: MeiPart, settings: LayoutSettings, breaks: EffectiveBreaks, context: RenderContext) -> Promise<MeiLayout>`; `validateLayout(layout: MeiLayout, constraints: LayoutConstraints) -> LayoutDiagnostic[]`. `RenderContext` supplies fonts, token, cancellation check, and configured resource limits.

- [ ] Write failing tests for Original and Automatic policies, manual page/system priority, stale/unsafe anchors, cap two, page-break-implies-system-break, exact staff height, and unsatisfiable usable rectangle. Assert anchors survive orientation/staff changes and no cap violation is labeled successful.

```ts
expect(layout.pages.every(p => p.systemCount <= 2)).toBe(true);
expect(layout.effectiveBreaks).toContainEqual(manualPageBreak);
expect(impossible.diagnostics.map(d => d.code)).toContain('UNSATISFIABLE_LAYOUT');
```
- [ ] Test a sustained cross-boundary fixture from A3 and compare normalized events before/after layout changes. Add renderer-backed regression for the retained experiment profile showing Letter/Large/Automatic 4+1 systems on two visibly separate pages; production-profile tests may use changed counts after explicitly reviewed engraving changes.
- [ ] Run `pnpm exec vitest run src/lib/export-layout/breaks.test.ts src/lib/export-layout/layout.test.ts`; expect failures.
- [ ] Implement a pinned adapter: reserve measured heading/footer space, convert physical usable dimensions into renderer units, materialize safe manual/source breaks into a copy of approved MEI, and verify resulting anchors/system counts/bounds. Automatic mode excludes source-only line breaks; Original preserves them while paginating. If renderer options alone cannot enforce the cap, inspect rendered system starts, add safe effective page breaks, rerender, and verify convergence. Bound iterations by candidate boundary count/resource limits; fail with a localized constraint diagnostic on nonconvergence. Never remove user anchors, shrink staff silently, or blindly rely on `breaks="encoded"`.
- [ ] Run tests and the representative six-dimension/policy fixture matrix; expect no lost musical events, clipping, or cap violation. Verify measured staff height within 0.1 mm. Record renderer build/hash and option translation.
- [ ] Commit with `feat: render MEI with verified physical layout and break constraints`.

## B5. Dedicated SVG sanitization and page namespaces

**Dependencies:** B4 representative SVGs. **Owner:** bounded security/rendering implementer.

**Files:** Create `svg.ts`, `svg.test.ts`; add corresponding server artifact checks in `pipeline/typeset/mei/svgcheck.py` and `tests/test_mei_svgcheck.py` if stored preview assets are published. Do not loosen `pipeline/typeset/svgcheck.py`.

**Interfaces:** `sanitizePageSvg(svg: string, namespace: string) -> SanitizedSvg`; `measureSvgBounds(svg: SanitizedSvg) -> SvgBounds`. Policy permits required Verovio text/glyph/geometry elements and a narrowly enumerated style set; font references must resolve to the approved profile.

- [ ] Write failing tests for duplicate IDs across pages; rewrite internal href/url/clip references; reject scripts, event handlers, foreignObject, DOCTYPE/entities, external/network references and unsafe style URLs; preserve accented text and legitimate glyph `<use>` references. Assert sanitization does not alter musical content geometry.

```ts
expect(page1.ids.some(id => page2.ids.includes(id))).toBe(false);
expect(() => sanitizePageSvg(scriptSvg, 'p1')).toThrow(/UNSAFE_SVG/);
expect(allReferencesResolve(safe.svg)).toBe(true);
```

The sanitizer result is `{svg: string, ids: string[], namespace: string}`; the reference checker is a test helper that parses output independently.
- [ ] Run `pnpm exec vitest run src/lib/export-layout/svg.test.ts` and, if server checks were added, `uv run pytest -q tests/test_mei_svgcheck.py`; expect failures.
- [ ] Implement separate explicit allowlists; parse XML, namespace every ID/reference with score/page/token identity, and reject unsupported constructs with diagnostic rather than strip meaningful music silently. Scan PNGs use the separate trusted composition path, not permission for arbitrary SVG images.
- [ ] Run tests plus existing `tests/test_typeset_render.py`/SVG policy tests; expect no change in existing source SVG validation. Insert multiple pages in a browser fixture and verify referenced glyphs remain present.
- [ ] Commit with `feat: sanitize and namespace rendered export SVG pages`.

## B6. Canonical mixed pages and PDF composition

**Dependencies:** B2, B4, B5. **Owner:** PDF implementer.

**Files:** Create `compose.ts`, `fixedPreview.ts`, `pdf.ts`, tests and licensed PDF/PNG fixtures. Coordinator pins a lazy original-PDF preview dependency if needed.

**Interfaces:** `composeExport(parts: ExportPart[], meiLayouts: Map<string, MeiLayout>, settings: LayoutSettings, assets: AssetLoader) -> Promise<LayoutResult>`; `previewFixedPage(page: FixedCanonicalPage, assets: AssetLoader) -> Promise<PreviewBitmap>`; `exportCanonicalPdf(result: LayoutResult, assets: AssetLoader) -> Promise<PdfResult>`. `PdfResult` includes bytes, page count, and byte size. `AssetLoader` verifies immutable paths/hashes and retains original image/PDF bytes.

- [ ] Write failing tests for mixed ordered MEI/scan/fixed parts, each starting on a new page; heading/rubric/credit reservation; max two complete scan images; original-resolution PNG embedding; exact page dimensions; fixed-page proportional fitting without clipping; and canonical page order preserved in PDF. Assert fixed source dimensions produce one uniform scale, not independent x/y stretching.
- [ ] Add failure tests: asset missing/corrupt, overlarge scan not fitting, unexpected fixed PDF page count, invalid canonical SVG. No fallback to another representation occurs inside custom export.

```ts
expect(pdf.pageCount).toBe(result.pages.length);
expect(fixed.transform.scaleX).toBe(fixed.transform.scaleY);
await expect(exportCanonicalPdf(result, missingAssetLoader)).rejects.toThrow(/ASSET_MISSING/);
```
- [ ] Run `pnpm exec vitest run src/lib/export-layout/compose.test.ts src/lib/export-layout/pdf.test.ts`; expect failures.
- [ ] Implement scan placements once during composition and copy original fixed PDF pages with recorded transforms. Preview uses those exact placements and a PDF preview adapter loaded only for fixed parts; rasterizing a fixed-page screen preview must not rasterize the export. Use B2's vector adapter for MEI. Measure headings with the same font profile and preserve existing credits, translations, rubrics, accents, and selected headings. Do not reuse quick export's lossy WinAnsi text sanitizer for custom Unicode headings.
- [ ] Run tests and render the mixed fixture PDF for comparison. Assert no typeset raster replacement, no cropped page, and no empty accidental trailing page. Existing `pnpm exec vitest run src/lib/pdf.test.ts` must pass unchanged.
- [ ] Commit with `feat: compose matching preview and PDF pages for mixed exports`.

## B7. Worker jobs, cancellation, preferences, and controller

**Dependencies:** B6. **Owner:** economical TypeScript implementer.

**Files:** Create `controller.ts`, `preferences.ts`, tests, both new workers. Preserve existing quick-export worker.

**Interfaces:** `createExportController(deps: ControllerDependencies) -> ExportController`; controller has `open(parts)`, `updateSettings(settings)`, `setBreak(partId, override)`, `resetLayout()`, `download()`, `close()`, `subscribe(listener)`. State is `idle | loading | rendering | ready | exporting | error`, with current request token, previous preview, current result, settings, and part-specific diagnostics. `readPreferences(storage: StorageLike | null) -> PreferenceReadResult`; `writePreferences(storage, prefs) -> void` handles denial without throwing.

- [ ] Write failing tests where token 2 completes before token 1, export begins during rendering, worker fails/timeouts, editor closes during download, and settings change while PDF generation is running. Assert only the current complete result enables download; an obsolete PDF is discarded rather than downloaded with the current settings label.
- [ ] Test blocked storage, corrupt/unknown preference versions, migration of `export-paper`, source-revision changes clearing manual anchors with a visible notice, and reset removing overrides while retaining source breaks. Preferences never update catalogue data.

```ts
expect(state.result?.token).toBe(2); // complete token 2, then deliver obsolete token 1
expect(state.canDownload).toBe(false); // while any new layout is incomplete
expect(readPreferences(throwingStorage).preferences.settings.paper).toBe('letter');
```

Expose `canDownload` in controller state and `{preferences, notices}` in `PreferenceReadResult`; use fixture-driven messages rather than exceptions for storage denial.
- [ ] Run `pnpm exec vitest run src/lib/export-layout/controller.test.ts src/lib/export-layout/preferences.test.ts`; expect failures.
- [ ] Implement latest-request coalescing and token checks at every response/download boundary; retain previous preview during updates. One render worker loads WASM lazily; a separate PDF worker loads heavy adapter dependencies on download. Terminate/recreate a timed-out worker; revoke temporary URLs and clean subscriptions on close. Use configurable byte/event/page/time limits from C2, with conservative provisional limits for development and no public enablement before measurements.
- [ ] Run tests with deterministic fake workers/timers, then a real worker smoke test. Expected: no stale replacement, no download during incomplete/error state, recoverable settings, and bounded cleanup.
- [ ] Commit with `feat: coordinate current export jobs and durable local preferences`.

## B8. Approved accessible editor and page preview

**Dependencies:** G0/B1 approval and B7. **Owner:** economical UI implementer.

**Files:** Create `ExportLayoutEditor.astro`, `ExportPagePreview.astro`, `web/src/scripts/exportLayout.ts`, component tests, and focused browser scenarios in `web/e2e/export-layout.e2e.ts`.

**Interfaces:** Editor accepts a selection snapshot and controller; its DOM bindings render state, dispatch settings/anchor actions, and perform the final download only for a current result. Page component displays canonical dimensions, printable margin indication, actual page/system counts, outside-paper labels, boundary overlays, and zoom.

- [ ] Write failing component/browser tests for keyboard opening/closing and focus return, narrow viewport controls, capability labels, disabled unavailable controls, updating/error states, break menu operation, Reset layout, and Download PDF enabled only in ready state.
- [ ] Test paper versus continuous view: paper retains blank bottom and correct ratio; continuous crops blank display space consistently without changing `LayoutResult`/PDF digest. Boundary overlays and Page N of M labels must be outside printable output.
- [ ] Run `pnpm exec vitest run src/components/ExportLayoutEditor.test.ts` and the focused Playwright scenarios after a build; expect failures before implementation.
- [ ] Implement approved mockups using controller state. Offer “Start new system here,” “Start new page here,” and “Remove my break”; never expose invented measure numbers. Keep paper view primary; zoom affects display only. Label unavailable fixed typography, maximum-system behavior, and per-part mixed capability in plain language.
- [ ] Run component and focused browser tests at desktop and 390px width; manually inspect touch hit targets, focus, page boundaries and final-system visibility. Expected: all approved scenarios operate with real canonical pages.
- [ ] Commit with `feat: add accessible export layout editor and paginated preview`.

## B9. Existing export integration and explicit recovery

**Dependencies:** B8, A6 manifest lookup. **Owner:** coordinator.

**Files:** Modify `ExportBar.astro`/test; integrate selection helper and approved asset loader; expand `export-layout.e2e.ts`. Avoid unrelated reader/admin/correction changes.

**Interfaces:** Existing quick selection feeds `snapshotSelection`; Customize export lazy-opens the editor. “Use original layout” closes customization and returns to existing quick-export controls, preserving selected parts and explaining custom music settings no longer apply.

- [ ] Write failing integration tests for intentional scans despite available MEI; partial run; mixed segments; changed/absent manifest; source ceiling >300 rejected before fetching; failed approved asset; renderer failure; original recovery; and unchanged quick-export behavior.
- [ ] Assert opening/closing customization does not change reader scan/typeset preference. Loading ordinary pages and clicking quick export must not request renderer/WASM/font/PDF-adapter chunks.
- [ ] Run ExportBar tests and focused Playwright scenarios; expect failures.
- [ ] Add Customize export beside quick Export PDF. Validate source selection first; load only immutable approved assets verified against current target/render hash. Runtime custom failure blocks download and offers explicit recovery; never silently route to scans/fixed PDF. No required upload/account/network compiler.
- [ ] Run existing selection/typeset/pdf/component tests and browser source-switch tests, then `pnpm typecheck` and `pnpm build`. Expected: old routes and quick export continue unchanged; customized downloads match the current preview.
- [ ] Commit with `feat: integrate custom export without changing quick export semantics`.

## B10. Browser and PDF acceptance matrix

**Dependencies:** B9 plus current A5 evidence. **Owner:** independent QA/rendering reviewer; fixes return to owning task.

**Files:** Complete `web/e2e/export-layout.e2e.ts`, `web/scripts/verify-export-pdf.ts`, deterministic approved test assets, and `docs/superpowers/plans/export-layout-decisions.md`. Fixture activation is test-only and cannot cause the production manifest to approve a score.

**Interface:** A reproducible report linking input/conversion/font/renderer hashes, settings, canonical result digest, exported PDF digest, and each case's result.

- [ ] Add failing acceptance assertions for actual downloaded PDF dimensions/count, manual anchors, maximum system cap, typography, mixed part order, Unicode headings, no editor overlays, and all voices/final systems. Include a PDF mutation with altered page geometry to prove the comparison detects it.
- [ ] Run the new targeted harness and prove the altered PDF fails. Use render-to-image comparison as an aid, with independently chosen geometric/text/glyph assertions; do not call identical generator output a fidelity oracle.
- [ ] Complete the representative matrix: all six paper/orientation choices at medium staff under Original and Automatic; Letter/large; both music/text fonts; cap two; manual system/page breaks; mixed sources. Include cold load, blocked storage, slow/interrupted worker, asset error, desktop/narrow screen and tablet browser behavior. If mobile/tablet execution is unavailable, record the gate as pending rather than substituting desktop viewport emulation for the device measurement.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`; verify no live CDN requests and ordinary-page asset budget unchanged. Inspect vector PDF at high zoom and compare rendered pages to canonical previews. Expected: all cases pass without unexplained musical or layout differences.
- [ ] Commit acceptance harness with `test: verify custom export preview and vector PDF fidelity`; deliver findings, screenshots, PDF samples, unresolved risks, and G2 recommendation to the coordinator.

## Completion packet

Return approved mockups, font/adapter decision, immutable renderer/font versions, canonical-page contract, focused and integration test results, representative PDF/preview matrix, error/recovery evidence, and memory/latency instrumentation for C2. Do not enable the public pilot until Plan C's limits/provenance/security gates are complete.
