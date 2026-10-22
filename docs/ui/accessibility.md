# Accessibility: target and current state

**Target (decided 2026-10-22, P12 in [../DECISIONS.md](../DECISIONS.md)): WCAG 2.2 AA site-wide, with AAA (7:1) contrast for body text and music.**

Sections 1 and 4 describe the agreed target and its verification; sections 2
and 3 record the current state (read from the code on 2026-10-22).

Related: [tokens.md](tokens.md), [templates.md](templates.md),
[must-keep.md](must-keep.md) (section 7 lists the features to keep),
[journeys.md](journeys.md). The export editor has its own accessibility spec:
`docs/superpowers/specs/2026-10-08-export-editor-ui-spec.md` section 5.

Paths are relative to `web/`.

## 1. Agreed target: testable criteria

| # | Criterion | Pass condition | How it is tested today | How it could be tested |
|---|---|---|---|---|
| 1 | Contrast, text (1.4.3, 1.4.6) | Body text and muted text at 7:1 or better, light and dark. Links, notices and error text at 7:1 | No test. Ratios are written in comments in `src/styles/tokens.css` | A small script that reads the token pairs and fails below 7:1; axe on the built pages |
| 2 | Contrast, controls (1.4.11) | Every control edge, focus ring and state indicator at 3:1 or better | `e2e/a11y.e2e.ts` runs axe (not 1.4.11 borders, which axe does not measure). Base buttons and public form fields now use `--control-border` (gap 1, closed 2026-10-22) | The same script; axe `color-contrast` and manual review of borders |
| 3 | Contrast, music | Scans are black on white, or white on black when inverted; typeset music uses external SVG images themed by `--score-filter`; chant uses `currentColor`; chant rubrics stay legible | No test | Pixel check of one scan and one chant in each theme |
| 4 | Target size (2.5.8, AA minimum 24 px; this site aims for 44 px) | Every control is at least 44 by 44 CSS px, apart from links inside a sentence | `e2e/export-layout-editor.e2e.ts` ("every interactive target is at least 44 px"; handles at 44 px). Nothing for public pages | A Playwright test that walks `a, button, input, select, summary` on key pages and checks `boundingBox()` |
| 5 | Focus visible (2.4.7) and not obscured (2.4.11) | Every focused control shows a ring and is not hidden behind the sticky export bar or the editor's sticky strip | `web/e2e/focus-clearance.e2e.ts` (phone, 600 px tall) | Playwright: Tab through a piece page and assert the focused element is above the bar |
| 6 | Keyboard (2.1.1, 2.1.2, 2.4.3) | Every journey in [journeys.md](journeys.md) can be done without a pointer; no traps; dialog returns focus | Editor: Esc, focus return, roving break handles, Ctrl/Cmd+Z in `e2e/export-layout-editor.e2e.ts` and `e2e/export-customize-lazy.e2e.ts`. Disclosures: `src/components/Disclosure.test.ts` | Playwright scripts that drive journeys (a), (b), (e) and (f) with the keyboard only |
| 7 | Reflow (1.4.10) | At 320 CSS px wide, no horizontal page scroll; data tables may scroll inside their own box | Editor layout at 390 px: `e2e/export-layout-editor.e2e.ts`, `e2e/export-layout-preview.e2e.ts`. Nothing at 320 | Playwright at 320 by 568: `document.documentElement.scrollWidth <= innerWidth` on each template |
| 8 | Text spacing (1.4.12) | No loss of content with line height 1.5, paragraph spacing 2 em, letter spacing 0.12 em, word spacing 0.16 em | No test | Playwright: inject the WCAG test stylesheet, then check for clipped or overlapping text on key pages |
| 9 | Zoom and text size (1.4.4) | Usable at 200 % browser zoom; type in `rem` and `clamp()` | Spec states it for the editor; no test | Playwright at 640 CSS px (1280 at 200 %) |
| 10 | Reduced motion (2.3.3 AAA, 2.2.2) | Nothing animates when `prefers-reduced-motion: reduce` is set | No test | Playwright `emulateMedia({ reducedMotion: "reduce" })` and a check for running animations and transitions |
| 11 | Dark mode parity | Every criterion above passes in the system dark theme and with "Invert" | `src/components/Polarity.test.ts` checks the switch. No contrast test | Run criteria 1, 2 and 4 under `emulateMedia({ colorScheme: "dark" })` and with `data-scan-polarity` set both ways |
| 12 | Forced colours | Controls and focus remain visible with `forced-colors: active` | No rule and no test (gap 7) | Playwright `emulateMedia({ forcedColors: "active" })` and screenshots |
| 13 | Screen-reader labelling of music (1.1.1) | Each score image or group says what it is (piece, part, mode, system count), says that the notes are not available as text, and points to any text alternative (chant words, chant notation label) | Group labels exist in markup. `src/components/LineupStack.test.ts` checks error messages and spoken tones. No test of the figure caption | Unit test on the rendered figure: caption present, `role="group"`, images `alt=""` or labelled; manual pass with VoiceOver |
| 14 | Status messages (4.1.3) | Results, errors and progress are announced without moving focus; one live region per widget | `src/components/ExportLayoutEditor.test.ts` ("should have exactly one live region…") | Playwright assertions on `role="status"` text after each action |
| 15 | Names, roles, language (4.1.2, 3.1.2) | Controls have a visible label that matches the accessible name (2.5.3); Latin text carries `lang="la"` | `src/components/ExportLayoutEditor.test.ts` ("should label the settings region and every radio group"). `src/components/ChantText.test.ts` checks Latin chant attributes; `src/components/Sections.test.ts` checks Latin rubrics | axe `label` and `label-content-name-mismatch`; a grep-based test that Latin fields render with `lang="la"` |
| 16 | Consistent help and no redundant entry (3.2.6, 3.3.7) | The "Report an error" route is in the same place on every page; the editor does not make the user re-enter the part selection | Not tested | Manual review per template |
| 17 | Dragging alternative (2.5.7) | Break handles in the editor have a keyboard and menu path | `e2e/export-layout-editor.e2e.ts` ("adds a page break by keyboard…") | Existing |

Proposed order of work: 1, 2, 5 and 12 first (they need small CSS changes and
catch real gaps), then add the automated checks in section 4.

## 2. Current state: what exists

Counts come from a search of `src/**/*.astro`, `*.ts` and `*.css`, excluding
test files.

| Feature | Where | Notes |
|---|---|---|
| Skip link "Skip to music" | `src/components/Layout.astro`, `src/styles/base.css` (`.skip-link`) | On every page. Pages that pass `skipTo` (piece, Kyriale, OF occasion, Vespers, Good Friday) say "Skip to music"; all others say "Skip to main content" and target `#main-content`. The move-in transition runs only without `prefers-reduced-motion: reduce` |
| Visible focus | `src/styles/base.css` (`:focus-visible`: 2px `--accent`, 2px offset, 2px radius) | Applies site-wide. The editor's hidden radio inputs show focus on the sibling label (spec; `src/styles/exportEditor.css`) |
| Target size | `--tap-min: 44px` in `src/styles/tokens.css`; buttons, `.nav-links a`, list links, jump links, disclosure summaries, labels | In-sentence and crumb links have no minimum |
| Latin language | `lang="la"` in `src/components/ChantText.astro`, `src/components/SystemStack.astro` (rubrics), `src/pages/ordinary-form/[key].astro`, `src/pages/good-friday/index.astro` | Page language is `en` (`Layout.astro`). See gap 5 |
| Live regions | 9 `aria-live` attributes on public pages: export bar, export editor, EF calendar, OF calendar, search, OF occasion note, and three on corrections (`#field-now`, `#form-status`, `#queue-list`). 12 `role="status"` on public pages (notices, export bar, editor, corrections, OF date message) plus 1 on the gated test page `src/pages/e2e/[page].astro`. Admin has 11 `aria-live` and 6 `role="status"` | One `role="alert"`, created in `src/scripts/exportLayout.ts` for global export errors only |
| Reduced motion | One rule: `src/styles/base.css` turns off the disclosure cue's rotation. Editor spec says no other transitions | The skip link's `top` transition is outside that rule. No `scroll-behavior: smooth` is set anywhere, so jump links scroll instantly |
| Native dialog | `src/components/ExportLayoutEditor.astro` / `src/scripts/exportLayout.ts`: `showModal()`, `aria-labelledby="cx-title"`, `aria-describedby="cx-sel"`, focus on the title, Esc closes, focus returns to the opener | Tested in `e2e/export-customize-lazy.e2e.ts` |
| Forced colours | None. No `forced-colors` or `prefers-contrast` rule found | Gap 7 |
| Dark mode | `@media (prefers-color-scheme: dark)` and `:root[data-scan-polarity="inverted"]` in `src/styles/tokens.css`; "Invert" button with `aria-pressed` in `Layout.astro`; scans inverted by `--score-filter: invert(1)` | Print forces light |
| Music text alternatives | `src/components/SystemStack.astro`: `<figure role="group" aria-labelledby>` with a visually hidden `<figcaption>` (piece, mode, source, page, system count, "cannot be read by a screen reader"). Scan images use `alt=""`. Typeset images use `alt="<part>: the music, typeset"`. `src/components/LineupStack.astro`: per-section hidden caption. Chant notation SVG gets `role="img"` and `aria-label="Chant notation: <incipit>"` (`src/scripts/chantNotation.ts`). Latin chant words are in the HTML | The caption does not say what the chant-words disclosure or the chant toggle is |
| Export editor semantics | Fieldsets with legends, radio groups with labels, steppers with labelled buttons, `aria-pressed` on the break toggle, page frames with `aria-label="Page n of N: …"`, break handles with long labels and a roving tab stop | Per spec section 5 |
| Viewport and zoom | `<meta name="viewport" content="width=device-width, initial-scale=1">` with no zoom lock; type in `rem` and `clamp()` | |
| Colour not the only signal | Calendar colour swatch is `aria-hidden` and the colour name is written; the editor's checked state changes weight and border width | |
| Print | `@media print` in `src/styles/base.css` hides navigation and controls | |

### Contrast, measured

Computed with the WCAG 2.x relative luminance formula on the hex values in
`src/styles/tokens.css`.

| Pair | Ratio | Meets |
|---|---|---|
| `--ink` on `--paper` (light) | 18.2:1 | AAA |
| `--ink-muted` on `--paper` | 8.1:1 | AAA |
| `--accent` on `--paper` | 10.9:1 | AAA |
| `--warn-ink` on `--warn-bg` | 8.4:1 | AAA |
| `--control-border` on `--paper` | 3.7:1 | 1.4.11 (3:1) |
| `--rule` on `--paper` | 1.7:1 | Fails 1.4.11 if used as a control edge |
| `--ink` on `--paper` (dark) | 15.0:1 | AAA |
| `--ink-muted` on `--paper` (dark) | 8.2:1 | AAA |
| `--accent` on `--paper` (dark) | 8.4:1 | AAA |
| `--warn-ink` on `--warn-bg` (dark) | 9.6:1 | AAA |
| `--control-border` on `--paper` (dark, system theme) | 3.9:1 | 1.4.11 |
| `--control-border` (light value) on dark `--paper` (explicit Invert) | 4.9:1 | 1.4.11 |
| `--rule` on `--paper` (dark) | 1.6:1 | Fails 1.4.11 if used as a control edge |
| Chant rubric `#d00` on white (PDF export, decision D29) | 5.2:1 | AA only, not 7:1 |

The comments in `tokens.css` state lower figures than these (for example 15.8,
7.4 and 8.9:1). Both sets pass AAA. Re-derive the comments when `tokens.md` is
written.

## 3. Known gaps

Each gap was checked in the code. The fix is the maintainer's call.

1. **CLOSED 2026-10-22: control borders used `--rule` (1.7:1).** Public buttons and inputs now use `--control-border`. Original finding: `src/styles/base.css` sets
   `button` and `.button` to `border: 1px solid var(--rule)`. The date field
   and the calendar and corrections inputs also use `--rule`:
   `src/pages/calendar/index.astro`, `src/pages/calendar/ordinary-form/index.astro`,
   `src/pages/search.astro`, `src/pages/corrections/index.astro`. Only the export
   editor and preview (`src/styles/exportEditor.css`, `exportPreview.css`) and
   the admin selects and textareas (`src/components/AdminNav.astro`) use
   `--control-border` (3.7:1). The admin review (`docs/ADMIN-UX-REVIEW.md`,
   section 2) found the same fault. Buttons with a filled `.primary` style pass.
2. **CLOSED 2026-10-22: no focus-not-obscured protection.** `ExportBar.astro` sets `scroll-padding-bottom: 8rem` below 62rem and scrolls a focused element clear of the pinned bar on `focusin` (`scroll-padding` alone does not move an element that is already on screen; found by `focus-clearance.e2e.ts` in a 600 px tall viewport). Original finding: Below 62rem the export bar is
   `position: sticky; bottom: 0` (`src/components/ExportBar.astro`) and no
   `scroll-padding-bottom` is set on public pages. Admin sets one
   (`AdminNav.astro`). A focused link in the music could sit under the bar.
3. **CLOSED 2026-10-22: skip link was missing on most pages and animated.** See table above. The
   `top` transition ignores `prefers-reduced-motion`.
4. **Status semantics are doubled on the switches.** The page-wide typeset
   switch (`src/components/TypesetSwitch.astro`) changes its text ("Show the
   scans" / "Show the typeset music") and also toggles `aria-pressed`. A screen
   reader hears a changed name and a pressed state. The per-part button
   (`SystemStack.astro`) changes text and toggles `aria-expanded`, though it
   does not control a collapsible region. "Invert" has a fixed name with
   `aria-pressed`, which is correct, but the name does not say what is inverted
   (the `title` does).
5. **CLOSED 2026-10-22: Latin text without `lang="la"`** (home, division, day, Vespers, hymns, both calendars). Original finding: Latin names print without the attribute
   in `src/pages/index.astro` (`.la`), `src/pages/[division]/index.astro`,
   `src/pages/day/[flex]/[name].astro` (lede), `src/components/VespersPage.astro`
   (lede), `src/pages/hymns/index.astro` ("Hymni"), `src/pages/calendar/index.astro`
   and the OF calendar client (`.latin`). AGENTS.md asks for the attribute.
6. **Live regions that replace whole pages of content.** The EF and OF
   calendars rebuild `#result` (`aria-live="polite"`) on each date change, so a
   screen reader may read the whole block. Search announces the result list but
   no count, and shows at most 25 results with no "more". Focus does not move
   on any of them.
7. **No forced-colours support.** No `forced-colors` rule exists, and the
   scans and typeset music rely on `filter`. Not tested.
8. **CLOSED 2026-10-22: explicit "Invert" did not set `--control-border`.** It now matches the system-dark value. The system-dark block
   sets 3.9:1; the explicit-inverted block (`:root[data-scan-polarity="inverted"]`)
   does not, so it inherits the light value (4.9:1 on dark). It passes, but the
   two dark themes use different values.
9. **Chant rubrics in the PDF are `#d00` on white (5.2:1).** This was the
   maintainer's choice (D29). It is below the agreed 7:1 target and needs a
   recorded exception or a change.
10. **Public pages link to editors.** Every part heading and piece footer shows
    "Edit" (read as "Edit … (editors)" by screen readers). Not a failure, but it
    adds a stop for every part.
11. **Error colour.** Error status text uses `--warn-ink` on `--paper`
    (`src/components/ExportBar.astro`, `src/pages/corrections/index.astro`),
    which is hard to tell from body text by colour. The messages carry words
    ("Can't…", "Could not…"), so meaning is not lost, but there is no icon or
    prefix.
12. **Unverified by eye.** In dark mode an inverted scan turns white to `#000`
    while the page is `#14140f`. Check whether the edge of each scan shows.

Not checked: screen-reader output (no VoiceOver or NVDA pass), the admin screens
at 320 px, and `Turnstile`'s own accessibility.

## 4. How it is tested today, and what is missing

Existing checks:

- `e2e/a11y.e2e.ts` runs axe (`@axe-core/playwright`, WCAG 2 A/AA, 2.1 and 2.2 AA tags) over one URL per template from `routes.json`, in light and dark system schemes, failing on serious or critical violations. Its allowlist is empty: no violations found on 2026-10-22. Axe does not measure control-border contrast (1.4.11), the 7:1 target, focus obscured, or Invert.
- Editor: 44 px targets, handle hit areas, `aria-label` text on page frames and
  break handles, `aria-expanded` on Settings, Esc and focus return, keyboard
  breaks and undo, one live region, labelled radio groups.
  Files: `e2e/export-layout-editor.e2e.ts`, `e2e/export-layout-preview.e2e.ts`,
  `e2e/export-customize-lazy.e2e.ts`, `src/components/ExportLayoutEditor.test.ts`,
  `src/components/ExportPagePreview.test.ts`.
- Admin: focus moves to the next item after an action (`toBeFocused`), and a 375 px phone check that an error shows in view and the item fits the width, in `e2e/admin.e2e.ts`.
- Disclosures with the keyboard: `src/components/Disclosure.test.ts`.
- Viewports used by Playwright specs: 390 by 844 and desktop; one iPad Pro 11
  project (`export-device.e2e.ts`). None at 320.

Checks needed to verify the agreed target (nothing here exists yet):

1. A token contrast test (criteria 1, 2, 11).
2. An axe pass over one built page per template in light, dark and inverted
   (criteria 1, 2, 15).
3. A Playwright "a11y" spec with: 320 px reflow; text-spacing stylesheet;
   Tab-order and focus-obscured check at 768 px; target-size walk;
   `reducedMotion`, `colorScheme` and `forcedColors` emulation.
4. A keyboard-only run of the main journeys.
5. A manual VoiceOver pass on a piece page, the calendar and the export dialog,
   recorded in this folder with a date.
