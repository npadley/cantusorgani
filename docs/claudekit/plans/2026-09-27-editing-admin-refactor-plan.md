# Editing guide, corrections admin, and refactor — brainstorm and plan

**Date**: 2026-09-27
**Status**: decisions taken; autoplan review applied (all 16 fixes, see
`docs/claudekit/reviews/2026-09-27-editing-admin-refactor-plan-autoplan-2026-09-27.md`); ready to build

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
| Reader corrections | Worker → D1 `corrections` table | Intake works; nobody reads the queue. As of 2026-09-27 the table is **empty**: no correction has ever been received |
| Applying corrections | `tools/triage/main.py` writes into `data/catalog.json` | **Bug**: see below |
| Deploy | `pnpm build` + `wrangler pages deploy`, run by hand from the laptop | No CI |

**The latent bug.** Triage writes accepted corrections straight into
`data/catalog.json`. But `catalog.json` is an *output*: the next `noh catalog`
run for that volume regenerates it from the index and scans (`merge_catalog`
replaces the whole volume). Every accepted correction would be silently lost.
No correction has been accepted yet, so nothing has been lost so far.

**Demand.** With no reader reports so far, the admin screen is justified by
the owner's own edits and future editors, not by a backlog. It is not gated on
intake. The prefilled "Report an error here" links (Phase D) should raise
report volume and quality.

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
- **Fix at the source when the source can express it** (`index-noh*.yml`,
  `vespers-offices.yml`, `vespers-noh8.yml`). The overlay is only for values
  the pipeline computes. `noh doctor` lists overlay entries that are now no-ops,
  so they can be moved to the source or deleted.
- **Test the routes readers take**, not only the pages.

---

## Part 1 — The editing guide (`docs/EDITING.md`)

Written first, because it is useful at once and forces the overlay design to be
concrete. It is organised by symptom rather than by file.

The guide has **two paths**:
- **Editors**: the admin screen only, with no laptop and no secrets.
- **The maintainer**: the full loop below.

It opens with a **symptom table** (symptom → recipe anchor), ordered by how
often each comes up: wrong title, wrong system, missing chant link, and so on.
Every recipe uses the same four headings: **File, Change, Command, Confirm**.

0. **Your first edit in five minutes**: a copy-pasteable walkthrough that fixes
   one real title, with each command's expected output shown:
   1. Open the piece page.
   2. Run `uv run noh where <page URL>` to get its target.
   3. Run `uv run noh correct piece:<slug> title "…"`.
   4. Run `uv run noh apply-corrections`.
   5. Run `pnpm dev` and see the change.
1. **Setup, once** (target: under 15 minutes). You do **not** need `pdf-source/`
   to make corrections. Then: `uv sync`, `pnpm install`, the 1Password-mounted `web/.env`
   (point to the Secrets section of the README; no values), `uv run noh doctor`.
2. **The loop**: edit → regenerate → check → preview → deploy, with the exact
   commands, each command's expected success output, and measured timings.
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
   - Adding a new volume: `index-noh<N>.yml` → `noh catalog` →
     `noh vespers-lineup` → the reachability test.

   **Finding what to fix**: `uv run noh where <page URL>` prints the target, the
   source file and line, and the regenerate command. Every recipe starts with it.
4. **Handling reader corrections**: run `uv run noh triage --dry-run`, then
   `uv run noh triage` (and, after Part 2, use the admin screen), accept or
   reject, then commit; CI deploys.
5. **What never to touch**: generated JSON, `pdf-source/`, the CCW reference
   edition, secrets.
6. **When a check fails**: each `noh doctor` failure and each review-queue kind,
   and what it means. Much of this exists in the README's Vespers section; move
   it here.

The README keeps a short overview that links to `EDITING.md`.

## Part 2 — The corrections admin screen

### What it does

- **Queue**: pending reader corrections, newest first. Each item reads top to
  bottom:
  - the target label;
  - the current and proposed values, with the proposed value editable and
    visually dominant;
  - the reader's note, in muted text;
  - the scan crop of the named systems.

  The actions come last, in this order: **Accept** (the only filled button),
  Reject, Duplicate. On screens narrower than 60rem the scan stacks below the
  values instead of sitting beside them.
- **Accept** (with the value editable before accepting), **reject** (with a
  short reason), or **mark duplicate**.
- **Edit directly**: every public piece and Vespers page has a plain "Edit"
  link to `/admin/edit?target=<target>`, which opens the same form for your own
  fixes without a reader's report. Access asks for sign-in there. Public pages
  stay static and never detect a session.
- **Batching**: accepted items gather into one pending change, shown as a
  single-line bar: "N changes ready · Publish changes". Publishing opens one
  GitHub pull request that edits `data/corrections.yml` (and regenerated
  outputs), with each correction's id and editor in the description. Merging it
  deploys the site through CI. The CLI equivalent is `uv run noh triage`.
- **History**: accepted and rejected corrections, with links to their PRs.
- **States**:
  - *Empty queue*: "No pending corrections. Last reviewed <date>.", with a link
    to History.
  - *Conflict*: if another editor has already acted on a row, the POST returns
    409 and the item shows "Already accepted by <email> at <time>" in a
    `.notice`, with the form disabled.
  - *Stale target*: "This piece or item no longer exists". Only Reject and
    Duplicate are offered.
  - *Failed PR*: the batch stays intact, and a `.notice` shows GitHub's status
    plus "Nothing was published; try again", with a Retry button.
  - *Awaiting merge*: "PR #N open, waiting for the owner". Publish is disabled
    until the PR merges or closes.
  - *Signed out or expired Access*: API calls return 401, and the page shows
    "Your session ended. Sign in again", with a link back to the same item.
    Unsaved edits are kept in sessionStorage.
  - *Loading*: the text "Loading…", as on `/corrections/`.

### How it is built

- **Where**: `/admin/` routes on the existing Pages site as **Pages Functions**
  (no second Worker). It reads and writes the existing D1 database, so there is
  no new store.
- **Who can get in**: **Cloudflare Access** in front of `/admin/*` and the admin
  API. Sign-in is by a one-time code sent to email, or Google, and there is no
  password system to build. Access's free plan covers up to 50 users.
- **Several editors**: the Access policy allows a list of email addresses,
  added and removed in the Cloudflare dashboard with no code change. The
  Function also **verifies the Access JWT** on every request (signature,
  audience, and email against its own `EDITORS` allowlist), so a misconfigured
  Access rule cannot open it up by itself.
- **Two roles, kept simple**:
  - *Editors* (anyone signed in) can accept, reject or edit, and "Publish
    changes".
  - *The owner* is the only one who can merge the resulting pull request on
    GitHub, which is what reaches the site. Publishing therefore stays with
    you, however many editors there are.

  Every accept, reject and edit records the editor's email in D1 and in the PR
  description.
- **Writing to GitHub**: a **GitHub App** installed on `npadley/cantusorgani`
  only, with contents and pull-request write. Its installation tokens are
  short-lived, so there is no expiry to renew by hand. The App's private key is
  a Pages secret, sourced from 1Password, and never in the repo.
- **Batch lifecycle**:
  - Publish sets rows to `queued`, with `pr_number`.
  - A GitHub `pull_request` webhook, checked by HMAC-SHA256 against
    `GITHUB_WEBHOOK_SECRET` (the check fails closed), sets `accepted` plus the
    merge SHA when the PR merges, and sets rows back to `pending` when a PR
    closes unmerged.
  - The App pushes only to `corrections/<batch-id>` branches.
  - A ruleset on `main` requires a PR, the owner's approval and passing CI, and
    blocks direct pushes, including from the App.
  - CI uses `pull_request`, never `pull_request_target`.
  - Access and the JWT check also cover `*.pages.dev` preview hosts.
  - `ACCESS_AUD` and the Access team certs URL are configuration variables,
    not code.
- **Validation**: the same per-field rules as the Worker and triage, from one
  shared schema definition (below), applied again on accept.
- **Safety**: state-changing requests are POST only, same-origin checked, and
  rate-limited. Rendering uses Astro's escaping only, with no raw HTML from rows.
- **Look**:
  - Admin pages use `Layout.astro`, `tokens.css` and base.css (`button`,
    `.notice`, `.muted`, `.small`, `--tap-min`), with no new colours, shadows or
    card chrome.
  - A small "Admin · signed in as <email>" line sits above the h1.
- **Accessibility** (WCAG 2.2 AA):
  - 4.5:1 contrast for text and controls, in both themes.
  - All actions are real `<button>`s, no smaller than `--tap-min`.
  - Keyboard triage: Tab reaches the value input, Accept, Reject and Duplicate
    in that order; after an action, focus moves to the next item's heading.
  - Outcomes are announced in an `aria-live="polite"` region.
  - Scan crops have `alt` text naming the piece and systems.
  - Reject opens an inline labelled reason field, not a modal.

### Widening what can be corrected

A correction names a **target** rather than always a piece:

- `piece:<slug>` with fields title, incipit, mode, genre, printed pages,
  system range.
- `part:<slug>/<part>` with fields start system and chant (GregoBase id).
- `vespers:<office>/<item>` with fields tone, chant, refs (systems), and "show
  a note instead".

**Migration 0002** is a table rebuild, not an additive change, because SQLite
cannot change a CHECK constraint:
1. Create `corrections_new` with `target`, the statuses
   `pending|queued|accepted|rejected|duplicate`, and the columns `pr_number`,
   `editor_email` and `reason`.
2. Copy the old rows across with `target = 'piece:'||piece_id`.
3. Swap the tables and rebuild `idx_corrections_dedupe` on
   `(target, field, proposed)`.

It ships with `rollback/0002_down.sql`. Deploy order: first `status.ts`, so it
accepts the new target format and statuses; only then start writing them.

**Report an error here**:
- Every piece and Vespers item carries the link, carrying its target. It sits
  at the foot of the item as small muted text, after the music and never in the
  header, and is hidden in print (`.no-print`).
- On the form, a known target is shown as read-only text ("Reporting on:
  <label> · Change"), and the piece `<select>` is not shown.
- An unknown or stale `target` falls back to the full selector with "We
  couldn't find that item; choose it below", in a `role="status"` region.
- Each field's current value appears before its input.

**Public corrections log**: `/corrections/log/` is built from
`data/corrections.yml`. It lists each accepted fix (target, old → new, date, and
the reader's name if they opted in), so readers see their reports land and the
site reads as a corrected edition.

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

1. **Corrections overlay** (fixes the latent bug).
   - **The file**: `data/corrections.yml`, a list of `{id, target, field, was,
     value, source: reader#123 | editor, editor_email, date}`, applied in file
     order. `was` is the generated value at the time the fix was accepted.
   - **Validation**: if the base value no longer equals `was`, the build fails
     with "stale correction <id>". The same (target, field) appearing twice
     fails validation.
   - **No PDFs needed**: `noh catalog` (which needs the PDFs) now writes
     `data/catalog.base.json`. A new `noh apply-corrections` reads the base file
     plus `corrections.yml`, writes `data/catalog.json`, then runs
     `noh vespers-lineup` so `catalog_sha256` stays current. Both steps are pure
     JSON/YAML with no pymupdf. CI runs `noh apply-corrections` and fails if the
     committed outputs differ, so an admin PR that edits only `corrections.yml`
     still reaches the site.
   - **Commands**:
     - `uv run noh correct <target> <field> <value> [--note]` validates against
       the shared schema, assigns the next `id`, fills `was`,
       `source: editor` and today's date, and appends the row. Nobody
       hand-writes rows.
     - `uv run noh where <URL>` finds a page's target and source file.
     - `uv run noh triage` replaces `tools/triage/main.py`, with the same
       `--local`/`--dry-run` flags, and says so when `wrangler login` is
       needed. It writes to the overlay instead of `catalog.json`.
     - `noh corrections --drop <id>` removes an entry.
   - **Field keys** are snake_case (`printed_pages`, `system_range`,
     `start_system`), and the file opens with a commented example of each
     target kind.
   - **Errors** follow one template: `corrections.yml:<line> (<id>): <target>
     <what failed> because <why>; try <next step>`. For example:
     `corrections.yml:14 (c-0007): piece:ave-maria-noh3 no longer exists; run
     "uv run noh where ave maria" to see current slugs, then update or delete
     this entry.`
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
   - Python tests without the local-only ones (`pytest -m "not source and not
     slow"`, since those need the untracked `pdf-source/`), web tests, gitleaks,
     `pnpm build` and the reachability test;
   - then `wrangler pages deploy`, using a Cloudflare API token limited to Pages
     and stored as a GitHub secret.

   CI needs the `PUBLIC_ASSET_BASE` repository variable (`with-public-env.ts`
   refuses a production build without it), plus `CLOUDFLARE_ACCOUNT_ID` and a
   Pages:Edit API token as secrets.

   Page images are already on R2, so CI needs only `data/` and `web/`. Pull
   requests (including admin PRs) run the same checks without deploying, so a
   broken fix is caught before merge. Merging deploys with no laptop in the
   loop, and hand deploys stop.

   **Staying free**:
   - GitHub Actions minutes are free and unlimited on standard runners for
     public repositories, and `npadley/cantusorgani` is public.
   - The deploy is a `wrangler` direct upload, not a Cloudflare-side build, so
     it does not use Pages' build quota.
   - The workflow limits waste:
     - `paths` filters, so docs-only commits skip the build and deploy;
     - a `concurrency` group that cancels a superseded run;
     - dependency caching for uv and pnpm.
   - Expected use is a few minutes per merge.
   - Every other piece is also on a free tier: Access (≤50 users), D1 and
     Workers (100k requests a day).
5. **One model of the day.** Today the pipeline and the site each work out a
   day's office key: `normalKey` (strip `r`, `m\d`), the observance fallback to
   `r`/`m3` in `lineupTitle`, and `vespers.normal_key` in Python. The pipeline
   should emit one canonical key and the titles into both `catalog.json` and
   `vespers-lineup.json`, and the site should stop guessing.
6. **Split the large modules along their seams**, each only when a change next
   touches that file.
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

| Phase | Contents | Size | Tests |
|---|---|---|---|
| A | Editing guide; corrections overlay, `apply-corrections`, `correct`, `where`, `triage`; reachability test (run locally) | small | Fixture pytest for `apply_corrections` (applies, missing target, stale `was`, duplicate target, lineup-sha rebuild), with no `source` marker. The crawl test fails on a fixture `dist/` with an orphaned Vespers page. |
| B | CI build and deploy (runs A's tests and reachability test), `main` ruleset | small–medium | The workflow on a PR, then on `main` |
| C | Admin screen (queue, states, accept, reject or edit, publish as PR), Access, GitHub App, webhook, one schema, migration 0002 | medium | Vitest: JWT check (bad signature, wrong aud, email not listed → 403); PR building against a mocked GitHub API; webhook HMAC; migration 0002 replayed on local D1 with 0001 rows |
| D | Wider targets (parts, Vespers items), "Report an error here" links, public corrections log | medium | `parseCorrection` and `toPublicRow` round-trip every target kind; test_triage.py checks all three consumers load the shared schema |
| E | One model of the day (may be pulled ahead of D); module split only when a change next touches those files; architecture doc | medium | The goldens are unchanged |

A first makes fixes possible and safe. B makes them deploy themselves. C and D
make them pleasant.

### Rollback

- **A**: revert the commit. A stale entry that blocks builds is removed with
  `noh corrections --drop <id>`.
- **B**: roll back in Pages → Deployments → Rollback, or re-run
  `wrangler pages deploy` locally from the previous SHA. To return to hand
  deploys, disable the workflow.
- **C**: remove the Access application and route, and uninstall the GitHub
  App. The D1 rows are untouched.
- **D**: export D1, then apply `rollback/0002_down.sql` by hand.
- **E**: revert; the goldens prove there is no change in behaviour.

## Decisions (2026-09-27)

1. **Sign-in**: Cloudflare Access, with room for other editors. Any signed-in
   editor may triage and publish a batch as a PR; only the owner merges.
2. **Accept flow**: one pull request per published batch, merged by the owner.
3. **CI deploys**: yes, on merge to `main`, kept within free tiers as described
   in Part 3, step 4.
4. **Direct editing**: yes. Editors can fix things without a reader's report.
5. **Admin host**: Pages Functions on the existing site; no second Worker.
6. **GitHub access**: a GitHub App, not a personal token.
