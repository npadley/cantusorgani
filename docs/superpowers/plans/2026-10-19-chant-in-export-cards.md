# Chant in the PDF export — Execution Cards

Date: 2026-10-19. Status: **ready once the user decides P1–P5** (spec §0). Protocol, standard commands, prompt templates and review are those of the [export execution packet §0](2026-10-08-export-execution-packet.md#0-read-this-first). Where a card and the spec disagree, **the card wins**.

| Short name | Document |
|---|---|
| **CS** | [specs/2026-10-19-chant-in-export-design.md](../specs/2026-10-19-chant-in-export-design.md) |
| **UI** | [specs/2026-10-08-export-editor-ui-spec.md](../specs/2026-10-08-export-editor-ui-spec.md) |
| **DL** | [plans/export-layout-decisions.md](export-layout-decisions.md) (D1–D24; D25–D28 added when the user decides) |
| **Spike** | [experiments/chant-export/](../experiments/chant-export/) |

**Model routing.** Every card is [S] (Sonnet) or [H] (Haiku); only K9 is [U] and only the coordinator step is [O]. Haiku never edits `svg.ts`, `vectorPdf.ts` or the normalizer (K1); K1 is upstream of the sanitizer, not a change to it, and `svg.ts` **does not change** in this feature. A card that hits **Escalate if** stops and reports with evidence.

**Settled; do not reopen:** CS §2 (Customize export first), §4.1 (Exsurge on the main thread, Canvas measurer), §4.2 (chant staff space = accompaniment staff space), §5 (normalizer before an unchanged sanitizer), plus DL D1–D24.

## Dependency graph

```
K0 ─┬─ K1 ──────────┐
    ├─ K2 ── K3 ────┤
    └─ K4a ── K4b ──┼─ K5 ── K6 ── K7 ── K8 ── K9[U]
                    │                      └── K10 (only if P3 = ship)
```

Parallel after K0: **K1, K2, K4a** (no shared files). Cap at 3 parallel agents.

---

### K0 [H] Fixtures and the fixture generator — depends: user decisions recorded in DL
**Read:** CS §4.3, §5; Spike `render-exsurge.mjs`.

**Files:**
- `web/scripts/render-chant-fixtures.ts`: the spike's `render-exsurge.mjs` turned into a dev script (Playwright Chromium, the vendored `exsurge.min.js`, `cleanGabc`, `setRubricColor('#000')`, `setFont("'Liberation Serif'", …)` with the face loaded via `@font-face` from `public/fonts/export/`). It writes, per chant id and width, `{svg, lines:[{y,height}]}` JSON.
- `web/src/lib/export-layout/__fixtures__/chant/`: `al-1-749.json` (Alleluia *Laudem Domini*, iPad-mini width), `gr-277-1333.json` (Gradual *Exaltabo te*, Letter Medium), `tr-889-749.json` (Tract *Qui habitat*), each with `SOURCE.md` (Exsurge commit `16c626f`, chant ids, command).
- `__fixtures__/chant/pages.json`: two page paths found by a query over the built catalogue: one Kyriale page whose part links a chant (expected: Kyrie IX → #2976), and the page whose linked chant has the most GABC characters. Record the query in `SOURCE.md`.

**Done when:** the script regenerates byte-identical fixtures on a second run; the three JSON files exist; `pages.json` has two paths that exist in `dist/`.

**Escalate if:** Kyrie IX's page links no chant (pick another approved MEI page with a chant and say so).

### K1 [S] Exsurge SVG normalizer and line splitter — depends: K0
**Read:** CS §5 (all), §4.3; `web/src/lib/export-layout/svg.ts` (read only, do not edit); Spike `normalize-to-pdf.ts` (the regex prototype; do **not** copy its regexes, use xmldom).

**Files:** `web/src/lib/export-layout/chantSvg.ts` + `chantSvg.test.ts`.
- `normalizeExsurgeSvg(svg: string): string`: the six rules of CS §5, DOM-based (`@xmldom/xmldom`), rejecting anything not listed with `UNSAFE_SVG: exsurge <what>`.
- `splitChantLines(normalized: string): readonly { svg: string; heightUnits: number; widthUnits: number }[]`: one standalone SVG per `g.chantLine` with the shared `<defs>`, re-based to y = 0, viewBox from measured bounds (first line includes drop cap and annotation overhang).

**Done when** these tests pass on all three K0 fixtures:
- `rawFailsSanitizer`: `sanitizePageSvg(raw)` throws (documents why K1 exists).
- `normalizedPassesSanitizer`: every split line passes `sanitizePageSvg(line, 'c<id>l<n>')`.
- `rejectsUnknowns`: an injected `onclick`, `<foreignObject>`, `style="filter:…"`, `<image>`, unknown attribute → throws, never strips.
- `lineCount`: lines equal the fixture's `lines.length`; heights within 0.5 unit of bounds.
- `noStyleLeft`: no `style` attribute or element in the output; every `<text>` has `font-size` and `font-family="Liberation Serif"`.
- `rubrics`: `V..` becomes `V.`; small caps become upper case at 0.8 × size.
- WEB passes.

**Escalate if:** a fixture needs a sanitizer change to pass.

### K2 [H] Chant scale — depends: K0
**Read:** CS §4.2; `types.ts` (`LYRIC_SIZE`, staff units), `settings.ts::paperDimensions`.

**Files:** `web/src/lib/export-layout/chantScale.ts::chantScale(settings, printableWidthMm, partKind): { mmPerUnit; widthUnits; setFontSize }` + test.

**Done when:** Medium staff gives `mmPerUnit` 0.144 (Small 0.112, Large 0.192); Letter printable 191.9 mm at Medium gives `widthUnits` 1333 (±1); Medium/Medium `setFontSize` = 4.05 / 0.144 / 0.9 (±0.01); scan and fixed parts use Medium staff regardless of setting; WEB passes.

### K3 [S] Exsurge loader and main-thread chant renderer — depends: K2
**Read:** CS §4.1, §4.2, §5 "Font consistency", §6; `web/src/scripts/chantNotation.ts`; `web/src/lib/exsurge.d.ts`.

**Files:**
- `web/src/lib/exsurgeLoader.ts`: `loadExsurge()` moved out of `chantNotation.ts` (which now imports it; behaviour unchanged).
- `web/src/lib/export-layout/chantRender.ts::renderChantSvg(lib, chant: {gabc, annotation, mode}, scale): Promise<string>` using `createSvg` (string) or `createSvgNode().outerHTML`, `setRubricColor('#000')`, and `ensureExportFace(): Promise<boolean>` (awaits `document.fonts.load` for the regular and italic Liberation Serif; false on failure).
- A memo cache keyed by `(chantId, widthUnits, setFontSize)`.
- Extend `exsurge.d.ts` with the members used (`setRubricColor`, `createSvg`, `lines`).

**Done when:**
- `exsurgeLoader.test.ts`: one script tag however many callers; reuses `window.exsurge`.
- `chantRender.test.ts` (Vitest with a stub `lib`): rubric colour set, font family `'Liberation Serif'`, cache hit on the same key, no render when `ensureExportFace` is false.
- Existing `MovementNav.test.ts` and site e2e chant toggle still pass.

**Escalate if:** `createSvg` output differs structurally from `createSvgNode` (then use `outerHTML` and note it).

### K4a [S] Contracts, settings and preferences — depends: K0 (coordinator merges `types.ts`)
**Read:** CS §9; `types.ts`, `settings.ts`, `preferences.ts` and their tests.

**Files:** `types.ts` (paste CS §9 verbatim), `settings.ts` (`normalizeSettings` accepts `chant`; junk → default), `preferences.ts` (persist `chant`; first-run default per DL P2 decision, reading `chant-display` through `readChantDisplay`), tests.

**Done when:** settings tests cover `off`/`before`/junk; preferences tests cover P2 default with `chant-display` = `show`, `link`, missing and a throwing store; existing settings and preferences tests pass unchanged except new-field expectations; WEB passes.

### K4b [S] Chant ids into the selection — depends: K4a
**Read:** CS §3.1, §9; `ExportBar.astro`, `lib/exportSelection.ts::readSelectionInput`, `capabilities.ts`/snapshot code, `SystemStack.astro` (how starts carry `chantId`, `annotationFor`).

**Files:** `ExportBar.astro` (a `data-chants` JSON attribute per segment input: `[{id, incipit, annotation, mode}]`, from the segment's starts), `exportSelection.ts`, the snapshot that builds `ExportPart`s (chants on the segment's first run only), tests.

**Done when:** `ExportBar.test.ts` renders `data-chants` for a page with a chant and `[]` for one without; the snapshot test puts chants on run 0 only; quick export unchanged (`site.e2e.ts` export scenarios pass).

### K5 [S] Compose: placing chant lines — depends: K1, K4a
**Read:** CS §3, §4.3, §9; `compose.ts`, `compose.test.ts`, `paginate.ts`, `limits.ts`.

**Files:** `compose.ts` (chant lines after the heading; `reservationFor` returns `chantTailMm`/`chantPages`; fixed parts get chant-only pages; scan parts reserve; credit line text; digests include chant SVG hashes; `CHANT_UNAVAILABLE` info diagnostic), `limits.ts` (120-line chant cap), tests.

**Done when** `compose.test.ts` gains and passes:
- `chantSharesPageWithMei` (short chant, accompaniment starts on page 1);
- `chantPushesMeiWhenNoRoom` (remaining < `minAccompanimentMm`);
- `longChantSplitsBetweenLines` (`tr-889-749` fixture across ≥ 2 pages, no line split, order kept);
- `fixedPartGetsChantPages`; `scanPartReservesChant`;
- `offIsUnchanged`: with `chant: 'off'`, every digest equals the pre-change value for the existing fixtures;
- `missingChantIsInfo`: a null SVG gives `CHANT_UNAVAILABLE` and the part composes without chant.

**Escalate if:** MEI pagination needs anything beyond the larger first-page reservation.

### K6 [S] Worker job, PDF and preview drawing — depends: K3, K5
**Read:** CS §4.1, §9, §10 (`exportPdf.test.ts` list); `controller.ts`, `workerCore.ts`, `exportPdf.ts`, `fixedPreview.ts`, `ExportPagePreview.astro`.

**Files:**
- `controller.ts`: when `chant !== 'off'` and parts have chants, `ensureExportFace` → `loadExsurge` → fetch `/chant/<id>.json` → `renderChantSvg` per chant, then post `chantSvgs` with the job; failures become null entries.
- `workerCore.ts`: normalize + split + sanitize (`sanitizePageSvg(line, 'c<id>l<n>')`) before compose.
- `exportPdf.ts` and the preview: draw `page.chant` placements with `drawSvgOnPage(..., placement)`.
- Tests.

**Done when:**
- `exportPdf.test.ts`: a chant page embeds only Liberation subsets, 0 image XObjects, pdf.js text contains `tá-` and `Dó-`, identical input gives identical bytes, and syllable x positions match the SVG within 0.3 mm.
- `workerCore.test.ts`: a malicious chant string is rejected (diagnostic, part prints without chant), never drawn.
- `controller.test.ts`: chant Off performs no `/chant/` fetch and no `loadExsurge`.

**Escalate if:** any chant glyph would be rasterised, or the walker needs a change.

### K7 [S] Editor control, notes and analytics — depends: K4a, K6
**Read:** CS §2, §7, §8; UI §1.3, §1.4, §5; `ExportLayoutEditor.astro` + test; `lib/exportAnalytics.ts` + test.

**Files:** `ExportLayoutEditor.astro` (fieldset "Chant", segmented Off / Before each part, after Breaks, before More options; in the Settings panel below 62rem; "In this PDF" lines; `#cx-status` announcement; page label "with chant"), `exportAnalytics.ts` (`chant`, `chantParts`), tests.

**Done when:**
- `ExportLayoutEditor.test.ts`: the fieldset, legend, two radios and helper copy exactly as CS §2; keyboard order per UI §5; every target ≥ 44 px.
- The announcement text for 3 with / 1 without matches CS §7.
- `exportAnalytics.test.ts`: `chant` and `chantParts` pass the filter; no chant ids are sent.
- No box-shadow, gradient or radius > 2 px is added (grep).

### K8 [S] E2E and PDF verifier — depends: K7
**Read:** CS §6, §10; `web/scripts/verify-export-pdf.ts`; `e2e/export-layout.e2e.ts`, `e2e/export-customize-lazy.e2e.ts`; K0 `pages.json`.

**Files:**
- `verify-export-pdf.ts`: `CanonicalExpectation` gains `chantStaffSpaceMm` and per-page `chantLines`; 4-line stroke groups at that spacing are counted as chant staves, separately from 5-line staves.
- `e2e/export-chant.e2e.ts`: Kyrie page, chant On, Letter and iPad mini, download and verify; longest-chant page, verify the split and that the page count matches `#cx-fit`.
- `e2e/export-customize-lazy.e2e.ts`: the three lazy assertions of CS §6.

**Done when:**
- The new e2e passes on the fixture build (packet §0.2 WEB-BUILD).
- The existing export e2e specs still pass, verifier included: with chant Off the verifier's output is unchanged.
- One timing line per chant render on the device-test build is recorded in the handoff (desktop; the user may add an iPad run in K9).

**Escalate if:** the verifier cannot tell chant staves from accompaniment staves at some music size.

### K9 [U] Visual review and release — depends: K8
The coordinator builds the device-test build and gives the user the Letter PDF and the 11-inch iPad PDF for the K0 Kyrie page and the longest-chant page. The user checks:
- lyric size against the accompaniment (CS §4.2 fallback if it is too big);
- the shared page;
- `V.`/`R.` and `*`;
- the "Dómine" spacing seen in the spike;
- forScore Best Fit.

The coordinator records the approval in DL (as for G2) and merges.

### K10 [S] Chant-only export — depends: K9, and only if the user decides P3 = ship
**Read:** CS §0 P3, §3; K5, K7 diffs.

**Files:** `types.ts` (`ChantMode` adds `'only'`, coordinator merges), `compose.ts` (`only`: skip accompaniment; parts with no chant are omitted, and the result line says how many), `ExportLayoutEditor.astro` (third radio "Chant only"; Music size and Systems per page show "Not used for chant only" helper), analytics value `only`, filename suffix " (chant)", tests.

**Done when:** a compose test exports chant only for a three-part selection with one chantless part; an e2e downloads it and the verifier finds 0 five-line staves; the editor test covers the third radio and the disabled-FIT helper copy.

---

## Status

| Card | Model | Status |
|---|---|---|
| K0 | H | waiting for P1–P5 |
| K1 | S | — |
| K2 | H | — |
| K3 | S | — |
| K4a | S | — |
| K4b | S | — |
| K5 | S | — |
| K6 | S | — |
| K7 | S | — |
| K8 | S | — |
| K9 | U | — |
| K10 | S | only if P3 = ship |
