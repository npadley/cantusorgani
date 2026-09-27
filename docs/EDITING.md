# Editing Cantus Organi

How to fix what the site shows: a wrong title, a wrong tone, a Mass on the
wrong day, a reader's correction. Start from what you see, find it in the
table below, and follow the recipe. You do **not** need the scanned PDFs for
most fixes.

## What do you want to fix?

| You see… | Recipe | Needs the PDFs? |
|---|---|---|
| A piece's title, incipit or mode is wrong | [Title, incipit, mode](#title-incipit-mode) | No |
| A piece's printed pages are wrong | [Printed pages](#printed-pages) | No |
| A reader sent a correction | [The admin screen](#the-admin-screen), or [Reader corrections](#reader-corrections) | No |
| A Vespers antiphon, tone, hymn or Magnificat antiphon is wrong | [Vespers items](#vespers-items) | No |
| A Vespers chant link is wrong or missing | [Vespers chant links](#vespers-chant-links) | No (needs the GregoBase dump) |
| A day shows the wrong Mass, or no Mass | [Days and rubrics](#days-and-rubrics) | Yes |
| A piece starts or ends on the wrong page or system | [Piece boundaries](#piece-boundaries) | Yes |
| A Proper part (Introit, Gradual…) starts on the wrong system, or its chant link is wrong | [Proper parts](#proper-parts) | Not yet fixable by hand |
| A Vespers psalm uses the wrong formula, or should show a note | [Psalm formulas and notes](#psalm-formulas-and-notes) | No |
| A newer Divinum Officium, vesperale, jgabc or calendar | [Refreshing a source](#refreshing-a-source) | No |
| A new volume to add | [Adding a volume](#adding-a-volume) | Yes |

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
  proposed one (which you can change before accepting), the reader's note and
  the printed system. **Accept**, **Reject** (with a reason) or **Duplicate**.
- **Make a correction yourself**: every piece page has an **Edit** link at its
  foot, which opens the form for that piece. Your fix is approved at once.
- **Publish changes** sends everything approved to GitHub as one pull request.
  The owner merges it, and merging deploys the site. Closing it without merging
  puts the corrections back under **To review**.
- **History** lists what was accepted (with its commit) and what was rejected
  (with the reason).

Every action records who did it. Two editors can't both act on one report: the
second is told who got there first. The admin screen corrects a piece's title,
incipit, mode, genre and printed pages. Everything else needs the loop below.

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

This takes about 15 minutes, and none of it needs `pdf-source/`.

1. Install [uv](https://docs.astral.sh/uv/) and
   [pnpm](https://pnpm.io/installation). Node 22 or newer is required.
2. At the repository root:

   ```bash
   uv sync
   pnpm --dir web install
   uv run noh doctor
   ```

   `noh doctor` checks everything and names the fix for each failure. Failures
   about `pdf-source/`, Tesseract or R2 only matter for the recipes marked
   *Needs the PDFs*.
3. For `pnpm dev` with the real images, and for publishing, you need the
   1Password Environment mounted as `web/.env` (see the README's Secrets
   section). Without it, `pnpm dev` still runs, using local image paths.

## The loop

| Step | Command | Time |
|---|---|---|
| Find it | `uv run noh where <page URL or words>` | instant |
| Change it | `uv run noh correct …`, or edit the YAML file the recipe names | — |
| Regenerate | the recipe's command (`noh apply-corrections`, `noh vespers-lineup`, `noh catalog`) | < 1 s; `noh catalog` about 1 min per volume |
| Check | `uv run noh doctor`; `uv run pytest -m "not source and not slow"` | ~10 s |
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

This changes only the page numbers shown. If the music itself starts on the
wrong system, see [Piece boundaries](#piece-boundaries).

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

A report about a chant link is refused with a pointer to
[Vespers chant links](#vespers-chant-links) or [Proper parts](#proper-parts),
because chant pairings are fixed at the source.

### Vespers items

- **File**:
  - `data/vespers-offices.yml` for feasts and every office other than the green
    Sundays;
  - `data/vespers-noh8.yml` for the green Sundays' Magnificat antiphons
    (`magnificat_antiphons`), the Sunday psalter, the Marian antiphons and the
    seasons.

  `noh where <vespers page URL>` names both.
- **Change**: find the office (for example `adv1:`) and edit the item:
  - `tone:` as printed in the margin, for example `VIII.G` or `IV.A*`;
  - `refs:`, the systems it's printed on. Each system is `noh8/<PDF page>/<n>`,
    and every image on the site carries its ref in `data-ref`.
  - `incipit:`, the words.

  ```yaml
      - n: 1
        incipit: In illa die
        refs: [noh8/0077/000, noh8/0077/001]
        tone: VIII.G
  ```

- **Command**:

  ```bash
  uv run noh vespers-lineup
  uv run noh vespers-lineup --day 2026-11-29     # check one day, item by item
  ```

- **Confirm**: the `--day` output matches the book; preview `/vespers/<date>/`.

### Vespers chant links

- **File**: the `chant:` field of the item, in `data/vespers-offices.yml` or
  `data/vespers-noh8.yml`, holds the GregoBase id: the number in
  `gregobase.selapa.net/chant.php?id=<id>`. Use `null` for no link.
- **Command**: `uv run noh vespers-lineup`, then `uv run noh chants`.
  `noh chants` needs the GregoBase dump in `vendor/`; the README's Vendored
  data section says how to get it.
- **Confirm**: the "Chant" link on the Vespers page opens the right melody.

### Days and rubrics

*Needs the PDFs.*

- **File**:
  - `days:` of the piece in `data/index-<volume>.yml` (the calendar keys it's
    sung on, for example `tempora:Adv1-0`);
  - or `data/rubrics-1962.yml`, for a day that takes another day's Mass.
- **Command**: `uv run noh catalog --volume <volume>`, then
  `uv run noh vespers-lineup`.
- **Confirm**: open `/day/<season>/<key>/`; the Proper listed is the right
  one.

### Piece boundaries

*Needs the PDFs.*

- **File**: `page:` of the entry in `data/index-<volume>.yml`, the printed page
  the piece starts on.
- **Command**: `uv run noh catalog --volume <volume>`. It re-reads the scans
  and reports anything uncertain in `data/review-queue.json`.
- **Confirm**: preview the piece; its first system is the one printed.

### Proper parts

This can't be fixed by hand yet. Where each part starts and which chant it
links to are worked out from the scans and jgabc when `noh catalog` runs. The
plan's Phase D adds `part:` corrections. Until then, open an issue on GitHub
naming the piece and the part.

### Psalm formulas and notes

- **File**: `psalm_formulas` and `magnificats` in `data/vespers-noh8.yml`.
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

*Needs the PDFs.*

1. Register the PDF in `data/volumes.yml`.
2. Run `uv run noh index-extract --volume noh<N>`, which proposes
   `data/index-noh<N>.proposed.yml`. Review it, then rename it to
   `index-noh<N>.yml`.
3. Run `uv run noh catalog --volume noh<N>`.
4. Run `uv run noh publish --volume noh<N> --upload`, which slices the pages
   and uploads the images.
5. Run `uv run noh vespers-lineup` and `uv run noh chants`.
6. Run `pnpm build`. The link check confirms every new page can be reached.

---

## What never to touch

- **Generated files**: `data/catalog.json`, `data/catalog.base.json`,
  `data/vespers-lineup.json`, `data/chants.json`, `data/review-queue.json`,
  and the vendored `data/*-propers.json`, `divinum-officium-vespers.json` and
  `vesperale-lineup.json`. Commands rewrite them, and a hand edit is lost or
  fails its checksum.
- **`pdf-source/`**, and especially the Corpus Christi Watershed reference
  edition in it. The CCW edition is never published.
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
