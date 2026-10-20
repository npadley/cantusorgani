# Chant in the PDF export — design

Date: 2026-10-19. Status: **decided** (§0, user, 2026-10-19; recorded as DL D25–D29). Feature request: a reader who ticks "Show the chant with each part" on the site wants that chant in the PDF too.

Read with: [export editor UI spec](2026-10-08-export-editor-ui-spec.md) (**UI**), [decision log](../plans/export-layout-decisions.md) (**DL**, D1–D24), [execution packet](../plans/2026-10-08-export-execution-packet.md) (house protocol). Cards: [plans/2026-10-19-chant-in-export-cards.md](../plans/2026-10-19-chant-in-export-cards.md). Spike evidence: [experiments/chant-export/](../experiments/chant-export/).

## 0. Product decisions (decided 2026-10-19)

| # | Question | Options | Decision |
|---|---|---|---|
| **P1** | Where the chant goes | (a) **Chant block before each part, accompaniment continues below it on the same page** (the site's order: chant above the part). (b) Chant on its own page(s) before each part; accompaniment always starts a new page. (c) Chant-only PDF (cantor's copy). (d) Chant aligned system-by-system above the accompaniment — rejected: Exsurge and Verovio space the same syllables differently, so they cannot line up. | **(a)**. It matches the site and wastes no paper. (b) is the same code with one flag (`newPageAfterChant`), so it can be added later if organists want page turns to stay clean. |
| **P2** | Default | Off / On / **Follow the site's "Show the chant" preference** (`localStorage["chant-display"]`) | **Follow the site preference**, falling back to Off. The reader who ticked the box on the page is the reader who asked for this; everyone else gets today's PDF unchanged. |
| **P3** | Chant-only export for cantors | Ship in v1 as a third choice / later / never | **Ship in v1** (user; the recommendation was later). It is the third choice in the same control, card K10, and reuses everything else in v1. |
| **P4** | Which export first | Customize export / Quick export / both | **Customize export only** (§2). |
| P5 (minor) | Rubric colour of ℣, ℟, * | Red (`#d00`, Exsurge's default, as on screen) / black | **Red `#d00`, as on screen** (user; the recommendation was black, because red prints pale grey on monochrome printers). |

P1–P5 are recorded in DL as D25–D29. Agents must not reopen them.

## 1. How chant is shown today

- `web/src/scripts/chantNotation.ts::initChantNotation` (MovementNav, Vespers page) controls the switch `[data-chant-toggle]` and the boxes `.chant-notation[data-chant-id][data-annotation][data-mode]` that `SystemStack.astro` / `LineupStack.astro` render for each part start that has a GregoBase chant (`start.chantId`, `catalog.ts:650`).
- When the reader shows chant, it lazy-loads `/vendor/exsurge/exsurge.min.js` (bbloomf/exsurge `16c626f`, MIT, 232 KB raw / **57 KB gzip**) and `/chant/<id>.json` (`{gabc, incipit, …}` from `data/chants.json`, 1,353 chants, CC0). `cleanGabc` strips `<eu>`, `<clear>` and `<nlba>`. Exsurge lays out with `TextMeasuringStrategy.Canvas` and returns an SVG DOM node (`createSvgNode`).
- The preference is `localStorage["chant-display"]`: `"show"` or `"link"`, default `"link"`.
- Neither export includes chant.

## 2. Which export, and the control

**Customize export first** (P4). It already composes vector pages in mm, sanitizes SVG, and draws it as vector PDF with embedded Liberation Serif (`compose.ts`, `svg.ts`, `vectorPdf.ts`, `exportPdf.ts`). Since D23 it is on every page that has an export bar, and it covers MEI, fixed and scan parts. Quick export (`lib/pdf.ts`) only places pre-rendered LilyPond PDFs and scan images on standard-font pages. Adding chant there would duplicate the whole SVG→PDF route. Readers who want chant can use Customize export.

**Control.** Add one fieldset to the settings column, **after BREAKS and before More options**. It is visible by default, because P2 means some readers arrive with it on.

| Group | Label | Control | Options | Default | Helper (`.small.muted`) |
|---|---|---|---|---|---|
| Chant | Chant | Segmented, 3 | **Off** / **Before each part** / **Chant only** | P2 (Before when the site preference is on) | Off: none. Before: "The Gregorian chant from GregoBase, set to your page width." Chant only: "Only the chant; parts without chant are left out." |

- It follows the UI §1.4 segmented-control spec exactly: real radios, `.sr-only`, 44 px targets, accent border plus weight change when checked.
- In the narrow (<62rem) layout it lives in the Settings panel, not the FIT strip.
- **"In this PDF"** (UI §1.3): when chant is on, every part with a chant gets a second `.small.muted` line, "With its chant (Introit *Ad te levavi*)". A part with none gets "No chant for this part." If a chant could not be drawn: "The chant could not be drawn; this part prints without it." The export never blocks on chant.
- **Live result line** counts chant pages in the page total. No other copy changes.
- Changing the setting re-lays out like any other control. The setting is saved in `preferences.ts` alongside the other settings. Turning it on in the editor does **not** write the site's `chant-display` key (one-way).

## 3. Placement and pagination (P1 = a)

For each part in export order: heading (as today) → **chant lines** → accompaniment.

1. A part's chants are its `starts` that have a `chantId`, in page order. This is usually one. A Mass segment with several starts gets each chant before the part. When a segment is split into several export runs, the chant attaches to the **first run only**.
2. Chant lines are atomic. A page break may come between lines, never inside one. Each line has its own clef, so no custos is needed at a page turn: Exsurge already draws a custos at every line end.
3. Lines fill the part's first page under the heading, then continue on full pages as needed (Graduals and Tracts, §4.3).
4. **Accompaniment starts on the same page as the last chant line** when the remaining height is at least `minAccompanimentMm` (one system of the current music size, measured from the part's pass-1 layout, or 40 mm for scan/fixed parts). Otherwise it starts on the next page.
5. MEI parts use the existing first-page reservation. `reservationFor` grows a `chantTailMm` (height used on the shared page) and `chantPages` (pages that hold chant only). `renderMei`'s first-page rect subtracts `headingMm + chantTailMm`, exactly as it subtracts the heading today. No change to the two-pass algorithm (S2).
6. **Fixed parts** (LilyPond pages that carry their own heading) cannot share a page. Their chant goes on chant-only page(s) before them, under a heading built from the part label.
7. **Scan parts** reserve chant space like the heading, then pack scan systems below it.
8. The credit footer gains "Chant: GregoBase (CC0), drawn with Exsurge." on the part's last page whenever that part printed chant.

## 4. Rendering Exsurge for the page

### 4.1 Where it runs

**Main thread, in the editor chunk, at layout time.** The controller renders each chant to an SVG **string** and sends the strings to the layout worker with the rest of the job. The worker splits, normalizes, sanitizes and composes.

Exsurge needs a text measurer. Its Canvas strategy needs a DOM, so not the worker. Its worker-safe `OpenTypeJS` strategy needs `opentype.js` Font objects, which would be a new dependency and an untested path. The spike timed Exsurge layout in Chromium at **4–39 ms per chant**, so main-thread cost is small. The controller caches results by `(chantId, widthUnits, lyricUnits)`.

**Loader:** move `loadExsurge()` out of `chantNotation.ts` into `web/src/lib/exsurgeLoader.ts` and share it, so the script loads once whether the page or the editor asks first.

### 4.2 Scale, so chant matches the accompaniment

- **Staff space:** the chant staff space equals the accompaniment staff space for the chosen Music size: `spaceMm = 2 × unit / 10` (D8: `unit` 7/9/12). Exsurge's staff space is 12.5 units at glyph scaling 1/16 (spike: lines at y −43.75, −31.25, −18.75, −6.25). So `mmPerUnit = spaceMm / 12.5`, which gives 0.112 / 0.144 / 0.192 for Small / Medium / Large. Scan and fixed parts use Medium.
- **Width:** `widthUnits = printable.widthMm / mmPerUnit`. For example, Letter at Medium is 191.9 mm → 1333 units, and iPad mini is 107.9 mm → 749 units. Exsurge lays out to that width (`layoutChantLines(ctxt, widthUnits)`). Because Exsurge **reflows**, a page or iPad change gives new line breaks, not a scaled picture.
- **Lyric size:** the chant lyric size equals the accompaniment's Sung text size: `lyricMm = LYRIC_SIZE[lyrics] × unit / 10` (Medium/Medium = 4.05 mm, 11.5 pt). Exsurge prints lyrics at 0.9 × the `setFont` size (spike: `setFont(f, 21.33)` → `.lyric` 19.2 px), so call `setFont("'Liberation Serif'", lyricMm / mmPerUnit / 0.9)`. This is about 1.5× the site's lyric-to-staff ratio. Check it in K9's visual review. If it looks crowded, P-decide a fixed chant lyric size.
- **Annotation** (`Grad.`, mode `5`) comes from `annotationFor(part, mode)`, as on the site. **Drop cap** stays on (Exsurge's default, as on the site).
- Colours: rubrics keep Exsurge's `#d00` (P5); call `ctxt.setRubricColor('#d00')` explicitly so a future default change can't alter it. All other colours are `#000`. Never `currentColor`, because the page is print paper (UI `--print-ink`).

### 4.3 Splitting long chants

The spike rendered three chants with real GABC from `data/chants.json`:

| Chant | GABC chars | Lines @430 u | Lines @690 u | SVG bytes |
|---|---|---|---|---|
| Alleluia *Laudem Domini* (#1) | 610 | 5 | 3 | 60 KB |
| Gradual *Exaltabo te* (#277, the longest Gradual) | 1,387 | 12 | 8 | 155 KB |
| Tract *Qui habitat* (#889, the longest chant) | 4,156 | 35 | 21 | 431 KB |

Each Exsurge line is a top-level `<g class="chantLine" transform="translate(0,y)">` after one shared `<defs>`. Exsurge also exposes `score.lines[i].bounds` (y and height, about 82–105 units). The splitter emits **one standalone SVG per line**: the shared `<defs>` plus that `<g>`, re-based to y = 0, with `viewBox` set from the bounds. Compose treats lines like systems (§3). The first line carries the drop cap and annotation, which overhang the line's top, so its bounds come from the measured SVG bounds (`measureSvgBounds`), not from `score.lines`. Estimate: Medium on Letter fits about 15–17 chant lines a page, so *Qui habitat* takes under one Letter page and about two iPad-mini pages.

## 5. Getting Exsurge's SVG through the sanitizer and into the PDF (spike result)

What Exsurge emits (inventory of the three chants):

- **Elements:** `svg g defs path use rect text tspan style` plus **`line`**.
  - Neumes, clefs, custos and episemata are **vector paths** in `<defs>` (`<g id="PunctumQuadratum" class="glyph" transform="scale(0.0625)"><path d=…>`), drawn by `<use xlink:href="#…" x y>`. So the music needs **no font**: it is already outlined.
  - Staff lines are `<line>`; neume stems and episemata are `<rect>`.
- **Not well-formed XML:** the root has `xlink="http://www.w3.org/1999/xlink"` (a plain attribute, not `xmlns:xlink`), yet children use `xlink:href`, which is an unbound prefix. `@xmldom/xmldom` and any XML parser reject it.
- **Attributes outside the allowlist:** `source-index`, `element-index` (`use`, `rect`, `text`, `g`), `key` (`line`), `id` on every `use` (`note-1…`), and `style="…"` on `text`/`tspan`.
- **Style:**
  - The `<style>` block is a set of `svg.Exsurge .lyric{fill;font-family;font-size:19.2px;font-kerning}` rules. Descendant selectors, `font-size` and `font-family` are all outside `svg.ts`'s CSS policy.
  - Inline declarations are only `font-variant: small-caps` (the annotation), `font-style: italic`, `font-weight: bold`, `fill: #d00` (rubrics), and `font-family: 'Exsurge Characters'` (℣ ℟ + *).
- **Fonts:**
  - Text is plain `<text>`/`<tspan>` in the family passed to `setFont`, here `'Liberation Serif'`.
  - `'Exsurge Characters'` is not vendored, so on the site the special characters already fall back to the serif face: Exsurge maps ℣→`v`, ℟→`r` and appends `.`. Liberation Serif has no U+2123/U+211F glyphs anyway. 430 of 1,353 chants use `<sp>V/</sp>` or `<sp>R/</sp>`.

**Decision (proposed): a closed normalizer in front of the unchanged sanitizer.** `web/src/lib/export-layout/chantSvg.ts::normalizeExsurgeSvg` does the following:

1. Repairs the namespace declaration.
2. Converts `<line x1 y1 x2 y2>` to `<path d="M x1 y1 L x2 y2">`, keeping stroke and stroke-width.
3. Removes **exactly** `source-index`, `element-index`, `key`, `id` on `use`, and empty `class`/`style`.
4. Deletes the `<style>` block and inlines its per-class `font-size` and `font-family="Liberation Serif"` on each classed `<text>`.
5. Rewrites inline style declarations as attributes:
   - `font-style: italic` → `font-style`;
   - `font-weight: bold` → `font-weight`;
   - `fill` → a `fill` attribute with the same value (`#d00` for rubrics);
   - `font-variant: small-caps` → upper-cased text at 0.8 × size;
   - `font-family: 'Exsurge Characters'` → dropped. The run keeps its letter (`V.`/`R.`) in Liberation Serif, as the site shows it.
6. **Rejects** anything else with `UNSAFE_SVG: exsurge <what>`, so a new Exsurge version cannot slip a feature through by being stripped.

It uses `@xmldom/xmldom` (no `DOMParser` in workers), like `svg.ts`. The output then goes through **`sanitizePageSvg` unchanged** and **`drawSvgOnPage` unchanged**. **No sanitizer or walker change is needed.** The security boundary (B5) stays frozen, and Haiku never touches it.

**Spike evidence** ([experiments/chant-export/](../experiments/chant-export/), regex prototype `normalize-to-pdf.ts`):

- All three chants passed `sanitizePageSvg` (9 / 17 / 36 ms) and `svgToVectorPdf` (26 / 45 / 106 KB).
- Fonts in the PDF: `LiberationSerif` (+ `-Italic` for `<i>` text) subsets only. **0 image XObjects.**
- The PDF render (`gradual-exaltabo-pdf.png`) matches Chromium's render of the normalized SVG (`gradual-exaltabo-browser.png`) and of Exsurge's own output, apart from small caps.
- Seen and to fix in K1/K9:
  - `V..` (Exsurge's appended `.` after a GABC `.`; the site has the same quirk) → collapse to one period;
  - a possible overlap in "Dómine" after a rubric run → check in K9.

**Font consistency.** Exsurge's Canvas measurer must measure with the same Liberation Serif that the PDF embeds. Otherwise lyrics drift from their notes: the PDF walker re-measures runs with pdf-lib widths. `exportPreview.css` already declares the `@font-face` (`/fonts/export/LiberationSerif-*.ttf`). Before any chant layout, the controller awaits `document.fonts.load('16px "Liberation Serif"')` and the italic. If that fails, chant is **omitted with the notice** in §2, never measured with a fallback face. (Times New Roman is metric-identical per S3, but the rule is strict and cheap.)

## 6. Lazy loading (no new eager JS)

- Nothing changes on ordinary page loads. The editor chunk is already lazy (B9). Inside it, `exsurgeLoader` and `/chant/<id>.json` load **only when chant is on and the selection has at least one chant**. A page that already drew chant reuses `window.exsurge` and the browser cache.
- Added cost when on: 57 KB gzip once, plus about 1–3 KB per chant JSON. No new npm dependency.
- The normalizer is a few KB in the existing layout-worker chunk, which already bundles xmldom.
- `e2e/export-customize-lazy.e2e.ts` gains assertions:
  - (a) an ordinary page load requests no `exsurge` or `/chant/`;
  - (b) opening the editor with chant Off requests neither;
  - (c) switching it On requests both.

## 7. Accessibility

- Editor: the control is a `<fieldset>` + `<legend>Chant</legend>` with radios (UI §5 keyboard order: after Breaks, before More options).
  - Its change is announced through `#cx-status`: "Chant added before 3 parts. 1 part has no chant." The live result line stays `aria-hidden`.
  - Preview chant lines are inside the page SVG, which is already `role="img"` with the page label. Append "with chant" to that label.
- PDF: chant lyrics are real text in Liberation Serif, so they are selectable and searchable, and screen readers in PDF viewers read them as syllables, as for the accompaniment lyrics.
  - The credit line names GregoBase and Exsurge.
  - The PDF stays untagged, like today's exports. This is no regression; tagging is out of scope.
- Error copy follows UI §3: plain text with a "Can't…" prefix in notices. Chant never adds a blocking error.

## 8. Analytics

Extend `trackExport` (`lib/exportAnalytics.ts`):

- Add `chant` to `ALLOWED_KEYS`, with values `off` | `before` | `only`. Custom exports send it.
- Add `chantParts`, the number of parts that printed chant, as a string. No chant ids and no personal data (D11).
- This shows how often each mode is used, including chant only.

## 9. Contract changes (coordinator merges; `types.ts` is frozen otherwise)

```ts
// LayoutSettings
readonly chant: ChantMode;                       // default from P2
export type ChantMode = 'off' | 'before' | 'only';

// ExportPartBase
readonly chants: readonly ChantRef[];            // [] when none; only on a segment's first run
export interface ChantRef { readonly id: number; readonly incipit: string; readonly annotation: string; readonly mode: string }

// Worker job (main → layout worker)
readonly chantSvgs: ReadonlyMap<number, string> | null;   // chantId → Exsurge SVG string at this job's scale; null when off

// CanonicalPage (all kinds)
readonly chant: readonly ChantPlacement[];       // [] when none
export interface ChantPlacement { readonly chantId: number; readonly line: number; readonly svg: SanitizedSvg; readonly rect: RectMm }

// PartReservation
readonly chantTailMm: number; readonly chantPages: number;

// LayoutDiagnosticCode: add 'CHANT_UNAVAILABLE' (info; part prints without chant)
```

- Digests include each placed chant SVG's sha256, so a cached PDF is invalidated when chant changes.
- `limits.ts`: chant lines do not count toward the 300-system ceiling. They are capped separately at 120 lines per export (*Qui habitat* at iPad-mini width is 35).

## 10. Tests

- **Unit (Vitest):**
  - `chantSvg.test.ts` (normalizer):
    - raw fixtures fail `sanitizePageSvg`; normalized fixtures pass;
    - every unknown attribute or style is rejected, not stripped;
    - one SVG per line; the line count equals `score.lines`;
    - `V..`→`V.`; small caps become upper case.
  - `chantScale.test.ts`: the §4.2 numbers for every Music size, Sung text size and preset.
  - `compose.test.ts`:
    - chant before an MEI part shares the page when there is room;
    - it moves the accompaniment to the next page when there isn't;
    - a 35-line chant spans pages and splits only between lines;
    - fixed parts get chant-only pages;
    - a scan part reserves chant space;
    - Off is byte-identical to today's result digests.
  - `exportPdf.test.ts`:
    - chant pages embed only Liberation subsets;
    - 0 image XObjects;
    - extracted text contains "tá-" and "Dó-";
    - identical input gives identical bytes.
  - `exportAnalytics.test.ts`: new keys.
- **E2E (Playwright, fixture build):**
  - Kyrie IX with chant On (GregoBase *Kyrie IX* is #2976; K0 confirms the page links it), at Letter and iPad mini: download the PDF and run `verify-export-pdf.ts`.
  - **The verifier must learn 4-line staves.** It groups horizontal strokes into 5-line staves today, so chant staves would be miscounted. `CanonicalExpectation` gains `chantStaffSpaceMm` and `chantLines` per page, and 4-line groups at that spacing are checked separately.
  - The page with the longest linked chant (K0 finds it from the built catalogue; *Qui habitat* #889 is the longest chant overall but may not be linked to a page): chant pages split between lines, and the page count matches the editor's result line.
  - The lazy-load assertions of §6.
- **Visual (K9, [U]):** the user checks Letter print and the iPad 11-inch PDF in forScore: lyric size, the shared page, the rubric glyphs, and "Dómine".

## 11. Risks

| Risk | Mitigation |
|---|---|
| Exsurge Canvas metrics differ from pdf-lib metrics for the same face (kerning, ligatures) | Same TTF on both sides. The walker re-measures runs, so a drift shows as spacing, never as clipping. K6's test compares syllable x positions in the PDF against the SVG to within 0.3 mm. |
| Lyric size equal to the accompaniment's looks too big for chant | K9 checks it. Fallback: a fixed 0.8× chant lyric factor, which is one constant. |
| A future Exsurge upgrade emits new SVG | The normalizer rejects unknowns, and the fixtures pin the vendored commit `16c626f`. |
| A chant JSON 404 or a GABC parse failure | The part prints without chant with a `CHANT_UNAVAILABLE` info notice. The export never blocks. |
| iPad main-thread jank on large selections | Each chant takes ≤ 40 ms (desktop), is cached, and runs after the debounce. Measure in K8 on the device-test build. |
