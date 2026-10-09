# ENG Review: Export layout editor + LilyPond-to-MEI conversion (spec + Plans A/B/C)

Reviewer: claudekit-eng-reviewer (Opus), 2026-10-08. Branch `codex/alleluia-verse-matches` @ 7b59595.
Inputs reviewed in full:
- `docs/superpowers/specs/2026-10-06-export-layout-editor-design.md` (cited as **S:line**)
- `docs/superpowers/plans/2026-10-06-export-layout-implementation-plan.md` (**P0:line**)
- `docs/superpowers/plans/2026-10-06-mei-conversion-plan.md` (**PA:line**)
- `docs/superpowers/plans/2026-10-06-export-editor-plan.md` (**PB:line**)
- `docs/superpowers/plans/2026-10-06-export-rollout-plan.md` (**PC:line**)
- Kyrie IX experiment at `/Users/npadley/.codex/visualizations/2026/10/06/01a10f81-7606-7733-b9d5-b66fceed337e/kyrie-ix-experiment/` and its extraction frontend clone at `/private/tmp/kyrie-ly-to-musicxml/` (commit 5adbd4d).

**Settled decision (user, 2026-10-08):** MEI/Verovio reflow is v1. The target use: an organist sets page size, staff size and systems per page, and the music reflows. The output is printed on custom paper or read in an iPad app such as forScore. This review does not reopen that choice. Server-side LilyPond is mentioned only as the fallback named in §7 if gate G1 or G2 fails.

**Overall: 4.6/10.** The architecture direction and the guardrails are good. The packet is not executable by Sonnet/Haiku as written. 12 of 20 tasks are too large and must be split. 5 depend on decisions nobody has made yet. About 40 types are named but never defined. 24 references to the codebase are wrong or stale. The most serious problem: the pilot score is one of only 2 of the 859 sources that lack the house-style "voice-line" voice (§3, C1).

---

## 1. Scores

| Dimension | Score | What would make it 10 |
|---|---|---|
| Data flow | 5/10 | Freeze concrete TS/Python types (given in §5). Add `target`/`hash` to `ExportRun` so the selection can find conversions. Pin Verovio's unit system (`scale: 100`, page in 0.1 mm), so that "staff 7.2 mm" is real. |
| Failure modes | 6/10 | The listed failure modes are good. Missing: what happens when the Verovio WASM chunk fails to load on iPad Safari; Verovio silently ignoring `<pb>` under `breaks="line"`; text-font metrics Verovio cannot honour; e2e fixture leaking into the production manifest. Add each, with a mitigation. |
| Edge cases & invariants | 5/10 | Name the corpus realities: the 5th hidden `voiceLines` voice (857/859 files), transparent-notehead glissando endpoints (92 files, 261 calls), `\quil` (45 files), blank `_` lyric tokens, `\set stanza` markers, custom page sizes, zero-margin screen pages. Then turn each into a fixture. |
| Test matrix | 5/10 | Mutation/oracle tests are well conceived. But B8 asks Astro container tests to check keyboard focus, which they cannot do. Playwright has one Desktop Chrome project and no tablet project. There is no mechanism for test-only manifests in a production `dist`. The layout gate's "4+1 systems" expectation was measured at `scale:40`, which production will not use. |
| Rollback & migration | 7/10 | Good: removing a manifest entry is the rollback, and quick export stays independent. Missing: down-migration for `export-paper` → `LayoutSettings` v2, and what happens to saved custom settings when the profile version changes. |

---

## 2. Answers to the coordinator's experiment questions

### (a) How `lilypond-resolved.xml` was produced

It is **not** an event/engraver log. It is a **parse-time music-expression tree dump** made by python-ly's `ly/xml/xml-export.ily` (Wilbert Berendsen, 2015, **GPL**). The script ran through `ly-to-musicxml` (MIT, commit `5adbd4d9864ad18368ecb2e4909782ab4bbfd258`), whose `src/ly_to_musicxml/lilypond.py::_build_wrapper_source` does the following:
1. sets `relative-includes`, `\include`s `xml-export.ily`;
2. replaces `toplevel-book-handler` with `(obj->lily-xml book xml-outputter)`;
3. `\include`s the score and runs `lilypond -dno-print-pages wrapper.ly` with `cwd` set to the score's directory. It does not use `pipeline/typeset/lilypond.run`, so there is no sandbox and no `--include` path. The include directory was the copied `noh2.ily` beside the score.

What the tree gives: resolved absolute pitches (`RelativeOctaveMusic` already applied), explicit durations on every `NoteEvent` (`log`, `dots`, `numer/denom` scale), `SlurEvent`/`TieEvent` articulations, `BreathingEvent`s whose override procedure names identify `ly:breathing-sign::finalis` vs `divisio-minima`, `LineBreakEvent`s, `LyricEvent`s with `HyphenEvent`s, and `origin` with filename/line/char.

What it does **not** give: onsets. `convert.py` computes them by summing durations inside each `Voice` context, which works only because Kyrie's voices are flat `SequentialMusic`. It also lacks lyric-to-note association (the experiment zips "notes not inside a slur" against lyric events, which is the forbidden "lyric-to-slur heuristic", PA:15), the effective staff after `\change Staff` (which `\voiceLine` uses), and grob-level facts: notehead transparency from `\voiceLineStyle`, the `\quil` stencil, and `\hide Stem`. Voices were picked by source line numbers `['165','168','175','178']` (convert.py:25).

**Consequence for A2:** a Python re-implementation of LilyPond's iterators over this tree would be fragile: `\lyricsto` melisma rules, `\change Staff`, `<<>>` nesting, `\voiceLine`'s `<>` empty chords. The recommended strategy, which spike **S1** must confirm, is an **iteration-time listener**: extend the approach of `pipeline/typeset/listen.ily`, but as a new file. Reasons:
- `listen.ily` already emits exact rationals (`now-exact`, listen.ily:13).
- An engraver can read `associatedVoiceContext` in the `Lyrics` context. That gives the exact lyric anchor with no heuristic.
- `ly:context-find context 'Staff` at the time of each event gives the staff after `\change Staff`.
- Acknowledgers on `note-head-interface`, `stem-interface` and `breathing-sign-interface` give transparency, stencil and division type.
- It reuses `lilypond.run` (sandbox, timeout, include path) unchanged.

The tree dump can stay as an *optional* provenance cross-check. **Do not vendor `xml-export.ily`**: it is GPL and this repository is CC0 (`LICENSE`). That needs a user decision if anyone wants it.

So A2 is **not Sonnet-ready until S1 is done**. Once S1 delivers the listener grammar (§4, S1 output), A2 splits into Sonnet tasks.

### (b) What to check in as fixtures (destination paths)

| Experiment file | Check in? | Destination | Notes |
|---|---|---|---|
| `README.md` | Yes (edited) | `docs/superpowers/experiments/kyrie-ix/README.md` | Add the provenance block: ly-to-musicxml commit, python-ly `xml-export.ily` (GPL, **not vendored**), Verovio `6.3.0-425dd7b`, date. Remove `/private/tmp` paths. |
| `convert.py` | Yes, as reference only | `docs/superpowers/experiments/kyrie-ix/convert.py` | Outside `pipeline/`, `tools/` and `tests/`, so ruff/pytest ignore it. Header line: "reference only, line-number voice selection and slur-lyric heuristic are forbidden in production (PA:15)". |
| `validation.json` | Yes | `tests/fixtures/mei/kyrie-ix/experiment-validation.json` | Baseline counts: voices `[180,61,61,61]`, total `373/8`, 60 syllables, breaks `["7","109/8","85/4","233/8","38"]`, Verovio options. A2's baseline assertions read this file. |
| `lilypond-resolved.xml` (930 KB, absolute paths) | No (raw) | — | Instead, commit a derived file `tests/fixtures/mei/kyrie-ix/baseline-events.json` (≈40 KB): per voice, a list of `{onset, duration, kind, step, alter, octave}`. A Haiku task produces it with a one-off script that is not committed, after the paths are stripped. This is the independent oracle for A2's Kyrie test. |
| `kyrie-ix.mei` (91 KB) | Yes | `web/src/lib/export-layout/__fixtures__/kyrie-ix-experiment.mei` and `tests/fixtures/mei/kyrie-ix/experiment.mei` | Lets B4/B2/S2/S4 start **now** without waiting for A3. Label it "experimental, unapproved, never published". |
| `mei-1.svg`, `lilypond.svg` | Yes | `docs/superpowers/mockups/export-layout/assets/` | B1 mockup inputs. Also the S4 vector-PDF test SVG (`web/src/lib/export-layout/__fixtures__/kyrie-ix-verovio-page1.svg`). |
| `kyrie-ix.musicxml`, `musicxml-*.{svg,mei}`, `comparison*.html`, `build_comparison.py` | No | — | MusicXML is out of scope (S:48). The comparison HTML loads jsDelivr. |

### (c) Verovio options the prototype used

From `validation.json` and `comparison-template.html`:
`pageWidth: 2100` / `pageHeight: 2970` (browser: from the paper selector), `pageMarginLeft/Right/Top/Bottom: 100`, **`scale: 40`**, `breaks: "line"` (browser: selector, `line`/`auto`), `svgViewBox: true`, `header: "none"`, `footer: "none"`, `evenNoteSpacing: true`, `spacingLinear: 0.25`, `spacingNonLinear: 0.6`, `mnumInterval: 0`, **`unit: 7 | 9 | 12`** (Small/Medium/Large), **`systemMaxPerPage: 0 | 2..`** (0 = automatic), `inputFrom: "mei"`. The browser build was `verovio@6.3.0/dist/verovio-module.mjs` + `verovio.mjs` from jsDelivr.

**Critical implication:** at `scale: 40`, `unit 9` gives a staff about 2.9 mm tall, not 7.2 mm. Verovio page units are 0.1 mm at `scale: 100`, and the staff height is 8 × unit × 0.1 mm × scale/100. The "Letter/Large/Automatic → 4 + 1 systems" result in S:26 and the layout gate S:179 were therefore measured with a staff 0.4× its physical size. Production must use `scale: 100` with `unit = staffHeightMm / 0.8`, which gives far fewer systems per page. The 4+1 expectation cannot be reproduced and must be dropped (fix F-12).

---

## 3. Critical issues

- **C1. The pilot score is the least representative file in the corpus.**
  - Evidence: "first public release is a reviewed pilot starting with **Missa IX, Kyrie IX**" (S:13). A2 asserts four named layers (PA:86). In the corpus, 850/859 sources have **5** `\new Voice` contexts, 7 have 6, and only **2 have 4**. 857/859 include a third lower-staff voice `\voiceThree \global \voiceLines` with `\voiceLineStyle`, which makes noteheads transparent (noh2.ily:46-51). 92 files (261 calls) use `\voiceLine`, which does `\change Staff` plus a `\glissando` between hidden notes. `\quil` is used in 45 files and `\forceBreak` in 585. Kyrie IX uses none of `\voiceLine`, `\voiceLineStyle` or `\quil`.
  - Fix: In PA "A2. Full resolved extraction and lyric anchoring", **Files**, add: "Pilot fixture set is fixed now: `vol-5/missa-ix/kyrie_IX.ly` (4 voices, baseline), one file with an empty `voiceLines` voice (choose with `grep -L '\\voiceLine \"' $(grep -l 'global \\voiceLines' -r data/typeset/src) | head -1`), one file with ≥3 `\voiceLine` calls, one file with `\quil`, one file with `\divisioMaior`/`\divisioMaxima`. All five are extracted in A2 and encoded in A3. Kyrie IX alone cannot pass G1."

- **C2. A2's layer-name assertion cannot pass.**
  - Evidence: `assert {layer.name for layer in ir.layers} == {"chant", "alto", "tenor", "bass"}` (PA:86). In `kyrie_IX.ly:168,175,178` the voices are anonymous `\new Voice`. `alto`/`tenor`/`bass` are only variable names (`altoMusic`, …), which disappear at parse time.
  - Fix: Replace `assert {layer.name for layer in ir.layers} == {"chant", "alto", "tenor", "bass"}` with `assert [l.id for l in ir.layers] == ["up:chant", "up:#1", "down:#2", "down:#3"]` and `assert [l.voice_command for l in ir.layers] == ["voiceOne", "voiceTwo", "voiceOne", "voiceTwo"]`. Layer IDs are `"<staff-id>:<voice-id-or-#ordinal>"`, numbered in first-event order, as `listen.ily:5-11` already does.

- **C3. The extraction strategy is an open research question disguised as a task step.**
  - Evidence: "Implement a reviewed resolved listener/compiler-tree adapter… If event listeners cannot provide an association/property, add a compiler-tree extraction" (PA:92); "Generalize the trusted event listener or use a reviewed compiler-tree extractor" (S:114).
  - Fix: In P0 "## 5. Gates, decision log", add: "**S1 (Opus, before A2):** choose the iteration-time listener (`pipeline/typeset/mei/listen_full.ily`) as the extraction mechanism. Deliver its TSV grammar (§4 S1 of the eng review), a passing run on the five pilot fixtures, and proof that `associatedVoiceContext` gives the lyric anchor. A2 starts only after S1 is recorded."

- **C4. The break/cap solver is specified as a convergence loop with no algorithm.**
  - Evidence: "If renderer options alone cannot enforce the cap, inspect rendered system starts, add safe effective page breaks, rerender, and verify convergence. Bound iterations…" (PB:124).
  - Fix: Replace "If renderer options alone cannot enforce the cap, inspect rendered system starts, add safe effective page breaks, rerender, and verify convergence." with "Use the two-pass algorithm in eng-review §6 B4: pass 1 renders one very tall page (`pageHeight` 60000, `breaks` = `line` or `auto`) to obtain line breaks and system heights. A pure `paginate()` packs systems into pages under cap, height and forced page starts. Pass 2 encodes every `<sb>`/`<pb>` and renders with `breaks: \"encoded\"`. Then verify: per-page system count, height and anchors."

- **C5. Data flow break: the selection cannot find conversions.**
  - Evidence: `approvedConversionFor(target: string, renderHash: string, …)` (PB:90). `ExportRun` (web/src/lib/typeset.ts:122-128) has `count, key, label, letter, a4`, with no `target` and no `hash`. ExportBar serialises only that (ExportBar.astro:55).
  - Fix: In PB "B3", **Files**, add: "Coordinator (B3a) adds `readonly target: string | null; readonly hash: string | null;` to `ExportRun` in `web/src/lib/typeset.ts`, fills them in `exportRuns()` from `seg.target` and `seg.render.hash`, and updates `typeset.test.ts` expectations. Quick export ignores the new fields."

- **C6. Text-font control assumes Verovio can lay out arbitrary text fonts.**
  - Evidence: "Bundled serif default and bundled sans-serif alternative. The same font assets and metrics must be used for lyrics/headings in preview and PDF" (S:71).
  - Fix: In P0 "## 5", add: "**S3 (Opus):** determine whether Verovio 6.3 lays out lyric text using metrics for a font other than its built-in text-font tables. If not, v1 ships one text font for lyrics (the font whose metrics Verovio uses, mapped to a bundled, license-compatible face for PDF). The serif/sans choice applies only to headings, which we lay out ourselves. Record this in the decision log before B2."

- **C7. Custom page sizes are missing, and they are the primary use case.**
  - Evidence: `paper: 'letter' | 'a4' | 'a5'` (P0:117); "One margin value, 8–25 mm" (S:68, PB:16).
  - Fix: Replace the `LayoutSettings` block at P0:116-122 with the v2 type in §5.1. It adds `paper: 'custom'` plus device presets, `customSize {widthMm, heightMm}` bounded 76–432 mm, `marginMm` 0–25 (screen presets default 3 mm), `staffUnit` 6–15, `maxSystems` 1–12, `fillPage`. Also add to PB Global Constraints: "PDF MediaBox = exactly `widthMm × heightMm` × 72/25.4 pt (no rounding beyond float64); the Verovio page is the usable area rounded **down** to 0.1 mm and placed at the margin origin."

- **C8. Fixed-layout parts have no source for the new sizes.**
  - Evidence: "Their original PDF page is proportionally fitted" (S:80). LilyPond renders only `letter.pdf` and `a4.pdf` (render.py:41 `FILES`).
  - Fix: In PB "B6", add: "Fixed source PDF choice: use `a4.pdf` when the target aspect ratio (h/w) is ≥ 1.35, otherwise `letter.pdf`; landscape and custom/device pages fit the chosen portrait page uniformly, centred in the usable rect. Record `sourcePaper` in `FixedCanonicalPage`."

- **C9. There is no test-only manifest mechanism, and the e2e suite runs against the production build.**
  - Evidence: "Fixture activation is test-only and cannot cause the production manifest to approve a score" (PB:228). `playwright.config.ts` serves the production `dist` through `wrangler pages dev`.
  - Fix: In PB "B10", add: "Fixture manifest is selected at build time only by `PUBLIC_MEI_MANIFEST=fixture` read in `web/src/lib/mei.ts`. `with-public-env.ts` refuses that value when `PUBLIC_ASSET_BASE` is the production base. CI runs a second `pnpm build` into `dist-e2e/` for the export-layout spec only. A unit test asserts that the production manifest import path never resolves to `__fixtures__`."

- **C10. Component tests cannot do what B8 asks.**
  - Evidence: "Write failing component/browser tests for keyboard opening/closing and focus return" (PB:202). Component tests use `AstroContainer.renderToString` (ExportBar.test.ts:1-30), which is static HTML.
  - Fix: Replace "Write failing component/browser tests for keyboard opening/closing and focus return, narrow viewport controls," with "Write failing **Playwright** tests (`web/e2e/export-layout.e2e.ts`, `test.use({ viewport: { width: 390, height: 844 } })` for narrow) for keyboard opening/closing and focus return, narrow viewport controls,". Container tests assert only static markup: labels, `aria-*`, disabled states.

---

## 4. Spikes that a strong model (or the user) must finish before handing tasks down

Each spike is one Opus session (S5 and S6 can be Sonnet). Each must output a decision record in `docs/superpowers/plans/export-layout-decisions.md` plus checked-in proof fixtures. **No downstream task starts until its spike's decision is recorded.**

| ID | Owner | Blocks | Question | Required output |
|---|---|---|---|---|
| **S0** | Haiku | everything | Check in the experiment fixtures (§2b). | Files at the §2b paths, with provenance README. |
| **S1** | **Opus** | A2 | Extraction: iteration listener vs tree dump. Can `associatedVoiceContext` anchor lyrics exactly? Does `\voiceLine` produce note events with the effective staff? Do the acknowledgers see `transparent`/`stencil`? | (1) Decision. (2) `pipeline/typeset/mei/listen_full.ily` prototype. (3) **The TSV grammar**: one row per record, columns fixed per `kind` (draft below). (4) Raw TSV outputs for the 5 pilot files in `tests/fixtures/mei/extraction/*.tsv`, so A2b–A2d can run **without LilyPond**. |
| **S2** | **Opus** | B4 | Verovio layout control: are `systemMaxPerPage`, `breaks: line/auto/encoded`, `unit`, `scale:100`, `pageWidth` in 0.1 mm, `justifyVertically` and `<pb>`/`<sb>` honoured as assumed? How do we read system geometry (SVG `g.system` bbox + first measure id)? Does the Python `verovio==6.3.0` wheel produce byte-identical SVG to the npm 6.3.0 WASM build? | Option table with the verified behaviour of each. Confirmation (or replacement) of the two-pass algorithm. A fixture `web/src/lib/export-layout/__fixtures__/s2-pass1-letter-medium.json` of measured systems. A determinism note: if Python and WASM differ, A5 evidence must be rendered with WASM (Node) only. |
| **S3** | **Opus** | B2, B6 | Text fonts: which metrics does Verovio use for `<syl>`? Can a custom text font change layout? | "Lyrics font = X (license, file, hash); headings fonts = serif Y / sans Z", or "one font for v1". |
| **S4** | **Opus** | B2, B6 | Vector PDF: (i) `pdfkit` standalone build + `svg-to-pdfkit` in a Vite module worker; (ii) `pdf-lib` + `@pdf-lib/fontkit` + a small walker over Verovio's SVG subset (`svg,g,path,use,symbol,defs,rect,polyline,polygon,ellipse,text,tspan`) using `page.drawSvgPath`. Test both on the Kyrie page SVG. | Chosen adapter, pinned versions, gzip chunk size, and a passing `usesExactPageDimensions` on a 160.5×229.8 mm page. Note: Verovio draws music glyphs as `<symbol>` paths, so **no music font embedding is needed**; only text needs a font. |
| **S5** | Sonnet | A3 | MEI 5.0 schema validation: `lxml.etree.RelaxNG` on `mei-CMN.rng` vs `jing` (Java). | Chosen validator. Vendored schema at `data/typeset/mei/schemas/mei-5.0/` with sha256, `resolve_entities=False, no_network=True`. Pass/fail on the experiment MEI. |
| **S6** | Sonnet | B4, B7 | Bundling: `verovio` npm ESM/WASM inside `new Worker(new URL("../workers/export-layout.worker.ts", import.meta.url), {type:"module"})` under Astro 7 static build. | Working import snippet, chunk sizes (Cloudflare Pages per-file limit 25 MiB), and proof that `dist/` pages without the editor do not reference the chunk. Also iPad Safari module-worker support. |

**S1 TSV grammar draft** (Opus finalises; A2b implements the parser against it). Columns are tab-separated. `onset` is an exact Guile rational (`"109/8"`, `"0"`). `loc` is `file:line:col` with a repository-relative file.
```
onset  layer  staff  note   step alter octave log dots scale_num scale_den dur loc
onset  layer  staff  rest   dur loc
onset  layer  staff  skip   dur loc
onset  layer  staff  head   transparent(0|1) stencil(normal|quilisma)      # acknowledger, follows its note row
onset  layer  staff  stem   transparent(0|1)
onset  layer  staff  tie    loc
onset  layer  staff  slur   dir(-1|1) loc
onset  layer  staff  gliss  loc                                            # \voiceLine start
onset  layer  staff  div    kind(finalis|maxima|maior|minima) loc         # from BreathingSign stencil name
onset  -      -      break  loc                                            # line-break-event (\forceBreak)
onset  lyrics:<ctx> <assoc-layer>  lyric  text stanza loc                  # text may be ""
onset  lyrics:<ctx> <assoc-layer>  hyphen
onset  lyrics:<ctx> <assoc-layer>  extender
onset  -      <staff> key    fifths loc
onset  -      <staff> clef   glyph position loc
```

---

## 5. Missing type definitions (paste-ready)

Names follow the plans. Where a plan named a type without defining it, the definition here is authoritative once the coordinator freezes it in task A1a/B3a.

### 5.1 TypeScript — `web/src/lib/export-layout/types.ts`

Compatible with `web/tsconfig.json` (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Uses no `any`.

```ts
// ---------------------------------------------------------------- settings ---
export type PaperPresetId =
  | 'letter' | 'a4' | 'a5'
  | 'ipad-13' | 'ipad-11' | 'ipad-mini'   // screen presets (forScore etc.)
  | 'custom';
export type Orientation = 'portrait' | 'landscape';
export type PartKind = 'mei' | 'scan' | 'fixed';
export type LinePolicy = 'original' | 'automatic';
export type MusicFontId = 'leipzig' | 'bravura';
export type TextFontId = 'serif' | 'sans';
export type LyricSizeId = 'small' | 'medium' | 'large';
export type SpacingId = 'compact' | 'normal' | 'spacious';

/** Portrait-normalised physical size: widthMm <= heightMm. */
export interface PageSize { readonly widthMm: number; readonly heightMm: number }

export interface LayoutSettings {
  readonly version: 2;
  readonly paper: PaperPresetId;
  /** Non-null iff paper === 'custom'. Each side in [PAGE_MIN_MM, PAGE_MAX_MM]. */
  readonly customSize: PageSize | null;
  readonly orientation: Orientation;
  /** [0, 25] in 0.5 mm steps. Default 12 for paper presets, 3 for screen presets. */
  readonly marginMm: number;
  /** Verovio `unit` at scale 100; staff height = staffUnit * 0.8 mm. Integer 6..15 (4.8..12.0 mm). Default 9 (7.2 mm). */
  readonly staffUnit: number;
  readonly musicFont: MusicFontId;
  readonly textFont: TextFontId;
  readonly lyrics: LyricSizeId;
  readonly spacing: SpacingId;
  /** null = automatic; else integer 1..12 (a maximum, never an exact count). */
  readonly maxSystems: number | null;
  /** Spread systems to fill each page (Verovio justifyVertically). Default true for screen presets. */
  readonly fillPage: boolean;
  readonly linePolicy: LinePolicy;
}

export const PAGE_MIN_MM = 76;   // 3 in
export const PAGE_MAX_MM = 432;  // 17 in (tabloid long side)
export const MARGIN_MIN_MM = 0;
export const MARGIN_MAX_MM = 25;
export const STAFF_UNIT_MIN = 6;
export const STAFF_UNIT_MAX = 15;
export const MAX_SYSTEMS_LIMIT = 12;

/** Portrait sizes. Screen sizes = native px / ppi * 25.4, verify on device in C2. */
export const PAPER_PRESETS: Readonly<Record<Exclude<PaperPresetId, 'custom'>, PageSize & { readonly screen: boolean; readonly label: string }>> = {
  letter:      { widthMm: 215.9, heightMm: 279.4, screen: false, label: 'Letter' },
  a4:          { widthMm: 210,   heightMm: 297,   screen: false, label: 'A4' },
  a5:          { widthMm: 148,   heightMm: 210,   screen: false, label: 'A5' },
  'ipad-13':   { widthMm: 197.0, heightMm: 262.9, screen: true,  label: 'iPad 12.9–13″' }, // 2048×2732 @264
  'ipad-11':   { widthMm: 160.5, heightMm: 229.8, screen: true,  label: 'iPad 11″' },      // 1668×2388 @264
  'ipad-mini': { widthMm: 115.9, heightMm: 176.6, screen: true,  label: 'iPad mini' },     // 1488×2266 @326
};

/** Physical page after orientation is applied. */
export interface PhysicalPage { readonly widthMm: number; readonly heightMm: number }

export interface RectMm { readonly xMm: number; readonly yMm: number; readonly widthMm: number; readonly heightMm: number }

export type SettingsNoticeCode = 'INVALID_VALUE_RESET' | 'UNKNOWN_VERSION_RESET' | 'MIGRATED_EXPORT_PAPER' | 'CUSTOM_SIZE_CLAMPED';
export interface SettingsNotice { readonly code: SettingsNoticeCode; readonly field: keyof LayoutSettings | null; readonly message: string }
export interface NormalizedSettings { readonly settings: LayoutSettings; readonly notices: readonly SettingsNotice[] }

// ------------------------------------------------------------------- parts ---
export interface BreakOverride {
  readonly boundaryId: string;
  readonly sourceRevision: string;   // ConversionManifestPart.sourceRevision
  readonly kind: 'system' | 'page';
}

export interface PartHeading {
  readonly label: string;
  readonly rubric: string | null;
  readonly rubricTranslation: string | null;
  readonly credit: string | null;
}

interface ExportPartBase {
  /** Unique within one export: ExportSegment.id + ":" + run index. */
  readonly id: string;
  readonly kind: PartKind;
  readonly label: string;
  readonly heading: PartHeading | null;
  /** Source systems this part covers (selection/ceiling only; never output system counts). */
  readonly sourceSystemCount: number;
  readonly sourceRevision: string;   // render hash for mei/fixed, first stem for scan
}

export interface SafeBoundary {
  readonly id: string;               // e.g. "b017"
  readonly onset: string;            // reduced rational, whole notes
  readonly sourceBreak: boolean;     // a \forceBreak in the source
  readonly division: 'finalis' | 'maxima' | 'maior' | 'minima' | null;
  readonly measureId: string;        // MEI xml:id of the <measure> that ENDS at this boundary
}

export interface MeiExportPart extends ExportPartBase {
  readonly kind: 'mei';
  readonly target: string;           // e.g. "movement:ordinarium-missae-ix/kyrie"
  readonly renderHash: string;       // 32-hex, as data/typeset/manifest.json
  readonly conversion: ApprovedConversion;
}
export interface ScanExportPart extends ExportPartBase {
  readonly kind: 'scan';
  /** Full URL stems as ExportSegment.stems; fetch `${stem}@2x.png`. */
  readonly stems: readonly string[];
}
export interface FixedExportPart extends ExportPartBase {
  readonly kind: 'fixed';
  readonly target: string;
  readonly renderHash: string;
  readonly letterPdf: string;
  readonly a4Pdf: string;
}
export type ExportPart = MeiExportPart | ScanExportPart | FixedExportPart;

/** A loaded MEI part ready for layout (B4 input). */
export interface MeiPart {
  readonly part: MeiExportPart;
  readonly meiXml: string;           // verified bytes decoded as UTF-8
}

export interface PartCapabilities {
  readonly paper: true;
  readonly margins: true;
  readonly staffSize: boolean;
  readonly fonts: boolean;
  readonly lyricsSize: boolean;
  readonly spacing: boolean;
  readonly linePolicy: boolean;
  readonly maxSystems: boolean;      // scan: true (counts whole images); fixed: false
  readonly manualBreaks: boolean;
  readonly label: 'Customizable typeset' | 'Original scan' | 'Fixed typeset layout';
}

// --------------------------------------------------------- conversion data ---
export interface ApprovedConversion {
  readonly digest: string;           // conversion digest (sha256 hex)
  readonly meiUrl: string;           // immutable URL under PUBLIC_ASSET_BASE/mei/<digest>/score.mei
  readonly meiSha256: string;
  readonly sourceRevision: string;
  readonly profile: string;          // "accompaniment-v1"
  readonly verovio: string;          // "6.3.0-425dd7b"
  readonly boundaries: readonly SafeBoundary[];
  readonly capabilities: { readonly manualBreaks: boolean; readonly bravura: boolean };
}
export interface ConversionManifestPart extends ApprovedConversion {
  readonly target: string;
  readonly renderHash: string;
}
export interface ConversionManifest {
  readonly schemaVersion: 1;
  readonly parts: readonly ConversionManifestPart[];
}
export type ConversionLookup = (target: string, renderHash: string) => ApprovedConversion | null;

/** Pure input to snapshotSelection, built from ExportBar's checked boxes (no DOM in pure code). */
export interface SelectionInput {
  readonly title: string;
  readonly segments: readonly {
    readonly segmentId: string;      // ExportSegment.id
    readonly label: string;
    readonly rubric: string | null;
    readonly rubricTranslation: string | null;
    readonly stems: readonly string[];
    readonly runs: readonly {
      readonly count: number;
      readonly key: string | null;
      readonly label: string | null;
      readonly target: string | null;   // requires ExportRun change (C5)
      readonly hash: string | null;
      readonly letter: string | null;
      readonly a4: string | null;
      /** The reader currently sees scans for this run (showsScans(key) in ExportBar). */
      readonly showsScans: boolean;
    }[];
  }[];
}

// ------------------------------------------------------------------ layout ---
export interface EffectiveBreak {
  readonly boundaryId: string;
  readonly kind: 'system' | 'page';
  readonly origin: 'user' | 'source' | 'automatic';
}
export interface EffectiveBreaks {
  readonly partId: string;
  readonly breaks: readonly EffectiveBreak[];     // sorted by boundary onset
  readonly droppedOverrides: readonly { readonly override: BreakOverride; readonly reason: 'STALE_ANCHOR' | 'UNSAFE_ANCHOR' }[];
}

export interface ResourceLimits {
  readonly maxMeiBytes: number;
  readonly maxEvents: number;
  readonly maxPages: number;
  readonly jobTimeoutMs: number;
}
export interface LayoutConstraints {
  readonly page: PhysicalPage;
  readonly usable: RectMm;
  readonly maxSystems: number | null;
  readonly staffHeightMm: number;
  readonly requiredBreaks: readonly EffectiveBreak[];
  readonly expectedEventIds: ReadonlySet<string>;
}
export interface RenderContext {
  readonly token: number;
  readonly fonts: FontProfile;
  readonly limits: ResourceLimits;
  readonly isCancelled: () => boolean;
  readonly toolkit: VerovioLike;
}
/** Minimal Verovio surface we use (lets tests inject a fake). */
export interface VerovioLike {
  setOptions(options: Readonly<Record<string, string | number | boolean>>): void;
  loadData(data: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
  getLog(): string;
  getVersion(): string;
}

export interface SystemGeometry {
  readonly index: number;                // 0-based within part
  readonly firstBoundaryId: string | null; // boundary the system starts after; null for first
  readonly topMm: number;                // relative to the page content origin
  readonly heightMm: number;
}
export interface MeiPageLayout {
  readonly svg: string;                  // raw Verovio SVG (sanitized later in B5)
  readonly systems: readonly SystemGeometry[];
}
export interface MeiLayout {
  readonly partId: string;
  readonly pages: readonly MeiPageLayout[];
  readonly effectiveBreaks: EffectiveBreaks;
  readonly staffHeightMm: number;        // measured
  readonly verovioOptions: Readonly<Record<string, string | number | boolean>>;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export type LayoutDiagnosticCode =
  | 'UNSATISFIABLE_LAYOUT'   // constraints cannot all hold (e.g. system taller than usable height)
  | 'SYSTEM_TOO_TALL'
  | 'CAP_EXCEEDED'
  | 'STALE_ANCHOR'
  | 'UNSAFE_ANCHOR'
  | 'CONTENT_CLIPPED'
  | 'EVENT_MISSING'          // an expected xml:id absent from rendered SVG
  | 'STAFF_HEIGHT_MISMATCH'  // measured vs requested > 0.1 mm
  | 'RENDERER_FAILED'
  | 'RENDERER_LOAD_FAILED'
  | 'ASSET_MISSING'
  | 'ASSET_HASH_MISMATCH'
  | 'UNSAFE_SVG'
  | 'FONT_UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'FIXED_PAGE_COUNT_MISMATCH'
  | 'SCAN_TOO_LARGE'
  | 'CANCELLED'
  | 'TIMEOUT';
export interface LayoutDiagnostic {
  readonly code: LayoutDiagnosticCode;
  readonly severity: 'error' | 'warning';
  readonly partId: string | null;
  readonly boundaryId: string | null;
  readonly message: string;              // plain-language, user-visible
}

// ---------------------------------------------------------- canonical pages ---
export interface HeadingBlock {
  readonly lines: readonly { readonly text: string; readonly font: 'heading' | 'rubric' | 'translation'; readonly sizePt: number; readonly baselineMm: number }[];
  readonly rect: RectMm;
}
export interface Transform { readonly scaleX: number; readonly scaleY: number; readonly translateXMm: number; readonly translateYMm: number }

interface CanonicalPageBase {
  readonly index: number;                // 0-based in export
  readonly widthMm: number;
  readonly heightMm: number;
  readonly partId: string;
  readonly printable: RectMm;            // page minus margins
  readonly content: RectMm;              // printable minus heading reservation
  readonly heading: HeadingBlock | null;
  readonly footer: HeadingBlock | null;  // credit/attribution
}
export interface MeiCanonicalPage extends CanonicalPageBase {
  readonly kind: 'mei';
  readonly svg: SanitizedSvg;
  readonly svgPlacement: Transform;      // Verovio page -> content rect
  readonly systemCount: number;
  readonly boundaries: readonly { readonly boundaryId: string; readonly rect: RectMm }[];
}
export interface ScanCanonicalPage extends CanonicalPageBase {
  readonly kind: 'scan';
  readonly images: readonly { readonly stem: string; readonly rect: RectMm; readonly pxWidth: number; readonly pxHeight: number }[];
  readonly systemCount: number;          // complete images
}
export interface FixedCanonicalPage extends CanonicalPageBase {
  readonly kind: 'fixed';
  readonly sourceUrl: string;
  readonly sourcePaper: 'letter' | 'a4';
  readonly sourcePageIndex: number;
  readonly sourceSizePt: { readonly width: number; readonly height: number };
  readonly transform: Transform;         // scaleX === scaleY always
  readonly systemCount: null;
}
export type CanonicalPage = MeiCanonicalPage | ScanCanonicalPage | FixedCanonicalPage;

export interface LayoutRequest {
  readonly token: number;
  readonly title: string;
  readonly parts: readonly ExportPart[];
  readonly settings: LayoutSettings;
  readonly overrides: Readonly<Record<string, readonly BreakOverride[]>>; // by part id
}
export interface LayoutResult {
  readonly token: number;
  readonly partIds: readonly string[];
  readonly digests: { readonly input: string; readonly settings: string; readonly fonts: string; readonly renderer: string; readonly result: string };
  readonly effectiveBreaks: readonly EffectiveBreaks[];
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly pages: readonly CanonicalPage[];
  readonly complete: boolean;            // false => download disabled
}

// ------------------------------------------------------------------ worker ---
export type LayoutWorkerRequest =
  | { readonly type: 'layout'; readonly request: LayoutRequest }
  | { readonly type: 'cancel'; readonly token: number };
export type LayoutWorkerResponse =
  | { readonly type: 'progress'; readonly token: number; readonly partId: string; readonly done: number; readonly total: number }
  | { readonly type: 'result'; readonly token: number; readonly result: LayoutResult }
  | { readonly type: 'error'; readonly token: number; readonly partId: string | null; readonly code: LayoutDiagnosticCode; readonly message: string };
export type PdfWorkerRequest = { readonly type: 'pdf'; readonly token: number; readonly result: LayoutResult };
export type PdfWorkerResponse =
  | { readonly type: 'progress'; readonly token: number; readonly done: number; readonly total: number }
  | { readonly type: 'pdf'; readonly token: number; readonly bytes: ArrayBuffer; readonly pageCount: number; readonly byteSize: number }
  | { readonly type: 'error'; readonly token: number; readonly code: LayoutDiagnosticCode; readonly message: string };

export interface PdfResult { readonly bytes: Uint8Array; readonly pageCount: number; readonly byteSize: number }

// ------------------------------------------------------------------ assets ---
export interface AssetLoader {
  /** Fetches and verifies sha256; rejects with Error('ASSET_HASH_MISMATCH: <url>') or Error('ASSET_MISSING: <url>'). */
  bytes(url: string, sha256: string | null): Promise<Uint8Array>;
}
export interface PreviewBitmap { readonly width: number; readonly height: number; readonly blob: Blob }

// ------------------------------------------------------------------- fonts ---
export type FontProfileId = `${MusicFontId}+${TextFontId}`;
export interface FontAsset { readonly family: string; readonly url: string; readonly sha256: string; readonly license: string; readonly bytes: Uint8Array }
export interface FontProfile {
  readonly id: FontProfileId;
  readonly musicFont: MusicFontId;       // passed to Verovio `font`
  readonly lyricFont: FontAsset;         // per S3 decision
  readonly headingRegular: FontAsset;
  readonly headingBold: FontAsset;
  readonly headingItalic: FontAsset;
  readonly metricsStrategy: 'verovio-builtin' | 'custom';
  readonly digest: string;
}

// --------------------------------------------------------------------- svg ---
export interface SanitizedSvg { readonly svg: string; readonly ids: readonly string[]; readonly namespace: string }
export interface SvgBounds { readonly widthMm: number; readonly heightMm: number; readonly contentBBox: RectMm }

// -------------------------------------------------------------- controller ---
export type ControllerPhase = 'idle' | 'loading' | 'rendering' | 'ready' | 'exporting' | 'error';
export interface ControllerState {
  readonly phase: ControllerPhase;
  readonly parts: readonly ExportPart[];
  readonly settings: LayoutSettings;
  readonly overrides: Readonly<Record<string, readonly BreakOverride[]>>;
  readonly requestToken: number;
  readonly result: LayoutResult | null;          // current, matching requestToken
  readonly previousResult: LayoutResult | null;  // shown while rendering
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly notices: readonly SettingsNotice[];
  readonly canDownload: boolean;                 // phase==='ready' && result?.token===requestToken && result.complete
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface WorkerLike { postMessage(message: unknown, transfer?: Transferable[]): void; terminate(): void; onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null }
export interface ControllerDependencies {
  readonly createLayoutWorker: () => WorkerLike;
  readonly createPdfWorker: () => WorkerLike;
  readonly storage: StorageLike | null;
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly saveFile: (bytes: Uint8Array, filename: string) => void;
  readonly limits: ResourceLimits;
}
export interface ExportController {
  open(parts: readonly ExportPart[]): void;
  updateSettings(settings: Partial<LayoutSettings>): void;
  setBreak(partId: string, override: BreakOverride | { readonly boundaryId: string; readonly kind: 'remove' }): void;
  resetLayout(): void;
  download(): Promise<void>;
  close(): void;
  subscribe(listener: (state: ControllerState) => void): () => void;
}
export interface Preferences {
  readonly version: 2;
  readonly settings: LayoutSettings;
  readonly overrides: Readonly<Record<string, readonly BreakOverride[]>>; // keyed by target
}
export interface PreferenceReadResult { readonly preferences: Preferences; readonly notices: readonly SettingsNotice[] }
export const PREFERENCES_KEY = 'export-layout-v2';
export const LEGACY_PAPER_KEY = 'export-paper';  // read-only migration; never deleted (quick export still uses it)

// ------------------------------------------------------------------ limits ---
export interface ResourceProfile {
  readonly version: number;
  readonly provisional: boolean;
  readonly limits: ResourceLimits;
  readonly maxAggregateEvents: number;
  readonly measuredOn: readonly { readonly device: string; readonly browser: string; readonly date: string }[];
  readonly rendererDigest: string;
  readonly fontDigest: string;
}
export interface BudgetInput { readonly meiBytes: readonly number[]; readonly eventCounts: readonly number[]; readonly sourceSystems: number; readonly predictedPages: number }
export type BudgetDecision =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly code: 'BUDGET_EXCEEDED' | 'SOURCE_CEILING'; readonly limit: string; readonly message: string };
```

**Mapping rules (put them in `settings.ts` docs and tests):**
- `paperDimensions(s)`: preset or `customSize`, then swap if `orientation === 'landscape'`.
- Verovio options at **`scale: 100`**: `pageWidth = floor((page.widthMm - 2*marginMm) * 10)`, `pageHeight` likewise minus the heading reservation, all `pageMargin* = 0` (we own the margins), `unit = staffUnit`, `lyricSize = {small:3.5, medium:4.5, large:5.5}`, `spacingSystem = {compact:2, normal:4, spacious:8}`, `font = 'Leipzig' | 'Bravura'`, `justifyVertically = fillPage`, `header/footer = 'none'`, `svgViewBox = true`, `mnumInterval = 0`, `evenNoteSpacing = true`, `spacingLinear 0.25`, `spacingNonLinear 0.6`. S2 verifies every name.
- `export-paper` migration: `'a4'` → `paper:'a4'`; anything else → `'letter'`. Never write `export-paper`.

### 5.2 Python — `pipeline/typeset/mei/model.py` and `diagnostics.py`

```python
# pipeline/typeset/mei/diagnostics.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

Severity = Literal["error", "warning", "info"]
DiagnosticCode = Literal[
    # audit / extraction
    "SOURCE_CHECK_FAILED", "UNKNOWN_INCLUDE", "COMPILE_FAILED", "EMPTY_SCORE", "UNKNOWN_FEATURE",
    "LYRIC_UNANCHORED", "VOICE_ENDS_UNEQUAL",
    # encoding
    "UNSUPPORTED_FEATURE", "UNSAFE_BOUNDARY", "SCHEMA_INVALID",
    # validation (A4)
    "VOICE_MISSING", "VOICE_EXTRA", "PITCH_MISMATCH", "ONSET_MISMATCH", "DURATION_MISMATCH",
    "ATTACK_MISMATCH", "TIE_MISMATCH", "SLUR_MISMATCH", "DIVISION_MISMATCH", "ENTRY_MARKER_MISMATCH",
    "ACCIDENTAL_DISPLAY_MISMATCH", "NOTEHEAD_MISMATCH", "ENDING_MISSING", "LYRIC_TEXT_MISMATCH",
    "LYRIC_ANCHOR_MISMATCH", "FRAGMENT_OVERLAP", "FRAGMENT_GAP", "RENDER_EVENT_MISSING",
    # review / manifest / publish
    "STALE_APPROVAL", "MATRIX_INCOMPLETE", "NOT_APPROVED", "HASH_MISMATCH", "UNSAFE_PATH",
    "TARGET_HASH_MISMATCH", "UNMATCHED_TARGET", "ASSET_MISSING", "KEY_COLLISION",
    # evidence geometry (flag only)
    "GEOMETRY_CLIPPING", "GEOMETRY_COLLISION",
]

@dataclass(frozen=True)
class SourceLocation:
    filename: str      # repo-relative POSIX, e.g. "data/typeset/include/noh2.ily"
    line: int          # 1-based
    column: int        # as LilyPond reports

@dataclass(frozen=True)
class Diagnostic:
    code: DiagnosticCode
    severity: Severity
    message: str
    source_location: SourceLocation | None = None
    event_ids: tuple[str, ...] = ()
    details: tuple[tuple[str, str], ...] = ()   # sorted key/value pairs; hashable

BLOCKING: frozenset[DiagnosticCode]  # = every "error"-severity code except GEOMETRY_*
```

```python
# pipeline/typeset/mei/model.py
from __future__ import annotations
from dataclasses import dataclass
from fractions import Fraction
from typing import Literal, Protocol
from pathlib import Path
from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation

IR_SCHEMA_VERSION = 1

def rational_to_str(value: Fraction) -> str:
    """Fraction(14,16) -> "7/8"; Fraction(0) -> "0/1"; Fraction(3) -> "3/1"."""
def rational_from_str(text: str) -> Fraction:
    """Accepts only r"-?\\d+/\\d+" with gcd 1 and denominator > 0; raises ValueError on "0.5", "7/8.0", "14/16"."""

Step = Literal["c", "d", "e", "f", "g", "a", "b"]
EventKind = Literal["note", "rest", "skip"]
Notehead = Literal["normal", "hidden", "quilisma"]
PrintedAccidental = Literal["none", "sharp", "flat", "natural", "double-sharp", "double-flat"]
DivisionKind = Literal["finalis", "maxima", "maior", "minima"]
LayerRole = Literal["chant", "accompaniment", "voice-line"]
SpanKind = Literal["tie", "slur", "voice-line"]
BoundaryReason = Literal["sustain-not-splittable", "slur-crosses", "voice-line-crosses",
                         "lyric-extender-crosses", "not-common-onset"]

@dataclass(frozen=True)
class Pitch:
    step: Step
    alter: Fraction          # semitones: Fraction(1) sharp, Fraction(-1) flat (LilyPond alteration * 2)
    octave: int              # scientific: middle C = 4

@dataclass(frozen=True)
class NotatedDuration:
    log: int                 # 0 whole, 1 half, 2 quarter, 3 eighth
    dots: int
    scale: Fraction          # 2*3/4 -> Fraction(3, 4); 1 when unscaled

@dataclass(frozen=True)
class StaffDef:
    id: str                  # LilyPond Staff id ("up", "down") or "staff#<n>"
    index: int               # 1-based, top to bottom
    clef_shape: Literal["G", "F", "C"]
    clef_line: int
    key_fifths: int

@dataclass(frozen=True)
class LayerDef:
    id: str                  # "<staff>:<voice-id or #ordinal>", e.g. "up:chant", "down:#3"
    home_staff_id: str
    ordinal: int             # first-event order, 0-based
    voice_command: Literal["voiceOne", "voiceTwo", "voiceThree", "voiceFour", "none"]
    role: LayerRole          # "chant" iff the Lyrics associatedVoice; "voice-line" iff all noteheads hidden

@dataclass(frozen=True)
class Event:
    id: str                  # f"{layer.ordinal}e{seq:04d}", stable for a source revision
    layer_id: str
    staff_id: str            # effective staff (differs from home after \change Staff)
    kind: EventKind
    onset: Fraction          # whole notes from score start
    duration: Fraction       # sounding/spacing duration incl. scale
    notated: NotatedDuration
    pitch: Pitch | None      # None for rest/skip
    printed_accidental: PrintedAccidental
    notehead: Notehead
    stem_visible: bool
    tie_to_next: bool
    location: SourceLocation

@dataclass(frozen=True)
class Span:
    id: str
    kind: SpanKind
    start_event_id: str
    end_event_id: str

@dataclass(frozen=True)
class LyricSyllable:
    id: str
    text: str                # "" for a blank `_` token
    onset: Fraction
    anchor_event_id: str | None   # None => LYRIC_UNANCHORED diagnostic
    hyphen_after: bool
    extender_after: bool
    lyrics_context: str
    location: SourceLocation

@dataclass(frozen=True)
class EntryMarker:
    id: str
    text: str                # "*", "**"
    syllable_id: str         # the syllable it was set before (\set stanza)
    location: SourceLocation

@dataclass(frozen=True)
class Division:
    id: str
    kind: DivisionKind
    onset: Fraction
    layer_id: str
    location: SourceLocation

@dataclass(frozen=True)
class Boundary:
    id: str                  # f"b{index:03d}" in onset order
    onset: Fraction
    source_break: bool
    division: DivisionKind | None
    safe: bool
    reason: BoundaryReason | None   # non-None iff not safe

@dataclass(frozen=True)
class FeatureUse:
    family: str              # see FEATURE_FAMILIES
    location: SourceLocation
    event_ids: tuple[str, ...]

FEATURE_FAMILIES: tuple[str, ...] = (
    "scaled-duration", "tie", "slur", "hidden-stem", "hidden-rest", "skip",
    "finalis", "divisio-maxima", "divisio-maior", "divisio-minima", "force-break",
    "stanza-marker", "blank-lyric", "melisma", "voice-line-voice", "voice-line-glissando",
    "cross-staff", "quilisma", "key-change", "clef-change", "note-shift", "manual-spacing",
)

@dataclass(frozen=True)
class ScoreIR:
    schema_version: Literal[1]
    source_path: str               # repo-relative
    dependency_digest: str         # sha256 hex, see ConversionInputs.digest()
    lilypond_version: str
    extractor_version: str
    total_duration: Fraction
    staves: tuple[StaffDef, ...]
    layers: tuple[LayerDef, ...]
    events: tuple[Event, ...]      # sorted (onset, layer.ordinal, seq)
    spans: tuple[Span, ...]
    lyrics: tuple[LyricSyllable, ...]
    entry_markers: tuple[EntryMarker, ...]
    divisions: tuple[Division, ...]
    boundaries: tuple[Boundary, ...]
    features: tuple[FeatureUse, ...]
    diagnostics: tuple[Diagnostic, ...]
    def to_dict(self) -> dict[str, object]: ...   # rationals via rational_to_str; keys camelCase
    @classmethod
    def from_dict(cls, value: dict[str, object]) -> ScoreIR: ...

# ------------------------------------------------------------- profile ---
@dataclass(frozen=True)
class FeatureRule:
    family: str
    status: Literal["supported", "unsupported", "engraving-only"]  # engraving-only => review diagnostic, not blocker
    mei: str                 # e.g. "<breath> with @type='divisio-minima'" (documentation)

@dataclass(frozen=True)
class ConversionProfile:
    id: str                  # "accompaniment-v1"
    version: int
    mei_version: Literal["5.0"]
    lyric_place: Literal["above"]
    container_policy: Literal["common-onset"]
    rules: tuple[FeatureRule, ...]
    @classmethod
    def load(cls, path: Path) -> ConversionProfile: ...   # data/typeset/mei/profiles/accompaniment-v1.json

# ---------------------------------------------------------- runner/extract ---
class LilyPondRunnerAdapter(Protocol):
    version: str
    def run(self, args: list[str], cwd: Path, includes: tuple[Path, ...], timeout: int) -> tuple[bool, str]: ...
# Production impl wraps pipeline.typeset.lilypond.run / load_pin().version; tests inject a fake that
# copies a checked-in TSV from tests/fixtures/mei/extraction/ into cwd.

@dataclass(frozen=True)
class ExtractionResult:
    ir: ScoreIR | None
    diagnostics: tuple[Diagnostic, ...]
    lilypond_version: str
    dependency_digest: str
    raw_evidence_path: Path            # build/typeset/mei/<digest>/events.tsv

# ---------------------------------------------------------------- encode ---
@dataclass(frozen=True)
class BoundaryManifestEntry:
    boundary_id: str
    onset: str                         # rational string
    measure_id: str                    # MEI xml:id of the measure ending here
    safe: bool
    source_break: bool
    division: DivisionKind | None

@dataclass(frozen=True)
class FeatureDecision:
    family: str
    status: Literal["supported", "unsupported", "engraving-only"]
    occurrences: int

@dataclass(frozen=True)
class EncodedScore:
    xml: bytes
    artifact_sha256: str
    boundaries: tuple[BoundaryManifestEntry, ...]
    feature_decisions: tuple[FeatureDecision, ...]
    provenance: dict[str, str]         # MEI xml:id -> IR event id (tied fragments map many->one)
    diagnostics: tuple[Diagnostic, ...]

@dataclass(frozen=True)
class SchemaBundle:
    root: Path                         # data/typeset/mei/schemas/mei-5.0/
    entry: str                         # "mei-CMN.rng"
    sha256: str                        # of the sorted concatenated files
    validator: str                     # "lxml-relaxng 5.x" | "jing 20220510" (S5)

# -------------------------------------------------------------- validate ---
@dataclass(frozen=True)
class NormalizedEvent:
    layer_key: str                     # staff index + layer n, NOT IR id
    onset: Fraction
    duration: Fraction                 # tied fragments merged ONLY for proven split
    kind: EventKind
    pitch: Pitch | None
    is_attack: bool
    notehead: Notehead
    printed_accidental: PrintedAccidental
    source_event_id: str | None        # via provenance; None is itself a difference

@dataclass(frozen=True)
class NormalizedScore:
    layers: dict[str, tuple[NormalizedEvent, ...]]
    lyrics: tuple[tuple[str, str | None], ...]     # (text, anchor source_event_id)
    entry_markers: tuple[tuple[str, str], ...]
    spans: tuple[tuple[SpanKind, str, str], ...]
    divisions: tuple[tuple[DivisionKind, Fraction], ...]
    total_duration: Fraction

@dataclass(frozen=True)
class SemanticDifference:
    code: DiagnosticCode
    layer_key: str | None
    onset: Fraction | None
    source_event_ids: tuple[str, ...]
    detail: str

@dataclass(frozen=True)
class ValidationReport:
    schema_ok: bool
    schema_diagnostics: tuple[Diagnostic, ...]
    semantic_differences: tuple[SemanticDifference, ...]
    eligible: bool                     # schema_ok and no differences and no unsupported feature
    hashes: dict[str, str]
    tool_versions: dict[str, str]

# ---------------------------------------------------------------- review ---
ConversionState = Literal["unsupported", "failed", "needs-review", "approved"]

@dataclass(frozen=True)
class ConversionInputs:
    source_sha256: str
    include_sha256: str                # all data/typeset/include/*.ily, as render.source_hash does
    lilypond_version: str
    extractor_version: str
    converter_version: str
    profile_id: str
    profile_sha256: str
    schema_sha256: str
    verovio_version: str
    font_digest: str
    def digest(self) -> str: ...       # sha256 of canonical sorted JSON

@dataclass(frozen=True)
class LayoutCase:
    id: str                            # "letter-portrait-u9-original"
    paper: str
    orientation: Literal["portrait", "landscape"]
    staff_unit: int
    line_policy: Literal["original", "automatic"]
    max_systems: int | None
    music_font: str
    text_font: str

REQUIRED_MATRIX: tuple[LayoutCase, ...]   # A5 builds it from spec S:171 (+ ipad-11 portrait, custom 160x230)

@dataclass(frozen=True)
class ReviewDecision:
    reviewer: str
    timestamp: str                     # ISO 8601 UTC
    inputs_digest: str
    artifact_sha256: str
    matrix_results: dict[str, Literal["pass", "fail", "accepted-difference"]]
    accepted_differences: tuple[str, ...]
    decision: Literal["approve", "reject"]

@dataclass(frozen=True)
class ConversionRecord:
    source_path: str
    target: str | None                 # from data/typeset/manifest.json; never inferred
    render_hash: str | None            # 32-hex from manifest.json
    state: ConversionState
    inputs: ConversionInputs
    artifact_sha256: str | None
    diagnostics: tuple[Diagnostic, ...]
    validation: ValidationReport | None
    review: ReviewDecision | None

class ReviewBlocked(Exception):
    def __init__(self, codes: tuple[str, ...], message: str) -> None: ...

@dataclass(frozen=True)
class EvidencePacket:
    directory: Path                    # build/typeset/mei/<digest>/evidence/
    index_html: Path
    cases: dict[str, Path]             # LayoutCase.id -> rendered SVG/PNG
    geometry_findings: tuple[Diagnostic, ...]

# ---------------------------------------------------------------- audit ---
AuditClass = Literal["candidate", "source-check-failed", "compile-failed", "unknown-feature"]

@dataclass(frozen=True)
class SourceRecord:
    path: str
    dependency_digest: str
    includes: tuple[str, ...]          # always ("gregorian.ly", "noh2.ily") today
    target: str | None
    match_status: str | None           # from data/typeset/parts.yml
    voices: int
    staves: int
    features: dict[str, int]           # family -> count (text scan = candidate only)
    classification: AuditClass
    diagnostics: tuple[Diagnostic, ...]

@dataclass(frozen=True)
class AuditReport:
    sources: tuple[SourceRecord, ...]
    absent_targets: tuple[str, ...]    # catalogue targets with no source file ("absent")
    family_counts: dict[str, int]
    unknown_commands: dict[str, int]
    proposed_pilot: tuple[str, ...]

# ------------------------------------------------------------- manifest ---
@dataclass(frozen=True)
class ManifestPart:                    # serialises to the TS ConversionManifestPart
    target: str
    render_hash: str
    digest: str
    mei_path: str                      # "mei/<digest>/score.mei"
    mei_sha256: str
    source_revision: str
    profile: str
    verovio: str
    boundaries: tuple[BoundaryManifestEntry, ...]
    capabilities: dict[str, bool]

@dataclass(frozen=True)
class ConversionManifest:
    schema_version: Literal[1]
    parts: tuple[ManifestPart, ...]

# --------------------------------------------------------- publish/batch ---
class AssetStore(Protocol):
    def exists(self, key: str) -> bool: ...
    def put_if_absent(self, key: str, data: bytes, content_type: str) -> bool: ...

@dataclass(frozen=True)
class PublishInputs: records: tuple[ConversionRecord, ...]; prefix: str  # "mei"
@dataclass(frozen=True)
class VerifiedBundle: root: Path; files: dict[str, str]  # key -> sha256
@dataclass(frozen=True)
class PublishReport: uploaded: tuple[str, ...]; skipped_existing: tuple[str, ...]
class PublishBlocked(Exception): ...

@dataclass(frozen=True)
class BatchReport:
    requested: tuple[str, ...]
    results: dict[str, ConversionState]
    counts: dict[ConversionState, int]
    cached: tuple[str, ...]
    evidence: dict[str, Path]
```

---

## 6. Task readiness and splits

Legend: **H** = Haiku-ready, **S** = Sonnet-ready, **O** = needs Opus or a spike first, **SPLIT** = too large for one session.

| Task | As written | Reason |
|---|---|---|
| A1 | SPLIT | Contracts + audit + live corpus run + CLI in one task. Its fixtures assume nested/unknown includes that do not exist (every source includes only `gregorian.ly` + `noh2.ily`). |
| A2 | O → SPLIT | Extraction mechanism undecided (S1). Lyric anchoring and staff-change semantics are research. |
| A3 | SPLIT (+S5) | Schema vendoring + validator choice + feature mappings + encoder + tie splitting + render harness. |
| A4 | SPLIT | Independent MEI reader + comparator + ~14 mutations. |
| A5 | SPLIT | State machine + HTML evidence + geometry checks + human review. |
| A6 | S | Bounded once §5.2 types exist. |
| B1 | S | Clear scenario list. Approval is the user's. Add custom/iPad presets to the scenarios. |
| B2 | O | S3 + S4 decisions required. "Evaluate PDFKit … or one concrete alternative" is research. |
| B3 | SPLIT | Types + settings + ExportRun change + selection extraction from inline script + manifest lookup. |
| B4 | O → SPLIT | Solver algorithm, Verovio option semantics and bundling (S2, S6). |
| B5 | S | Well specified. Not Haiku (security-sensitive). |
| B6 | SPLIT | Composition geometry + PDF assembly + fixed preview (needs a `pdfjs-dist` decision) + Unicode fonts. |
| B7 | SPLIT | Preferences + controller + two workers. |
| B8 | SPLIT | Preview frame + controls + break overlay; tests must be Playwright (C10). |
| B9 | O (coordinator) | Owns `ExportBar.astro` and lazy-chunk budget assertions. |
| B10 | SPLIT | Harness code (Sonnet) vs. device matrix and visual sign-off (user). |
| C1 | SPLIT | Python verifier vs. workflow YAML + workflow contract tests. |
| C2 | SPLIT | `limits.ts` (Haiku) vs. harness (Sonnet) vs. device measurements (user). |
| C3 | O | Coordinator + maintainer release. |
| C4 | SPLIT | `batch.py` tooling (Sonnet) vs. per-batch conversion runs. |

**Tally (20 tasks):** Haiku-ready 0, Sonnet-ready 3 (A6, B1, B5), needs-Opus/spike 5 (A2, B2, B4, B9, C3), must-split 12.

### Proposed sub-tasks (each fits one agent session)

All Python sub-tasks: run `uv run pytest -q <file>` and `uv run ruff check pipeline tests`. All web sub-tasks: `cd web && pnpm exec vitest run <files> && pnpm exec astro check`.

**A1a [H] Contracts.** In: §5.2 text. Out: `pipeline/typeset/mei/{__init__,diagnostics,model}.py`, `tests/test_mei_model.py`. Done when: `rational_to_str(Fraction(14,16)) == "7/8"`; `rational_from_str("0.5")` raises; `ScoreIR.from_dict(ir.to_dict()) == ir` on a 3-event hand-built IR; `json.dumps(ir.to_dict(), sort_keys=True)` is stable.
**A1b [S] Audit.** In: A1a; `data/typeset/src/**.ly`, `data/typeset/parts.yml`, `data/typeset/manifest.json`. Out: `audit.py` with `audit_sources(root, targets, include_dir) -> AuditReport`; `tests/test_mei_audit.py` with tmp-dir fixtures (no LilyPond). Done when: `test_dependency_change_changes_digest` (edit `noh2.ily` copy), `test_absent_target_is_not_a_failure` (a target in parts.yml with no file → `absent_targets`, not in `sources`), `test_unknown_include_reports_location` (fixture `\include "other.ily"` → `UNKNOWN_INCLUDE` at line 2), plus text-scan feature counts for `\voiceLine "`, `\quil`, `\divisioMinima`, `\set stanza`. **Delete `empty_record.state == "absent"` (PA:62); there are no empty sources.**
**A1c [H] CLI + run.** Out: `pipeline/typeset/mei/cli.py` and a dispatch line in `pipeline/cli.py` for `typeset-mei-audit --out`. Run it and commit `docs/superpowers/plans/export-layout-audit-2026-10.md` (counts only). Done when: `tests/test_cli_commands.py` passes and the report lists 859 sources.

**A2a [S, after S1] Listener.** In: S1's `listen_full.ily` prototype and grammar. Out: the production `pipeline/typeset/mei/listen_full.ily` and `extract.py::run_listener(source, runner) -> str` using `lilypond.run(..., includes=(INCLUDE, MEI_DIR))`. Test `-m lilypond`: TSV for Kyrie equals `tests/fixtures/mei/extraction/kyrie_IX.tsv` byte-for-byte.
**A2b [S] TSV → events/layers/staves.** In: the 5 fixture TSVs. Out: `extract.py::parse_rows`, `build_layers`. No LilyPond needed. Done when: Kyrie layer IDs equal `["up:chant","up:#1","down:#2","down:#3"]`; per-layer `(onset,duration,pitch)` equal `tests/fixtures/mei/kyrie-ix/baseline-events.json`; total `373/8`; 358 notes + 5 skips; the voice-line fixture has a 5th layer with `role == "voice-line"` and `notehead == "hidden"`.
**A2c [S] Lyrics, entry markers, spans, divisions.** Done when: Kyrie has 82 syllables, 60 non-blank; every anchor is a `up:chant` event with an equal onset; 3 entry markers (`*`, `*`, `**`) on the right syllables; 22 divisions (18 finalis + 4 minima, matching the tree dump's procedure counts).
**A2d [S] Boundaries.** Common-onset boundaries; `safe` rules per `BoundaryReason`. Done when: Kyrie's 5 source breaks map to boundaries at `7, 109/8, 85/4, 233/8, 38`; a boundary inside a slur is `safe=False, reason="slur-crosses"`.
**A2e [H] CLI `typeset-mei-extract`** plus IR JSON written to `build/typeset/mei/<digest>/ir.json`.

**A3a [S, after S5]** Vendor the schema and implement `schema.py::validate_schema`. Done when: experiment MEI → pass or a listed diagnostic; a document with a DOCTYPE/entity → `SCHEMA_INVALID` without network access.
**A3b [O writes table, H transcribes]** `data/typeset/mei/profiles/accompaniment-v1.json`: one `FeatureRule` per `FEATURE_FAMILIES` entry. Opus decides each MEI mapping, e.g. finalis → `measure@right="dbl"`; minima/maior/maxima → `<breath>` + `@type`, pending S2 render check; quilisma → `@head.shape` or `UNSUPPORTED_FEATURE`; voice-line glissando → `<gliss>` between `@visible="false"` notes or unsupported; scaled durations → hidden `<tuplet>` as in the experiment.
**A3c [S] Encoder core** (`encode.py`): staves, layers, measures by common onset, notes/spaces/hidden tuplets, ties, slurs, lyrics `<verse place="above">`, `<sb>` at source breaks, stable `xml:id = IR id`. Done when: experiment-equivalent output for Kyrie validates and Verovio (Python) timemap onsets match the IR.
**A3d [S] Tie-split at boundaries** + `UNSAFE_BOUNDARY`. Done when: the 7/8 → 3/8 + 1/2 fixture assertions in PA:110-113 pass.
**A3e [S] `typeset-mei-convert` CLI** and render harness (Node script `web/scripts/render-mei.ts`, using WASM per S2's determinism note).

**A4a [S]** `normalize.py::normalize_mei`: independent ElementTree reader. It must not import `encode.py` (enforced by a test that greps imports).
**A4b [S]** `validate.py::compare_scores` with the codes in §5.2.
**A4c [H]** Mutation fixtures: 14 small functions in `tests/test_mei_validate.py`, each mutating the Kyrie MEI with ElementTree, one per PA:130 item. Each asserts one code.

**A5a [S]** `review.py`: `apply_review`, `approval_is_current`, `ReviewBlocked`. Pure, no rendering.
**A5b [S]** `evidence.py`: HTML packet with LilyPond SVG, MEI SVG per `LayoutCase`, scan context via `pipeline/typeset/proofread.py`'s existing lookup (confirm the function name in-task), diagnostics list.
**A5c [S]** Geometry checks (clipping: any glyph bbox outside the page viewBox; collision: lyric `<text>` bbox overlap).
**A5d [user]** Visual review and signed decision JSON.

**B3a [H]** `types.ts` (paste §5.1) + `settings.ts` (`normalizeSettings`, `paperDimensions`, `verovioOptions`). Done when: the A5-landscape test from PB:96, the custom 500 mm → clamp + notice test, and the `export-paper` migration test pass.
**B3b [S, coordinator]** Add `target`/`hash` to `ExportRun`; move ExportBar's inline `selection()` input gathering into `web/src/lib/exportSelection.ts::readSelectionInput(root: ParentNode, showsScans: (key: string) => boolean): SelectionInput`. Done when: `ExportBar.test.ts`, `typeset.test.ts` and `exportParts.test.ts` pass unchanged except for the new fields.
**B3c [S]** `selection.ts::snapshotSelection`, `capabilities.ts`, `web/src/lib/mei.ts::approvedConversionFor`.

**B4a [S] `paginate()` (pure).** Signature:
```ts
export interface PaginateInput {
  readonly systems: readonly { readonly heightMm: number; readonly startsAfterBoundary: string | null }[];
  readonly contentHeightMm: number;          // first page: minus heading
  readonly firstPageContentHeightMm: number;
  readonly minGapMm: number;                 // spacingSystem in mm
  readonly maxSystems: number | null;
  readonly forcedPageStarts: ReadonlySet<number>; // system indices from user page breaks
}
export type PaginateResult =
  | { readonly ok: true; readonly pages: readonly (readonly number[])[] }
  | { readonly ok: false; readonly code: 'SYSTEM_TOO_TALL'; readonly systemIndex: number };
```
Greedy fill: a new page when the cap is reached, the height overflows, or a forced start is hit. Done when there are property tests: no page exceeds the cap; every forced start begins a page; the output order is preserved; there are no empty pages.
**B4b [S] `breaks.ts::resolveBreaks`** (priority user page > user system > policy > automatic; stale/unsafe dropping).
**B4c [S] `mei.ts` materialisation:** insert `<sb/>`/`<pb/>` after `measureId` in a DOMParser copy; strip source `<sb>` when `linePolicy === 'automatic'`.
**B4d [S] `layout.ts`:** pass 1 → `SystemGeometry[]` from SVG `g.system` bboxes, `paginate`, pass 2 `breaks:"encoded"`, `validateLayout` (cap, `EVENT_MISSING`, staff height ±0.1 mm). Use a fake `VerovioLike` in unit tests plus one real WASM test in Node.
**B4e [S]** Renderer-backed matrix fixture test (3 paper presets + ipad-11 + custom 160×230; both orientations; units 7/9/12).

**B6a [S]** `compose.ts` (pure geometry; scan packing with complete images; fixed fit rule C8; headings measured with fontkit metrics from `FontProfile`).
**B6b [S]** `exportPdf.ts` (**rename from `pdf.ts`**, which collides with `web/src/lib/pdf.ts`): pdf-lib document, `embedPdf`/`drawPage` for fixed pages, `embedPng` for scans, the B2 adapter for MEI, `@pdf-lib/fontkit` for Unicode headings. Done when the page MediaBox equals the mm→pt value within 0.01 pt.
**B6c [S, after a decision]** `fixedPreview.ts` using `pdfjs-dist` (coordinator pins it). It is loaded only when a fixed part is present.

**B7a [H]** `preferences.ts` with a throwing-storage test and migration.
**B7b [S]** `controller.ts` with fake workers/timers (token tests, PB:179-186).
**B7c [S]** `web/src/workers/export-layout.worker.ts` and `export-layout-pdf.worker.ts` (thin wrappers, like `pdf.worker.ts`).

**B8a [S]** `ExportPagePreview.astro` + script (page frames, Page N of M, continuous view). **B8b [S]** `ExportLayoutEditor.astro` controls bound to the controller. **B8c [S]** Break overlay and menu. Each has Playwright scenarios.

**B10a [S]** Harness and PDF-mutation proof. **B10b [user]** Device/tablet matrix and forScore import check.

**C1a [S]** `publish.py` verify/publish with fakes. **C1b [S]** `.github/workflows/mei-conversion.yml` + `tests/test_mei_workflows.py`, modelled on `test_preview_render_is_separated_from_secret_upload` (tests/test_typeset_workflows.py:12).

**C2a [H]** `limits.ts::checkLayoutBudget` + `resource-profile.json` (provisional). **C2b [S]** `web/scripts/measure-export-layout.ts`. **C2c [user]** Device runs.

**C4a [S]** `batch.py`. **C4b..n [S]** Per-batch conversion runs. Human reviewers approve.

---

## 7. Architecture risks (rework drivers)

1. **Unit system (high).** Without `scale:100` and page dims in 0.1 mm, every physical claim (staff mm, page mm) is wrong. Fix: §5.1 mapping, verified in S2.
2. **Verovio break semantics (high).** `breaks:"line"` may ignore `<pb>`, and `encoded` ignores `systemMaxPerPage` (README). The two-pass design puts pagination in our pure code. If pass 2 (`encoded`) reflows lines differently from pass 1, B4d must detect that via the system-start boundary IDs and fail with `UNSATISFIABLE_LAYOUT`. It must not loop.
3. **Text font metrics (high).** See C6/S3. This could remove a spec control.
4. **WASM bundling and iPad (medium).** Verovio's module is several MB. Module workers need iPadOS 15+. A cold start on an older iPad may exceed the 60 s watchdog. S6 plus C2 device runs. Ordinary pages must not import the chunk; assert this in a Playwright request log (B9).
5. **Vector PDF (medium-high).** `svg-to-pdfkit` is not actively maintained, and `pdfkit` in the browser needs the standalone build (~1 MB+). The pdf-lib walker route is smaller and reuses pdf-lib, which is already a dependency. S4 decides.
6. **Corpus representativeness (high).** C1: voice-line voices and glissandi in nearly every file. If `<gliss>` between hidden notes does not render acceptably in Verovio, most of the catalogue is blocked. Put a voice-line file in S2's render checks now, not in C4.
7. **Python/WASM renderer divergence (medium).** Evidence rendered by the Python wheel may not match browser output. Render evidence with the same npm build in Node.
8. **Critical path length (high).** As written, the path is serial: A1→A2→A3→A4→A5→A6→C1→C3, plus B2←A3 and B4←A3. Using the experiment MEI as B-lane input (§2b) removes the A3 dependency from B2/B4/B5/B6/B7. The critical path becomes S1 → A2 → A3 → A4 → A5 → C3.
9. **Fallback (only if a gate fails).** If G1 (musical fidelity, e.g. voice-line glissandi or quilisma cannot be represented) or G2 (PDF/text fidelity) fails, the fallback is server-side native LilyPond rendering of catalogue sources with enumerated parameters: `paper-width/height`, `max-systems-per-page`, `set-global-staff-size`, breaks inserted at listener-derived moments. It reuses `render.py::wrap`. This is a contingency, not v1.

---

## 8. Execution DAG with model assignment

```text
Lane 0 (now, parallel):  S0[H] ─┬─> S1[Opus] ──────────────> A2a..e[S/H]
                                ├─> S2[Opus] + S6[S] ──────> B4a..e[S]
                                ├─> S3+S4[Opus] ───────────> B2[S]
                                ├─> S5[S] ─────────────────> A3a[S]
                                └─> B1[S] ──(user G0)──────> B8a..c[S]
Contracts (after S0):   A1a[H] (Python types)   B3a[H] (TS types)   — coordinator freezes

Python lane (one agent at a time; owns pipeline/typeset/mei/**, tests/test_mei_*):
  A1a → A1b → A1c → [S1] → A2a → A2b → A2c → A2d → A2e → A3a → A3b → A3c → A3d → A3e
      → A4a → A4b → A4c → A5a → A5b → A5c → (A5d user) → A6 → C1a → C1b

Web lane 1 (owns web/src/lib/export-layout/{settings,selection,capabilities,breaks,layout,mei,svg}.ts):
  B3a → B3c → [S2,S6] → B4a → B4b → B4c → B4d → B4e → B5
Web lane 2 (owns fonts.ts, vectorPdf.ts, compose.ts, exportPdf.ts, fixedPreview.ts):
  [S3,S4] → B2 → B6a → B6b → B6c
Web lane 3 (owns controller.ts, preferences.ts, workers, components, scripts/exportLayout.ts):
  B7a → (B4d, B6b) → B7b → B7c → [G0] → B8a → B8b → B8c
Coordinator (Opus; owns ExportBar.astro, typeset.ts, package.json/lockfile, pipeline/cli.py, workflows):
  B3b (early) → dependency adds for S4/S6/B6c → B9 → B10a[S] → B10b[user]
Release: C2a[H] → C2b[S] → C2c[user] → C3[Opus+user] → C4a[S] → batches[S]
```

Parallelism: the Python lane and the three web lanes run concurrently from day one. Only B10/C3 need a real A6 manifest. Earlier web work uses the experiment MEI and the hand-written fixture manifest from B3c.

---

## 9. Stale or wrong references (24)

| # | Plan text (location) | Reality | Correction |
|---|---|---|---|
| 1 | `uv sync --extra dev` (P0:140) | `dev` is a `[dependency-groups]` group (pyproject.toml), not an extra | `uv sync` (dev group is synced by default) |
| 2 | Experiment "retained in this chat's `kyrie-ix-experiment` directory" (S:205) | `/Users/npadley/.codex/visualizations/2026/10/06/01a10f81-7606-7733-b9d5-b66fceed337e/kyrie-ix-experiment/` (outside repo) | Check in per §2b (S0) |
| 3 | Frontend clone (implied by README) | `/private/tmp/kyrie-ly-to-musicxml/` (volatile `/private/tmp`) | Record the commit + `xml-export.ily` origin in the provenance README; do not depend on it |
| 4 | `{"chant","alto","tenor","bass"}` (PA:86) | Anonymous voices (kyrie_IX.ly:168,175,178) | C2 |
| 5 | `empty_record.state == "absent"` / empty transcriptions (PA:58,62) | 0 of 859 `.ly` files are empty | "absent" = catalogue target with no source |
| 6 | "fixture include families", cycle handling (PA:54,68) | All 859 sources include exactly `gregorian.ly` + `noh2.ily` | Digest = source + all `data/typeset/include/*.ily` + pin, as `render.source_hash` |
| 7 | Hashes "SHA-256 of bytes" for render hashes (P0:92) | `render.source_hash` is SHA-256 **truncated to 32 hex** (render.py:90); manifest.json stores 32-hex | Store `renderHash` verbatim as 32-hex |
| 8 | `approvedConversionFor(target, renderHash, …)` fed by selection (PB:90) | `ExportRun` lacks target/hash (typeset.ts:122-128) | C5 |
| 9 | "Coordinator extracts … only where necessary" (PB:88) | Selection is inline DOM code (ExportBar.astro:167-200); extraction is required | B3b |
| 10 | Component tests for keyboard/focus (PB:202,204) | Container API = static HTML (ExportBar.test.ts) | Playwright (C10) |
| 11 | "desktop and 390px", "tablet browser" (PB:206,234) | playwright.config.ts has one Desktop Chrome project | `test.use({viewport})`; real tablet = user |
| 12 | "Fixture activation is test-only" (PB:228) | e2e serves production `dist` | C9 |
| 13 | "quick export's lossy WinAnsi text sanitizer" (PB:167) | Function is `pdfSafe` (web/src/lib/pdf.ts:67); Unicode needs `@pdf-lib/fontkit` (not installed) | Name it; coordinator adds fontkit |
| 14 | `web/src/lib/export-layout/pdf.ts` (PB:44) | Collides in name with `web/src/lib/pdf.ts` | Rename `exportPdf.ts` |
| 15 | `pipeline/typeset/mei/listen.ily` (PA:40) | Same name as `pipeline/typeset/listen.ily`, and `events.py` adds the include dir | Rename `listen_full.ily` |
| 16 | Fixed parts carry "original PDF" for any paper (PB:130-131) | Only `letter.pdf`, `a4.pdf` (render.py:41) | C8 rule |
| 17 | Staff "unit 7/9/12" ⇒ 5.6/7.2/9.6 mm (PB:103) | True only at `scale:100`, page in 0.1 mm; experiment used `scale:40` | §5.1 mapping |
| 18 | "Letter/Large/Automatic 4+1 systems" (S:179, PB:122) | Measured at `scale:40` | Drop; replace with "pages visibly separated; final system present" |
| 19 | "existing trusted-preview rules" (PC:66) | Not in docs/TYPESETTING.md; they live in `.github/workflows/typeset-preview.yml`, `corrections-batch.yml`, `tests/test_typeset_workflows.py` | Cite those files |
| 20 | "inspect applicable `AGENTS.md`" (P0:139) | None in the repo (only `vendor/missalemeum/AGENTS.md`); rules are in `.claude/rules/security.md` | Point to `.claude/rules/` |
| 21 | Verovio/PDF deps "selected in B2/A3" (P0:9) | `web/package.json` has only `pdf-lib`; no `verovio`, `pdfkit`, `@pdf-lib/fontkit`, `pdfjs-dist`. pyproject has no `verovio`, `lxml` | Coordinator adds them after S4/S5/S6 |
| 22 | "ordinary-page asset budget unchanged" (PB:235) | No budget baseline exists | B9: record the request list for `/` and one piece page before the change |
| 23 | `pnpm build` in agent verification (P0:143) | Production build refuses without `PUBLIC_ASSET_BASE` (web/scripts/with-public-env.ts) | Agents set `PUBLIC_ASSET_BASE=/systems` explicitly for local builds, or use web/.env |
| 24 | Kyrie IX target never named (S:13 etc.) | `movement:ordinarium-missae-ix/kyrie`, file `vol-5/missa-ix/kyrie_IX.ly` (data/typeset/manifest.json:100) | State it in A6/C3 |

---

## 10. Strengths

- LilyPond stays authoritative; approval is separated from proofreading; "no best-effort success state" (PA:18). These are correct guardrails.
- A4's independent oracle and mutation list (PA:130-136) is the right way to make agent-built converters trustworthy.
- One canonical `LayoutResult` feeds both preview and PDF (P0:127-133). This eliminates a whole class of preview/PDF drift.
- Revision tokens and stale-result discard are specified with concrete tests (PB:179-186).
- C1's secret-free compile / separate upload split matches the existing `typeset-preview.yml` pattern and its contract tests.
- Quick export is explicitly untouched, which gives a free rollback route.

## 11. Recommended fixes

- [ ] eng-fix-1 — S0: check in the experiment fixtures at the §2b paths (Haiku).
- [ ] eng-fix-2 — Expand the pilot fixture set to 5 files including voice-line and quilisma (C1).
- [ ] eng-fix-3 — Replace the A2 layer-name assertion (C2).
- [ ] eng-fix-4 — Record spikes S1–S6 with their required outputs in P0 §5 before any dependent task (C3, C6, §4).
- [ ] eng-fix-5 — Replace the B4 convergence loop with the two-pass + pure `paginate()` design (C4).
- [ ] eng-fix-6 — Add `target`/`hash` to `ExportRun`; make the selection-helper extraction mandatory (C5).
- [ ] eng-fix-7 — Adopt `LayoutSettings` v2 with custom/device page sizes and margins from 0 mm (C7, §5.1).
- [ ] eng-fix-8 — Pin `scale:100` with 0.1 mm page units; drop the 4+1 systems gate (refs 17, 18).
- [ ] eng-fix-9 — Fixed-PDF source choice rule for A5/landscape/custom (C8).
- [ ] eng-fix-10 — Build-time fixture manifest flag guarded against production (C9).
- [ ] eng-fix-11 — Move interaction tests to Playwright with explicit viewports (C10).
- [ ] eng-fix-12 — Paste the §5 type definitions into P0 §3 and freeze them as tasks A1a/B3a.
- [ ] eng-fix-13 — Replace the original 20 tasks with the §6 sub-tasks; assign models per §8.
- [ ] eng-fix-14 — Fix the 24 stale references in §9.
- [ ] eng-fix-15 — Rename `export-layout/pdf.ts` → `exportPdf.ts` and `mei/listen.ily` → `listen_full.ily`.
