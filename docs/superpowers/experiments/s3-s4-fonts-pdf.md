# S3+S4: text face and vector PDF route

Date: 2026-10-09. Spike S3+S4 of the execution packet. Prototype code is in `web/scripts/spike-pdf/` (not shipped, outside `tsconfig` `include`; it has its own strict `tsconfig.json`).

## Decisions

- **S3, text face:** **Liberation Serif 2.1.5** (SIL OFL 1.1) for lyrics and for all headings. Regular is the lyric face and the heading regular; Italic and Bold are the heading italic and bold. Verovio's own text metrics are Times New Roman's, and Liberation Serif is metric-compatible with Times New Roman. It is also the face Verovio itself bundles for `fontTextLiberation`.
- **S4, vector PDF:** **route (ii): `pdf-lib` + `@pdf-lib/fontkit` + our own walker** over Verovio's SVG subset. Both routes keep every glyph as vectors at the exact page size, so G2 is not at risk. Route (ii) wins on the following points:
  1. **B6b needs pdf-lib anyway.** Fixed pages go in through `embedPdf` as vectors, and quick export already uses pdf-lib. pdfkit cannot import existing PDF pages, so route (i) would ship two PDF libraries.
  2. **svg-to-pdfkit drops Verovio's stylesheet.** Verovio strokes its shapes through a `<style>` rule, `#id path {stroke:currentColor}`, and svg-to-pdfkit 0.1.8 ignores it. Without that rule, staff lines, stems and barlines disappear: 51–58 % of the ink is misplaced (table below). Route (i) only works after a pre-pass (`inlineVerovioStroke`) that copies the rule onto each element as an attribute. svg-to-pdfkit was last published to npm in 2019.
  3. **The pdfkit standalone build does not run in a module worker.** It fails with `Dynamic require of "url" is not supported`. Only pdfkit 0.20's browser ESM export works, and only after `registerStdFonts(Helvetica)`.
  4. **The walker has a small, closed input surface.** It handles about 300 lines covering the elements and attributes listed below. There are no external references, images or CSS to handle, which suits the B5 sanitiser.
- **Cost of route (ii):** a bigger chunk. It is 550 KB gzip against 236 KB for route (i), because `@pdf-lib/fontkit` 1.1.1 is a 939 KB (minified) monolith. An adapter onto upstream `fontkit@2.0.4` (`fontkit2Adapter.ts`) cuts the chunk to 333 KB gzip with output that is otherwise identical. It is measured below; it is optional and not recommended for v1.

## S3 findings: how Verovio 6.3.0 measures text

The evidence comes from the 6.3.0 sources (`src/devicecontext.cpp`, `src/resources.cpp`, `data/text/Times*.xml` at tag `version-6.3.0`), confirmed by the renders.

- **Text options.** No `textFont` option exists in 6.3.0, which `getAvailableOptions()` confirms. `fontAddCustom`, `fontLoadAll` and `fontFallback` apply to **music** fonts only. The single text option is `fontTextLiberation` (bool).
- **Text width.** `DeviceContext::GetTextExtent` sums advances from built-in bounding-box tables: `Times.xml`, `Times-italic.xml`, `Times-bold.xml` and `Times-bold-italic.xml`, at 2048 units/em. These are Times New Roman metrics. Rows without `h-a-x` fall back to the bbox width `w`.
- **`fontTextLiberation` does not change layout.** Rendering the Kyrie with and without it gave **0 geometry differences** across 685 `text/rect/use/path/ellipse` elements. The option only switches `font-family` to `"Liberation, serif"` and embeds four Liberation woff2 files in a `<style>`. That made the SVG 534,603 B instead of 141,411 B. **Keep it off.** The preview loads the bundled face with `@font-face` instead.
- **Non-ASCII characters are measured as 'o' (0.5 em).** `InitTextFont` reads `c` with `strtol(…, 16)`, and the Latin-1 rows are written as UTF-8 byte pairs (`C3A9` for é). They load as code 0xC3A9, so they never match a code point, and every non-ASCII character falls back to the 'o' glyph. This is confirmed by the renders: changing "ri" to "rí" moved the following hyphen by +45 units, which is half of (0.5 − 0.2778) em × 405.
- **Liberation Serif against Verovio's table** (`metrics.ts`). Liberation Serif and the system Times New Roman give identical results.
  - Regular: 80 of 94 printable ASCII glyphs match exactly. The 14 that differ are where Verovio used bbox widths: A D G H K N O Q U V X Y w ~, by +0.026 to +0.067 em, which is at most 0.27 mm at the default 4.05 mm lyric size. Lowercase Latin except `w` matches exactly.
  - Italic: 26 of 94 differ, by up to 0.16 em. Bold: 11 of 94 differ, by up to 0.084 em. Neither is used for lyrics in the pilot.
  - Accented letters, as face advance against Verovio's 0.5 em:

    | Letters | Face advance | Difference |
    |---|---|---|
    | é á ë | 0.444 em | −0.056 |
    | í ï | 0.278 em | −0.222 |
    | ó ú ý ü | 0.5 em | 0 |
    | ǽ æ | 0.667 em | +0.167 (≈0.68 mm at 4.05 mm) |
    | œ | 0.722 em | +0.222 |
    | Á Ó Ú | 0.722 em | +0.222 |
    | Ǽ Æ Œ | 0.889 em | +0.389 |

  - Liberation Serif covers every character tested, including é á í ó ú ý ǽ œ Ǽ Œ.
- **Consequence.** Preview and PDF both draw each syllable at Verovio's `x`, with `text-anchor` start, in the same face, so the PDF text sits exactly where the preview text sits. The measured misplaced ink is 0 px at 288 dpi. The only error is Verovio's own reservation of space: syllables with ǽ, œ or accented capitals are drawn up to about 0.2 em wider than Verovio reserved. That is a spacing nuance, not a preview/PDF mismatch. It is an upstream Verovio bug and is reportable.
- **Accents in the preview.** The accented page (`render.ts --accents` rewrites syllables to Ký, rí, lǽ, sœn., Chrá, stó, ú) was rendered with resvg, using Liberation Serif and `font-family` rewritten. All accents render; see `s34-assets/accents-sys1-svg.png`.

## Fonts to place at `web/public/fonts/export/`

They are staged under `build/s34-fonts/` and not committed. Source: <https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz> (release 2.1.5, 2021-09-30). The tarball's sha256 is `7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0`.

| Role (`FontProfile`) | Family | File | SPDX | Bytes | sha256 |
|---|---|---|---|---|---|
| `lyricFont`, `headingRegular` | Liberation Serif | `LiberationSerif-Regular.ttf` | OFL-1.1 | 393,576 | `058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74` |
| `headingItalic` | Liberation Serif | `LiberationSerif-Italic.ttf` | OFL-1.1 | 375,632 | `0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e` |
| `headingBold` | Liberation Serif | `LiberationSerif-Bold.ttf` | OFL-1.1 | 370,096 | `d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce` |
| licence text (ship alongside) | | `OFL-LiberationFonts.txt` (the release's `LICENSE`) | | 4,414 | `93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b` |
| *(not in profile; optional)* | Liberation Serif | `LiberationSerif-BoldItalic.ttf` | OFL-1.1 | 376,772 | `f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7` |

The `FontProfile` contract is **unchanged**. The lyric font and the heading regular are the same file. The walker maps italic syllables to `headingItalic`, bold syllables to `headingBold`, and bold italic to `headingBold`; the pilot has none of these. `FontAsset.license` should be `"OFL-1.1"`. The OFL requires the licence to travel with the fonts, so ship `OFL-LiberationFonts.txt` in the same directory.

## Packages for the coordinator

- **Keep or add:**
  - `@pdf-lib/fontkit` `1.1.1`, a dependency (B6b's card already says the coordinator adds it).
  - `pdf-lib` is already `^1.17.1`. I suggest pinning it to `1.17.1`.
  - `pdfjs-dist` `6.4.299` (B6c adds it). B2's text-extraction test can use it too; the spike's Node usage is `pdfjs-dist/legacy/build/pdf.mjs`.
- **Spike-only, not needed:** `pdfkit` 0.20.2, `svg-to-pdfkit` 0.1.8, `fontkit` 2.0.4, `@types/pdfkit`, `@types/pngjs`, `@resvg/resvg-js` 2.6.2, `@napi-rs/canvas` 1.0.10, `pixelmatch` 8.0.0, `pngjs` 7.0.0 and `esbuild` 0.28.2. They are in a separate commit so it can be dropped. The spike scripts need them to re-run.

## Measurements

The pages are:
- **primary:** a fresh Kyrie IX render, Verovio 6.3.0-425dd7b npm WASM in Node, at `scale:100`. The page is 1578 × 2271 with `pageMargin*` 40, `breaks:auto`, `header/footer:none` and `svgViewBox:true`. It is placed on a 157.8 × 227.1 mm (ipad-11) PDF page.
- **accents:** the same page with accented syllables.
- **fixture40:** the checked-in `scale:40` SVG on A4.

A heading line, "Kýrie eléison — cǽlum, cœli: á é í ó ú ǽ œ", is drawn by the PDF library itself in regular and italic, as B6b headings will be.

| Measure | (ii) pdf-lib walker | (i) pdfkit + svg-to-pdfkit, stroke pre-pass | (i) as-is |
|---|---|---|---|
| MediaBox on ipad-11 (expected 447.30709 × 643.74803) | exact (error 0 pt) | error 5e-7 pt (pdfkit writes 6 decimals) | same |
| MediaBox on A4 (fixture40) | exact | error 4.5e-7 pt | same |
| Image XObjects | 0 | 0 | 0 |
| `<use>` resolved (primary / fixture40) | 197/197, 384/384 (walker count) | no warnings; paint ops match | same |
| Paint operators vs SVG drawables (primary / fixture40) | 649/649, 1272/1272 | 649/649, 1272/1272 | 649/649 (strokes missing) |
| Font objects in the PDF | Liberation Serif subsets only (4: the spike embeds every style eagerly) | Liberation Serif, Liberation Serif Italic | same |
| Music font embedded | none (Leipzig drawn as paths) | none | none |
| Accented text extractable (pdf.js `getTextContent`) | Ký, rí, lǽ, sœn., ú, lé and the full heading line: all found | all found | all found |
| Misplaced ink vs SVG at 144 dpi (dark pixels with no dark pixel within 1 px in the other render) | 1,432 / 67,754 (2.1 %): one staff hairline per system snapping to a different pixel row | 1,432 (identical to ii) | 39,154 (57.8 %) |
| Misplaced ink at 288 dpi | **0** / 281,661 | **0** | 144,449 (51.3 %) |
| pixelmatch at 288 dpi (threshold 0.1, anti-aliasing excluded) | 5,004 px (1.8 % of ink) | 5,010 px | 93,473 px |
| PDF size (primary) | 41,026 B | 30,403 B | 27,383 B |
| Runs in a Chromium module worker (Playwright) | yes, 56–79 ms/page | ESM build: yes, 67–112 ms. Standalone: **no** (`Dynamic require of "url"`) | |
| Browser chunk, esbuild ESM minified (raw / gzip) | 1,380,775 / **549,661** B. Without pdf-lib: 995,125 / 385,738 B. With the fontkit-2 adapter: 808,043 / 333,452 B (without pdf-lib: 153,642 B) | ESM: 604,079 / **235,667** B. Standalone: 740,891 / 270,578 B | |

**Comparison method.** The SVG was rendered by resvg with only the Liberation Serif files loaded. The PDF was rendered by pdf.js 6.4.299 on `@napi-rs/canvas`. A 14 pt band at the top and bottom, where the heading test lines sit, is excluded from the comparison. Results are in `build/s34/out*/results.json`.

PDF sha256 for the accents page:
- pdf-lib: `69382ce0…49cc6`
- pdfkit with the stroke pre-pass: `ca1162a2…1cca2`
- pdfkit as-is: `1a541600…c02`

**Comparison images** (`s34-assets/`): the first system of the accents page at 144 dpi.
- `accents-sys1-svg.png` is the preview path (SVG with Liberation Serif).
- `accents-sys1-pdf-lib.png` is route (ii). The pdfkit render with the pre-pass is pixel-identical to it in misplaced-ink terms, so it is not stored.
- `accents-sys1-pdfkit-raw.png` is route (i) without the pre-pass: no staff lines, stems or barlines.
- `accents-sys1-pdf-lib-diff.png` is the pixelmatch map. Red is hairline anti-aliasing; there is no glyph or text displacement.

### Maintenance (2026-10-09)

| Package | Last npm release | Repository activity | Open issues + PRs |
|---|---|---|---|
| pdf-lib 1.17.1 | 2021-11-06 | last commit 2021-11-12 (dormant) | 318 |
| @pdf-lib/fontkit 1.1.1 | 2020-11-28 | Hopding/fontkit, pushed 2023-12 | 5 |
| pdfkit 0.20.2 | 2026-08-30 | active (pushed 2026-10-08) | 332 |
| svg-to-pdfkit 0.1.8 | 2019-11-24 | recent commits (2026-10-03), no release since 2019 | 65 |
| fontkit 2.0.4 | 2024-08-09 | active | 162 |

pdf-lib is dormant, but it is already the project's PDF dependency (quick export). The walker uses only its stable public API: `drawSvgPath`, `drawText`, `pushOperators`, `concatTransformationMatrix` and `embedFont`.

## Walker (route ii): supported subset

Source: `web/scripts/spike-pdf/walker.ts` and `xml.ts`. Workers have no `DOMParser`, so `xml.ts` is a strict, minimal parser. It rejects DOCTYPE and declarations.

- **Elements:**
  - `svg` (root and nested; `viewBox`, `x`, `y`, `width`, `height` in user units or %, scaled with xMidYMid meet);
  - `g`; `defs` and `symbol` (drawn only through `use`);
  - `use` (`xlink:href` or `href` to `#id`, plus `x` and `y`);
  - `path` (`d`, through pdf-lib `drawSvgPath`, which handles M L H V C S Q T A Z in absolute and relative form);
  - `rect` (no `rx`); `ellipse`; `circle`; `polyline`; `polygon`;
  - `text` and `tspan` (nested runs);
  - `style`, `desc`, `title` and `metadata` are ignored.
  - Anything else is counted in `stats.unsupported` and skipped. B2 should turn that count into an error.
- **Attributes:**
  - `transform`: translate, scale, matrix, rotate (with centre), skewX, skewY;
  - `fill`, `stroke` and `color`: none, currentColor, black, white, #rgb, #rrggbb, rgb();
  - `stroke-width`, `stroke-linecap`, `stroke-linejoin`;
  - `font-size`, `font-style`, `font-weight`, `text-anchor` (start, middle, end, measured with the embedded face);
  - `x` and `y` on `text` and on the first run of a `tspan`; `id`; `class`.
- **Verovio's fixed stylesheet is applied by rule, not parsed:**
  - `ellipse, path, polygon, polyline, rect {stroke:currentColor}` with the default stroke width 1;
  - `g.ending, g.fing, g.reh, g.tempo` are bold;
  - `g.dir, g.dynam, g.mNum` are italic;
  - `g.label` is normal weight.
- **Not supported:** `dx`, `dy`, `rotate` and `textLength` on text, `letter-spacing`, `opacity`, gradients, `clipPath`, `mask`, `image`, `foreignObject`, external `href`s and `style` attributes. None of these occur in Verovio 6.3.0 output for the Kyrie pages.
- **Coordinate mapping.** Paper space is y-down, so `pdf = [1 0 0 −1 0 H] ∘ CTM`. Each primitive is emitted as `q`, then `cm(CTM ∘ flipY)` (which cancels `drawSvgPath`'s built-in `scale(1,−1)`), then the path, then `Q`. Text uses `cm(CTM ∘ translate(x,y) ∘ flipY)` and `drawText` at the origin.

## Re-running

Run from `web/`, after the spike-packages commit:

```sh
node scripts/spike-pdf/render.ts ../build/s34/times.svg            # add --accents and/or --liberation
node scripts/spike-pdf/metrics.ts ../build/s34/verovio-Times.xml ../build/s34-fonts/LiberationSerif-Regular.ttf
node scripts/spike-pdf/measure.ts ../build/s34/out primary=../build/s34/times.svg accents=../build/s34/times-acc.svg \
  fixture40=src/lib/export-layout/__fixtures__/kyrie-ix-verovio-page1.svg@210x297   # RENDER_SCALE=4 for 288 dpi
sh scripts/spike-pdf/bundle.sh ../build/s34/bundle
node scripts/spike-pdf/browser-check.ts ../build/s34/bundle ../build/s34/times-acc.svg
node_modules/.bin/tsc -p scripts/spike-pdf/tsconfig.json
```

`verovio-Times*.xml` come from `https://github.com/rism-digital/verovio/tree/version-6.3.0/data/text`. The fonts come from the tarball above.
