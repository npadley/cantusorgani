# Current user journeys

Status: baseline of the site as built on 2026-10-22. Written from the code in
`web/src`, not from the product intent. The last section is direction, not
current state.

Related: [templates.md](templates.md) (page by page), [tokens.md](tokens.md)
(design tokens), [must-keep.md](must-keep.md) (no-regression checklist),
[accessibility.md](accessibility.md).

How to read a journey: each step gives the page, the control (its visible
label, as the code prints it) and what the user sees. "Friction" lists things
visible in the code. It does not judge taste.

Shared chrome on every public page (`web/src/components/Layout.astro`): a
header with the brand link "Cantus Organi", "Extraordinary Form (1962)" (short
form "EF (1962)" below 44rem), "Ordinary Form" ("OF"), "Search", "About",
"Corrections", and a button "Invert". The footer links "Sources and
attributions", "Report an error" and "AI discovery guide".

## (a) Organist, Extraordinary Form: a date to the music

Goal: play today's Mass, or a chosen date's, from the scans or the typeset music.

1. `/` (home). The user sees two cards. They choose "What is sung today in the
   Extraordinary Form?".
2. `/calendar/`. The page opens on today's date with no click. It shows the
   date, the season (English and Latin) and one block per celebration: name,
   Latin name, colour swatch and rank, then a "Proper" line, an "Ordinary" line
   and, where there is one, a "Vespers" line. The URL becomes `?date=YYYY-MM-DD`.
3. To change the date the user uses the date field (label "Date", hidden
   visually) or the buttons "‹ Day", "Today", "Next Sunday", "Day ›".
4. Under "Proper" the user sees each catalogued piece as a link, plus "all for
   this day". Under "Ordinary" they see a link "Missa IX — Cum jubilo" (for
   example), the Kyriale heading, and "Also appropriate:" links.
5. Fastest route: click a Proper piece link. That opens
   `/piece/<slug>/`. Longer route: "all for this day" opens
   `/day/<flex>/<name>/`.
6. `/day/…` (day page). The user sees the name, Latin name, class and colour,
   "next on <date>", then "Proper" (a list of pieces with printed pages) and,
   under each piece, a row of part links ("Parts of …"). The page shows no
   music. It also shows "Ordinary", "Vespers", "Hymns for the Office" and, last,
   the export bar.
7. `/piece/<slug>/` (piece page). Top to bottom the user sees:
   - the title, and a line with label, printed pages and system count;
   - notices (for example "Catalogued, not yet verified." with "Something here
     is wrong");
   - a "Jump to" row of part links;
   - a checkbox "Show the chant with each part" (only if a part has chant);
   - the export bar (journey b);
   - a button "Show the scans" with a "not yet proofread" note (only if some
     music is typeset);
   - the music: a heading per part with "Chant" (GregoBase) and "Report · Edit"
     links, then the systems.
   A link "Skip to music" appears on focus (first Tab stop) on this page.
8. Reading controls:
   - "Invert" (header) flips the page and the scans between light and dark. It is
     remembered in this browser.
   - "Show the scans" / "Show the typeset music" (page-wide) and "Show the
     scan" / "Show the typeset music" (per part) choose typeset or scan. The
     page-wide choice is remembered; a per-part choice lasts for the visit.
   - "Show the chant with each part" draws the GregoBase chant above each part
     with Exsurge. It is off by default and remembered (`chant-display`).

Friction (from the code):

- Three blocks of controls sit before the first note on a piece page: the jump
  row, the export bar and the typeset switch.
- The day page lists parts as links and shows no music. The user needs a
  second click to read, and the export bar sits at the bottom of that page.
- The date chosen in the calendar is lost on the way to `/day/…`. The day page
  works out "next on <date>" at build time (`findNextDate(key, today())`), and
  the Ordinary suggestion and the default part ticks follow that date. The
  page says which date it used.
- `/calendar/` builds its result in the browser. Without JavaScript the user
  sees "The calendar needs JavaScript to look up a date."
- There is no previous or next piece link on a piece page. The user goes back
  to the day or uses the jump row.
- No service worker or web manifest exists in `web/src` or `web/public`. Images
  other than the first two load lazily, so a dropped connection at the console
  leaves later systems blank. A failed image shows "System N of M could not be
  loaded. The rest of this piece is shown below."
- "Edit (editors)" and the "Report · Edit" pair appear to every reader beside
  each part. The Edit link leads to the admin screen.

## (b) Organist: exporting a PDF

Goal: one PDF of chosen parts for forScore, an iPad reader or print. The export
bar (`ExportBar.astro`) appears on piece, Kyriale, day, Ordinary Form and
Vespers pages. Below 62rem it sticks to the bottom of the screen.

### Quick export

1. On any page with the export bar. A disclosure "Choose parts (n of m)" lists
   the parts as checkboxes (fieldset legend "Parts to export", each with its
   system count). It is hidden when the page has one part. On a piece page every
   part is ticked. On a day page the ticks follow the season of the date used,
   and a note says why (for example no Tract in October).
2. Optional: select "Paper": "Letter (8½ × 11)" or "A4". It is remembered.
3. Click the button "Export PDF (N systems, ~P pages)". With nothing ticked it
   reads "Tick at least one part" and is disabled. Over 300 systems it is
   disabled and the status says which parts to untick.
4. The user sees "Preparing…", a progress bar and "Building PDF — system n of
   N". The browser downloads `<title>.pdf`. The status line ends with "PDF ready
   — N systems, P pages, S MB." If a typeset file could not be fetched, the
   status adds that the scans went in instead.
5. Typeset parts go in as their own pages unless the user is looking at the
   scans for them. The export follows what is on screen. Quick export has no
   chant (decision D28).

### Customize export

1. Same bar. Click "Customize export". The button reads "Opening…" while the
   editor loads. It loads Verovio, workers and fonts only on this click.
2. A full-screen dialog opens (heading "Customize export", the selection under
   it, a "Close" button). The URL gains `#customize-export`; Back closes it.
3. Controls, in order:
   - Fit: "Music size" (Small 5.6 mm, Medium 7.2 mm, Large 9.6 mm); "Systems per
     page" with "−" / "+" buttons (accessibility labels "Fewer systems per page" / "More systems per page"; default
     "As many as fit").
   - Below 62rem a button "Settings" opens the rest as a panel, closed with
     "Done".
   - "In this PDF": the selected parts (read-only; the dialog says to close it
     and tick parts on the page).
   - Page: "Page size" Print / iPad / Custom; Print gives Letter, A4, A5; iPad
     gives iPad mini, 11-inch iPad, 13-inch iPad; Custom gives "Width" and
     "Height" with a mm / in switch. "Orientation": Portrait, Landscape.
     "Margins" with "−" / "+" buttons (accessibility labels "Smaller margins" / "Larger margins") and a mm field.
   - Breaks: "Line breaks": Original, Fit to page; "Choose where systems break"
     (then "Done"); "Each part starts on a new page" is fixed text.
   - Chant: Off, Before each part, Chant only.
   - "More options": "Sung text size" (Small, Medium, Large); "Space between
     systems" (Compact, Normal, Spacious).
4. Preview: "View" Pages or Continuous; "Zoom" with "−" / "+" buttons (accessibility labels "Zoom out" / "Zoom in") and
   "Fit width". An "Updating preview…" note appears if layout takes long.
5. Footer: a status line, "Undo" (after a break edit), "Reset layout", "Cancel"
   (while exporting) and "Download PDF · N pages". Errors appear as notices that
   begin "Can't…" with one action (for example "Use original layout").
6. Close with "Close" or Esc. Focus returns to "Customize export". If the user
   closes during export the page status says "Custom PDF cancelled."

Friction (from the code):

- Quick export and Customize export give different results for the same parts:
  only Customize has chant, page size and margins. Paper is chosen twice (the
  bar's "Paper" select, saved as `export-paper`, and the editor's "Page size",
  saved as `export-layout-v2`). The editor reads the bar's choice only as a
  fallback when it has no saved settings of its own.
- Changing the selection means leaving the dialog. The editor says "To change
  the parts, close this and tick them on the page."
- On a day page the export bar is the last block, below Vespers and hymns. On a
  piece page it is above the music.
- The controls named in the spec as "Fit", "Page" and "Breaks" change what a
  scan part can do. When no part reflows, "Systems per page" remains available. The dialog hides music size and line-break controls and shows a sentence ("Music size and line breaks apply only to customizable
  typeset.").
- The bar's status line (`#export-status`) and the dialog's (`#cx-status`) are
  two separate live regions.

See [must-keep.md](must-keep.md) for the full control inventory and
`docs/superpowers/plans/export-layout-decisions.md` (D1–D30) for decisions.

## (c) Organist, Ordinary Form: a date to the music

1. `/` home: card "What is sung today in the Ordinary Form?", or the header link
   "Ordinary Form".
2. `/calendar/ordinary-form/`. The same date controls as (a) plus an inline
   message line (`role="status"`) for out-of-range dates (2024–2050). The result
   shows the season, "Year A/B/C · Weekday Year 1/2", and per celebration: name,
   colour and rank, rubric, and "Proper chants" as a list. Each chant links to
   the NOH piece where one exists, or reads "Not in Nova Organi Harmonia" with a
   GregoBase link.
3. The user clicks "View accompaniments for this occasion". Where the date has
   two local choices (for example a transferred Corpus Christi) the text is
   "Choose the music for your local celebration:" with a link for each.
4. `/ordinary-form/<key>/`. The page URL carries `?cycle=A&season=…`. The user
   sees the title, Latin title, a notice that the page assembles NOH music for
   1974 Graduale chants, and a line naming the requested year and season, followed by "Every
   applicable alternative starts selected; choose the chants required for this
   celebration." The export bar, the typeset switch, the jump row and the music
   follow. The cycle and season preselect the checkboxes but hide no music.
5. Export as in (b).
6. Without JavaScript: the directory "Browse Ordinary Form chant sets" lists
   every occasion page as a static link.

Friction: the user must tick one alternative among several (the page shows all
years and seasons); sections without NOH music appear as notices
("Not in Nova Organi Harmonia") inside the music flow.

## (d) Vespers for a Sunday or feast

1. Entry points: the day page's "Vespers" section ("Full Vespers, in the order
   sung", and "I Vespers, the evening before"); a piece page of the Vesperale
   with a list "Full Vespers, in the order sung"; the Vespers division page
   (`/vespers/`, "Vespers by date, in the order sung"). The coming evenings are
   chosen in the browser from the reader's own date; "Every date (n)" opens the
   full list by year.
2. `/vespers/<date>/` (or `/vespers/<date>/i/` for I Vespers). The user sees the
   title, a "console line" (the tone and key to set up), a nav "Order of
   Vespers" of jump links, a checkbox "Show the chant with each antiphon and
   hymn" (only when chant exists), then the lineup in sung order. "Skip to
   music" is on this page.
3. Each item shows a heading, "Chant" and "Report · Edit" links, the music
   systems, and for psalms a disclosure "The text of …". Tone formulas say
   "Continue every verse to this formula in …".
4. The export bar is last. It exports the lineup in sung order.

Friction: coverage is partial (the code states that only some green Sundays
have a full order; other days show "NOH VIII does not print the full order of
Vespers for this day."). The export bar is below the whole lineup.

## (e) Finding a piece: search, Kyriale, hymns

- Search. Header "Search" opens `/search/`. The field (label "Search chant
  words, titles and modes") has focus on load. After a 120 ms pause it shows up
  to 25 results with titles and highlighted excerpts. An empty box shows
  "Ordinarium Missae", the list of Masses. No match shows a message with example
  queries. The code does not keep the query in the URL. It does not establish whether Back restores the search.
- Kyriale. No header link. The user reaches `/kyriale/` from the home page's
  "The books" list, from the calendar's Ordinary link, or from the search
  fallback list. `/kyriale/` has a table of contents ("On this page") and lists
  by group. A Mass opens `/kyriale/<n>/` with the jump row of movements.
- Hymns. `/hymns/` (home card "Hymns") is one alphabetical list in two columns:
  title, "NOH <part> · p. N" and a GregoBase link. There is no filter on the
  page.
- Books. Home "The books" opens a division page: Temporale by season, Sanctorale
  by month, others by section.

Friction: the hymn list has no filter and relies on the browser's find or on
Search. The Kyriale has no header link.

## (f) A reader reports a correction

1. Start from a link next to the problem: "Report an error" (piece footer and
   site footer), "Report" beside a part or Vespers item, "Something here is
   wrong" in the unverified-record notice, "This pairing is wrong", or "Report a
   music error" beside typeset music. Each opens `/corrections/` with the target
   filled in. The form then shows "Reporting on: …" with "choose something
   else".
2. The form fields: "Which piece?" (hidden when the target is fixed); "What is
   wrong?" (Title, Incipit, Mode, Genre, Printed pages, "A part is missing or
   mislabelled"; other lists for parts, pairings, Vespers and music errors);
   "What should it be?"; "Anything else? (optional, not published)"; a
   Cloudflare Turnstile check; and the button "Send correction". The current value
   shows as "Now: …".
3. After sending, a status line says "Thank you. Your correction is in the queue
   for review." Errors read "Please complete the anti-spam check just above the
   button.", "Corrections are paused at the moment…" and similar.
4. On the same page "Recent corrections" is a table: "Piece or item", "Field",
   "Proposed", "Status" (with "fix #n" or "report #n" and a "Published change"
   link to the GitHub commit once published).
5. Later the user finds the change at `/corrections/log/`: a table "Date",
   "What", "Changed", "From", "To", "Reported by".

Friction: the form gives no receipt or reference number. The queue shows all
recent reports, and the reader has to find theirs by piece and value. The log is
linked only from the `/corrections/` intro paragraph. Without Turnstile
configured, the form is disabled (local builds).

## (g) An editor reviews and publishes a correction

The admin is at `/admin/`, behind Cloudflare Access. Reader reports arrive in a
queue. Summary (full review: [docs/ADMIN-UX-REVIEW.md](../ADMIN-UX-REVIEW.md);
setup: `docs/ADMIN-SETUP.md`):

1. `/admin/` ("Admin"). The nav shows Admin, Review, Typeset music and Make a
   correction. All except Make a correction have a live count. "What's waiting" is a table of queues.
   "Readers' reports" lists each report with the field, the value now, the
   proposed value and the scan beside it.
2. The editor picks "Accept", "Reject" (with a reason) or "Duplicate" (a second
   press confirms), or edits the value first.
3. Accepted items move to "Approved, waiting to publish".
4. The editor presses "Publish changes". That opens one pull request on GitHub.
   The "Publishing" section lists open batches; most auto-merge, and the site
   changes "a few minutes after the merge", according to the admin page. The code does not establish a rebuild duration.
5. The change then appears in the public log.

The ADMIN-UX-REVIEW status line says the three pull requests it plans are
built. It lists items left on purpose (for example the Sections row form's
"More…" folding and hiding the public nav on admin pages).

## Target journey (direction, not current state)

This section condenses
`docs/reports/2026-10-20-reading-edition-design-correction.md` (the governing
direction; see also AGENTS.md). Nothing here is built unless the code above says
so.

- The product is a place to see Gregorian chant and organ accompaniment
  together, select the music needed and assemble it into one PDF. Finding a
  date or service is the entry point, not a replacement for the experience, and
  not a sequence of separate part-selection screens.
- Open on a representative music page, with a compact masthead and the
  English service name above its Latin name.
- Offer optional jump links into one continuous reading page. A jump link is a
  convenience, not a tab that hides other parts.
- Show the complete chant above the complete accompaniment for each part, in
  order.
- Keep export selection on the reading page. A checkbox at each part changes the
  selection without removing music from the page. A persistent export toolbar
  offers "Choose parts" (one compact list of every part, in step with the inline
  checkboxes, with Select all and Clear) and the existing Quick and Customize
  entries. "Change parts" in the dialog closes it, opens the same selector and
  returns with a fresh snapshot.
- The customization preview keeps the selected parts and shows chant Off /
  Before each part / Chant only. Closing it leaves the reader and the selection
  where they were.
- Art belongs in the masthead and around the music, never behind notation. More
  books become inline alternative settings where useful. Source records are
  secondary.
- Every existing capability stays unless the maintainer approves removing it.
  A control missing from a mockup is flagged as unmodeled, never read as a
  deletion. The list is in [must-keep.md](must-keep.md).
