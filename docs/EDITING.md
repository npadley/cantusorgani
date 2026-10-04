# Editing Cantus Organi

How to fix what the site shows: a wrong title, a wrong tone, a Mass on the
wrong day, a reader's correction. Start from what you see, find it in the
table below, and follow the recipe. Nothing here needs your own computer's
files: the scanned PDFs are in the repository, and the recipes that rebuild the
catalogue can run on GitHub.

What to run after each change, the checks, and getting a change to the site are
in [OPERATIONS.md](OPERATIONS.md); this page is the recipes.

## What do you want to fix?

| You see… | Recipe | Rebuilds the catalogue? |
|---|---|---|
| A piece's title, incipit or mode is wrong | [Title, incipit, mode](#title-incipit-mode) | No |
| A piece's printed pages are wrong | [Printed pages](#printed-pages) | No |
| A reader sent a correction | [The admin screen](#the-admin-screen), or [Reader corrections](#reader-corrections) | No |
| A Vespers antiphon's or Magnificat antiphon's tone, chant link or systems are wrong, or it should show a note instead | [Vespers items](#vespers-items) | No |
| A Vespers hymn, versicle, psalm or season is wrong | [Vespers at the source](#vespers-at-the-source) | No |
| A day shows the wrong Mass, or no Mass | [Days and rubrics](#days-and-rubrics) | Yes, on GitHub |
| A piece starts or ends on the wrong system | [System range](#system-range) | No |
| A piece is listed on the wrong page, or starts on the wrong page | [Piece boundaries](#piece-boundaries) | Yes, on GitHub |
| A Proper part (Introit, Gradual…) starts on the wrong system, or its chant link is wrong | [Proper parts](#proper-parts) | No |
| A Proper's sections are missing, extra, mislabelled or out of order (an Ember day's four Graduals) | [Sections](#sections) | No |
| A Vespers psalm uses the wrong formula, or should show a note | [Psalm formulas and notes](#psalm-formulas-and-notes) | No |
| A system image misses a staff, holds two systems, or a system has no image | [Slicing a page](#slicing-a-page) | Yes (and uploads images: your machine) |
| A newer Divinum Officium, vesperale, jgabc or calendar | [Refreshing a source](#refreshing-a-source) | No |
| A new volume to add | [Adding a volume](#adding-a-volume) | Yes (and uploads images: your machine) |
| A feast prints only a rubric ("resumitur Missa Feriae praecedentis") | [OPERATIONS: a feast that prints only a rubric](OPERATIONS.md#a-feast-that-prints-only-a-rubric) | Yes |
| Two pieces should be one (or a piece moved to a new address) | [OPERATIONS: two index entries that are one piece](OPERATIONS.md#two-index-entries-that-are-one-piece) | Yes |
| Pages printed "bis" between two others | [OPERATIONS: a leaf inserted into the book](OPERATIONS.md#a-leaf-inserted-into-the-book) | Yes (and re-slices) |
| A Vespers hymn linked to the wrong system | [OPERATIONS: a hymn the heading search misplaces](OPERATIONS.md#a-hymn-the-heading-search-misplaces) | Yes |
| Many review items checked at once | [OPERATIONS: confirming many items at once](OPERATIONS.md#confirming-many-items-at-once) | No |

Two kinds of people edit:

- **Editors** use the [admin screen](#the-admin-screen). It needs no laptop and
  no secrets.
- **The maintainer** uses the full loop below, for everything the admin screen
  can't do yet.

## The admin screen

`https://cantusorgani.org/admin/` is for editors: sign in with your email (a
code arrives by email). Setting it up is described in
[docs/ADMIN-SETUP.md](ADMIN-SETUP.md).

Every admin page starts with the same navigation (**Admin · Review · Typeset
music · Make a correction**), each with how much is left on it, and "N ready to
publish" when something is approved. The counts come from one place
(`/admin/api/summary`), so they agree everywhere: an item is *left* until it is
marked, chosen or skipped; skipped items are counted apart.

- **What's waiting**, at the top of the **Admin** page (`/admin/`), lists every
  list with what's left on it and a link to it, and **Publish changes** in its
  first row. Start each session there.
- **Readers' reports**, below the table: each shows the current value, the
  proposed one (which you can change before accepting) and the reader's note,
  beside the systems the report is about: a part's first system and the one
  proposed, a Vespers item's systems, a piece's first and last. Each picture is
  captioned with its ref. **Accept**, **Reject** (with a reason) or
  **Duplicate** (press twice: it asks first).
- **Make a correction yourself**: every piece page has an **Edit** link at its
  foot, which opens the form for that piece. Your fix is approved at once.
  **Approve** stays greyed out until the value differs from what it is now.
- **Undo**: whatever you do (accept, reject, mark, skip, choose a part) is
  confirmed in a bar at the foot of the window, with **Undo**, until it is
  published. A marked item stays in view, dimmed, for ten seconds, with its own
  Undo.
- **Review** (`/admin/review/`) lists what the pipeline was not sure of when it
  read the scans (`data/review-queue.json`), with the parts to check. Each item
  says in words what to look at, beside its scans. The first button confirms it
  as it is, and its words say what you are confirming ("Starts here: right",
  "Not printed here", "No chant to link"); **Correct** opens the edit form,
  where a correction can fix it, and offers the way back to the next item once
  you approve; **Skip with a note** leaves it for the next editor (kept on the
  admin screen only). Two lists: what a correction can fix, and what to check
  against the scan. What the site can't act on is listed apart at the foot,
  folded, with nothing to press. A confirmation is
  published like a correction (a `reviewed` entry in `corrections.yml`, left out
  of the public log). It records what was confirmed, so if a later rebuild
  changes the item, the confirmation lapses and the item comes back;
  `uv run noh corrections --lapsed` lists those.
- **Typeset music** (`/admin/typeset/`) looks after the volunteers' LilyPond
  transcriptions ([docs/TYPESETTING.md](TYPESETTING.md)), in three queues:
  - **Matches**: files the matcher couldn't place with confidence. Each shows
    the drawing beside its candidate parts: their scans, how alike the melodies
    are, and (with **Show the chant**) GregoBase's chant. **This part** chooses
    a candidate; **Another part…** searches every part by name (type part of
    the piece's name and choose a suggestion; a target such as
    `part:dominica-i-adventus/gradual` works too); under "None of these",
    **Not in the catalogue** and **A different setting** settle a file that is
    no part the site has. A chosen file replaces the scans for that part once
    published. When another file is already chosen for the same part, a warning
    says so: choosing this one replaces it. A tall drawing shows its first lines
    (what you compare); **Show the whole drawing** opens it.
  - **Errors**: files LilyPond can't draw, with the lines around the one it
    stopped at. **Edit the source** opens the file in an editor: **Save draft**
    (private to you), **Preview draft** (LilyPond draws it on GitHub, in a
    minute or so), then **Approve this edit** with a public reason. The edit
    publishes like a correction. Or **Skip** with a note, or settle a file that
    isn't in the catalogue.
  - **Proofreading**: every part shown typeset, beside the scan of the same
    systems. **Proofread** confirms that drawing (an edit to the file brings it
    back); **Problem** leaves a note and keeps it listed.

  Each answer is a correction on `typeset:<file>` (`match`, or `reviewed` for
  a proofreading), published like any other.
- **Publish changes** sends everything approved to GitHub as one pull request.
  When the site's checks pass it merges itself, and merging deploys the site
  (a few minutes in all). A batch that moves systems between pieces, or has 25
  corrections or more, waits for the owner to merge it instead. If a check
  fails, the pull request is closed and the corrections come back under
  **Approved**, with the reason. Closing a pull request without merging puts
  its corrections back under **Readers' reports**. **Publishing**, on the Admin
  page, follows each batch to the site: the pull request while it is open, then
  "Merged …; building and deploying the site now", then "Live on the site since
  …" (or the failed run). It asks GitHub's public API, from your browser, every
  30 seconds while a deploy is under way. **What's waiting** shows the last one.
- **History** lists what was accepted (with its commit) and what was rejected
  (with the reason). Accepted corrections also appear publicly at
  `/corrections/log/`, without names or addresses.

Scan captions name a system in words and by its ref: "vol. 1, scan p. 50,
system 4 · noh1/0050/003" (systems count from 1 in words, from 0 in the ref,
which is what `noh where`, corrections and section lists use).

Every action records who did it. Two editors can't both act on one report: the
second is told who got there first. The admin screen corrects a piece's title,
incipit, mode, genre, printed pages and system range; where a Proper part starts
and its chant; a Mass movement's chant; and a Vespers antiphon's tone, chant,
printed systems and a note shown instead of its music; and which part a typeset
transcription is. Everything else needs the loop below.

---

## Your first edit in five minutes

This walkthrough fixes one title. Copy each line and paste it into a terminal
at the repository root.

1. Open the page that is wrong, for example
   `https://cantusorgani.org/piece/dominica-i-adventus/`, and copy its address.
2. Ask what it is:

   ```bash
   uv run noh where https://cantusorgani.org/piece/dominica-i-adventus/
   ```

   ```
   piece:dominica-i-adventus
     Dominica I Adventus (noh1, pp. 3-7)
     source:  data/index-noh1.yml:19
     then:    uv run noh correct piece:dominica-i-adventus <field> <value>
   ```

3. Record the fix:

   ```bash
   uv run noh correct piece:dominica-i-adventus title "Dominica prima Adventus" --note "as printed on p. 3"
   ```

   ```
   recorded c-0001: piece:dominica-i-adventus title 'Dominica I Adventus' -> 'Dominica prima Adventus'
   data/catalog.json rewritten. Preview with `pnpm --dir web dev`, then commit
   data/corrections.yml and data/catalog.json.
   ```

4. See it: `pnpm --dir web dev`, then open
   `http://localhost:4321/piece/dominica-i-adventus/`.
5. Keep it: commit `data/corrections.yml` and `data/catalog.json`, then
   [publish](#publishing).

To undo it before committing, run `uv run noh corrections --drop c-0001`.

---

## Setup, once

This takes about 15 minutes. The clone includes the scanned PDFs (about 240 MB).

1. Install [uv](https://docs.astral.sh/uv/) and
   [pnpm](https://pnpm.io/installation). Node 22 or newer is required.
2. At the repository root:

   ```bash
   uv sync
   pnpm --dir web install
   uv run noh doctor
   ```

   `noh doctor` checks everything and names the fix for each failure. Failures
   about R2 only matter for uploading images.
3. For `pnpm dev` with the real images, and for publishing, you need the
   1Password Environment mounted as `web/.env` (see the README's Secrets
   section). Without it, `pnpm dev` still runs, using local image paths.

## The loop

| Step | Command | Time |
|---|---|---|
| Find it | `uv run noh where <page URL or words>` | instant |
| Change it | `uv run noh correct …`, or edit the YAML file the recipe names | — |
| Regenerate | `scripts/regenerate.sh` (add the volume after an index edit: `scripts/regenerate.sh noh3`) | ~2 min; each volume rebuilt adds 2–7 min |
| Check | `scripts/check.sh --quick` (what a pull request checks, less the build) | ~5 min |
| Browser tests | `scripts/check.sh` (adds the build, the link check and the browser tests) | ~8 min |
| Preview | `pnpm --dir web dev` → http://localhost:4321 | ~5 s to start |
| Publish | push to `main`; see [Publishing](#publishing) | ~1½ min |

### Publishing

Commit your change and push to `main`. GitHub then checks, builds and deploys
the site by itself, in about 1½ minutes; the run appears under the repo's
**Actions** tab. If any check fails, nothing is deployed, and the failing step's
log says why. A change that touches only `docs/` or `*.md` files deploys
nothing, because it changes nothing on the site.

To check a change without deploying it, push it to a branch and open a pull
request: the same checks run, and merging it deploys.

To deploy by hand (if GitHub is down), from `web/`:

```bash
pnpm build
npx wrangler pages deploy dist --project-name cantusorgani --branch main
```

To roll back a bad deploy: in the Cloudflare dashboard, open Workers & Pages →
cantusorgani → Deployments, and use **Rollback** on the last good one. Then
revert the commit so the next push doesn't bring the problem back.

---

## Recipes

Every recipe has the same four parts: **File**, **Change**, **Command**,
**Confirm**.

### Title, incipit, mode

- **File**: `data/corrections.yml`. Don't write entries by hand; the command
  writes them.
- **Change**:

  ```bash
  uv run noh correct piece:<slug> title "…"     # or: incipit, mode (I–VIII), genre
  ```

- **Command**: none. `noh correct` rewrites `data/catalog.json` itself.
- **Confirm**: `uv run noh corrections` lists the entry; preview the page.

The maintainer can instead fix the title at its source, `title:` in
`data/index-<volume>.yml` (the line `noh where` prints), and run
`uv run noh catalog --volume <volume>`. This needs the PDFs. Afterwards,
`noh doctor` lists any correction the source now makes redundant, and
`noh corrections --drop <id>` removes it.

### Printed pages

- **File**: `data/corrections.yml`.
- **Change**: `uv run noh correct piece:<slug> printed_pages 5-10`
- **Command**: none.
- **Confirm**: the page's heading line shows the new pages.

This changes only the page numbers shown. If the music itself starts or ends
on the wrong system, see [System range](#system-range).

### System range

A piece's first and last system, when the pipeline split two pieces at the
wrong system.

- **File**: `data/corrections.yml`.
- **Change**: `uv run noh correct piece:<slug> system_range noh1/0044/002-noh1/0046/003`
  (or `... to ...`). Every image on the site carries its ref in `data-ref`.
- **What else moves**: systems the new range takes leave the piece before or
  after, and its printed pages follow its systems (a `printed_pages`
  correction still wins). The pieces' Proper parts keep the systems they start
  on, so a range that would leave a part outside its piece, take the system a
  neighbour's part starts on, split a neighbour in two or take all of it is
  refused: move the part first. Part corrections count from the corrected
  range.
- **Command**: none.
- **Confirm**: preview the piece and its neighbour; each starts and ends on the
  right system.

If the index lists the piece on the wrong page, fix it at the source instead:
[Piece boundaries](#piece-boundaries).

### Reader corrections

Readers' reports from the Corrections form wait in the Cloudflare database
until someone reviews them.

- **File**: `data/corrections.yml`. Each accepted report becomes an entry with
  `source: reader#<id>`.
- **Change**:

  ```bash
  uv run noh triage --dry-run     # see what is waiting, change nothing
  uv run noh triage               # accept (y), reject (n) or stop (q), one at a time
  ```

  The first time, `npx wrangler login` connects you to Cloudflare. Triage says
  so if it's needed.
- **Command**: commit `data/corrections.yml` and `data/catalog.json`, then run
  `uv run noh triage --stamp` to record the commit against the accepted
  reports.
- **Confirm**: `uv run noh corrections`; the public queue on `/corrections/`
  shows them as accepted.

Reports can name a piece, one of its parts, or a Vespers item; triage records
each against its target. An old-style report of a whole piece's "chant
pairing" is refused, because a chant belongs to a part: see
[Proper parts](#proper-parts).

### Vespers items

The tone, chant and printed systems of an office's antiphons and Magnificat
antiphon, and of a green Sunday's Magnificat antiphon; or a note shown in place
of its music.

- **File**: `data/corrections.yml`.
- **Change**: `uv run noh where <Vespers page URL>` lists the page's targets.
  Then:

  ```bash
  uv run noh correct vespers:adv1/antiphon-2 tone VIII.G*
  uv run noh correct vespers:sunday:tempora:Pent18-0/magnificat chant 2205
  uv run noh correct vespers:adv1/antiphon-1 refs "noh8/0077/000 noh8/0077/001"
  uv run noh correct vespers:adv1/magnificat note "The book prints this for II Vespers; sing it from the Antiphonale."
  uv run noh correct vespers:adv1/magnificat note none      # show the music again
  ```

  `refs` are the systems it is printed on, in order; every image on the site
  carries its ref in `data-ref`. Each must be a system in the catalogue.
  A `note` replaces the item's music (its repeat after the psalm too) with that
  sentence; its tone and chant link stay.

- **Command**: none; `noh correct` rebuilds the Vespers lineup for the years it
  already covers.
- **Confirm**: `uv run noh vespers-lineup --day <date>`, or preview
  `/vespers/<date>/`. On the site, each such item has **Report · Edit** beside
  its heading.

### Vespers at the source

Everything else about Vespers — hymns, versicles, the Sunday psalter, seasons,
the tone bank, a psalm's opening — is fixed in the reviewed files, not the
overlay.

- **File**: `data/vespers/vespers-offices.yml` (an office's items) or
  `data/vespers/vespers-noh8.yml` (psalter, Marian antiphons, seasons,
  `magnificat_antiphons`, tone bank). `noh where` names the office and line.
- **Change**: `refs:` are the systems, as `noh8/<PDF page>/<n>`; every image on
  the site carries its ref in `data-ref`.
- **Command**: `uv run noh vespers-lineup`, then
  `uv run noh vespers-lineup --day <date>` to check it item by item.

### Days and rubrics

*Rebuilds the catalogue:* edit the file on a branch — GitHub's web editor is
fine — and open a pull request. Then in the repository's **Actions** tab run
**catalog-rebuild**, with the volume and your branch. It rebuilds on GitHub and
commits the result to the branch, and the checks run again. Or locally: the command below.

- **File**:
  - `days:` of the piece in `data/index-<volume>.yml` (the calendar keys it's
    sung on, for example `tempora:Adv1-0`);
  - or `data/rubrics-1962.yml`, for a day that takes another day's Mass.
- **Command**: `uv run noh catalog --volume <volume>`, then
  `uv run noh vespers-lineup`.
- **Confirm**: open `/day/<season>/<key>/`; the Proper listed is the right
  one.

### Piece boundaries

*Rebuilds the catalogue:* edit the file on a branch — GitHub's web editor is
fine — and open a pull request. Then in the repository's **Actions** tab run
**catalog-rebuild**, with the volume and your branch. It rebuilds on GitHub and
commits the result to the branch, and the checks run again. Or locally: the command below.

- **File**: `page:` of the entry in `data/index-<volume>.yml`, the printed page
  the piece starts on.
- **Command**: `scripts/regenerate.sh <volume>` (it runs `noh catalog`, which
  re-reads the scans and reports anything uncertain in
  `data/review-queue.json`, then everything after it).
- **Confirm**: preview the piece; its first system is the one printed.

### Sections

A Proper's sections are what the book prints on it, in order: its Introit,
each Gradual (an Ember Saturday prints four), a hymn such as *Benedictus es*,
the Tract, and so on. The pipeline proposes them from the margin labels and
the chants; where that is wrong in more than one start, write the piece's list
by hand.

- **File**: `data/sections/<volume>.yml`, one list per piece, in printed order.
  When a piece is listed there, the list is the whole truth for it: the
  pipeline adds, drops and moves nothing.
- **Change**:

  ```bash
  uv run noh sections sabbato-temporum-adventus            # the current list, with each margin label
  uv run noh sections sabbato-temporum-adventus --review   # write it to data/sections/noh1.yml to edit
  ```

  Each section has a `kind`, `n` for the 2nd (3rd…) of its kind (or a `key`
  of its own, below), the `label`
  and `title` as printed, the `ref` of its first system (every image on the site
  carries its ref), and optionally its `chant`. The file's header lists every
  key. Optional `rubric` holds the verified printed liturgical instruction in
  Latin; `rubric_translation` holds its English translation. Each is plain text
  of at most 500 characters. Both appear above that section on the piece page
  and in its PDF export; copy the instruction from the scan rather than infer
  it from the seasonal variant.
- **Command**: `uv run noh apply-corrections`. A list that names a system the
  piece no longer has (after a re-slice or a new range) stops the build, naming
  the piece and the ref: check it against the scan again.
- **Confirm**: the piece's jump links and headings follow the list, each heading
  showing its printed label.

**On the admin screen**, the **Sections** screen (`/admin/sections/?piece=<slug>`,
linked from **Edit the sections** on Review's part items and from the edit page
as "edit its whole list of sections") shows the piece's systems beside its list. Press **Start a
section here** beside a system to add one, change a section's kind, number,
label, opening words or chant, move or remove it, or mark it printed elsewhere
(a volume and page). A system where a section starts is marked down its side
and named above it. **Approve this list**, at the foot of the list panel (it
stays in view however long the list), is greyed out until the list differs from
the piece's own; it records it as one correction,
`sections:<slug>` in `data/corrections.yml`, with the list it replaces as its
`was`; published, it counts like a list in `data/sections/`, and it goes stale
(stopping the build) if the piece's list changes underneath it. From the
command line the same correction is

```bash
uv run noh correct sections:sabbato-temporum-adventus sections '[{"kind": "introit", "system": 1, "chant": 169}, ...]'
```

each start a system counting from 1 (it is recorded as that system's ref).

#### A section with a name of its own (`key`)

Sections are named by kind and number (`gradual:2`, `other:3`), so adding one
before another of its kind renumbers the later ones, and whatever pointed at
them (a correction, a typeset match) then points at the wrong section. A row
may instead carry a `key`, a short name of its own in lower-case letters, digits
and hyphens (`kyrie-b`, `deo-gratias-vi`). It takes the place of `n` and
`variant`, the section is `part:<slug>/other:kyrie-b`, and it never changes
when rows are added or removed around it. Use it for whatever the kinds do not
foresee; give it a `label`, which is what the page shows.

#### A Mass of the Kyriale

A Mass keeps its movements (Kyrie, Gloria, Sanctus, Agnus Dei and one
dismissal) as the pipeline finds them. `data/sections/noh5.yml` lists only what
they leave out, each row with a `key`:

- a second Kyrie (Mass XVII's "Vel, ubi moris est");
- each dismissal, where the book prints several (an Ite for Easter week and
  another for the rest of Paschaltide; an Ite and a Benedicamus) or the
  pipeline found none.

```yaml
ordinarium-missae-iv:
- {kind: other, key: ite, label: 'Ite, missa est', ref: noh5/0074/004, chant: 353}
- {kind: other, key: benedicamus, label: Benedicamus Domino, ref: noh5/0074/005, chant: 2856}
```

**To move a movement** (the pipeline put the Gloria a system late), give a row
the movement's own name as its key: `kyrie`, `gloria`, `credo`, `sanctus`,
`agnus` or `ite`. That row is the movement, wherever the pipeline put it: it
keeps the movement's heading and chant unless you give it a label or a chant.

```yaml
ordinarium-missae-ix:
- {kind: other, key: gloria, ref: noh5/0100/000}
```

On the admin screen: open the Mass's edit page (**Edit** beside its title, or
**Correct** on a "Mass movement placed by order" item in Review), follow "edit
its whole list of sections", press **Start a section here** beside the right
system, leave its kind as *Section*, and type the movement's name under "A name
of its own".

A piece that is one chant of the Ordinary (a Credo, an ad libitum Kyrie) is
that movement from its first system; if its heading is in the wrong place, its
range is wrong: correct `system_range`.

On the page the rows stand among the movements in the book's order, each with
its own heading, jump link, chant and typeset music, and the export offers each
heading separately. A row that starts on the system where a movement was found
takes that movement's place (the row `ite` above replaces the heading "Ite,
missa est" the pipeline put there). Name a row for what it is: a typeset file
`benedicamus_IV.ly` is matched to the row whose key begins `benedicamus`
(docs/TYPESETTING.md).

Readers report a missing or mislabelled part with **A part is missing or
mislabelled** (on the Corrections page, or on a part's **Report**), naming the
system. The report waits in the queue with a link to the Sections screen;
saving a list from there marks the report a duplicate of the fix.

Single starts and chants can still be corrected on top of a list (below).

### Proper parts

- **File**: `data/corrections.yml`.
- **Change**: `uv run noh where <piece URL>` lists the piece's parts as
  targets, with where each starts and its chant. Then:

  ```bash
  uv run noh correct part:dominica-i-adventus/gradual start_system 4    # counting from 1
  uv run noh correct part:dominica-i-adventus/gradual chant 1169        # a GregoBase id, or none
  ```

  A part has no list of systems: it runs from the system it starts on until
  the next part starts. So a part that is missing systems at its end is fixed
  by moving the *next* part's start. The parts must still start in printed
  order once all your corrections are in, but not after each one: to move the
  Gradual down past where the Alleluia starts now, move both, in either order,
  and publish them together. (One at a time with `noh correct`, move the later
  part first.) A part printed in another volume is corrected where it is
  printed.
- **Command**: none; `noh correct` rewrites the files.
- **Confirm**: the part's heading on the piece page sits above the right
  system, and its **Chant** link opens the right melody. A new chant's
  notation (drawn above the music) comes with it: publishing from the admin
  screen runs `noh chants` on GitHub. Locally, run
  `uv run noh gregobase-fetch && uv run noh chants` (the check on every pull
  request insists on it).

Editors do the same on the admin screen: **Edit** beside the part's heading,
or **Which part?** on the edit page. Readers use **Report** beside it.

How the pipeline places a part: a margin label ("Grad.", "2. Grad.", "Hymn.")
starts a section; a part jgabc lists that no label names is found by its words,
only between the sections before and after it; failing that, it is placed only
where exactly one chant starts in that gap (`inferred`), and otherwise it goes to
the review queue (`part_missing`, naming the candidate systems). Nothing is
placed by guesswork any more. Nothing unlabelled starts inside the Introit's
Psalm verse and Gloria Patri, and the word "alleluia" places an Alleluia only
where its chant begins (at the start of the line, beside its mode, or before
its asterisk), not where it ends a Paschaltide Introit, Offertory or Communion.

**Part to check**, a kind on Review (`/admin/review/?kind=part_to_check`; the
old `/admin/parts/` address leads there), lists the parts whose start looks wrong: inferred rather than read from a label or the
words, or much shorter than that kind of part usually is (often because the next
part starts too early). A reviewed section list counts as checked. Each opens its edit page with the scan. A part corrected by hand,
or marked **Looks right**, leaves the list once it is published; a part marked
**Looks right** comes back if its start or length changes.

### Psalm formulas and notes

- **File**: `psalm_formulas` and `magnificats` in `data/vespers/vespers-noh8.yml`.
- **Change**: add a formula only from a printed accompaniment in exactly that
  tone and ending. Where NOH8 prints none, the page correctly shows a note, and
  that is not an error.
- **Command**: `uv run noh vespers-lineup`. Its summary lists the
  `tone_unprinted` tones left.

### Slicing a page

A page's staves are found line by line; a slur or beam read as a staff line,
or a line read twice or lost, can hide a staff, and the page is then cut wrongly.

1. `uv run noh overlay --volume noh<N> --pages <pdf page>` draws the boxes on
   the page (`build/overlay/`).
2. Name the PDF page under that volume's `staff_finder` in `data/volumes.yml`,
   with a comment naming the fault, and one of these settings:
   - `refit`: a stray row, or a line read twice or lost; the staves are fitted
     as on faint print (strays ignored, one line of five may be missing).
   - `dashed`: staff lines printed as dashes; as `refit`, bridging wider gaps.
   - `plain`: tilt recovery cuts the page wrongly; the strict finder alone.

   Only the pages named change. Re-run the overlay and check every staff is in
   a box.
3. `uv run noh publish --volume noh<N> --pages <pdf page>` re-slices it and
   records the new images in `data/published/`; add `--upload` (R2 keys) to
   send them, or run the Images workflow.
4. `uv run noh catalog --volume noh<N>`, then fix any list in `data/sections/`
   whose refs moved (the build names them), and `uv run noh apply-corrections`.

### Refreshing a source

Each vendored source is pinned to a commit. Its command fetches, checks and
rewrites the vendored file; never edit those files by hand.

```bash
uv run noh officium-fetch --commit <sha>     # Divinum Officium
uv run noh vesperale-fetch --commit <sha>    # vesperale
uv run noh jgabc-fetch --commit <sha>        # jgabc
uv run noh calendar                          # the 1962 calendar (Missalemeum)
```

Then run `uv run noh vespers-lineup` and `uv run noh doctor`, and read the
summary for anything new to review.

### Adding a volume

Slicing and uploading the page images needs the R2 keys, so this one runs on
the maintainer's machine.

1. Add the PDF as `pdf-source/NOH<N> <name>.pdf` (only `NOH*.pdf` files are
   tracked there), and register it in `data/volumes.yml`.
2. Run `uv run noh index-extract --volume noh<N>`, which proposes
   `data/index-noh<N>.proposed.yml`. Review it, then rename it to
   `index-noh<N>.yml`.
3. Run `uv run noh catalog --volume noh<N>`.
4. Run `uv run noh publish --volume noh<N> --upload`, which slices the pages,
   uploads the images and records them in `data/published/noh<N>.json` (commit
   it: a rebuild on GitHub reads it).
5. Run `uv run noh vespers-lineup` and `uv run noh chants`.
6. Run `pnpm build`. The link check confirms every new page can be reached.

---

## What never to touch

- **Generated files**: `data/catalog.json`, `data/catalog.base.json`,
  `data/vespers/vespers-lineup.json`, `data/chants.json`, `data/review-queue.json`,
  and the vendored `data/*-propers.json`, `divinum-officium-vespers.json` and
  `vesperale-lineup.json`. Commands rewrite them, and a hand edit is lost or
  fails its checksum.
- **`pdf-source/`**: only the NOH scans are tracked. The Corpus Christi
  Watershed reference edition beside them on the maintainer's machine is never
  published; a test fails if any other file there is ever committed.
- **`data/published/` and `data/ocr/`**: records of the published images and
  of the margin readings, written by `noh publish` and `noh catalog`.
- **Secrets**: `web/.env` and `.dev.vars` are 1Password mounts. Never copy
  their values anywhere.

## When a check fails

`noh doctor`, `noh correct` and `pnpm build` each say what failed and what to
do. The common ones:

| Message | Meaning | Do |
|---|---|---|
| `stale correction c-0007` | The generated value changed after the fix was made | Check the new value; set `was:` to it, or `noh corrections --drop c-0007` |
| `piece:… no longer exists` | A slug was renamed | `noh where "<a few words>"`, then update or drop the entry |
| `catalog.json is not current with corrections.yml` | The overlay wasn't applied | `uv run noh apply-corrections` |
| `Vespers lineup … has changed since the lineup was written` | The catalogue was rebuilt | `uv run noh vespers-lineup` |
| `N page(s) no link leads to` (from `pnpm build`) | A reader can't reach those pages | Link each from its day, book section or index |
| `N link(s) to pages that do not exist` | A link points nowhere | Fix the link, or build the page |

The Vespers review entries (`tone_unprinted`, `office_unprinted`,
`tone_disagreement`) are explained in the README's Vespers section.
