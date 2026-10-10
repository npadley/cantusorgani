# Export layout editor: approval mockups (card B1, gate G0)

`editor.html` is one self-contained file: `tokens.css` and `base.css` are inlined (base.css without its first line, an `@import` of tokens.css that cannot resolve inline), followed by the editor CSS from the UI spec and vanilla JS. It makes no external requests. It references two checked-in SVGs by relative path (`assets/kyrie-ix-mei-page1.svg`, `assets/kyrie-ix-lilypond.svg`), so keep the `assets/` folder beside it. Open it in a browser (file URL is fine); the editor opens on load, as a native `<dialog>` via `showModal()`.

Everything on the preview pages is a **simulation**. The music is a fixed crop of the checked-in Kyrie IX SVG, and the page count, systems per page and blank-page rules come from a small model in the script. Nothing here is Verovio output, and staff size changes system count and spacing more than glyph size.

## Scenario switcher

A small bar fixed at the bottom of the screen, labelled "Prototype control", with a select of all scenarios. The URL `editor.html?s=N` opens scenario N directly. Scenarios set state directly; the controls also work (segmented controls select, the stepper changes the cap, the Print / iPad / Custom tiers swap, the page aspect ratio follows the preset, and a change shows "Updating preview…" for about 0.7 s before the preview swaps).

## Scenario checklist

| # | How to reach it | What you should see |
|---|---|---|
| 1 | `?s=1` | Letter portrait, Medium, "As many as fit (now 4)", result line "2 pages · 4 + 1 systems", Download enabled "Download PDF · 2 pages" |
| 2 | `?s=2` | iPad tier, 11-inch iPad, portrait, 4 mm margins (dashed margin guide visible), page ratio 157.8 : 227.1, label "Page 1 of 2 · 11-inch iPad, portrait" |
| 3 | `?s=3` | Custom tier, 160 × 230 mm, width and height inputs and mm/in toggle, helper "90–450 mm (3.5–17.7 in) each side." |
| 4 | `?s=4` | Kyrie (customizable), Gloria (original scan, grey strips "Original scan (simulated)"), Credo (fixed typeset layout, 2 pages). Result "Kyrie: 2 pages · Gloria: 3 pages (scan) · Credo: 2 pages (fixed)"; capability text per part; "Applies to / Not to" line |
| 5 | `?s=5` | iPad mini, Large, Spacious: page 1 carries "The rest of page 1 is blank: the next system doesn't fit." |
| 6 | `?s=6` | "Choose where systems break" pressed, handles on every page, 3 user breaks, menu open at break point 4 of 23 ("eléison"). Arrow keys move between handles; Esc closes the menu |
| 7 | `?s=7` | iPad mini landscape, Large: `.notice` "Can't fit Kyrie: …" with buttons "Use Medium music", "Switch to portrait", "Remove the page break after 'eléison'". Previous preview kept, Download disabled. Press a button to see it resolve |
| 8 | `?s=8` | "Updating…" in the result line, "Updating preview…" in the toolbar and status, Download disabled. Any control change ends it |
| 9 | `?s=9` | Global `.notice` with "Try again" and "Use original layout" (the latter closes the dialog, focuses Export PDF and sets the host status) |
| 10 | `?s=10` | Continuous view: reading-view notice, no frames, bottoms cropped, "Page 2 begins" dividers |
| 11 | `?s=11` | "This browser isn't saving site settings…" at the bottom of the settings column |
| 12 | `?s=12` | Stale-anchor `.notice` with Dismiss in the Breaks group; the same sentence in the status line |
| 13 | `?s=13` (add `&panel=1` to open the panel) | Phone layout (a forced 390 px frame on wider screens): header, FIT strip, preview, footer; the Settings button opens a bottom sheet. Open the page at 390 px wide to see it for real |
| 14 | `?s=14` | Extra, not on the card: scans and fixed parts only, so music size, line breaks and More options are replaced by one sentence (UI 1.4 capability rules) |

## Layout below 62rem (preview first)

Below 62rem (iPad portrait 768, phone 390) the order is header, a fixed **FIT strip** (Music size, Systems per page stepper, result line, **Settings** button), the preview, then the footer. The Settings button opens a panel with In this PDF, Page, Breaks and More options: a 22rem side panel from the right at 768 (the preview shrinks beside it and keeps updating), and a bottom sheet of at most 85dvh at 390. Done, the Settings button and Esc close it (Esc closes the panel first, then the dialog); focus returns to the Settings button. Turning on break editing closes the panel. At 62rem and above nothing changes. Add `&panel=1` to the URL to open the panel on load.

## Screenshots (`screens/`)

Captured by `capture.mjs` at 1280×800, 768×1024 and 390×844:
`s01-kyrie-ready-{1280,768,390}`, `s01-kyrie-ready-zoom50-1280`, `s01-kyrie-ready-panel-768`, `s02-ipad-11-panel-{768,390}`, `s04-mixed-parts-panel-390`, `s02-ipad-11-{1280,768,390}`, `s04-mixed-parts-{1280,768,390}`, `s04-mixed-parts-scan-page-1280`, `s06-break-editing-{1280,768,390}`, `s06-break-editing-menu-1280`, `s07-impossible-layout-{1280,390}`, `s13-narrow-fit-strip-390`. All `.png`, each under 400 KB.

Regenerate and check:

```
cd web && pnpm install --frozen-lockfile && pnpm exec playwright install chromium
node docs/superpowers/mockups/export-layout/capture.mjs
```

The script prints PASS or FAIL for: the first page visible without scrolling and the FIT strip height at 768 and 390 (scenarios 1 and 2); the Settings panel opening, closing, focus return, Esc order, 44 px targets with the panel open, and the preview beside it at 768; tab order at 62rem and above and below it; all 14 scenarios render; one polite live region; every visible interactive element at least 44×44 px at 1280, 768 and 390 (with every `<details>` opened); tab order for scenario 1; no horizontal scroll at 390; the controls working; no Lettering or Music-symbol controls; no console errors or external requests.

## Known deviations from the UI spec

- **Prototype bar sits inside the `<dialog>`.** A modal dialog makes everything outside it inert, so a bar outside would be unusable. It is `position: fixed`, last in the DOM, and the dialog is shortened by its height (`--proto-h`, 3.5 rem) so the footer stays visible. Spec says the dialog is `100dvh`.
- **Breakpoints are applied by script** (`data-bp="wide|mid|phone"` from `matchMedia` at 62 rem and 40 rem), not by CSS media queries, so scenario 13 can show the phone layout on a desktop. B8 should use plain media queries.
- **FIT group moves between places.** The same DOM node sits in the settings column at 62 rem and above and in the strip below it. In the strip the group labels and helper text are visually hidden or omitted, and the "Applies to / Not to" lines are not shown there (the panel's part list carries the capability text).
- **Host page.** A minimal stand-in for the Mass page with the "Customize export" button and `#export-status`, so Close and "Use original layout" have somewhere to return focus.
- **Simulated layout model.** System count per page, the blank-page rule (unused height over 25% and the next system does not fit), break-point positions (23 per Kyrie, spread evenly) and the effect of user breaks (a page break snaps to the nearest system boundary; a system break adds one system) are invented for the mockup.
- **Export** is a timed text simulation ("Preparing PDF — page k of N"); no file is produced.
- **Loading and "rendering (first)" states** are not shown (not on the card's list).
- Native radios are used inside `role="radiogroup"` wrappers so each set has a visible label.
- The Page and Breaks groups are plain always-open fieldsets at every width; the old per-group `<details>` collapse and value summaries are gone. Only More options is a `<details>`.
- The `.primary` and `.link` classes and `--print-paper` / `--print-ink` are defined in the editor CSS because the coordinator has not yet promoted them into `base.css` / `tokens.css`.

## Decisions for review

1. **Global error** is announced once: the `role="alert"` paragraph carries the sentence and `#cx-status` is left empty (accepted decision).
2. **"fills the screen in forScore and similar apps"** is true only in forScore's Best Fit mode (S7), and the Pro 11 has a 1.9 mm blank strip. I kept the spec's wording as the iPad helper text; suggest "(Best Fit)" or softer wording.
3. **The "Systems per page" stepper's `+` is disabled at "As many as fit"**, as specified, so it drops out of the tab order (the tab-order check expects that).
4. **The "Applies to / Not to" line sits under the FIT legend**, since the spec says "under the Music legend" and there is no such legend.
5. **Article in the copy**: "{paper}" becomes "an iPad mini landscape page" / "a Letter portrait page" (a/an chosen by script).
6. **Scenario 7 shows three buttons**, adding "Remove the page break after 'eléison'" (a state-matrix example) to the two system-too-tall suggestions.
7. **Margin input** clamps silently to 3–25 on commit (the spec defines no message for margins).
8. **Mixed parts** no longer push the preview down: the settings live in the panel, and the first page is visible at 768 and 390 in every scenario (checked for 1 and 2).
9. **Scenario 14 added** to demonstrate the "no customizable part" rule.
