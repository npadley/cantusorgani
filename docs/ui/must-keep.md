# Must keep: no-regression checklist for any redesign

Status: baseline on 2026-10-22, read from the code. A redesign must keep every
line below, or the maintainer must approve the removal in writing
(AGENTS.md, "Ask the maintainer first"). A control missing from a mockup is
unmodeled, not deleted.

Paths are relative to `web/` unless they start with `docs/`. "Verify" names an
existing test file where one exists. "Manual" gives a step to try by hand.
"No test" means none was found in `src/**/*.test.ts` or `e2e/`.

Related: [journeys.md](journeys.md), [accessibility.md](accessibility.md),
[templates.md](templates.md), [tokens.md](tokens.md).

Run before and after a redesign: `scripts/check.sh` (everything) and
`cd web && pnpm test:e2e` (build first; export specs need `pnpm build:e2e` and
`pnpm test:e2e:export`).

## 1. Navigation and finding

| Capability | Where | How to verify |
|---|---|---|
| Header links: brand "Cantus Organi", "Extraordinary Form (1962)" (short "EF (1962)"), "Ordinary Form" ("OF"), "Search", "About", "Corrections"; short forms keep full accessible names | `src/components/Layout.astro` | `e2e/ordinary-form.e2e.ts` ("names both forms in the header", "uses short labels on a narrow header") |
| Footer links: "Sources and attributions", "Report an error", "AI discovery guide" (`/llms.txt`) | `src/components/Layout.astro` | Manual: open any page, check the three links. `pnpm check:seo` covers `/llms.txt` |
| Home: two calendar cards (EF and OF), "The books" list including Hymns, count per book, note on books not yet catalogued | `src/pages/index.astro` | `e2e/ordinary-form.e2e.ts` ("home page links directly…", "home calendar cards sit side by side…") |
| EF calendar: date field, "‹ Day", "Today", "Next Sunday", "Day ›"; opens on today; `?date=` in the URL; Proper, Ordinary, Vespers lines; "all for this day"; commemorations; Good Friday link | `src/pages/calendar/index.astro`, `src/lib/liturgy.ts` | `src/lib/liturgy.test.ts`, `src/lib/goodFriday.test.ts`. Manual: step through a week; open `/calendar/?date=2026-12-25` |
| EF calendar noscript message | `src/pages/calendar/index.astro` | Manual: disable JavaScript |
| OF calendar: same date controls, range 2024–2050, inline message for bad dates, season with Year A/B/C and weekday year, chant list, "View accompaniments for this occasion", two-choice local celebration links, back/forward restores the date | `src/pages/calendar/ordinary-form/index.astro`, `src/lib/ordinaryFormCalendarClient.ts` | `e2e/ordinary-form.e2e.ts` (back and forward, Enter, invalid dates, transfers, Corpus Christi); `src/lib/ordinaryFormCalendarClient.test.ts` |
| OF static directory "Browse Ordinary Form chant sets" (works without JavaScript) | `src/pages/calendar/ordinary-form/index.astro` | `e2e/ordinary-form.e2e.ts` ("Ordinary Form pages are discoverable…") |
| OF occasion page: title, Latin title, rubric, notices, `?cycle=&season=` preselects export boxes without hiding music | `src/pages/ordinary-form/[key].astro`, `src/lib/ordinaryFormPageClient.ts` | `e2e/ordinary-form.e2e.ts` ("cycle and season links filter…"); `src/components/OrdinaryFormPage.test.ts`; `src/lib/ordinaryFormPageClient.test.ts` |
| Day pages: name, Latin name, class and colour, "next on <date>", Proper list, part-link rows, Ordinary, Vespers, "Hymns for the Office" | `src/pages/day/[flex]/[name].astro`, `src/components/PieceList.astro`, `src/components/PartLinks.astro` | `src/components/ExportBar.test.ts` ("PartLinks"); `src/lib/indexes.test.ts` (divisions and indexes; no test of the day page itself) |
| Piece pages and Kyriale Mass pages, with one address per piece (Kyriale `/piece/` redirects to `/kyriale/<n>/`) | `src/pages/piece/[slug].astro`, `src/pages/kyriale/[mass].astro` | `src/components/Seo.test.ts`; `src/components/PiecePage.test.ts` |
| Jump row "Jump to" / "Parts of the Proper" / "Movements" / "Hymns", with links to parts printed in other volumes | `src/components/MovementNav.astro` | `src/components/MovementNav.test.ts` |
| Division pages (Proper of Time by season, Proper of Saints by month, Common, Kyriale, Defunctorum, Vespers, Varia) | `src/pages/[division]/index.astro`, `src/pages/kyriale/index.astro`, `src/lib/indexes.ts` | `src/lib/indexes.test.ts` |
| Kyriale index with "On this page" table of contents | `src/pages/kyriale/index.astro` | Manual: check the index anchors. `src/components/MovementNav.test.ts` covers movement anchors on individual Masses |
| Hymns index: A–Z, "NOH <part> · p. N", GregoBase link, "pairing needs review" label | `src/pages/hymns/index.astro` | `e2e/hymns.e2e.ts`; `src/lib/hymnpairings.test.ts` |
| Search: field "Search chant words, titles and modes", lyrics beyond the incipit, highlighted excerpt, "Ordinarium Missae" fallback when blank, no-match help | `src/pages/search.astro` | `e2e/search.e2e.ts` |
| Vespers: dated pages, I Vespers pages, "Order of Vespers" jump row, coming evenings and "Every date (n)", console line | `src/pages/vespers/`, `src/components/VespersPage.astro`, `src/components/VespersDates.astro` | `e2e/site.e2e.ts` ("should link each antiphon of a Vespers page, and list the coming evenings"); `src/components/LineupStack.test.ts`; `src/lib/vespers.test.ts` |
| Good Friday page (chant only, both calendars, "The organ is silent") | `src/pages/good-friday/index.astro` | `src/lib/goodFriday.test.ts`; `e2e/ordinary-form.e2e.ts` |
| 404 page with Search, Calendar and Home links; a real HTTP 404 | `src/pages/404.astro` | `e2e/not-found.e2e.ts` |
| About page with anchors `#what`, `#how`, `#limits`, `#corrections`, `#typeset`, `#sources` (linked from notices and the footer) | `src/pages/about.astro` | `e2e/site.e2e.ts` ("should credit the transcriptions on the About page") |
| Breadcrumb line on content pages | each page's `.crumb` | Manual |
| Every page reachable by a link from `/` | `scripts/check-links.ts` (part of `pnpm build`) | `pnpm build` |

## 2. Reading the music

| Capability | Where | How to verify |
|---|---|---|
| Scans shown at one scale per piece, each slot reserving its height (no reflow while loading) | `src/components/SystemStack.astro`, `src/components/LineupStack.astro` | `src/components/LineupStack.test.ts` ("should draw every system at one scale across sources"). Manual: throttle the network on a long Mass |
| Failed system image shows "System N of M could not be loaded…" and the rest still shows | `SystemStack.astro`, `LineupStack.astro` | `src/components/LineupStack.test.ts` ("should name the item in a slice's error message…") |
| Page-wide switch "Show the scans" / "Show the typeset music", remembered (`typeset-view`) | `src/components/TypesetSwitch.astro` | `e2e/site.e2e.ts` ("should swap the whole page to the scans, and remember it") |
| Per-part switch "Show the scan" / "Show the typeset music", for the visit | `src/components/SystemStack.astro` | `e2e/site.e2e.ts` ("should swap one part to its scan with its own switch") |
| Scan fallback when a typeset drawing cannot load; "Typeset, proofread" / "Typeset, not yet proofread" state | `SystemStack.astro` | `e2e/site.e2e.ts` ("should fall back to the scans when the drawing cannot be loaded") |
| Polarity "Invert" (header, `aria-pressed`): page and scans, system theme default, remembered (`scan-polarity`), set before first paint | `src/components/Layout.astro`, `src/styles/tokens.css` | `src/components/Polarity.test.ts`; `e2e/site.e2e.ts` ("should invert the scans for a dark loft, and remember it") |
| Chant display: checkbox "Show the chant with each part" (Vespers: "…each antiphon and hymn"), off by default, remembered (`chant-display`), drawn with Exsurge | `src/components/MovementNav.astro`, `src/components/VespersPage.astro`, `src/scripts/chantNotation.ts`, `src/lib/gabc.ts` | `e2e/site.e2e.ts` ("should draw the chant above each part when the switch is on"); `src/components/MovementNav.test.ts` ("chant notation beside each part"); `src/lib/gabc.test.ts`; `src/lib/exsurgeLoader.test.ts` |
| Chant failure message "The chant could not be drawn here…" | `src/scripts/chantNotation.ts` | Manual: block `/chant/<id>.json` |
| Chant words as collapsed Latin text without JavaScript, with credit | `src/components/ChantText.astro` | `src/components/ChantText.test.ts`; `src/components/Disclosure.test.ts` |
| Per-part "Chant" link to GregoBase (new tab) and "Chant for the whole Proper" (jgabc) | `SystemStack.astro`, `PartLinks.astro`, `src/pages/piece/[slug].astro` | `src/components/MovementNav.test.ts` ("should put the chant link beside the heading…") |
| Chant pairing box with "Suggest a chant" and the "Unverified pairing" notice | `src/components/ChantPair.astro` | Manual: open a piece with no chant; no test found for the notice |
| Record-status notice "Catalogued, not yet verified." with "Something here is wrong" and the reassurance that the scans are not in doubt | `src/components/RecordStatusNotice.astro` | No test. Manual: open an unverified piece |
| "No music of its own" notice, by-reference notice, borrowed-part notices, `sourceNote` | `SystemStack.astro`, `src/pages/piece/[slug].astro` | `src/components/PiecePage.test.ts` |
| Part headings with printed label, rubric (Latin and English) above the music, "Music from …" line | `SystemStack.astro` | `src/components/Sections.test.ts` |
| Hymn settings, related hymns in Book VII, Vespers dates on Vesperale pieces | `piece/[slug].astro`, `HymnChantLinks.astro`, `VespersDates.astro` | `e2e/hymns.e2e.ts` |
| Vespers: tone in heading, tone-bank provenance, "Continue every verse…", psalm text disclosure, quiet notes for unaccompanied items | `LineupStack.astro` | `src/components/LineupStack.test.ts` |
| Skip link "Skip to music" (piece, Kyriale, OF, Vespers, Good Friday); Good Friday targets `#chants` | `Layout.astro` (`skipTo`) | No test. Manual: press Tab once on a piece page |

## 3. Export

The bar's button is labelled "Export PDF (N systems, ~P pages)". The docs call
it Quick export (analytics name: `quick`).

### 3a. Export bar (Quick export)

| Capability | Where | How to verify |
|---|---|---|
| Bar on every page that has music: piece, Kyriale, day, OF, Vespers; sticky at the bottom below 62rem | `src/components/ExportBar.astro` | `e2e/export-customize-lazy.e2e.ts` samples two Kyriale pages and one piece. Check day, OF, Vespers and sticky positioning manually |
| "Choose parts (n of m)" disclosure, fieldset "Parts to export", one checkbox per part with system count; hidden when one part | `ExportBar.astro` | `src/components/ExportBar.test.ts` ("should offer each part in a fieldset…"); `src/components/Disclosure.test.ts` |
| Season defaults on day pages with a note naming the date (no Tract in October); all ticked on piece pages | `ExportBar.astro`, `src/lib/exportParts.ts` | `src/components/ExportBar.test.ts` ("should untick the Tract in October…"); `src/lib/exportParts.test.ts` |
| Button "Export PDF (N systems, ~P pages)"; "Tick at least one part" when none; disabled over 300 systems with the parts to untick | `ExportBar.astro`, `src/lib/pdf.ts`, `src/lib/config.ts` | `src/lib/pdf.test.ts`; `src/lib/config.test.ts`; `e2e/export-customize-lazy.e2e.ts` ("the button follows the quick export's disabled rule") |
| "Paper" select: "Letter (8½ × 11)" and "A4", remembered (`export-paper`) | `ExportBar.astro` | `e2e/site.e2e.ts` ("should export Letter pages by default…", "should remember A4, and export A4 pages") |
| Progress bar, "Building PDF — system n of N", "PDF ready — N systems, P pages, S MB", download of `<title>.pdf` | `ExportBar.astro`, `src/workers/pdf.worker.ts` | `e2e/site.e2e.ts` ("Export with typeset music") |
| Typeset parts go in as their own pages; scans go in when the reader is looking at scans; a failed typeset fetch falls back to scans and says so | `ExportBar.astro`, `src/lib/typeset.ts` | `e2e/site.e2e.ts` ("should put the scans in, and say so, when a typeset PDF cannot be fetched") |
| Part headings and bilingual section rubrics carried into the PDF; excluded parts drop their rubric | `ExportBar.astro`, `src/lib/exportSelection.ts` | `src/components/Sections.test.ts` ("exports the affected section's bilingual instruction…"); `src/lib/exportSelection.test.ts` |
| OF export: composed lender assets, Letter, A4 and scans, no section dropped | `src/pages/ordinary-form/[key].astro` | `e2e/ordinary-form.e2e.ts` ("builds Letter, A4, and scan PDFs…") |
| Export analytics (one event, no personal data) | `src/lib/exportAnalytics.ts` | `src/lib/exportAnalytics.test.ts` |
| Quick export has no chant (D28) | `ExportBar.astro` | Manual: quick-export with chant shown. `e2e/export-chant.e2e.ts` covers customized exports only |

### 3b. Customize export (dialog)

| Capability | Where | How to verify |
|---|---|---|
| Button "Customize export" ("Opening…" while loading), disabled by the same rule as Export PDF; editor code and Verovio load only on click; a `#customize-export` fragment is stripped and never opens it | `ExportBar.astro`, `src/scripts/exportLayout.ts` | `e2e/export-customize-lazy.e2e.ts` |
| Full-screen native `<dialog>`: heading "Customize export", selection summary, "Close", Esc, Back closes, focus returns to the button | `src/components/ExportLayoutEditor.astro` | `e2e/export-customize-lazy.e2e.ts`; `src/components/ExportLayoutEditor.test.ts`; `e2e/export-layout-editor.e2e.ts` |
| "Music size": Small (5.6 mm), Medium (7.2 mm), Large (9.6 mm) | `ExportLayoutEditor.astro` | `src/components/ExportLayoutEditor.test.ts` ("should offer the specified controls…") |
| "Systems per page": "Fewer systems per page" / "More systems per page", "As many as fit (now N)", 1–8 | `ExportLayoutEditor.astro` | `e2e/export-layout-editor.e2e.ts` (aria-label "Already as many as fit") |
| "Page size": Print (Letter, A4, A5), iPad (iPad mini, 11-inch iPad, 13-inch iPad), Custom ("Width", "Height", mm / in, 90–450 mm) | `ExportLayoutEditor.astro`, `src/lib/export-layout/limits.ts`, `settings.ts` | `src/lib/export-layout/limits.test.ts`; `src/lib/export-layout/settings.test.ts`; `e2e/export-layout.e2e.ts` |
| "Orientation": Portrait, Landscape | `ExportLayoutEditor.astro` | `e2e/export-layout-editor.e2e.ts` |
| "Margins": "Smaller margins" / "Larger margins" and a mm field, 3–25 mm | `ExportLayoutEditor.astro` | `src/lib/export-layout/settings.test.ts` |
| "Line breaks": "Original", "Fit to page" | `ExportLayoutEditor.astro` | `e2e/export-layout-editor.e2e.ts` |
| "Choose where systems break" (manual breaks): handles, menu, keyboard, "Done", "Undo", Ctrl/Cmd+Z, stale-break notice | `ExportLayoutEditor.astro`, `src/scripts/exportBreakEditor.ts` | `e2e/export-layout-editor.e2e.ts`; `src/scripts/exportBreaks.test.ts` |
| "Chant": "Off", "Before each part", "Chant only"; default follows the page preference (D26) | `ExportLayoutEditor.astro`, `src/lib/exportChants.ts` | `e2e/export-chant.e2e.ts`; `src/components/ExportLayoutEditor.test.ts` ("should put the Chant fieldset after Breaks…") |
| "More options": "Sung text size" (Small, Medium, Large); "Space between systems" (Compact, Normal, Spacious) | `ExportLayoutEditor.astro` | `src/components/ExportLayoutEditor.test.ts` |
| "Settings" panel and "Done" below 62rem; two columns above | `ExportLayoutEditor.astro`, `src/styles/exportEditor.css` | `e2e/export-layout-editor.e2e.ts` (viewports 390, tablet and desktop) |
| "In this PDF" part list; "Applies to … Not to …" for mixed selections; "Music size and line breaks apply only to customizable typeset…" for scan-only | `ExportLayoutEditor.astro`, `exportLayout.ts` | `e2e/export-nonreflow.e2e.ts` |
| Preview: "View" Pages / Continuous; "Zoom out", "Zoom in", "Fit width"; page frames labelled "Page n of N: …" | `src/components/ExportPagePreview.astro`, `src/scripts/exportPagePreview.ts` | `src/components/ExportPagePreview.test.ts`; `e2e/export-layout-preview.e2e.ts` |
| Footer: "Reset layout", "Cancel" while exporting, "Download PDF · N pages", "Preparing PDF…"; one polite status region | `ExportLayoutEditor.astro`, `exportLayout.ts` | `e2e/export-layout-editor.e2e.ts`; `src/components/ExportLayoutEditor.test.ts` ("should have exactly one live region…") |
| Settings remembered in the browser (`export-layout-v2`), with a message when storage is blocked or unreadable | `src/lib/export-layout/preferences.ts` | `src/lib/export-layout/preferences.test.ts` |
| Error copy ("Can't…") with a single action; no diagnostic codes shown | `src/scripts/exportLayoutCopy.ts` | `src/components/ExportLayoutEditor.test.ts` ("copy deck") |
| iPad on the LAN (insecure context) | `scripts/serve-device-test.ts` | `e2e/export-device.e2e.ts` (WebKit with `E2E_WEBKIT=1`) |
| PDF matches the canonical layout | `scripts/verify-export-pdf.ts` | `scripts/verify-export-pdf.test.ts`; `e2e/export-layout.e2e.ts` |
| Parts that cannot reflow still export (scaled LilyPond pages, scans) | `exportLayout.ts` | `e2e/export-nonreflow.e2e.ts` |
| Download filename names the preset for iPad and Custom pages | `exportLayout.ts` | `e2e/export-layout-editor.e2e.ts` ("Missa IX · Kyrie (11-inch iPad).pdf"); `e2e/export-customize-lazy.e2e.ts` |

## 4. Corrections and reporting

| Capability | Where | How to verify |
|---|---|---|
| Form: "Which piece?", "What is wrong?", "What should it be?", "Anything else? (optional, not published)", "Send correction"; current value "Now: …"; Mode disabled for a Proper | `src/pages/corrections/index.astro` | `e2e/site.e2e.ts` ("The Corrections form") |
| Turnstile check, disabled-form notice when not configured, error and success messages | `corrections/index.astro`, `src/lib/config.ts` | Manual: submit without the check. `src/lib/config.test.ts` |
| Deep links `?target=piece:…`, `part:…`, `vespers:…`, `pairing:…`, `typeset:…&seen=…`, and `?piece=&field=` | `corrections/index.astro`, `src/components/ReportLinks.astro` | `e2e/site.e2e.ts` ("Report links"); `e2e/corrections.e2e.ts` |
| Report links beside parts and Vespers items ("Report · Edit", names for screen readers); "Report a music error" beside typeset music; "Report an error" on piece pages | `ReportLinks.astro`, `SystemStack.astro`, `piece/[slug].astro` | `e2e/site.e2e.ts` ("should open the Corrections form on a part…") |
| "Recent corrections" table with status, "fix #n", "report #n", "Published change" link; never shows the submitter's note | `corrections/index.astro` | `e2e/corrections.e2e.ts` |
| Corrections log at `/corrections/log/` (Date, What, Changed, From, To, Reported by) | `src/pages/corrections/log/index.astro`, `src/lib/correctionsLog.ts` | `src/lib/correctionsLog.test.ts` |
| Admin: Admin, Review, Typeset music, Make a correction; Accept, Reject, Duplicate, Publish changes; live counts; Undo | `src/pages/admin/`, `src/components/AdminNav.astro` | `e2e/admin.e2e.ts`; `e2e/typeset-source.e2e.ts` |

## 5. Offline and print

| Capability | Where | How to verify |
|---|---|---|
| Print stylesheet: navigation, controls, `.no-print` blocks and buttons hidden; scans unfiltered and unbroken; light colours forced | `src/styles/base.css` (`@media print`) | `src/components/Polarity.test.ts` checks white print background and removal of the music filter. Check the remaining print behavior manually |
| Exported PDF is the offline copy (there is no service worker or manifest today) | `ExportBar.astro` | Journey (b) |
| Preferences degrade quietly when browser storage is blocked (polarity, typeset view, paper, chant, export settings) | `Layout.astro`, `TypesetSwitch.astro`, `ExportBar.astro`, `gabc.ts`, `preferences.ts` | `e2e/ordinary-form.e2e.ts` ("handles invalid dates and blocked settings storage…"); `src/lib/export-layout/preferences.test.ts` |
| Sticky export bar for one-handed use on a console tablet (below 62rem) | `ExportBar.astro` | Manual: iPad width |

## 6. SEO constraints (from `docs/SEO.md`)

| Constraint | Where | How to verify |
|---|---|---|
| Every HTML page has a canonical URL without query or fragment, a description, Open Graph and Twitter metadata; public pages carry JSON-LD | `src/components/Layout.astro`, `src/lib/seo.ts` | `src/components/Seo.test.ts`; `src/lib/seo.test.ts`; `pnpm check:seo` |
| Piece pages and dated Vespers pages each have their own canonical URL | `piece/[slug].astro`, `src/components/VespersPage.astro` | `src/components/Seo.test.ts` ("keeps dated Vespers canonical to their own date") |
| Query-string state (`?date=`, `?cycle=&season=`) never changes the canonical | `Layout.astro`, `src/lib/seo.ts` | `src/lib/seo.test.ts` ("normalizes bookmarked, parameterized and preview URLs to production") |
| Sitemap omits redirects, admin and API pages, `/search/`, the corrections form and the 404 page; includes the corrections log; no `lastmod` | `scripts/build-discovery.ts` | `scripts/build-discovery.test.ts`; `pnpm check:seo` |
| Admin pages `noindex, nofollow`; utility pages `noindex, follow`; never disallowed in `robots.txt` (crawlers must read the tag) | `Layout.astro`, `public/_headers`, `public/robots.txt` | `src/components/Seo.test.ts` ("keeps utility pages out of indexing") |
| Preview deployments and `pages.dev` aliases send `X-Robots-Tag: noindex` | `public/_headers` | Manual after deploy (SEO.md "After merging and deploying") |
| Unknown URLs return HTTP 404 via the top-level `404.html` | `src/pages/404.astro` | `e2e/not-found.e2e.ts` |
| `/llms.txt` linked from the footer; Latin chant text present in the HTML without JavaScript, with its source credit | `public/llms.txt`, `Layout.astro`, `ChantText.astro` | `src/components/ChantText.test.ts` |
| Pagefind indexes public pages only (`data-pagefind-ignore` on noindex pages) | `Layout.astro`, `pnpm build` | `e2e/search.e2e.ts` covers results only. No test for the ignore rule |
| Every page is linked from some other page | `scripts/check-links.ts` | `pnpm build` |

## 7. Accessibility features already present

Detail and gaps are in [accessibility.md](accessibility.md). Keep all of these.

| Capability | Where | How to verify |
|---|---|---|
| Visible focus ring (`:focus-visible`, 2px accent) on every control | `src/styles/base.css` | Manual: Tab through a piece page |
| Skip link | `Layout.astro`, `base.css` | Manual (no test) |
| 44px minimum targets (`--tap-min`) | `src/styles/tokens.css`, component styles | `e2e/export-layout-editor.e2e.ts` ("every interactive target is at least 44 px") covers the editor only |
| Native `<dialog>` with focus return, Esc, labelled title and description | `ExportLayoutEditor.astro`, `exportLayout.ts` | `src/components/ExportLayoutEditor.test.ts`; `e2e/export-customize-lazy.e2e.ts` |
| Scans described by a figure caption that says a screen reader cannot read them; typeset images have alt text | `SystemStack.astro`, `LineupStack.astro` | No test. Manual: screen reader on a piece page |
| `lang="la"` on chant words, rubrics and some Latin titles | `ChantText.astro`, `SystemStack.astro`, `ordinary-form/[key].astro`, `good-friday/index.astro` | `src/components/ChantText.test.ts` checks Latin chant attributes; `src/components/Sections.test.ts` checks Latin rubrics |
| Status messages in `role="status"` / `aria-live="polite"` regions | export bar, editor, calendars, search, corrections | `src/components/ExportLayoutEditor.test.ts` (one live region in the editor) |
| Labelled fields, radio groups, steppers; `aria-pressed` on Invert and typeset switches; `aria-expanded` on per-part switches | components above | `src/components/ExportLayoutEditor.test.ts` ("should label the settings region and every radio group") |
| Keyboard operation of disclosures and break handles (roving tab stop, arrow keys, Home, End) | `Disclosure`, `exportBreakEditor.ts` | `src/components/Disclosure.test.ts`; `e2e/export-layout-editor.e2e.ts` |
| Reduced motion for the disclosure cue; no motion elsewhere in the editor | `base.css` | Manual: set reduced motion |
| Dark mode and polarity inversion with contrast-checked tokens | `tokens.css` | `src/components/Polarity.test.ts` |
| Flat loading placeholder instead of a shimmer | `SystemStack.astro` | Manual |
