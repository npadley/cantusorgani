# Editing Cantus Organi

How to fix what the site shows: a wrong title, a wrong tone, a Mass on the
wrong day, a reader's correction. Start from what you see, find it in the
table below, and follow the recipe. Nothing here needs your own computer's
files: the scanned PDFs are in the repository, and the recipes that rebuild the
catalogue can run on GitHub.

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
| A Vespers psalm uses the wrong formula, or should show a note | [Psalm formulas and notes](#psalm-formulas-and-notes) | No |
| A newer Divinum Officium, vesperale, jgabc or calendar | [Refreshing a source](#refreshing-a-source) | No |
| A new volume to add | [Adding a volume](#adding-a-volume) | Yes (and uploads images: your machine) |

Two kinds of people edit:

- **Editors** use the [admin screen](#the-admin-screen). It needs no laptop and
  no secrets.
- **The maintainer** uses the full loop below, for everything the admin screen
  can't do yet.

## The admin screen

`https://cantusorgani.org/admin/` is for editors: sign in with your email (a
code arrives by email). Setting it up is described in
[docs/ADMIN-SETUP.md](ADMIN-SETUP.md).

- **To review** lists readers' reports. Each shows the current value, the
  proposed one (which you can change before accepting) and the reader's note,
  beside the systems the report is about: a part's first system and the one
  proposed, a Vespers item's systems, a piece's first and last. Each picture is
  captioned with its ref. **Accept**, **Reject** (with a reason) or
  **Duplicate**.
- **Make a correction yourself**: every piece page has an **Edit** link at its
  foot, which opens the form for that piece. Your fix is approved at once.
- **Publish changes** sends everything approved to GitHub as one pull request.
  The owner merges it, and merging deploys the site. Closing it without merging
  puts the corrections back under **To review**.
- **History** lists what was accepted (with its commit) and what was rejected
  (with the reason). Accepted corrections also appear publicly at
  `/corrections/log/`, without names or addresses.

Every action records who did it. Two editors can't both act on one report: the
second is told who got there first. The admin screen corrects a piece's title,
incipit, mode, genre, printed pages and system range; where a Proper part starts
and its chant; a Mass movement's chant; and a Vespers antiphon's tone, chant,
printed systems and a note shown instead of its music. Everything else needs the
loop below.

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
| Regenerate | the recipe's command (`noh apply-corrections`, `noh vespers-lineup`, `noh catalog`) | < 1 s; `noh catalog` about 1 min per volume |
| Check | `uv run noh doctor`; `uv run pytest -m "not source and not slow"`; `pnpm --dir web test` | ~10 s each |
| Browser tests | `pnpm --dir web build`, then `pnpm --dir web test:e2e` (the admin screen and forms in Chromium) | ~1 min |
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
- **Command**: `uv run noh catalog --volume <volume>`. It re-reads the scans
  and reports anything uncertain in `data/review-queue.json`.
- **Confirm**: preview the piece; its first system is the one printed.

### Proper parts

- **File**: `data/corrections.yml`.
- **Change**: `uv run noh where <piece URL>` lists the piece's parts as
  targets, with where each starts and its chant. Then:

  ```bash
  uv run noh correct part:dominica-i-adventus/gradual start_system 4    # counting from 1
  uv run noh correct part:dominica-i-adventus/gradual chant 1169        # a GregoBase id, or none
  ```

  A part's start must stay between its neighbours' starts. A part printed in
  another volume is corrected where it is printed.
- **Command**: none; `noh correct` rewrites the files.
- **Confirm**: the part's heading on the piece page sits above the right
  system, and its **Chant** link opens the right melody. A new chant's
  notation (drawn above the music) comes with it: publishing from the admin
  screen runs `noh chants` on GitHub. Locally, run
  `uv run noh gregobase-fetch && uv run noh chants` (the check on every pull
  request insists on it).

Editors do the same on the admin screen: **Edit** beside the part's heading,
or **Which part?** on the edit page. Readers use **Report** beside it.

A part the pipeline placed by order alone (a guess) isn't shown on the site,
so it has no Report link. It's listed on the admin edit page and in
`noh where`.

### Psalm formulas and notes

- **File**: `psalm_formulas` and `magnificats` in `data/vespers/vespers-noh8.yml`.
- **Change**: add a formula only from a printed accompaniment in exactly that
  tone and ending. Where NOH8 prints none, the page correctly shows a note, and
  that is not an error.
- **Command**: `uv run noh vespers-lineup`. Its summary lists the
  `tone_unprinted` tones left.

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
