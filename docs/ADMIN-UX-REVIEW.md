# Admin screens: usability review and plan

A usability review of `/admin/`, done on 2026-10-03 from screenshots of every
admin screen (desktop and phone, today's build, a local test database) and from
the source. The review's findings are below, unchanged except for this
introduction; the screenshots were not committed. Each finding names the file to
change, the effort (S/M/L) and a priority (P1 first).

## What to do, in three pull requests

The review's top ten, grouped so that each pull request leaves the screens
better on its own:

**1. Know what's left (P1).** Answers "what do I do next?" and makes the counts agree.
- `GET /admin/api/summary` with one counting rule for every queue: *left* means
  not confirmed, not chosen, not skipped; skipped is shown apart (§4.2).
- Home becomes **Admin**, with a "What's waiting" table and Publish in it (H1).
- A shared `AdminNav` on every admin page (§4.1).
- Retire `/admin/parts/` into Review, adding "Edit the sections" to part items (P1).
- Fix the run-together words ("nextPublish", "( 17 )") (§4.7).

**2. Less noise, safer actions (P1–P2).**
- Drop "No chant linked to the Proper as a whole" from Review. A Proper's chants
  belong to its parts, so the 412 items are not findings. Show the remaining
  information kinds as collapsed tables with no buttons (R1).
- A bottom status bar with **Undo** for Looks right, Skip, Accept, Reject (R3).
- After a correction opened from Review: "Back to Review (next item)", and
  Approve stays disabled until the value changes (E1, E2).
- Per-kind button words: "No chant exists", "Starts here: correct" (R4). Clearer
  group names (R2). A "done" state pointing to the next queue (R7).

**3. Finishing (P1–P3).**
- Typeset: search for a part instead of typing `part:<piece>/<part>`, and show the
  "another file is already chosen" conflict as a warning (T1, T2).
- Sections: Approve and its status in a footer that stays in view, and section
  starts marked on the systems (S1, S2).
- Publishing shown through to live (H2). Start with "Merged: live within about
  3 minutes". Reading Cloudflare's deployment state would add a secret to the
  admin Functions, so leave it until the simple version proves too vague.
- Readable refs ("Vol. 1, p. 34, 1st system") with the raw ref kept, muted.
  `noh where`, the docs and corrections all use the raw form. Control borders at
  3:1 contrast (§4.3, §4.7).

Where I'd differ from the review: keep **Duplicate** on readers' reports (H3),
but ask for confirmation first. Two readers reporting the same misprint is
common enough to deserve its own button.

---

## 1. Verdict

- **What works:** the visual language is calm and fits the site (letterpress paper, rubric red, AAA text contrast, 44px targets). Every decision is shown next to the scan. Focus moves to the next item after an action, and the plain-English "look" sentences in `reviewKinds.ts` are well written.
- **What gets in the way most:** there is no single "what do I do next" home. `/admin/` is a reader-report queue with five inline links. The counts there are worked out when the site is built, so they go stale and disagree with the counts on the other screens.
- **Next:** about 490 "Nothing to do here" items, each with action buttons, bury the 20 real ones. The Parts page duplicates part of Review without the scans. Typeset "Another part…" asks for raw target syntax.
- **Feedback after an action** usually lands in a status line at the top of a very long page, out of sight. **Looks right** can't be undone where you clicked it. Nothing tells you when a published batch is actually live.
- **Fix order:** fix navigation and counts first (one home with live counts), then remove noise (info group, Parts page), then make actions reversible and visible.

## 2. Scorecard

| Dimension | Score | Justification |
|---|---|---|
| Information hierarchy | 4/10 | No screen names its primary action above the fold. On `/admin/` the next steps are a run of inline links buried in a paragraph (`home-desktop-fold.png`). Review's three groups carry equal weight, though one is 96% noise. |
| Visual consistency | 6/10 | Tokens are used everywhere (`tokens.css`, `--tap-min`). But a primary button appears only on home and the edit forms, link colours vary (the black "Change" against red links), breadcrumbs differ on every page, and Astro whitespace collapse breaks spacing ("more).Make", "nextPublish", "( 17 )"). |
| State coverage | 5/10 | Loading, 401 and 409 are handled well on home. But each queue has one generic empty state ("Nothing to show with these choices."), there is no "done" state that points to the next queue, success messages fall out of view, and "live on the site" is never shown. |
| Accessibility | 7/10 | Labels, `aria-live`, focus management, `aria-pressed` and AAA text contrast are good. Input and button borders (`--rule` #c9c2b4 on #fdfcf9, about 1.7:1) fail WCAG 1.4.11's 3:1, error text (`--warn-ink`) is hard to tell from body text, and native checkboxes are small on Sections. |
| Polish vs AI slop | 8/10 | Clearly not template work: no gradients, no card shadows, a palette taken from the book. What lets it down is density and repetition (490 identical blocks), not taste. |

**Overall: 6.0/10.** Well built, but nothing on it says what to do next.

---

## 3. Findings per screen

### 3.1 Home: `/admin/` (`web/src/pages/admin/index.astro`)

**H1. The screen does not answer "what is left to do?"**
- **Problem:** above the fold there is a 4-line paragraph about pull-request mechanics, and the routes to the other work are inline links inside it: "Review (20 to check) ·Parts to check · Typeset music (842 to do)" (`home-desktop-fold.png`; on the phone, lines 270–440 of `home-phone-fold.png`). The heading "Corrections" describes only one of the five queues.
- **Why it matters:** Nick is now the only person who keeps the work moving. Each session should start from one list of what is waiting, sorted by urgency.
- **Recommendation:** rename the H1 to **"Admin"** and replace the paragraph with a **"What's waiting"** table: one row per queue, a live count, and the action as a button-styled link.
  ```
  Ready to publish          4   [Publish changes]   <- only when > 0, primary
  Readers' reports          3   Review them ↓
  Review: to correct       17   Open
  Review: to check          3   Open
  Typeset: matches         71   Open
  Typeset: broken files    16   Open
  Typeset: proofread  312 of 1,059 done   Open
  Last published   PR #71 · live since 2 Oct 14:05   View
  ```
  Move the PR explanation into a `<details><summary>How publishing works</summary>` under the table. Put the counts in a new `GET /admin/api/summary` endpoint (see 4.2) so they are live. Keep "To review" (reader reports) as the first section below it.
- **Effort:** M · **Priority:** P1

**H2. The Publish bar is hidden until something is approved, and "live" is never confirmed**
- **Problem:** `#batch-bar` is `hidden` unless there are approved items or batches (index.astro:306). "On GitHub" lists only open PRs, so a merged batch simply disappears. History shows a commit SHA but not the deploy. The success message says "The pull request appears under "On GitHub" in about a minute", and then nothing more happens.
- **Why it matters:** job (5) in the brief is "know when things went live". At the moment Nick has to go to GitHub to find out.
- **Recommendation:** add a **"Recently published"** state to the "On GitHub" section that shows the last 3 batches whatever their state: `PR #71 · 12 corrections · Checks running…` → `Merged 14:02 · deploying` → `Live 14:05 · see a changed page`. Take state from the GitHub API (merged_at) and the deploy from the Cloudflare Pages deployment for that SHA, or failing that "merged; live within ~3 minutes". While a batch is open, poll `/queue` every 30 s. Rename the section **"Publishing"**.
- **Effort:** M · **Priority:** P1

**H3. Duplicate acts at once, has the same weight as Reject, and doesn't say "of what"**
- **Problem:** "Accept / Reject / Duplicate" (`home-desktop.png`). Duplicate calls `act("duplicate")` with no confirmation and no reference (index.astro:240-241).
- **Why it matters:** a mis-tap on the phone (the buttons sit 8px apart, `home-phone.png`) closes a reader's report with no undo on this screen.
- **Recommendation:** remove the Duplicate button. Make Reject open the reason box with two quick choices above the text input: `( ) A duplicate of another report  ( ) Other reason: [____]`. Leave **Accept** as the only filled button.
- **Effort:** S · **Priority:** P2

**H4. Reader-report headings use the internal label, not the title being corrected**
- **Problem:** "III (noh5) · Title", then "Now: In Festis Solemnibus 2" (`home-desktop.png`). The heading names the Kyriale number while the field shows another name, so it is unclear which piece is meant.
- **Recommendation:** in `label()` (index.astro:132), for Kyriale and Mass pieces use `"{title} (Mass {roman}, Vol. {n})"`, e.g. "In Festis Solemnibus 2 (Mass III, Vol. 5) · Title". Make the same change in `describeTarget` so the edit form's "Correcting: IX (noh5)" (`edit-kyriale-desktop.png`) reads the same way.
- **Effort:** S · **Priority:** P2

**H5. The proposed value's styling claims more than it is**
- **Problem:** the Proposed input is `--step-1` 600 weight (index.astro:81) and is the largest text on the page, larger than the item heading.
- **Recommendation:** use normal weight at `--step-0` for the input. Show the change as a diff line under it: `Dominica II Adventus → Dominica secunda Adventus`, with the changed words in `<mark>`.
- **Effort:** S · **Priority:** P3

**H6. Migration banner (not visible in these screenshots)**
- It comes from `serverError` (api.ts:215) when D1 reports "no such column/table". Against a local seed database that is almost certainly an artefact of an unmigrated local DB. The message itself is good: it names the fix and says to reload. Two changes: (a) show the `pnpm migrate:remote` command only when `me.owner`, and tell a volunteer "The admin screen is being updated; try again later"; (b) render it once at page level, not repeated per failing call.
- **Effort:** S · **Priority:** P3

### 3.2 Review: `/admin/review/` (`review/index.astro`, `reviewKinds.ts`, `reviewClient.ts`)

**R1. "For information" (490) is listed item by item, with action buttons, for things that by definition need nothing**
- **Problem:** `review-info-desktop-top.png`: 412 blocks reading "No chant linked to the Proper as a whole … Nothing to do here.", each with **Looks right**, **Skip…** and a full scan. The page is over 20,000px tall. One block even shows pipeline debug text: "no jgabc Proper for its day; parts are not divided".
- **Why it matters:** these items swamp the counts, make the page slow on a phone, and invite pointless clicks.
- **Recommendation:**
  1. Drop `unpaired`-on-a-Proper from the review entries altogether (reviewKinds.ts:122). It is not a finding.
  2. Render the remaining info kinds (about 78) as a collapsed `<details>` per kind, each a compact table (Piece · Vol · Page · Open the page) with **no buttons and no images**.
  3. Remove the "For information" radio, and give the section the heading "Things the site can't act on (78)".
  4. Don't render `detail` text that comes straight from the pipeline (reviews.ts sets it); keep only the human `look` sentence.
- **Effort:** M · **Priority:** P1

**R2. Above the fold there is only chrome, and the group names are hard to tell apart**
- **Problem:** on the phone the whole first screen is header, intro paragraph and radios (`review-fix-phone-fold.png`); the first item starts below 840px. The labels "To check, and correct if wrong" and "To check against the scan" sound the same.
- **Recommendation:** rename the groups in `GROUP_LABELS` to **"Can be corrected here (17)"** and **"Check only: needs the pipeline (3)"**. Collapse the intro into `<details><summary>How Review works</summary>`. Put the radio group on one line as a segmented control (`.choice` with `aria-pressed` buttons, as `#breakdown` already does), and move Volume, Kind and "Show what is already done" behind a "Filter" `<details>` on screens narrower than 40rem.
- **Effort:** S · **Priority:** P2

**R3. "Looks right" can't be undone here, and its confirmation is invisible**
- **Problem:** after **Looks right**, `markReviewed` writes a state line, then `onChange → apply()` immediately hides the item (done items are hidden unless the box is ticked), and the "marked as looking right" message goes to `#status` at the top of the page (reviewClient.ts:117-120). Skip has "Take back the skip". Looks right has no take-back here; you have to find it under "Approved" on `/admin/` and press "Back to review".
- **Why it matters:** quick keyboard runs (focus jumps to the next item) make a mis-press likely, and it then goes out in the next PR.
- **Recommendation:** add a **fixed status bar at the bottom of the viewport** (`position: sticky; bottom: 0` inside `.admin`) for all admin pages, in a shared `AdminStatus` component. It shows "Dominica V Post Pascha · Alleluia 2: marked as looking right. **Undo**" for 10 s. Undo calls the existing `/rows/{id}/unapprove`; `/reviews` must return the row id. Keep the item visible and dimmed for that window before hiding it.
- **Effort:** M · **Priority:** P1

**R4. "Looks right" means different things for different kinds**
- **Problem:** for "No chant linked: Asperges (noh5)" (`review-fix-desktop-top.png`), it is unclear whether "Looks right" means "there is no chant".
- **Recommendation:** add an optional `confirm` label to `ReviewKind` and use it as the button text: unpaired → **"No chant exists"**; part_by_order / uncertain_movement / starts_mid_page → **"Starts here: correct"**; unverified_pairing → **"Chant is right"**; part_missing → **"Not printed"**; default "Looks right".
- **Effort:** S · **Priority:** P2

**R5. Identical headings for different items**
- **Problem:** three consecutive "No chant linked: Asperges (noh5)" (`review-fix-desktop-top.png`).
- **Recommendation:** in reviews.ts, add the printed page and incipit to `about` when the label repeats: "Asperges me (Vol. 5, p. 47)", "Vidi aquam (Vol. 5, p. 48)".
- **Effort:** S · **Priority:** P2

**R6. No primary action on items**
- **Problem:** Looks right, Correct and Skip are all outline buttons (`review-check-desktop.png`), whereas home uses a filled Accept.
- **Recommendation:** make the kind's `confirm` button `.primary`, keep Correct as an outline button, and turn **Skip…** into a text-style link button. That gives each item one clear default, the same as home.
- **Effort:** S · **Priority:** P3

**R7. Empty and done states**
- **Problem:** every empty combination says "Nothing to show with these choices." (review/index.astro:84).
- **Recommendation:** when a group's count reaches 0 with no filters, say **"All 17 done. Next: Check only (3) →"**, or for the last group "Review is clear. Back to Admin →". Keep the current sentence only when Volume or Kind filters cause the emptiness, and add a "Clear filters" button.
- **Effort:** S · **Priority:** P2

### 3.3 Parts to check: `/admin/parts/` (`parts/index.astro`)

**P1. A second, weaker copy of eight Review items**
- **Problem:** the same 8 parts appear as "Part to check" on Review **with** scans (`review-fix-desktop-top.png`), and here **without** scans but still with **Looks right** (`parts-desktop.png`). The intro says so itself: "These are also on the Review page".
- **Why it matters:** two places to do one job, and this one invites confirming a start you haven't seen.
- **Recommendation:** remove the page from navigation and make `/admin/parts/` redirect to `/admin/review/?kind=suspect` (the Review script should read `?group=&kind=` from the URL). Carry its one useful feature, the **Sections** link per piece, onto the Review item: add "Edit the sections" next to **Correct** for every part-start kind.
- **Effort:** S · **Priority:** P1

**P2. If it stays:** the piece heading links to the public page while the part name links to the edit form (same visual style, different destinations), and "(noh2)Sections" has no space. Make the heading plain text, label the links "Correct the start" and "Edit the sections", and add a scan thumbnail.
- **Effort:** S · **Priority:** P3

### 3.4 Sections: `/admin/sections/?piece=…` (`sections/index.astro`)

**S1. The commit button and its feedback are out of sight**
- **Problem:** on desktop the list panel is sticky with its own scroll (`.list { max-height: calc(100vh…); overflow-y:auto }`), so **Approve this list** sits at the bottom of an inner scroll area below every row (`sections-desktop-top.png`, where the panel cuts off mid-row 2). `#status` is at the top of the page, above the fold you've scrolled past. On the phone, Approve comes after every row and before 86 systems.
- **Recommendation:** split the list panel into a scrolling body and a **sticky footer** (`position: sticky; bottom: 0; background: var(--paper); border-top: 1px solid var(--rule)`) that holds: the change count ("3 changes from the published list"), **Approve this list** (primary), **Start again** (text button), and the status line. Disable Approve while `unchanged(rows, piece)` is true, rather than erroring afterwards (sections/index.astro:240).
- **Effort:** M · **Priority:** P1

**S2. Section starts are hard to see in the systems column, and the button moves**
- **Problem:** a start is shown only as small red caption text ("Introit starts here"), and on those systems the button wraps to the left onto its own line while elsewhere it sits on the right (`sections-desktop-top.png`, systems 1, 7, 16).
- **Recommendation:** give a system where a section starts a 3px `--accent` left border and a row above the image: **"▸ Gradual 1 starts here"** in `--step-0` 600 weight. Set `.system-bar { flex-wrap: nowrap }` so "Start a section here" always sits right-aligned. Clicking a row's heading in the list should scroll its system into view (`#system-n`), and vice versa.
- **Effort:** S · **Priority:** P2

**S3. Row form: too many fields at equal weight**
- **Problem:** nine fields per row, including "A name of its own (instead of a number)" with a truncated placeholder ("e.g. kyrie-b; rarely n"), and "Number (2nd, 3rd …)" showing "1" (`sections-desktop-top.png`).
- **Recommendation:** show **Kind, Starts on system, Label as printed, Opening words, Chant** by default. Put Number, Own name, Paschaltide and Printed elsewhere behind a per-row "More…" `<details>`, opened automatically when any of them has a value. Rename "Chant (GregoBase id)" to "GregoBase chant no." with a link to the chant when filled.
- **Effort:** M · **Priority:** P3

**S4. Mass-movement hint asks the editor to type code names**
- **Problem:** `#mass-hint` tells the editor to type `kyrie`, `gloria` and so on into "A name of its own".
- **Recommendation:** when the piece has movements, make "Kind" offer "Kyrie / Gloria / Credo / Sanctus / Agnus / Ite (replaces the found one)" directly, and have the editor set `key` behind the scenes.
- **Effort:** M · **Priority:** P3

### 3.5 Edit form: `/admin/edit/?target=…` (`edit/index.astro`)

**E1. A dead end after saving, and no way back to where you came from**
- **Problem:** after **Approve this correction** the status says "Approved. It is waiting on the corrections queue until someone publishes." (edit/index.astro:212). There is no way back to the Review item you came from, and no admin breadcrumb at the top (`edit-part-desktop.png`).
- **Recommendation:** Review's **Correct** link should pass `&from=review&item=<anchor>`. After a save, show **"Approved. ← Back to Review (next item)"**, linking to `/admin/review/#<next-anchor>`, plus "or Publish now on Admin". Add the shared admin nav (4.1).
- **Effort:** S · **Priority:** P1

**E2. Approve is available when nothing has changed**
- **Problem:** "What should it be?" is pre-filled with the current value (`edit-piece-desktop.png`: Now "Dominica I Adventus", field "Dominica I Adventus"), and Approve is enabled.
- **Recommendation:** disable **Approve this correction** until `value !== current`. Show a live diff line under the input ("9 → 11"), and for start_system redraw the scan beside it (that already happens on home).
- **Effort:** S · **Priority:** P2

**E3. Layout differs from home's for the same task**
- **Problem:** home shows value and scan side by side, while the edit form stacks the scan under the input (`edit-part-desktop.png`). The "Change" control is a black-underlined button among red links.
- **Recommendation:** reuse home's `.item.has-scan` two-column grid at ≥60rem. Give `.link` buttons `color: var(--accent)` (edit/index.astro:73). Write the link text in sentence case: "Open the page · Change · Edit the sections".
- **Effort:** S · **Priority:** P3

### 3.6 Typeset music: `/admin/typeset/` (`typeset/index.astro`, `typesetClient.ts`)

**T1. "Another part…" needs internal target syntax**
- **Problem:** the label reads "The part it is, as a target (part:<piece>/<part>, movement:<Mass>/<movement> or piece:<piece>; the piece page's Report link shows it)" (typeset/index.astro:135).
- **Recommendation:** replace the text input with a search combobox over `targets.json` (already loaded by the edit form via `loadTargets()`). Type "Dominica I Adv" to get "Dominica I Adventus (Vol. 1) · Alleluia", then press **Choose it**. Keep raw target input only as a fallback when the text starts with `part:`.
- **Effort:** M · **Priority:** P1

**T2. A conflict warning is hidden in grey metadata**
- **Problem:** `vol-1/al_ostende_nobis.csv.ly · page reference 5 · an editor chose vol-1/al_jubilate_deo.csv.ly for part:dominica-i-adventus/alleluia · best melody match 99%` sits in one muted line (`typeset-desktop-top.png`).
- **Why it matters:** choosing "This part" here would put two files on one part.
- **Recommendation:** split `detail` in typesetQueues.ts. Keep the file name and page reference as muted metadata, and render the conflict as `<p class="notice">` above the candidates: **"Another file is already chosen for Dominica I Adventus · Alleluia (al_jubilate_deo). Choosing this one replaces it."**
- **Effort:** S · **Priority:** P1

**T3. The comparison is lopsided**
- **Problem:** the LilyPond drawing shows all 7 systems at full width, but each candidate shows one scan system, below it (`typeset-desktop-top.png`). You scroll about 1,100px to compare first lines.
- **Recommendation:** at ≥60rem, show drawing and candidates in two columns (as `.item.proofreading` already does). Cap `.drawing` at `max-height: 18rem; overflow: hidden` with a "Show the whole drawing" toggle. The first system is what you compare.
- **Effort:** S · **Priority:** P2

**T4. Settling actions carry the same weight as choosing**
- **Problem:** "This part" (per candidate) and "Not in the catalogue / A different setting / Skip…" all look alike.
- **Recommendation:** make **This part** `.primary` on the top candidate only. Group the other three under a quiet label "None of these:" with outline buttons, and Skip as a text button.
- **Effort:** S · **Priority:** P3

**T5. Proofreading is counted as a to-do list**
- **Problem:** "Proofreading (747)" (`typeset-phone-fold.png`) feeds home's "842 to do".
- **Recommendation:** label it **"Proofreading: 312 of 1,059 done"** (a progress count, not a backlog), sort by volume and page, and keep it out of the home "to do" total.
- **Effort:** S · **Priority:** P2

**T6. Docs drift:** EDITING.md says for Errors "The source editor comes later", but the page links **Edit the source**. Update docs/EDITING.md:69-71. **Effort:** S · **Priority:** P3

---

## 4. Cross-cutting recommendations

### 4.1 Navigation

The breadcrumbs differ on every page:

| Page | Links shown |
|---|---|
| review | Corrections · Parts to check · Typeset music |
| parts | Corrections |
| sections | Corrections · Parts to check |
| edit | none (only "corrections queue" in the prose) |
| typeset | Corrections · Review · Parts to check |

The site header's **Corrections** goes to the *public* `/corrections/` report form, but the admin home is also titled "Corrections". That is two different "Corrections" one inch apart (`home-desktop-fold.png`).

**Recommendation (P1, S):** create `web/src/components/AdminNav.astro`, rendered by every admin page directly under the site header:
`Admin home (3) · Review (20) · Typeset (87) · Make a correction` with `aria-current="page"` on the current page (underline plus 600 weight). Counts are filled from `/admin/api/summary`. Rename the admin H1 to "Admin" so "Corrections" stays the public report page. Delete the per-page `<p class="small muted"><a…>` breadcrumbs.

### 4.2 Counts: do they agree? No, and here is why

- **Home "Review (20 to check)"** = `reviewEntries().filter(e => e.group !== "info").length` (index.astro:6), worked out **at build time**. `reviewEntries` already leaves out items whose confirmation is *published* (`REVIEWED`, from data/reviewed.json). It does **not** know about Looks right waiting to publish, or Skips, which live only in D1.
- **Review page "( 17 ) / ( 3 )"** first renders the same build-time numbers, then `apply()` recounts in the browser **excluding every item with `data-done`**: reviewed (queued or approved) *and skipped* (review/index.astro:164; reviewClient.ts:47,54).
- **So after you mark 5 Looks right and skip 2, Review says 13 while home still says 20**, and keeps saying 20 until the batch is merged *and* the site rebuilt.
- **Typeset is inconsistent in a different way:** home "842 to do" = 79 + 16 + 747, at build time, so it includes proofreading and the matches already chosen in D1. The Typeset page subtracts only `reviewed`/`chosen` and **keeps skipped items in the count** (typeset/index.astro:245-246), unlike Review, which drops them. That likely explains the brief's 71 matches against the 79 built into the page: 8 are chosen but not yet published.
- **Parts (8)** is a subset of Review's "Part to check (8)", not extra work, but home lists it as a separate destination.

**Recommendation (P1, M):** add `GET /admin/api/summary` returning, per queue, `{ total, pendingPublish, skipped, left }`, computed from the build-time entries (ship them as a small JSON with the build, as `review.json.ts` already does) minus D1 review-state. Use it on home, in AdminNav and as the initial counts on Review and Typeset. Pick one rule and state it in the UI: **"left" = not confirmed, not chosen, not skipped; skipped is shown separately ("2 skipped")**. Apply the same rule in both `apply()` functions.

### 4.3 Wording and jargon

| Now | Where | Change to |
|---|---|---|
| `noh1/0034/000` in captions | home, review, sections, typeset | "Vol. 1, scan p. 34, 1st system" with the ref kept in a `title` attribute and muted mono at the end. System indices are 0-based in refs but 1-based in "System 1" on Sections, so only the 1-based number should be visible. |
| `(noh2)` after titles | everywhere | "(Vol. 2)". Volume selects: "Vol. 1 … Vol. 8". |
| "To check, and correct if wrong" / "To check against the scan" | Review | "Can be corrected here" / "Check only (needs the pipeline)" |
| "settle files that are not in the catalogue" | Typeset intro | "mark files that aren't a part on this site" |
| "Approving gathers a change" | home intro | (move to "How publishing works" details) |
| "as a target (part:<piece>/<part>…)" | Typeset | replaced by search (T1) |
| "Part placed by its order, not its heading" etc. | kinds | good; keep |
| "Skip…" / "Take back the skip" | Review | "Skip with a note…" / "Undo skip" |

### 4.4 Empty and done states

| Screen | Now | Recommended |
|---|---|---|
| Home, To review | "No pending corrections. Last reviewed … History" (good) | add "Next: Review (17) →" |
| Home, Approved | "Nothing approved yet." | "Nothing waiting to publish." (the batch bar is hidden anyway) |
| Review / Typeset group at 0 | "Nothing to show with these choices." | "All done in this group. Next: … →"; keep the filter message only when a filter is the cause, with "Clear filters". |
| Parts | "Nothing to check." | (page removed: P1) |
| Sections, unknown piece | "Open its Sections link from the piece's edit page." | add a piece picker, as edit has. |

### 4.5 Feedback after actions

- One shared bottom-sticky `AdminStatus` (R3) on every admin page, with Undo where the API allows. Today `#status` sits near the top of pages 5,000–40,000px tall.
- Per-item confirmations stay visible and dimmed for about 10 s before the filter hides them.
- Publish: the button changes to "Publishing…" and then to the batch row with its live state (H2). Error colour: use `--warn-ink` on `--warn-bg` with a "⚠" or "Error:" prefix so errors don't read as body text (`.status[data-state="error"]` on every page).

### 4.6 Phone layout

- About 160px of site header (brand, wrapped nav, Invert button) comes before admin content on every page (`home-phone-fold.png`). On admin pages, hide the public nav and Invert behind the brand line, or show only `Cantus Organi · Admin` plus AdminNav.
- Intro paragraphs (4–6 lines) push the first item below the fold on every screen. Collapse them into `<details>`.
- The Proposed input truncates ("Dominica secunda Adver", `home-phone-fold.png`) because of the oversized font (H5). Use a `<textarea rows=2>` for titles below 40rem.
- Review on the phone renders hundreds of lazy images. R1 removes most of them.

### 4.7 Accessibility

- **Non-text contrast (P2, S):** input, select and button borders use `--rule` #c9c2b4 on #fdfcf9 (about 1.7:1), below WCAG 1.4.11's 3:1. Add `--control-border: #8a8272` (about 3.6:1) to tokens.css and use it for form controls and outline buttons; keep `--rule` for hairlines.
- **Error identification:** error status is colour-only (`--warn-ink` is dark olive and reads as body text). Add a text prefix and the warn background.
- **Checkboxes on Sections** are native size; their labels have `min-height: var(--tap-min)`, so the target is fine. Raise them to `inline-size: 1.25rem` for visibility.
- **Whitespace:** Astro collapses spaces at line breaks inside inline text, producing "more).Make", "nextPublish", "pressesPublish", "(noh2)Sections" and "( 17 )" (spaces from JSX). Screen readers run the words together too. Put `{" "}` at the line breaks, or keep inline runs on one source line (index.astro:18-21, review/index.astro:24-25, edit/index.astro:13-14, parts/index.astro:34-35, Layout footer).
- Good already: labelled controls, `aria-live` status, focus moved to the next item, `aria-expanded` on Reject, `aria-pressed` kind buttons, alt text on scans, 44px targets.

---

## 5. Top 10 changes, in order

1. Add `/admin/api/summary` and a "What's waiting" table at the top of `/admin/`, with live counts per queue and Publish in it, so home answers "what next?" and agrees with every other screen.
2. Add a shared `AdminNav` component (Admin · Review · Typeset · Make a correction, with counts and `aria-current`) to every admin page, and rename the admin H1 so it no longer clashes with the public "Corrections".
3. Take the 412 "Proper as a whole" items out of Review, and show the remaining info items as collapsed, button-free tables per kind.
4. Retire `/admin/parts/` (redirect to Review filtered to part starts) and add an "Edit the sections" link to those Review items.
5. Add a bottom-sticky status bar with **Undo** for Looks right, Skip, Accept and Reject on every admin page, so every action is visible and reversible.
6. Show publishing through to "live": keep the last few batches with states (checks running → merged → live at hh:mm) instead of letting merged PRs vanish.
7. After a correction saved from Review, offer "Back to Review (next item)", and disable Approve until the value differs from Now.
8. Replace Typeset's raw-target "Another part…" input with a piece/part search, and promote the "another file is already chosen" conflict to a visible notice.
9. Move Sections' Approve button and status into a sticky footer of the list panel, and mark section-start systems with an accent border and a stable button position.
10. Fix the copy details in one pass: human refs ("Vol. 1, p. 34, 1st system"), clearer group names, per-kind confirm labels ("No chant exists", "Starts here: correct"), the Astro whitespace collapses, and `--control-border` for 3:1 control contrast.
