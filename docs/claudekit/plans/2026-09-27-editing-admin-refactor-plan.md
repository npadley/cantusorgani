# Editing guide, corrections admin, and refactor — brainstorm and plan

**Date**: 2026-09-27
**Status**: brainstorm, for review before anything is built

## Why now

Three things surfaced together:

1. **There is no written way to fix anything.** Every fix today means knowing
   which YAML file under `data/` holds the fact, which `noh` command regenerates
   the output, and how to check and deploy. Only the code records this.
2. **Readers' corrections go nowhere.** The Corrections form posts to the
   `workers/corrections` Worker, which stores rows in D1 (`status = pending`).
   `tools/triage/main.py` can apply them, but it is undocumented, command-line
   only, and has a latent bug (below).
3. **The Vespers pages were unreachable from the book.** Each page worked when
   its URL was typed, but the Vesperale sections did not link to it. Checks
   tested pages, never the routes readers take. Vespers was added onto a site
   built around Mass pieces, and the seams show.

## What exists today

| Concern | Where | State |
|---|---|---|
| Piece placement and titles | `data/index-noh*.yml` (hand-reviewed) → `noh catalog` → `data/catalog.json` | Works; undocumented |
| Proper parts, chant links | computed in `noh catalog` from scans + jgabc + GregoBase | Works; can only be fixed through the index or code |
| Vespers offices | `data/vespers-offices.yml`, `data/vespers-noh8.yml` → `noh vespers-lineup` → `data/vespers-lineup.json` | Works; undocumented |
| Calendar | `noh calendar` from Missalemeum | Works |
| Reader corrections | Worker → D1 `corrections` table | Intake works; nobody reads the queue |
| Applying corrections | `tools/triage/main.py` writes into `data/catalog.json` | **Bug**: see below |
| Deploy | `pnpm build` + `wrangler pages deploy`, run by hand from the laptop | No CI |

**The latent bug.** Triage writes accepted corrections straight into
`data/catalog.json`. But `catalog.json` is an *output*: the next `noh catalog`
run for that volume regenerates it from the index and scans (`merge_catalog`
replaces the whole volume). Every accepted correction would be silently lost.
No correction has been accepted yet, so nothing has been lost so far.

**The form's vocabulary is too narrow.** It accepts six fields on a piece
(title, incipit, mode, genre, printed pages, chant). It cannot express the
errors most likely now: a part starting on the wrong system, a wrong Vespers
tone, a wrong antiphon or Magnificat antiphon, a missing chant link on a
Vespers item.

## Principles

- **Files in git are the truth.** D1 is a mailbox and the admin screen is a
  convenience. Every change lands as a reviewable diff, so the site can always
  be rebuilt from `data/` and any change can be reverted.
- **Hand fixes are an overlay, never edits to generated files.** Generated
  outputs (`catalog.json`, `vespers-lineup.json`, `chants.json`) are never
  hand-edited. Fixes live in one reviewed file that each build applies last,
  and the build fails loudly if a fix no longer applies.
- **Test the routes readers take**, not only the pages.

---

## Part 1 — The editing guide (`docs/EDITING.md`)

Written first, because it is useful at once and forces the overlay design to be
concrete. It is organised by symptom rather than by file.

1. **Setup, once**: `uv sync`, `pnpm install`, the 1Password-mounted `web/.env`
   (point to the Secrets section of the README; no values), `uv run noh doctor`.
2. **The loop**: edit → regenerate → check → preview → deploy, with the exact
   commands and roughly how long each takes.
3. **Recipes**, one per symptom. Each gives the file, an example diff, the
   command and how to confirm:
   - A piece's title, incipit or mode is wrong.
   - A piece starts or ends on the wrong page or system.
   - A Proper part (Introit, Gradual…) starts on the wrong system.
   - A chant link is wrong or missing (Mass part, Vespers antiphon).
   - A Mass is missing for a day, or a day points at the wrong Mass (rubrics).
   - A Vespers antiphon, tone, hymn or Magnificat antiphon is wrong.
   - A Vespers psalm uses the wrong formula, or should show a note.
   - A tone the book does not print (where the note text comes from).
   - Refreshing a vendored source (Divinum Officium, vesperale, jgabc,
     calendar) and what to check after.
4. **Handling reader corrections**: run triage (and, after Part 2, use the admin
   screen), accept or reject, commit, deploy.
5. **What never to touch**: generated JSON, `pdf-source/`, the CCW reference
   edition, secrets.
6. **When a check fails**: each `noh doctor` failure and each review-queue kind,
   and what it means. Much of this exists in the README's Vespers section; move
   it here.

The README keeps a short overview that links to `EDITING.md`.

## Part 2 — The corrections admin screen

### What it does

- **Queue**: pending reader corrections, newest first. Each is shown beside the
  scan of the piece or item it names, with the current value, the proposed
  value and the note.
- **Accept** (with the value editable before accepting), **reject** (with a
  short reason), or **mark duplicate**.
- **Edit directly**: from any piece or Vespers page, while signed in, an "Edit"
  control opens the same form for your own fixes, without a reader's report.
- **Batching**: accepted items gather into one pending change. "Publish
  changes" opens a single GitHub pull request that edits `data/corrections.yml`,
  with each correction's id in the description. Merging it rebuilds and deploys
  the site (Part 3, CI), and a webhook or next visit stamps the D1 rows
  `accepted` with the merge commit.
- **History**: accepted and rejected corrections, with links to their PRs.

### How it is built

- **Where**: `/admin/` routes on the existing Pages site as Pages Functions, or
  a small second Worker. It reads and writes the existing D1 database, so there
  is no new store.
- **Who can get in**: **Cloudflare Access** in front of `/admin/*` and the admin
  API, allowing only your email address (a one-time code or Google login). There
  is no password system to build. The Function also **verifies the Access JWT**
  on every request (signature, audience, email), so a misconfigured Access rule
  cannot open it up by itself.
- **Writing to GitHub**: a fine-grained GitHub token, or better a GitHub App,
  limited to `npadley/cantusorgani` with contents and pull-request write only.
  It is stored as a Worker secret, sourced from 1Password, and never in the repo.
- **Validation**: the same per-field rules as the Worker and triage, from one
  shared schema definition (below), applied again on accept.
- **Safety**: state-changing requests are POST only, same-origin checked, and
  rate-limited. Rendering uses Astro's escaping only, with no raw HTML from rows.

### Widening what can be corrected

A correction names a **target** rather than always a piece:

- `piece:<slug>` with fields title, incipit, mode, genre, printed pages,
  system range.
- `part:<slug>/<part>` with fields start system and chant (GregoBase id).
- `vespers:<office>/<item>` with fields tone, chant, refs (systems), and "show
  a note instead".

This needs D1 migration 0002 (additive: a `target` column, with `piece_id` kept
for old rows) and a Corrections form that is prefilled from the page the reader
came from. Every piece and Vespers page gets a "Report an error here" link
carrying the target.

### Alternatives considered

- **A git-based CMS (Decap, Tina)**: generic form editors over files. Rejected:
  the data needs domain validation and scan context, and those tools would edit
  generated JSON or need heavy configuration.
- **D1 as the source of truth**: simpler writes, but no diff, no review, and the
  site would depend on a database. Rejected.
- **Command line only (improved triage)**: the cheapest option. Kept as the
  fallback, and built first in Part 3, since the admin screen calls the same
  apply logic.

## Part 3 — The refactor

In order. Each step ships on its own.

1. **Corrections overlay** (fixes the latent bug). Add `data/corrections.yml`,
   a list of `{id, target, field, value, source: reader#123 | editor, date}`.
   `noh catalog` and `noh vespers-lineup` apply it last, and fail with a clear
   message when a target no longer exists. Triage writes to it instead of to
   `catalog.json`. Test: accept a correction, rebuild the catalogue, and check
   the correction survives.
2. **One correction schema.** A single JSON Schema in `data/schema/` that the
   Worker (TypeScript), triage (Python) and the admin screen all load, replacing
   the three hand-mirrored copies (`schema.ts`, `FIELD_PATTERNS`, the form's
   `FIELDS`).
3. **Reachability test.** After `pnpm build`, a test crawls `dist/` from `/` and
   asserts:
   - every piece page is reachable;
   - every Vespers page is reachable from `/vespers/`, from its day page and
     from its Vesperale section;
   - every day page is reachable from `/calendar/`;
   - no internal link 404s.

   This is the check that would have caught the Vespers miss.
4. **CI build and deploy.** A GitHub Actions workflow runs on push to `main`:
   Python and web tests, gitleaks, `pnpm build`, the reachability test, then
   `wrangler pages deploy`. A Cloudflare API token limited to Pages is stored as
   a GitHub secret. Page images are already on R2, so CI needs only `data/` and
   `web/`, not `pdf-source/`. Merging an admin PR then deploys with no laptop in
   the loop, and hand deploys stop.
5. **One model of the day.** Today the pipeline and the site each work out a
   day's office key: `normalKey` (strip `r`, `m\d`), the observance fallback to
   `r`/`m3` in `lineupTitle`, and `vespers.normal_key` in Python. The pipeline
   should emit one canonical key and the titles into both `catalog.json` and
   `vespers-lineup.json`, and the site should stop guessing.
6. **Split the large modules along their seams.**
   - `pipeline/vespers.py` (740 lines) → `vespers/calendar.py` (the Vespers of
     each date), `vespers/music.py` (psalm and Magnificat sources),
     `vespers/lineup.py` (build and write).
   - `pipeline/indexextract.py` (1,703 lines) → reading, matching and
     verification.
   - Move Vespers data under `data/vespers/`.

   This is behaviour-neutral, and the goldens and tests stay as they are.
7. **Docs**: README reduced to an overview, `docs/EDITING.md` (Part 1),
   `docs/ARCHITECTURE.md` (sources → pipeline → data → site, with one diagram).

## Phasing

| Phase | Contents | Size |
|---|---|---|
| A | Editing guide, corrections overlay, triage writes to the overlay | small |
| B | Reachability test, CI build and deploy | small–medium |
| C | Admin screen (queue, accept or reject, publish as PR), Access, one schema | medium |
| D | Wider targets (parts, Vespers items), prefilled "Report an error here" links | medium |
| E | One model of the day, module split, architecture doc | medium, no user-visible change |

A first makes fixes possible and safe. B makes them deploy themselves. C and D
make them pleasant.

## Decisions for you

1. **Sign-in**: Cloudflare Access with your email is recommended. Do you want
   anyone else to have admin access?
2. **Accept flow**: a PR per batch, which you merge (recommended, and you can
   review the diff), or commit straight to `main`?
3. **CI deploys**: are you happy for merges to `main` to deploy automatically?
   This needs a Cloudflare API token limited to Pages, stored in GitHub.
4. **Direct editing**: should the admin screen allow your own edits without a
   reader's report (recommended), or only process reports?
