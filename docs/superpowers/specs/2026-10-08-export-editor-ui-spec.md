# Export Layout Editor — UI Specification

Date: 2026-10-08. Status: **authoritative for B1 (mockups) and B8 (build)**. Derived from the design review (`docs/superpowers/reviews/2026-10-08-export-design-review.md` §§5–11) with the user decisions of 2026-10-08 applied (decision log D1–D6). Types and codes referenced here are defined in [the frozen contracts](../plans/2026-10-08-export-contracts.md); where this document and the contracts disagree on a name or value, **the contracts win** and this document is corrected.

Applied decisions:

- **D2 core job:** set page size, music (staff) size and systems per page, and see the music reflow, for print or for an iPad reader app such as forScore. FIT controls come first and are large.
- **D3 v1 controls:** Music size, Systems per page, Page size (Print / iPad / Custom), Orientation, Margins, Line breaks, break editing, and under *More options* Sung text size and Space between systems. **No lettering (text font) or music-symbol (music font) control in v1**; they are deferred, not disabled.
- **D4 page sizes:** Print / iPad / Custom. Margins 3–25 mm, default 12 mm print, 4 mm iPad and Custom. Preset dimensions live in `PAGE_PRESETS` (contracts §1) and are provisional until spike S7.

Implementers: import `web/src/styles/tokens.css` and `base.css` unchanged. Do **not** reuse markup or CSS from the Codex prototype `kyrie-ix-comparison.html`; its Bootstrap `form-select` controls are the pattern this editor replaces.

---

## 1. Screen spec

### 1.1 Container and regions

The editor is a full-viewport native `<dialog>` (see §6 for the reasons). Its markup lives in `ExportLayoutEditor.astro`, and it is opened with `showModal()`.

```
dialog.cx  (inset 0; width 100vw; height 100dvh; max-width/max-height none; margin 0; padding 0; border 0;
            background var(--paper); color var(--ink); display grid;
            grid-template-rows: auto 1fr auto)
├── header.cx-head        one row, border-bottom 1px var(--rule), padding var(--s-2) var(--s-3)
│     h2#cx-title "Customize export" (font-family var(--font-text); font-size var(--step-1); weight 600)
│     p.cx-sel .ui.small.muted  "Missa IX · Kyrie"   (selection title, from ExportBar data-title minus site name)
│     button.cx-close  "Close"   (default button style; text, not an × icon) — right-aligned
├── div.cx-body           (≥62rem: grid-template-columns 20rem 1fr; <62rem: single column)
│     aside.cx-settings   (≥62rem: overflow-y auto; border-right 1px var(--rule); padding var(--s-3))
│        section "In this PDF"   (parts list, §1.3)
│        fieldset Fit (Music size, Systems per page, result line) / fieldset Page / fieldset Breaks / details More options
│        p.cx-storage (only when storage blocked, §7)
│     section.cx-preview  (overflow-y auto; overflow-x auto; position relative)
│        div.cx-toolbar   (position sticky; top 0; background var(--paper); border-bottom 1px var(--rule);
│                          padding var(--s-2) var(--s-3); flex row, wrap, gap var(--s-2) var(--s-3))
│              View: [Pages | Continuous]   Zoom: [−] 100% [+] [Fit width]   span.cx-updating
│        div.cx-pages     (padding var(--s-4) var(--s-3); pages stacked; gap var(--s-5))
└── footer.cx-foot        sticky by grid; border-top 1px var(--rule); padding var(--s-2) var(--s-3);
      p#cx-status role=status aria-live=polite (.ui.small; min-height 1.4em)
      button.link#cx-undo "Undo" (hidden unless an undoable action just happened)
      button.link#cx-reset "Reset layout"
      button.primary#cx-download "Download PDF · 2 pages"
```

Breakpoints reuse the site's existing values, with no new numbers:
- **≥62rem** (`--page-max`, the same as ExportBar's sticky breakpoint): two columns. The settings column is 20rem wide, and both columns scroll independently. iPad landscape (1024px) lands here.
- **40rem–62rem** (iPad portrait, 768px): one column. The settings come first, but each group is a collapsed `<details>` (§1.5), so the first page of the preview is visible without scrolling at 768×1024.
- **<40rem** (390px phone): same as the middle range. The footer wraps: the status line takes the full width on row 1, and row 2 holds `[Reset layout]` on the left and `[Download PDF]` filling the rest.

Visual hierarchy, in order:
1. **Paper preview.** It is the largest region and the only white surface, and it shows the reflow as soon as a control changes.
2. **Download PDF.** It is the only filled button on screen (`.primary`).
3. **The FIT group** (Music size, Systems per page, live result line). It comes first in the settings column.

Everything else is outline buttons, segmented controls or link buttons.

### 1.2 Tokens and classes to reuse (with names)

| Need | Use | Notes |
|---|---|---|
| Page ground, text | `--paper`, `--ink`, `--ink-muted` | Never raw hex (`tokens.css` L1–2) |
| Hairlines, group dividers | `--rule` | Never for text or control edges |
| Control edges (segments, stepper, select, page frame) | `--control-border` (3.7:1) | WCAG 1.4.11 |
| Selected segment, group headings, focus ring | `--accent` | The only accent colour. Focus is already global: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` (base.css L27) |
| Notices / errors | `.notice` (base.css L73: `--warn-bg`, `--warn-ink`, 3px left border) | Errors also get a text prefix "Can't…" (ADMIN-UX-REVIEW §4.7) |
| Chrome font | `.ui` (`--font-ui`); headings `--font-text` | Two families only; no third |
| Sizes | `--step--1` for helper/labels, `--step-0` for controls, `--step-1` for the title | |
| Spacing | `--s-1` … `--s-6` only | |
| Targets | `--tap-min` (44px) on every interactive element, including overlay handles | |
| Radius | `--radius` (2px) | No pill shapes |
| Disclosure | `.disclosure-summary` + `<DisclosureCue />` | The same as ExportBar's "Choose parts" |
| Primary button | `.primary` — `background var(--ink); color var(--paper); border-color var(--ink)`; disabled: `background var(--paper); color var(--ink-muted); border-color var(--rule)` | **Today it exists only in admin pages** (`AdminNav.astro` L41–42, `admin/*/index.astro`). Promote it to `base.css` (coordinator) |
| Text-style button | `.link` — `background none; border 0; padding 0; min-height var(--tap-min); color var(--accent); text-decoration underline; font inherit` | Copied from `SystemStack.astro` L204 / `AdminNav.astro` L43; promote to `base.css` |
| Status line | Same pattern as `#export-status` (ExportBar L77) with `data-state="error"` | |

**New tokens (coordinator adds them to `tokens.css`, identical in every theme):**
```css
--print-paper: #ffffff;  /* the physical sheet in export previews; never themed */
--print-ink:   #000000;
```
The preview page is a proof of what prints. It stays white with black music in dark mode and under `data-scan-polarity="inverted"`. Do **not** apply `--score-filter` to `.cx-page`. The desk around it follows the theme (`--paper`).

**Forbidden in this component** (restating `tokens.css` L4–6 for implementers): gradients, `box-shadow` of any kind (including on pages), translucent or blurred panels, radius above 2px, icons that stand in for text labels, coloured pill badges, skeleton shimmer, and spinners.

### 1.3 "In this PDF" (parts list, top of the settings column)

- Heading: `h3` "In this PDF". Use the group-heading style from §5.5.
- One row per part, in export order: part label in `--step-0` (e.g. "Kyrie"), then a line under it in `.small.muted` with the capability label:
  - **Customizable typeset**: no extra text.
  - **Original scan**: "Page size, margins and systems per page apply. The music itself can't be resized." When a customizable version exists but the reader chose the scans on the page, add: "Customizable typeset is available. To use it, close this and choose 'Show the typeset music' on the page."
  - **Fixed typeset layout**: "Fitted to your paper. Its lines and lettering can't change."
- Last line, `.small.muted`: "To change the parts, close this and tick them on the page." The editor never edits the part selection.
- Don't use chips, badges or icons. The capability is plain text, as the spec requires (Spec L60).

### 1.4 Controls: order, type, default, visibility

Every group is a `<fieldset>` with a `<legend>`. Every choice set of 2–3 options is a **segmented radio group**: real `<input type="radio">` elements, visually hidden with the `.sr-only` technique (never `display:none`), each wrapped by its `<label>`. Lists of four or more options use a native `<select>`. Numeric values use a stepper. **No sliders anywhere**, because they are imprecise on a tablet at the music desk.

Settings column order: **FIT** (the reflow controls), **PAGE**, **BREAKS**, then **More options**. All of these update the preview as soon as they change. There is no Apply button (§2, "updating").

| # | Group | Label (visible) | Control | Options (visible text) | Default | Visible by default? | Helper text (`.small.muted`) |
|---|---|---|---|---|---|---|---|
| 1 | Fit | Music size | Segmented, 3, **full column width**, each option 56px tall with the size name over the staff height. A small 5-line staff glyph (`aria-hidden`) drawn at the three relative heights | Small 5.6 mm / Medium 7.2 mm / Large 9.6 mm | Medium | Yes, first control | "Height of one staff on the page." |
| 2 | Fit | Systems per page | **Stepper**, full width: `[−]` value `[+]`, buttons 56×56. Values: "As many as fit", 1–8 (see behaviour below) | As many as fit | Yes | "The most on any page. Fewer may fit with large music or your own page breaks." |
| — | Fit | (live result line, not a control) | `<p id="cx-fit" aria-hidden="true">` in `--step-0`, `--ink`, weight 600 | e.g. "2 pages · 4 + 1 systems"; for mixed parts "Kyrie: 2 pages · Gloria: 3 pages (scan)" | — | Yes | Shows "Updating…" in `--ink-muted` while a job is pending. Announcements go through `#cx-status`, not this line |
| 3 | Page | Page size | Two tiers. Tier 1: segmented, 3: **Print / iPad / Custom**. Tier 2 depends on tier 1: Print → segmented Letter / A4 / A5 (sub-labels "8½ × 11 in" / "210 × 297 mm" / "148 × 210 mm"). iPad → segmented iPad mini / 11-inch / 13-inch (sub-label "fills the screen in forScore and similar apps"). Custom → Width and Height number inputs (`inputmode="decimal"`, 44px tall) and a segmented unit **mm / in** | Print → Letter (or the migrated `export-paper` value) | Yes | Custom: "90–450 mm (3.5–17.7 in) each side." |
| 4 | Page | Orientation | Segmented, 2, each with a 12×16 / 16×12 outline-rectangle SVG (`aria-hidden`, stroke `currentColor`, 1px) before the text | Portrait / Landscape | Portrait | Yes | none |
| 5 | Page | Margins | Stepper: `[−]` `<input type="number" min=3 max=25 step=1 inputmode="numeric">` `mm` `[+]` | 3–25 | 12 (print) / 4 (iPad, Custom) | Yes | Live inch equivalent: "12 mm (0.47 in)". Print and under 6 mm: "Most printers can't print this close to the edge." |
| 6 | Breaks | Line breaks | Segmented, 2 | Original / Fit to page | Original | Yes | Original: "Keeps the typeset lines; pages are filled to fit." Fit to page: "Re-flows the music for this page and music size." |
| 7 | More options | Sung text size | Segmented, 3 | Small / Medium / Large | Medium | No | none |
| 8 | More options | Space between systems | Segmented, 3 | Compact / Normal / Spacious | Normal | No | "A minimum; the music never overlaps." |
| — | Breaks | (fixed rule, not a control) | Text | "Each part starts on a new page." | — | Yes | — |
| — | Breaks | Your breaks | Button `aria-pressed` | "Choose where systems break" | off | Yes, only when ≥1 customizable part is present | "3 of your breaks" count line when >0 |

**Systems per page stepper behaviour**

The aim is to make the common move, "fewer, bigger-looking systems per page", one tap away.
- The value reads "As many as fit (now 4)", where 4 is the largest actual system count on any page in the current result.
- From "As many as fit", **−** sets the cap to (now − 1). **+** is disabled, with the reason given in its `aria-label`: "Already as many as fit".
- From a number, − lowers it to a minimum of 1. + raises it. Raising past the current natural fit, or past 8, returns to "As many as fit".
- The value is a `<output>` inside `role="group"` with `aria-label="Systems per page"`. Each button has an `aria-label` ("Fewer systems per page" / "More systems per page").
- Rapid presses coalesce (§2). The value updates instantly; the preview follows.

**Page size behaviour**
- Switching tier 1 keeps orientation.
- Switching to Custom pre-fills the previous page's dimensions.
- Custom inputs commit on `change` (blur or Enter), not on every keystroke.
- Invalid values keep the last valid layout and show inline copy (§3).
- The unit toggle converts the displayed values (mm stored, rounded to 0.1 mm / 0.01 in).
- The page label in the preview names the preset: "Page 1 of 3 · 11-inch iPad, portrait".
- The download filename appends the preset for iPad and Custom pages so it is identifiable in a forScore library: "Missa IX – Kyrie (11-inch iPad).pdf".

Segmented control spec:
- Each option is a flex child with `min-height: var(--tap-min); min-width: var(--tap-min); padding: 0 var(--s-3); border: 1px solid var(--control-border); font: inherit (--step-0, .ui)`.
- Adjacent options use `margin-left: -1px`. The outer corners use `--radius`.
- Checked: `border: 2px solid var(--accent); color: var(--accent); font-weight: 600; z-index: 1` (padding −1px to keep the size). A colour change alone isn't enough, so the weight and border width change too.
- Focus: `input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px }`.
- Disabled: `color: var(--ink-muted); border-style: dashed`, and the reason is stated in helper text, never only in a tooltip.

Capability rules:
- **No customizable part selected** (scans or fixed only): replace Music size, the Line breaks control and the More options music settings with one `.small.muted` sentence: "Music size and line breaks apply only to customizable typeset. None of the parts in this PDF are." Don't render disabled controls for a whole group. Systems per page (counting whole scanned systems), Page and Margins remain.
- **Mixed selection:** show the Music controls enabled, with one line under the Music legend: "Applies to: Kyrie. Not to: Gloria (original scan)."
- **Fixed parts and Most systems on a page:** add under the select: "Doesn't apply to Credo (fixed typeset layout)."

"More options":
- `<details class="cx-more">` with `<summary class="disclosure-summary"><DisclosureCue />More options</summary>`.
- When closed, the summary shows the non-default values in `.small.muted`: "More options · Large sung text, Spacious".
- It opens on load when either of its two values differs from its default.

### 1.5 Group headings and narrow-screen collapse

- `legend`/`h3`: `font-family: var(--font-text); font-variant-caps: all-small-caps; letter-spacing: 0.06em; font-size: var(--step-0); color: var(--accent); font-weight: 600`. These are rubric-style headings taken from the source edition, and they are the editor's signature detail. Use them for FIT, PAGE, BREAKS and IN THIS PDF.
- Groups are separated by `border-top: 1px solid var(--rule); padding-top: var(--s-3); margin-top: var(--s-3)`. No boxes and no backgrounds.
- **<62rem:** FIT is always expanded. Its two controls and the result line take about 230px, so the first page of the preview still starts above the fold at 768×1024. PAGE, BREAKS and More options are `<details>` whose summaries show the heading and a value summary ("PAGE · 11-inch iPad, Portrait, 4 mm"); they start closed. The open/closed state is not persisted.
- **<62rem result strip:** while the preview's first page is scrolled out of view, the sticky preview toolbar repeats the result line ("2 pages · 4 + 1 systems"), so an organist adjusting FIT can see the effect without scrolling.

### 1.6 Preview pane

- **Toolbar** (sticky):
  - View segmented `[Pages | Continuous]`, default Pages.
  - Zoom `[−]`, a `<output>` showing "100%", `[+]`, and `[Fit width]`. 100% means "fit width". Steps: 50, 75, 100, 125, 150, 200, 300%. Never relate the percentage to physical millimetres.
  - The updating indicator text sits on the right.
  - Pinch-zoom must stay enabled: no `touch-action: none` on the pane.
- **Page frame `.cx-page`:**
  - `background: var(--print-paper); color: var(--print-ink); border: 1px solid var(--control-border); aspect-ratio: widthMm / heightMm`. Width is set by the zoom level, centred, max 100% of the pane at "Fit width".
  - No shadow and no radius.
- **Margin guide:** an absolutely positioned inset box at `marginMm / widthMm` percentages, `border: 1px dashed var(--rule)`, `aria-hidden`, and `pointer-events: none`. It never appears in the PDF.
- **Page label** (outside and above each page), `.ui.small.muted`, flex space-between: left "Page 1 of 3", right the part name on the first page of each part ("Kyrie"). For fixed parts, add a second line: "Fixed typeset layout".
- **Blank-page note** (C8): below the page label when the unused usable height is over 25% and a next page exists in the same part: "The rest of page 1 is blank: the next system doesn't fit."
- **Continuous view:**
  - Pages are drawn without frames, with unused bottoms cropped at the same scale.
  - A `.notice` sits at the top of `.cx-pages`: "Reading view: page breaks are hidden here. The PDF uses the pages shown in Pages view."
  - Between former pages, draw a 1px `--rule` line with a centred `.small.muted` label "Page 2 begins".
  - Break editing is unavailable in Continuous view. Turning it on switches back to Pages.

### 1.7 Footer

- Download label: "Download PDF · {N} page(s)", where N is the actual page count from the current result.
- Reset layout is a `.link` button, and it sits on the opposite side from Download on narrow screens (≥ var(--s-4) apart on desktop) to prevent mis-taps.
- Undo (`.link`) appears only after a break change or Reset. It stays until the next settings change or for 30 s, whichever comes first.

### 1.8 Entry point in `ExportBar.astro` (coordinator)

- In `.go`, after `#export-btn` and before the Paper label, add `<button id="export-customize" type="button">Customize export</button>`. It uses the default outline style, so the quick Export PDF stays the main action on the reading page.
- The button follows the same disabled rule as `#export-btn` (label "Customize export" whatever the state; disabled when nothing is ticked).
- **Pilot scope (decided, D5):** render the button only when at least one segment on the page has an approved conversion. Otherwise the editor is just a more elaborate paper picker for scans.
- While its JS chunk loads: `aria-busy="true"` and the text "Opening…". It reverts on open.
- The editor initialises Paper size from `#export-paper`. The editor's own preference is stored under a new versioned key. Quick export keeps `export-paper` (Letter/A4 only). The editor never writes A5 into it.

---

## 2. State matrix

The `canDownload` column is the controller's value. "Status" is the footer `#cx-status` text. "Preview" is what `.cx-pages` shows.

| State | Trigger | Preview | Toolbar indicator | Status line (polite) | Download button | Other UI |
|---|---|---|---|---|---|---|
| **idle** | Dialog closed | — | — | — | — | ExportBar unchanged |
| **loading** (first open, WASM/fonts) | `open()` before the first result | One empty page frame per expected first page at the correct aspect ratio, with this text centred inside the frame in `.ui.muted`: "Getting the music ready to lay out…". After 8 s add: "This can take up to a minute on a tablet." No spinner and no shimmer | — | "Loading the layout tools…" (announced once) | Disabled, label "Download PDF" | Settings are interactive. Changes are queued |
| **rendering (first)** | Assets loaded, first job running | As loading, text "Laying out the pages…" | — | none (avoid chatter) | Disabled | — |
| **ready** | Current-token result, no blocking diagnostics | Pages | none | "Preview ready: {N} page(s)." (only after a change, not on every open) | **Enabled**: "Download PDF · {N} pages" | — |
| **updating** (rendering with a previous preview) | A setting or break changes while a result exists. **Reflow is immediate:** segmented/select changes post a job at once. Stepper presses and Custom-size commits coalesce for 250 ms after the last press. The worker keeps only the latest pending request | The previous preview stays at full opacity. No dimming | After 300 ms: "Updating preview…" in `.small.muted`, with `aria-hidden` (the status line announces) | After 300 ms: "Updating preview…". On completion: "Preview updated: {N} pages." Announce at most once per 2 s | Disabled, "Download PDF" | — |
| **exporting** | Download pressed | Unchanged | — | "Preparing PDF — page {k} of {N}" (progress events; announce every 25%) | Disabled, "Preparing PDF…" | Reset is replaced by `.link` "Cancel". Settings stay enabled; a change cancels the export (next row) |
| **export cancelled by change** | Setting changed during export | Updating | as updating | "Settings changed, so the PDF was stopped. Download again when the preview is ready." | Disabled → enabled when ready | — |
| **export done** | PDF delivered for the current token | Unchanged | — | "PDF downloaded: {N} pages, {size} MB." | Enabled | — |
| **error (part)** | Error with `partId` | Previous good preview kept, if any. A `.notice` is inserted **above the first page of the affected part** with copy from §3 and that error's actions | — | Same sentence, starting "Can't update the preview." | Disabled | Settings kept |
| **error (global)** | Renderer/WASM/font failure, timeout | A `.notice` at the top of `.cx-pages` with copy from §3 and the actions **Try again** (button) and **Use original layout** (button) | — | Same sentence | Disabled | Settings kept |
| **unsupported part** (scan/fixed; not an error) | Snapshot kind ≠ mei | Rendered as scan/fixed pages | — | — | Normal | Capability text in "In this PDF" (§1.3) |
| **impossible layout** | `UNSATISFIABLE_LAYOUT` | Previous preview kept. A `.notice` above the affected part, with copy from §3 and one button per `suggestion` ("Use Medium music", "Switch to landscape", "Remove the page break after 'eléison'") | — | "Can't lay out {part} with these settings." | Disabled | The offending break marker is outlined in `--accent` when break editing is on |
| **advisory: crowded original lines** | Original + Large, with a renderer-reported overfull system (transcript: "some original lines become too crowded at larger staff sizes") | Normal | — | — | Enabled | `.small.muted` line under Line breaks: "Some original lines are tight at this size. Fit to page may read better." Non-blocking |
| **blocked storage** | `readPreferences` notice | Normal | — | — (shown, not announced) | Normal | `p.cx-storage .small.muted` at the bottom of the settings column: "This browser isn't saving site settings, so your choices will reset when you leave." |
| **stale anchors** | Saved breaks have an old `sourceRevision` | Normal | — | Announced once on open: "Your saved breaks for Kyrie were removed because its music was updated." | Normal | `.notice` inside the Breaks group with the same text and a "Dismiss" `.link` |
| **over ceiling / budget** | >300 systems or a C2 budget exceeded | No preview. One `.notice` | — | Copy from §7 | Disabled | Button "Use original layout" |

## 3. Copy deck

Rules:
- Name the part, say what still works, and offer one primary action.
- No "Oops", no "Something went wrong", no codes or format names (MEI, SVG, WASM, Verovio) in visible text.
- The code goes into a `data-code` attribute for support.
- Sentence case. Use the site's existing vocabulary: "systems", "the scans", "typeset music".

| Code (plan-named or **proposed**) | Visible copy | Actions |
|---|---|---|
| `UNSATISFIABLE_LAYOUT` / `system-too-tall` | "Can't fit {part}: at {Large} music size, one system is taller than the space on a {paper} {orientation} page." | Use {next smaller} music · Switch to portrait / larger paper (when applicable) |
| `UNSATISFIABLE_LAYOUT` / `system-too-wide` | "Can't fit {part}: its original lines are too long for {paper} {orientation} at {size} music size." | Use Fit to page · Use {smaller} music · Switch to landscape |
| `UNSATISFIABLE_LAYOUT` / `heading-too-tall` | "Can't fit {part}: its heading and rubric leave no room for music on a {paper} {orientation} page." | Use smaller margins · Use larger paper |
| `UNSATISFIABLE_LAYOUT` / `no-convergence` | "Can't settle the page breaks for {part} with these settings." | Remove my breaks in {part} · Use original layout |
| `ASSET_MISSING` | "The music for {part} didn't load. Check your connection and try again." | Try again · Use original layout |
| `ASSET_HASH_MISMATCH` | "The music for {part} doesn't match the approved version, so it can't be used. If the site was just updated, reloading the page will fix this." | Reload page · Use original layout |
| `UNSAFE_SVG` (+ **`INVALID_PAGE`**) | "The preview of {part} failed a safety check, so it isn't shown." | Use original layout · Report a problem (link to `/corrections/`) |
| **`RENDERER_LOAD_FAILED`** | "The layout tools couldn't start in this browser." | Try again · Use original layout |
| `FONT_UNAVAILABLE` | "The lettering for the preview didn't load." | Try again · Use original layout |
| `TIMEOUT` | "The preview is taking too long. Large music on small paper takes longest." | Try again · Use original layout |
| `FIXED_PAGE_COUNT_MISMATCH` | "The typeset pages for {part} aren't what we expected, so they can't be placed." | Use original layout |
| **`SCAN_TOO_LARGE`** | "One system of {part} is too wide for {paper} {orientation} with {n} mm margins." | Switch to landscape · Use smaller margins |
| Selection over 300 (existing `validateSelection`) | Reuse the existing sentence verbatim, e.g. "This selection is 320 systems (about 80 pages); the limit is 300. Untick some parts to fit." | Close |
| `BUDGET_EXCEEDED` (C2) | "This is too much music to customize at once (more than {limit} pages). Untick some parts on the page, or use Export PDF." | Use original layout |
| **`CUSTOM_SIZE_INVALID`** (inline under the inputs, not a notice; the last valid layout stays) | Out of range: "Use a width between 90 and 450 mm (3.5–17.7 in)." / "…a height between…". Too narrow: "The long side can be at most three times the short side." Empty or not a number: "Enter a number." | — |
| **`MARGIN_PRINTER_ADVISORY`** (print size, margin under 6 mm; advisory, Download stays enabled) | "Most printers can't print this close to the edge." | — |
| **`PDF_FAILED`** | "The PDF couldn't be made. Your settings are kept." | Try again |
| `STALE_ANCHOR` (settings notice) | "Your saved breaks for {part} were removed because its music was updated." | Dismiss |
| **`PREFS_UNREADABLE`** | "Your saved export settings couldn't be read, so the defaults are used." (`.small.muted`, once) | — |
| **`STORAGE_BLOCKED`** | "This browser isn't saving site settings, so your choices will reset when you leave." | — |
| Unknown code | "Can't update the preview of {part}. Your settings are kept." | Try again · Use original layout |
| Build-time codes (`UNSUPPORTED_FEATURE`, `LYRIC_ANCHOR_MISMATCH`, `ATTACK_MISMATCH`, `HASH_MISMATCH` publish) | **Never shown to visitors.** Those conversions are never published (Spec L144) | — |

Code coverage rules (B8 has a test that every `LayoutDiagnosticCode` in the contracts resolves to a row here):

- `CAP_EXCEEDED`, `CONTENT_CLIPPED`, `EVENT_MISSING`, `STAFF_HEIGHT_MISMATCH`, `RENDERER_FAILED`: internal layout faults. Use the **Unknown code** row (generic copy, Try again · Use original layout) and block download.
- `UNSAFE_ANCHOR`: treated like `STALE_ANCHOR` (the break is dropped with the same notice).
- `SOURCE_CEILING`: the "Selection over 300" row.
- `CANCELLED`: no visible UI.
- `CROWDED_ORIGINAL_LINES`: the non-blocking advisory row in the state matrix (§2).
- `CUSTOM_SIZE_INVALID` and `MARGIN_PRINTER_ADVISORY` are **client-side form validation**, not worker diagnostics; they never enter `LayoutDiagnostic`.
- `UNSATISFIABLE_LAYOUT` copy is chosen by `diagnostic.reason`; its action buttons are generated from `diagnostic.suggestions` in the order given.

After "Use original layout": the dialog closes, focus moves to `#export-btn`, and `#export-status` reads "Custom layout closed. Export PDF uses the original layout{; paper: A4}." Include the paper clause only when the quick-export select differs from the editor's paper.

## 4. Break editing

**Mode:** break points are hidden until the user presses **Choose where systems break** (`aria-pressed`, Breaks group). Showing every safe boundary all the time would cover the music in markers. The mode is available only in Pages view and only for customizable parts. Turning it on scrolls nothing and keeps focus on the button. The status reads: "Break points shown. Select one to start a new system or page there."

**Overlay visuals** (an `aria-hidden` SVG layer per page, plus real buttons for interaction):
- A safe boundary inside a system is a 1px solid `--accent` vertical line spanning the staff group height. At its top, above the system, sits a **handle**: a 24×24 visible square (`--radius`, 1px `--accent` border, `--print-paper` fill) centred in a 44×44 transparent hit area (`--tap-min`).
- Handle glyphs are text in `--font-ui` at 0.75rem:
  - Empty handle: no break.
  - "↵" in `--accent`: your system break.
  - "⤓" with filled `--accent` and white glyph: your page break.
  - Original line breaks are shown at system starts with a muted "↵" in `--ink-muted`. They can't be selected for removal.
- Hover (mouse) thickens the line to 2px and shows a tooltip-free label below the handle in `.small`: "after 'eléison'".
- No overlay element is ever part of the canonical page or PDF.

**Selecting:**
- Mouse/touch: click or tap a handle.
- **Dense break points:** when handles are closer than 44 CSS px at the current zoom, show every other handle, and use the menu's Previous/Next to reach the others. Never shrink hit areas.
- Keyboard: the overlay is one tab stop per page section, using a **roving tabindex** (`tabindex=0` on the current handle, `-1` on the others).
  - ←/→ move to the previous/next break point in the part, crossing systems and pages.
  - Home/End go to the first/last.
  - Enter or Space opens the menu.
  - Esc leaves the overlay and focuses the mode button.
  - The handle scrolls into view (`block: nearest`).
- Each handle is a `<button>` with `aria-label`: "Break point 4 of 23 in Kyrie, after 'eléison', page 1. Now: no break." (or "Now: your new system" / "Now: your new page" / "Now: original line break").

**Menu** (a non-modal popover anchored under the handle; at <40rem it is a full-width panel fixed above the footer):
```
After "eléison" · break point 4 of 23           [◀ Previous] [Next ▶]
Now: no break
[ Start new system here ]
[ Start new page here ]
[ Remove my break ]          (only when a user break exists here)
[ Cancel ]                   (.link)
```
- Use the spec's exact wording for the three actions. Disable the action that matches the current state and add "(current)" to its text.
- At an original line break, replace "Start new system here" with the muted line "Original line break. To remove it, choose Line breaks: Fit to page."
- Implement it as a `<div role="group" aria-labelledby>` of buttons, **not** an ARIA `menu`. Ordinary buttons need no arrow-key menu semantics, which keeps them robust for implementers.
- Focus moves to the first enabled action on open.
- Esc or Cancel closes the menu and returns focus to the handle.
- Choosing an action closes the menu, returns focus to the handle and starts a preview update.

**Undo:**
- Every break change and Reset layout pushes onto a session-only stack (max 50).
- The footer shows `.link` **Undo**, and the status reads "New page starts after 'eléison'. Undo is available."
- Ctrl/Cmd+Z inside the dialog, when focus isn't in a text or number input, undoes too.
- Undo restores the previous overrides (and settings, for Reset) and announces "Undone."

## 5. Accessibility (each bullet is a Playwright or container test)

- **Semantics:** `<dialog aria-labelledby="cx-title" aria-describedby="cx-sel">` opened with `showModal()`, so the rest of the page is inert and Esc closes it natively. While open, add `html:has(dialog.cx[open]) { overflow: hidden }`. Mark the dialog `.no-print`.
- **Open:** focus the `h2#cx-title` (`tabindex="-1"`) so screen readers announce the title and selection. **Close** (button, Esc, browser Back) returns focus to `#export-customize`. During exporting, closing cancels the PDF and sets `#export-status` to "Custom PDF cancelled."
- **Focus order (DOM order):** Close → parts list (no stops) → Fit (music size, systems − / +) → Page (tier 1, tier 2 or custom inputs and unit, orientation, margin − / input / +) → Breaks (line breaks, break-mode button) → More options summary → its controls → toolbar (view, zoom −, +, Fit width) → break-point handles (one roving stop per page, only in edit mode) → footer (Undo, Reset/Cancel, Download PDF). On <62rem the same order holds; the group `<details>` summaries are stops.
- **Radio groups:** native radios give arrow-key selection inside a group. Don't re-implement them.
- **Live region:**
  - Exactly one polite region, `#cx-status`. No `role=alert` except for global errors (a separate `role="alert"` paragraph inside the error notice, rendered once).
  - Throttle as in §2: "Updating preview…" only after 300 ms, then at most one announcement per 2 s.
  - Never announce zoom changes. The `<output>` is not live.
- **Page text alternatives:** each `.cx-page` is `role="img"` with `aria-label="Page 1 of 3: Kyrie, 4 systems"` (fixed: "Page 3 of 3: Credo, fixed typeset layout"). The inner SVG and margin guide are `aria-hidden="true"`.
- **Targets:** every control, segment, stepper button, zoom button, handle hit area and menu action is at least `--tap-min` (44×44 CSS px). Verify at 390px and on a 768px tablet.
- **Contrast:** text uses `--ink`/`--ink-muted` (≥7.4:1) and `--accent` (8.9:1). Control edges and the page frame use `--control-border` (3.7:1, meets 1.4.11). The dashed margin guide uses `--rule` and is decorative (`aria-hidden`), so it is exempt. Handles: `--accent` on `--print-paper` is above 8:1.
- **Reduced motion:** no transitions anywhere in the editor except the existing `.disclosure-cue` rotation (already disabled under `prefers-reduced-motion`). Preview swaps are instant. `scrollIntoView` uses `behavior: "auto"` when `prefers-reduced-motion: reduce`, otherwise `"smooth"`. No indeterminate `<progress>` (it animates); use text.
- **Errors:** never colour-only. Every error starts with "Can't…" and sits in a `.notice`.
- **Zoom:** at 200% browser zoom on a 1280px window the layout falls to one column (rem-based breakpoints) and nothing is clipped.

## 6. Container decision: full-screen native `<dialog>` with a history entry

**Recommendation:** a full-viewport modal `<dialog>`, lazily created on first open. On open, `history.pushState({cx: true}, "", "#customize-export")`. A `popstate` event closes it, so the browser and tablet Back gesture behave as expected. On page load with `#customize-export` present, strip the hash with `replaceState` and **don't** auto-open.

Reasons tied to this site:
1. **Selection state lives in the page DOM.** The part checkboxes, the page-wide `data-view`, and each part's per-visit "Show the scan" `data-show` (`TypesetSwitch.astro`, `SystemStack.astro`, `ExportBar.showsScans`) are never serialised. A dedicated route would have to encode all of that into a URL and would lose per-visit scan choices. A dialog over the same page reads them directly, which honours "Never silently substitute MEI for a scan the reader deliberately selected" (Spec L56).
2. **The preview needs the whole screen.** A drawer (≤28rem) on an iPad leaves the paper preview at about 500px, too small to judge staff size. The existing ExportBar is already a sticky bottom bar on tablets (ExportBar L106–114), so a drawer would stack two pieces of bottom chrome.
3. **Native `<dialog>` gives focus containment, inertness and Esc for free.** That is the single biggest accessibility risk for a cheaper implementer hand-rolling a focus trap.
4. **Close returns the organist to exactly where they were on a long Mass page**, scroll position included. A route change would lose that.
5. Lazy loading (Spec L148) is equally easy: the `Customize export` click dynamically imports `exportLayout.ts`, which inserts the dialog.

Rejected:
- **Drawer:** too narrow, for reason 2.
- **Dedicated route:** loses state and scroll, for reasons 1 and 4. Revisit only if shareable layout links become a goal (excluded by Spec L50).

## 7. "More options" split

| Always visible | Behind "More options" |
|---|---|
| **Fit (first, most prominent):** Music size, Systems per page, live result line. **Page:** Page size (Print / iPad / Custom), Orientation, Margins. **Breaks:** Line breaks, break editing | Sung text size, Space between systems |

Per decision D2, the core job is: set page size, music size and number of systems, and see the music reflow. Those controls are first and large, with their effect shown immediately in a result line and in the preview. Margins stay visible because screen use (forScore) wants small margins.

Deferred to a later release (decision D3): **Lettering** (text-font choice) and **Music symbols** (Bravura). Do not render either control, disabled or otherwise. If the requesting organist's "font" turns out to mean a typeface rather than size, revisit after the pilot.

Possible later addition: an "Extra large" music size for iPad viewing at console distance, decided from pilot feedback.
