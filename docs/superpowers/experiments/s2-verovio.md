# S2: Verovio 6.3.0 layout control and two-pass pagination

Date: 2026-10-09. Branch `export/s2`, fast-forwarded to `export/integration` at `87cd992` (the fixture's measures carry `xml:id="m001"`…`"m061"`).
Renderer: npm `verovio@6.3.0` (`6.3.0-425dd7b`), WASM (`verovio/wasm` + `verovio/esm`), run in Node 26.

**Verdict:** the two-pass algorithm is **confirmed**. Pass 2 (`breaks: "encoded"`) reproduced pass 1's system starts and the planned page assignment in **28 of 28** cases, with no clipping and no missing events. Every contracts §1.1 option name is accepted. Staff heights are exact. The hidden-note glissando **renders acceptably**, including across a system break. The Python wheel's SVG is **byte-identical** to the WASM SVG once `xmlIdChecksum` is on.

There are **two contract changes** (§1.1, see "Contract changes"): reserve a left page margin for the brace, and add `xmlIdChecksum: true`.

## Reproduce

```bash
cd web && pnpm install --frozen-lockfile
node scripts/spike-verovio.ts                   # report only -> build/spike-verovio/report.json
node scripts/spike-verovio.ts --write-fixture   # also rewrites the pass-1 fixture and s2-assets/*.svg
```

The harness exits 1 if any two-pass case fails. It takes about 12 s. The checked-in outputs are:
- `web/src/lib/export-layout/__fixtures__/s2-pass1-letter-medium.json` (pass-1 `SystemGeometry[]` for Letter portrait, medium staff, original lines, 12 mm margins);
- `docs/superpowers/experiments/s2-assets/kyrie-ix-gliss-letter-medium.svg`;
- `docs/superpowers/experiments/s2-assets/feature-mappings.svg`.

The fixture's `firstBoundaryId` values are **synthetic**: `b00k` names the boundary after measure `m00k`. Real `SafeBoundary` ids come from A2d.

## 1. Options (contracts §1.1)

Method: `getAvailableOptions()` gives each option's metadata, `setOptions()` sets the full §1.1 set, and `getOptions()` reads the values back.

**How rejection works:** `setOptions` returns `true` even when it rejects something. A rejected option is reported **only on `console.error`**, never in `getLog()`:
- an unknown name gives `[Error] Unsupported option 'x'`;
- an invalid enum gives `[Error] Parameter 'pages' not valid for 'breaks'`;
- an out-of-range number gives `[Error] Parameter value 13 … out of bounds`.

The option then **keeps its previous value**, which on a fresh toolkit is the default. B4d must therefore read the values back with `getOptions()`, or validate before calling `setOptions`.

| Option | Type / range (6.3.0) | §1.1 value | Read back | Verified behaviour |
|---|---|---|---|---|
| `scale` | int 1–1000 | 100 | 100 | 0.1 mm per page unit (see §2) |
| `pageWidth` | int 100–100000 | `floor(content.widthMm*10)` | ✓ | Outer SVG viewBox width = pageWidth. **Includes** the left/right margins. |
| `pageHeight` | int 100–**60000** | `floor(content.heightMm*10)` | ✓ | 60000 (6 m) is the maximum, and pass 1 uses it. |
| `pageMarginLeft` | int 0–500 | **`ceil(3*unit)`** (changed, was 0) | ✓ | Shifts the music right inside pageWidth (`g.page-margin transform=translate`). |
| `pageMarginRight/Top/Bottom` | int 0–500 | 0 | ✓ | |
| `unit` | double **4.5–12** | 7 / 9 / 12 | ✓ | 12 (large) is the maximum Verovio accepts. |
| `lyricSize` | double 2–8 | 4.5 | ✓ | |
| `spacingSystem` | int 0–48 | 4 | ✓ | Affects the gap, but the gap is not `spacingSystem` in mm (see §6). |
| `font` | string | `Leipzig` | ✓ | |
| `justifyVertically` | bool | `kind !== 'print'` | ✓ | See §5. |
| `header` / `footer` | none/auto/encoded(/always) | `none` | ✓ | |
| `svgViewBox` | bool | true | ✓ | Root `viewBox="0 0 pageWidth pageHeight"`, with no width/height attributes. |
| `mnumInterval` | int 0–64 | 0 | ✓ | |
| `evenNoteSpacing` | bool | true | ✓ | |
| `spacingLinear` / `spacingNonLinear` | double 0–1 | 0.25 / 0.6 | ✓ | |
| `breaks` | `none, auto, line, smart, encoded` | per pass | ✓ | See §3. |
| `xmlIdChecksum` | bool | **true** (added) | ✓ | Seeds generated ids from the input checksum, so the SVG is reproducible (see §9). |
| `systemMaxPerPage` | int 0–24 | (not in §1.1) | ✓ | Not used by the two-pass design (see §3). |
| `inputFrom` | string | (not needed) | not reported by `getOptions` | MEI is auto-detected. |
| `svgBoundingBoxes` | bool | pass-1 measurement only | ✓ | Adds `<g class="… bounding-box"><rect/></g>`. Layout is unchanged (system starts are identical with and without it, 28/28). |
| `xmlIdSeed` | int | not used | ✓ | Re-loading in the same toolkit still gives different ids. Use `xmlIdChecksum`. |

`getLog()` returns `""` in the WASM build, even when Verovio printed warnings. Warnings such as `[Warning] Justification is highly compressed (ratio … < 0.8)` reach only `console.warn/error`. A worker that wants them (for `CROWDED_ORIGINAL_LINES`) must wrap `console.error` around `loadData`/`renderToSVG`. The harness's `captureConsole` shows the pattern.

## 2. Staff height (D8)

Verovio's SVG has an outer `<svg viewBox="0 0 W H">` in 0.1 mm (W = pageWidth) and an inner `<svg class="definition-scale" viewBox="0 0 10W 10H">`. One inner unit is therefore 0.01 mm at `scale: 100`. The harness computes `mmPerUnit = (outerW / 10) / innerW` and checks that it equals 0.01.

| Staff | `unit` | Line spacing (inner units) | Staff height (bottom line − top line) | Expected |
|---|---|---|---|---|
| small | 7 | 140 | **5.600 mm** | 5.6 |
| medium | 9 | 180 | **7.200 mm** | 7.2 |
| large | 12 | 240 | **9.600 mm** | 9.6 |

Every staff on every page of every two-pass case measured exactly 5.6, 7.2 or 9.6 mm. The formula `8 × unit × 0.1 mm` holds. Use a ±0.1 mm tolerance as planned.

## 3. `breaks` modes and `systemMaxPerPage`

Fixture with its five source `<sb/>` (systems start at m001, m009, m017, m027, m040, m051).

| `breaks` | Source `<sb>` | Adds its own line breaks | `<pb>` | Paginates by height | `systemMaxPerPage` |
|---|---|---|---|---|---|
| `auto` | **ignored** | yes | ignored | yes | **honoured** |
| `line` | honoured | **no**: an over-wide line is compressed (warning), never split | **ignored** | yes | **honoured** |
| `smart` | partly (an sb is used only above `breaksSmartSb` 0.66 width usage) | yes | ignored | yes | honoured |
| `encoded` | honoured | no | honoured | **no**: if the document has any `<sb>`/`<pb>`, the content overflows the page (13 systems on one 124 mm page reached 694 mm) | **ignored** |
| `none` | ignored | no (1 system) | ignored | no | ignored |

Two edge cases:
- `encoded` with **no** break element in the document falls back to automatic breaking. The warning is `Requesting layout with encoded breaks but nothing provided`. With the stripped fixture on A5-landscape/large it gave 3 pages. In the two-pass design, a part with exactly one system therefore gets no break element, and pass 2 reflows automatically. That is harmless, because pass 1 fitted it on one line at the same width.
- `line` at Letter/medium compresses one source line to a ratio of 0.798. At A5 portrait/large it compresses to 0.66–0.71 and still honours the source lines. Original line policy plus large staff on narrow pages relies on this compression. Use the warning, captured from the console, to drive `CROWDED_ORIGINAL_LINES`.

## 4. Inserted `<sb/>` / `<pb/>`

The source `<sb/>` were stripped and new breaks inserted (ipad-11 portrait, medium).

| Markup | `encoded` | `line` | `auto` | `smart` |
|---|---|---|---|---|
| `<sb/>` before m010, m030 | honoured | honoured | ignored | ignored or partial |
| `<pb/>` before m020 | **starts page 2** | ignored (1 page) | ignored | ignored |
| `<pb/><sb/>` before m020 | starts page 2, same result as `<pb/>` alone | ignored | ignored | ignored |

Only `encoded` honours `<pb/>`. `<pb/>` alone and `<pb/><sb/>` give identical layouts, so write `<pb/>` followed by `<sb/>` as the card says. It is harmless and explicit.

## 5. `justifyVertically`

Under `encoded` with two systems per page (ipad-11 portrait, content 219.1 mm):
- **false:** the systems are stacked at exactly the pass-1 offsets (tops 0 and 40.75 mm; bottom 72.6 mm).
- **true:** Verovio stretches the page **partially**, not to the bottom. System 1 grows from 31.9 to 46.5 mm (the staves inside the system spread), and the second system moves to 69.95 mm. The page ends at 116.4 mm, not 219.1 mm. The **last page is also justified** (one system grows from 32.8 to 40.2 mm).
- Under `line`, a single full page is justified, to a bottom of 214.6 mm out of 219.1 mm.

Consequences:
- Pass 1 must run with `justifyVertically: false`, so that heights are natural.
- Pass 2 uses the §1.1 value. Justification never pushed content past `pageHeight` in any screen or custom case.
- System rectangles for B6a/B8c (break overlay) must be read from **pass 2's** SVG, never from pass 1.

## 6. Reading geometry from the SVG

The worker has no DOM, so parse the SVG as a string with a tag tokenizer (or `@xmldom/xmldom`, now in integration):
- **Systems:** `<g class="system">` in document order. A system's **first measure** is the first descendant `<g class="measure" id="…">`. Its `id` is the MEI `xml:id` (m001…), and `xmlIdChecksum` does not change ids that the encoding supplies.
- **Notes:** `<g class="note" id="…">` carries the MEI note `xml:id`. Use these for `EVENT_MISSING`. Hidden notes are present, with `visibility="hidden"`.
- **Staff lines:** a `<g class="staff">`'s direct-child `<path d="Mx y Lx2 y">` elements, five per staff.
- **Vertical extent** (needs `svgBoundingBoxes: true`, used in pass 1 only):
  - Take the union of every `rect` inside a `<g class="… bounding-box">` within the system.
  - **Exclude** milestone boxes (`pageMilestone`, `systemMilestone`, `mdiv`, `score`, `section`).
  - The `system bounding-box` rect covers only the system's own barline, so it is useless by itself.
  - **Spanner trap:** a tie, slur or gliss that crosses a system break is drawn in two pieces. The bounding box of the first piece's `<g>` (in the start measure) can contain the continuation's rect, which lies in the **next** system. The continuation itself is emitted in the next system as `<g class="tie id-<xml:id> spanning">`, with no `id` attribute. Assign each `tie|slur|gliss|phrase|lv|hairpin|bracketSpan` rect to the system whose staff band (top line to bottom line) is nearest the rect's vertical centre. Without this rule, system 1 measured 70 mm instead of 32 mm.
- **Units:** `mm = innerUnits × (outerViewBoxWidth / 10) / innerViewBoxWidth`. Add the `g.page-margin` translate X before converting horizontal positions.
- **Horizontal extent:**
  - With `pageMarginLeft: 0`, the brace or bracket and the system barline start at −0.28 × unit mm (−2.52 mm at unit 9, −3.36 mm at 12). That is **outside** the content rect, and with a 3 mm margin and large staff it falls off the page. With `pageMarginLeft = ceil(3*unit)`, the minimum x is +0.14 to +0.24 mm.
  - The right edge overflows `pageWidth` by **0.12–0.35 mm** in every case: glyph and stroke overhang of the final barline and last notes. The one exception was **0.73 mm**, in the compressed original-lines case (ipad-11/large/original).

**Pass-1 measurements** (Letter portrait, content 191.9 × 255.4 mm, medium; the fixture):

| index | firstBoundaryId | topMm | heightMm |
|---|---|---|---|
| 0 | null | 0 | 31.89 |
| 1 | b008 | 40.75 | 31.89 |
| 2 | b016 | 81.5 | 31.89 |
| 3 | b026 | 122.25 | 31.89 |
| 4 | b039 | 163 | 31.95 |
| 5 | b050 | 203.81 | 32.76 |

**Inter-system gap** (next top − previous bottom), measured:
- small 6.89 mm, medium 8.86 mm, large 11.82 mm. That is about 0.985 × unit mm at `spacingSystem: 4`; the gap at medium is 7.06 mm with `spacingSystem` 0 and 12.46 mm with 8.
- The gap is **not** `spacingSystem` in mm, and it varies slightly with content (10.74 vs 11.82 mm in one large case, 8.05 vs 8.86 mm in A5 portrait).
- The merged B4a `paginate()` takes one `minGapMm`. **B4d must pass the maximum measured pass-1 gap** (`max(top[i+1] − (top[i] + height[i]))`), not `SYSTEM_SPACING` in mm. The maximum is conservative: the actual stacked extent is never larger than predicted. In all 28 cases, paginate with the maximum gap, with the minimum gap, and with exact pass-1 extents gave identical pages.

## 7. Two-pass algorithm: confirmed

Cases run, all passing:
- The **required 12**: Letter portrait, iPad-11 portrait and A5 landscape × medium/large × original/automatic.
- All **13** contracts §3 matrix cases.
- 3 variants: cap 2 with `<pb>` only, cap 2 with `<pb><sb>`, and A5-landscape/large with cap 1 (six one-system pages).

In every case:
- pass-2 system starts equalled pass 1's;
- systems per page equalled `paginate()`'s pages;
- no content fell below `pageHeight`;
- no left overflow;
- 0 missing note ids;
- the staff measured 5.6/7.2/9.6 mm;
- two fresh-toolkit pass-2 renders gave byte-identical SVG.

The glissando MEI was also run through two passes (Letter/original and A5 portrait/automatic), and both passed.

Pseudocode for B4d (`renderMei`):

```
renderMei(part, settings, overrides, ctx):
  page    = paperDimensions(settings); content = contentRect(page, margins, heading)
  base    = verovioOptions(settings, content)                 // contracts §1.1, incl. pageMarginLeft and xmlIdChecksum
  eff     = resolveBreaks(part, settings, overrides)          // B4b
  mei1    = materialiseBreaks(part.meiXml, eff restricted to user SYSTEM breaks + source breaks if 'original',
                              boundaries, policy)            // B4c; strips source <sb> when 'automatic'; never writes <pb> here
  // ---- pass 1: natural line breaking on one tall page
  tk.setOptions({...base, pageHeight: 60000, justifyVertically: false, svgBoundingBoxes: true,
                 breaks: policy == 'original' ? 'line' : 'auto'})
  assert readBack(tk.getOptions()) == requested else RENDERER_FAILED   // setOptions never reports rejection
  tk.loadData(mei1); if tk.getPageCount() != 1 -> RENDERER_FAILED (content > 6 m)
  sys1 = parseSystems(tk.renderToSVG(1))                     // §6 rules; per system: firstMeasureId, topMm, heightMm, minX/maxX
  for each s: firstBoundaryId = boundary whose measureId is the measure before s.firstMeasureId (null for the first)
  if any s.maxXMm > content.widthMm + 0.5:
      policy=='original' ? warn CROWDED_ORIGINAL_LINES : error UNSATISFIABLE_LAYOUT reason 'system-too-wide'
  gap = max over i of (sys1[i+1].topMm - sys1[i].topMm - sys1[i].heightMm), or 0 if one system
  // ---- paginate (B4a)
  forced = { i : sys1[i].firstBoundaryId has a user PAGE break }
  r = paginate({systems: sys1 heights, contentHeightMm, firstPageContentHeightMm, minGapMm: gap,
                maxSystems: settings.maxSystems, forcedPageStarts: forced})
  if !r.ok -> UNSATISFIABLE_LAYOUT reason 'system-too-tall' (+ suggestions)
  // ---- materialise every system start explicitly
  mei2 = strip all <sb>/<pb> from mei1
  for each page p, each system s in p (skip global system 0):
      insert before s.firstMeasureId:  (s is first on page) ? "<pb/><sb/>" : "<sb/>"
  // ---- pass 2: encoded, real page height (first page uses firstPageContentHeight: render page 1 separately
  //      or pass the smaller height for all pages; see risk R4)
  tk.setOptions({...base, breaks: 'encoded', svgBoundingBoxes: false})
  tk.loadData(mei2); pages2 = [renderToSVG(k) for k in 1..getPageCount()]
  starts2 = flatten(pages2 -> systems -> firstMeasureId)
  if starts2 != sys1.firstMeasureId list or getPageCount() != r.pages.length or per-page counts differ:
      -> UNSATISFIABLE_LAYOUT reason 'no-convergence'      // no retry loop
  // ---- validate (validateLayout)
  per page: systems <= maxSystems else CAP_EXCEEDED
  every expected note xml:id appears as <g class="note" id> in some page else EVENT_MISSING
  every staff height within ±0.1 mm of STAFF_SIZES[staff].heightMm else STAFF_HEIGHT_MISMATCH
  clipping (needs a bbox pass or a cheap check): content bottom <= pageHeight + 0.05 mm, left >= 0,
      right <= pageWidth + 0.5 mm, else CONTENT_CLIPPED
  return MeiLayout{ pages: pages2 with systems read from pass 2 (tops differ under justifyVertically), ... }
```

Notes for implementers:
- Read rectangles for B6a/B8c from pass 2. With `justifyVertically: true`, tops and heights differ from pass 1.
- `<pb/>` is honoured only under `encoded`, and `encoded` ignores `systemMaxPerPage`. Never set `systemMaxPerPage`; the cap lives in `paginate()`.
- The clipping check in pass 2 needs bounding boxes. Either render pass 2 with `svgBoundingBoxes: true` and strip the `bounding-box` groups in B5, or render it twice. The option does not change layout.

## 8. Voice-line glissando (noh2.ily `\voiceLine`)

Setup:
- I copied the experiment MEI and added a third layer to staff 2 holding `@visible="false"` notes. Each one copies the rhythmic container (the hidden `<tuplet>`) of that measure's staff-2 layer 1, so measure durations are unchanged.
- I joined the notes with `<gliss startid endid lform="dotted"/>`.
- There are three cases:
  1. **cross-staff**: m006 alto b3 (`note@staff="1"` inside staff 2's layer) to m007 bass e3;
  2. **across the source `<sb/>`**: m008 to m009;
  3. **same staff within a system**: m002 to m003.

Result: **acceptable; renders.**
- Each gliss is a dotted line (`stroke-dasharray="1 120"`, round caps, width 40 inner units, i.e. 0.4 mm) between the hidden heads.
- The cross-staff gliss runs diagonally from the treble to the bass staff.
- The across-break gliss is drawn to the end of system 1 and resumes at the start of system 2, as `<g class="gliss id-vl2 spanning">`. That matches LilyPond's `\allowVoiceLineBreak`.
- No warnings were printed.
- System starts are unchanged by the extra layer, and both two-pass runs on this MEI passed.

SVG: `s2-assets/kyrie-ix-gliss-letter-medium.svg`, top two systems.

Caveats:
1. Hidden notes are emitted **with their notehead `<use>`**, under `<g class="note" visibility="hidden">`. The B5 sanitizer must keep the `visibility` attribute, and the S4/B2 vector-PDF walker **must skip `visibility="hidden"` subtrees**, or every voice-line note prints as a black head.
2. The `spanning` continuation groups have no `id` attribute, only the class `id-<xml:id>`. The B5 id allow-list must not reject them.
3. Line thickness and dot pitch differ from LilyPond (`thickness 2.0`). If the reviewer wants a closer match, try `lwidth` in A5d.

## 9. Determinism

Python `verovio==6.3.0` installs from a wheel (`uv venv build/s2-pyvenv --python 3.12 && uv pip install --python build/s2-pyvenv/bin/python verovio==6.3.0`). It reports `6.3.0-425dd7b`, the same build as npm.

With the same MEI and option JSON (`build/spike-verovio/determinism/`), the outcome depends on `xmlIdChecksum`:
- **with `xmlIdChecksum: true`:** the Python SVG **equals the WASM SVG byte for byte** (270,095 bytes, Letter/medium/original);
- **without it:** the SVGs differ, because generated element ids are random per load. That is also true between two WASM loads.

This was checked on one fixture and one option set, not the whole matrix. Keep the eng review's rule: **A5 evidence renders through Node/WASM** (A3e `web/scripts/render-mei.ts`). The Python wheel is acceptable for timemap and onset checks.

## 10. Recommended MEI mappings for A3b

These were verified visually in `s2-assets/feature-mappings.svg` (unit 12; measure k is candidate k).

| Feature (noh2.ily) | Recommended MEI | Render result | Rejected alternatives |
|---|---|---|---|
| `\finalis` (double bar) | `measure@right="dbl"` | correct double bar | `<caesura glyph.num="U+E8F6">` also draws a double bar, but as a mid-measure glyph. |
| `\divisioMaxima` (full-staff bar) | `measure@right="single"` | correct | `<caesura U+E8F5>` also works. |
| `\divisioMaior` (half-staff bar) | `<caesura tstamp=… staff=… glyph.auth="smufl" glyph.num="U+E8F4"/>` | Draws a half-height bar. It runs from the top line to the middle line instead of being centred: an **engraving difference to accept in A5d**. | `barLine@len/@place` inside a layer is ignored (draws a full bar). `measure@right="dashed"` draws a full dashed bar. |
| `\divisioMinima` (short tick on the top line) | `<caesura … glyph.num="U+E8F3"/>` | A short vertical tick **just above** the top line, close to LilyPond's | `<breath>` draws a comma, and `breath@glyph.num` is ignored. This is the experiment's current mapping, to be **replaced**. |
| `\quil` (prall glyph in place of the notehead) | `note@head.visible="false"` plus `<dir startid="#n" place="within"><symbol glyph.auth="smufl" glyph.num="U+E56C"/></dir>` | Draws the prall at the note's position, which looks like LilyPond's. **Caveat:** it is emitted as SVG `<text><tspan font-family="Leipzig">`, not a path. The PDF route must handle a Leipzig **text** glyph (S3/S4 assumed music glyphs are always paths). If S4 cannot embed it, fall back to `<mordent form="upper">` on a visible head (path glyph above the staff, a semantic approximation) or mark it `unsupported`. | `note@glyph.num` is ignored. `head.altsym` with `<symbolDef>` is ignored. `<ornam glyph.num/glyph.name>` draws nothing. `<ornam>` with text U+E56C draws a missing-glyph box. `head.shape` has no prall value. |
| `\voiceLine` | 5th layer of `note@visible="false"`, cross-staff via `note@staff`, with `<gliss startid endid lform="dotted"/>` (§8) | acceptable | none |
| Scaled durations | hidden `<tuplet num.visible="false" bracket.visible="false">`, as in the experiment | already proven by the experiment | none |

## Contract changes (contracts §1.1, coordinator review)

1. **`pageMarginLeft = ceil(3 * unit)` in 0.1 mm** (2.1 / 2.7 / 3.6 mm), replacing 0. Verovio draws the brace at −0.28 × unit mm, outside the content rect. Music width shrinks by that amount inside `pageWidth`. The other margins stay 0.
   - **Follow-up:** the merged `web/src/lib/export-layout/settings.ts` (lines 384–387) and its test still use 0 and need a W1 follow-up card.
2. **Add `xmlIdChecksum: true`** to the fixed options, for reproducible SVG and digests and Python/WASM equality.
   - **Follow-up:** this needs the same `settings.ts` change.
3. Documented in §1.1, not changed: `breaks` uses only `line`, `auto` and `encoded`. `systemMaxPerPage` is deliberately not used. `setOptions` failures are silent, so read the values back.

These changes do **not** alter the frozen §1 TypeScript types. A proposal for the coordinator, not applied: B4d would benefit from `getOptions()` on `VerovioLike`, and from the ambient `verovio.d.ts` gaining `getLog`, `getOptions` and `getAvailableOptions`.

## Risks for B4a–B4e

- **R1. Gap model (B4a/B4d).** `minGapMm` is not `spacingSystem` in mm. It must be the maximum measured pass-1 gap (§6), or the prediction will undercount (8.86 mm measured against 3.6 mm if `spacingSystem` is read as 0.9 mm units). The B4a code is fine. Only the caller's input changes.
- **R2. Silent option rejection (B4d).** A typo or out-of-range value in `verovioOptions` falls back silently. Assert the read-back values in a real-WASM test.
- **R3. Spanner bboxes (B4d).** Without the nearest-staff rule (§6), any tie or slur across a line break inflates the earlier system's height by a whole system, and paginate then over-breaks.
- **R4. First page with a heading (B4d).** Verovio has one `pageHeight` for all pages. With `encoded` there is no automatic page breaking, so a smaller first-page budget is safe for **fit**. However, `justifyVertically: true` stretches page 1 to the full `pageHeight` and can run into the reserved heading space. Options:
  - render page 1 in its own pass-2 call, with `pageHeight = firstPageContentHeight`;
  - or turn justification off when the first page has a heading.

  This spike did not exercise headings.
- **R5. Single-system parts (B4c/B4d).** With no break element, `encoded` falls back to `auto`. That is harmless, but it is a different code path. Keep a test.
- **R6. Original lines on narrow pages (B4d/B4e).** `line` never adds breaks. Large staff on A5 or iPad mini compresses lines (ratio down to 0.62) and can overhang the right edge by about 0.7 mm. Raise `CROWDED_ORIGINAL_LINES` from the captured console warning or from the measured overhang. Use a right-edge tolerance of 0.5 mm.
- **R7. Hidden notes in PDF (B5/B6).** Voice-line notes keep their notehead `<use>` under `visibility="hidden"`. A sanitizer or PDF walker that ignores `visibility` prints them.
- **R8. Leipzig as a text font (B2/S4).** A quilisma via `<dir><symbol>` is SVG text in Leipzig, so the vector-PDF route needs that glyph, or A3b takes the mordent fallback.
- **R9. Worker parsing (B4c/B4d).** Web workers have no `DOMParser`. Use `@xmldom/xmldom` (already added in integration, `fc7433f`) or the string tokenizer from the harness.
- **R10. Measure ids (A3c).** `SafeBoundary.measureId` and system detection rely on every `<measure>` carrying an `xml:id`. Verovio keeps encoded ids verbatim, but generates random ones (or checksum-seeded ones) for elements without them.
- **R11. B4e.** The full contracts §3 matrix passes on the experiment MEI (§7). The A3 output is not tested yet.
