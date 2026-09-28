# Typeset music and reviewing in the browser: implementation plan

**Date**: 2026-09-28
**Status**: plan; not started.
**Design**: `docs/claudekit/specs/2026-09-28-typesetting-design.md`. This plan says how
and in what order; the design says what and why.

## Settled since the design

- **LilyPond 2.26.0**, the latest stable release (2.27.x is the development series).
  - CI installs the official binary from GitLab, pinned by sha256
    `cd8a097a9f52cb2b9f4e7914774786f203f4fc61fcd299afcbb63c23fa5c6b24`:
    `https://gitlab.com/lilypond/lilypond/-/releases/v2.26.0/downloads/lilypond-2.26.0-linux-x86_64.tar.gz`
  - Checked 2026-09-28 on Kyrie IX:
    - `convert-ly` updated the 2.18/2.22 files with no hand edits (old
      `#'`-style overrides, and the `parser location` arguments removed from
      music functions);
    - it compiles;
    - LilyPond's MIDI and the event-log MusicXML still agree on **290 of 290**
      notes.
  - The one warning left is `gregorian.ly is deprecated`. Our house-style copy
    drops that include, since the divisio marks it provided are defined in
    `noh2.ily`.
  - Checked without the include: the MIDI is byte-identical and the line breaks,
    divisiones and lyrics are unchanged. The only difference is horizontal
    spacing: the notes within a neume are set a little wider and more evenly.
  - PR 2 compares both against the NOH scan of Kyrie IX. If the tighter grouping
    is closer to the book, it restores those spacing settings in `noh2.ily`.
- **Not VaticanaScore.** It draws square neumes on a four-line staff (the Liber
  Usualis look), and it has no place for the organ voices. NOH prints the chant
  in modern notes over a harmonised grand staff, which is what the transcriptions
  reproduce.
- **No GitHub fork.** The import is our working copy. Our 2.26 conversions can be
  offered back to Joe Egan as a pull request on his repository, as a courtesy, if
  he wants them.
- **Credit**: Joe Egan (joeegan2202), for the LilyPond transcriptions. On the About
  page, and on every typeset part.
- **Widths**: ordinary responsive-web practice.
  - The SVG scales to its container (`width: 100%; height: auto`).
  - There are two renders, so a phone doesn't get desktop-sized notation shrunk
    down:
    - **narrow**: line width for a 360 CSS px phone, shown below `40rem`;
    - **wide**: line width for the site's reading measure, shown at `40rem` and
      above.
  - `<picture>` chooses between them. The staff size is set so that at 100% the
    staff space is close to print size on a phone. It is tuned against real pages
    in PR 3.

## Ground rules for every PR

- One branch and one PR per step, from `main`. The owner merges (or auto-merge
  applies, when the owner turns it on for these).
- Before pushing:
  - `uv run ruff check pipeline tools tests`
  - `uv run pytest -q -m "not slow"`
  - in `web/`: `pnpm exec astro check && pnpm exec vitest run`
  - the Playwright tests when pages change
  - gitleaks, where it is installed
- Tests follow `.claude/rules/testing.md`: Python names
  `test_[function]_[scenario]_[expected]`, a happy path and an error case in each
  file, fakes only at external seams (R2, GitHub, LilyPond where it is absent).
- Security follows `.claude/rules/security.md`:
  - no secrets in code;
  - no `any`;
  - every admin API input validated;
  - output encoded;
  - LilyPond is dynamic code execution, so it runs only in the sandboxed render
    job (design §3).
- Docs change with the code: `EDITING.md` (editors), `ADMIN-SETUP.md` (owner
  settings), `ARCHITECTURE.md` (the diagram).

---

## PR 1: Review area and `reviewed` corrections (scans only)

Useful before any typesetting: editors can confirm or skip the 1,212 review-queue
items and the "Parts to check", in the browser.

**Pipeline**
- `pipeline/reviewkeys.py`: a stable key for each `review-queue.json` item.
  - Form: `review:<volume>/<kind>/<id>`, where `<id>` is a short hash of the
    identifying fields (piece, pdf_page(s), part, variant, movement, ref) and never
    of free text or scores.
  - A second function hashes the whole item: the value a review confirms.
- `pipeline/catalog.py`: writes `key` into each review-queue item.
- `pipeline/corrections.py`:
  - a new field `reviewed`, allowed on `part:`, `piece:` and `review:` targets
    (and on `typeset:` targets from PR 6);
  - the value is `true` and `was` is the confirmed value: the item's hash for
    `review:`, and start system plus reasons for a part on "Parts to check";
  - **a lapsed review never stops the build**, unlike other corrections: when
    `was` no longer matches, apply skips it, and `noh corrections --lapsed` lists
    it;
  - `hold_reasons` is unchanged (reviews are never structural).
- `noh apply-corrections` writes `data/reviewed.json`: the set of keys and targets
  with a current review, for the site.

**Site / admin**
- `web/src/pages/admin/review/index.astro`: queue 1, **Scans to check**, built
  with the site from `review-queue.json` + `reviewed.json` + `suspectParts`.
  - Grouped by kind, with a plain-language label for each (a table in
    `web/src/lib/admin/reviewKinds.ts`, which also marks the kinds the site can't
    act on).
  - The scans come from the existing `scans.json`.
  - The count is shown on `/admin/`.
- Actions:
  - **Looks right** → `POST /admin/api/reviews` (target, was);
  - **Skip, with a note** → the same endpoint with `skip: true` and a note. A skip
    stays in D1 only and is shown to other editors, never published;
  - **Correct** → the existing edit form.
- `web/src/lib/admin/api.ts`:
  - validate the target against `targets.json` and the review keys;
  - rate-limit through `actionsSince`;
  - insert an approved row with field `reviewed`.
  It publishes with the next batch, like any correction.
- D1 migration `0003_reviews.sql`: the `skips` table (key, note, editor, at). A
  review itself is an ordinary correction row.
- An item acted on disappears at once, client-side (the approved rows are merged
  in), then for good when its batch merges.
- "Parts to check" gains **Looks right**. `suspectParts` leaves out reviewed parts.

**Tests**
- Python:
  - key stability: same item gives the same key, reordered fields give the same
    key, and a changed `why` gives the same key but a new hash;
  - a review recorded, applied, and lapsed after a rebuild;
  - `correct-batch` with `reviewed` entries;
  - `hold_reasons` is not triggered.
- vitest:
  - the reviews endpoint (happy path, unknown key, bad `was`, rate limit);
  - `reviewKinds` covers every kind in the current queue: a test reads
    `review-queue.json` and fails on an unknown kind.
- Playwright: open Review, mark an item **Looks right**, it leaves the list, and
  **Publish** includes it.

**Done when** an editor can clear a review item in the browser and, after the
batch merges itself, it stays cleared.

## PR 2: Import, match, and the pinned LilyPond

**Tooling**
- `tools/lilypond/install.sh`: downloads the pinned tarball, checks its sha256,
  unpacks it to `vendor/lilypond-2.26.0/` (git-ignored), and prints the version.
  Used by CI and locally. `data/typeset/LILYPOND` holds `2.26.0` and the sha256.
- `noh doctor` reports the LilyPond version, and warns if it isn't the pinned one.

**Pipeline**
- `pipeline/typeset/source_check.py`: the denylist from design §3 (system-reaching
  Scheme, `\include` outside `data/typeset/include/`). Returns each problem with
  its line.
- `pipeline/typeset/importer.py` → `noh typeset-import --commit <sha>`:
  - fetches the pinned upstream tarball by commit (codeload), unpacks the volume
    folders, and runs `convert-ly -e`;
  - moves the shared includes to `data/typeset/include/`, rewriting `\include`s to
    match;
  - our `noh2.ily` drops `gregorian.ly`;
  - writes `data/typeset/UPSTREAM.yml` (repo, commit, credit, each file's upstream
    sha256 and our sha256 at import);
  - never overwrites a file whose sha256 differs from the one recorded at import;
    those go in the import report.
- `pipeline/typeset/events.py`: runs LilyPond with `listen.ily` (moved from the
  experiment to `data/typeset/include/`) and reads the events log. LilyPond is
  invoked only through `pipeline/typeset/lilypond.py`, which PR 3 sandboxes.
- `pipeline/typeset/melody.py`: compares the top voice with a GregoBase melody
  (from `chants.json` / the GABC), allowing for transposition. Returns a score
  and the first place they differ.
- `pipeline/typeset/match.py` → `noh typeset-match`: proposes `parts.yml` entries.
  - Vol. 5 is matched by folder and movement; Vols. 1-3 by incipit, confirmed by
    melody.
  - Statuses: `proposed`, `matched` (only above a high melody score, and only in
    this first import, to seed the site), `broken`, `melody-differs`.
  - Writes `data/typeset/parts.yml` and a readable report.
- **The first import is committed** in this PR: the sources, `UPSTREAM.yml`, and
  the proposed `parts.yml`. Nothing is rendered or shown yet.

**CI**
- In the site workflow, a `typeset-check` step that runs without LilyPond:
  - the source check on every file;
  - `parts.yml` targets exist in the catalogue.
- The `lilypond`-marked tests run in a job that installs the pinned LilyPond.

**Tests**
- source_check: each denied construct, and the house style passes.
- importer: against a local fixture "upstream" tarball. Fresh import; re-import
  adds new files; an edited file is kept and reported.
- melody: identical, transposed, one wrong note, a different chant.
- match: folder, incipit, low score gives `proposed`.
- `lilypond` marker: Kyrie IX imported, compiled on 2.26.0, and 290/290 notes
  against the MIDI (the experiment's `compare.py` becomes a test helper).

**Done when** the four volumes are imported and converted, every file is
`matched`, `proposed`, `broken` or `melody-differs` with evidence, and CI is green.

## PR 3: Render and upload

**Pipeline**
- `pipeline/typeset/render.py` → `noh typeset-render --out build/typeset/`:
  - hash = source + includes + house style + LilyPond version;
  - for each `matched` entry, and for others that compile (the review queues need
    them), writes `narrow.svg`, `wide.svg` and `score.pdf`, with the events
    log for the melody check;
  - page settings: one tall page per SVG (`page-breaking = #ly:one-page-breaking`)
    and A4 pages for the PDF;
  - the melody check re-runs, and a regression fails;
  - the warning allow-list is bar checks only;
  - it skips any hash that `--have <list>` says is already on R2.
- `pipeline/typeset/svgcheck.py`: rejects `<script>`, `on*` attributes,
  `<foreignObject>` and external `href`s, and checks each file is one page at the
  expected width.
- `pipeline/typeset/publish.py` → `noh typeset-publish`:
  - verifies (svgcheck) and uploads write-if-absent to `typeset/<hash>/…`
    (reusing `upload.py`; content types extended to SVG and PDF, still
    allow-listed);
  - then writes `data/typeset/manifest.json` (site entries: matched only) and
    `data/typeset/review.json` (everything else rendered, with status and error).
- `noh typeset-check`: the manifest matches the sources (hashes only), and every
  file in it answers 200 at `PUBLIC_ASSET_BASE` (a HEAD request, no credentials).

**CI** (site workflow). A new job before `check-build-deploy` runs `render`, then
`upload`:
- `typeset-render`:
  - `permissions: {}`; no secrets; installs LilyPond from the pinned tarball, which
    is cached;
  - runs `noh typeset-render` under `sudo unshare --net`, so there is no network
    while LilyPond runs;
  - uploads `build/typeset/` as a workflow artifact.
- `typeset-upload`:
  - runs only on pushes to `main` and same-repo PRs;
  - has the R2 secrets; never installs or runs LilyPond;
  - downloads the artifact and runs `noh typeset-publish`.
  - If the manifest changed on a PR branch, it commits `manifest.json` and
    `review.json` back, as the App (the corrections-batch pattern), so the merged
    tree always carries the current manifest. On `main` it fails instead: the
    manifest must have been committed with the change.
- `check-build-deploy` runs `noh typeset-check` before the build.

**Owner action**: none new. It uses the R2 secrets and the App already set up.

**Tests**
- Render planning, hash inputs, and the skip list.
- svgcheck: each rejection, and a real LilyPond SVG passes.
- publish against the fake R2 client: the manifest is written only after every
  upload succeeds, and a partial failure writes no manifest.
- typeset-check: stale, missing on R2 (a fake HEAD), unknown target.
- `lilypond`: Kyrie IX renders; each SVG is one page at the expected width; the PDF
  opens.

**Done when** a push renders only what changed, uploads it, and the manifest check
guards the build.

## PR 4: Typeset music on the site

- `web/src/lib/typeset.ts`:
  - reads `manifest.json` and `reviewed.json`;
  - `typesetFor(part)` returns the SVG URLs, the proofread state and the credit,
    or null when the part is on "Parts to check" or has no entry.
- The part component (`LineupStack.astro` / `PartLinks.astro`, whichever draws a
  part):
  - a `<picture>` with narrow and wide sources (alt = the incipit), the credit
    line, and the "not yet proofread" label;
  - a **Show the scan** link that toggles that part for the visit;
  - the scans hidden, with `loading="lazy"`;
  - on `onerror`, falls back to the scans with a note.
- A page-wide **Show the scans** switch in the page header, stored in
  `localStorage` (every access wrapped in try/catch), and applied before first
  paint so the page doesn't flash.
- **About page**: a "Typeset music" section crediting Joe Egan (joeegan2202) for
  the LilyPond transcriptions, with a link to his repository and the pinned
  commit. It explains "not yet proofread" and says how readers can report a
  problem.
- **Tests**:
  - vitest: `typesetFor` (hidden when on "Parts to check", the proofread label,
    no entry);
  - Playwright: a typeset part and its credit; both switches, and the page-wide
    one surviving a reload; an image 404 falls back; the About credit is present.

**Done when** matched parts show typeset music on the live site, with the switches
and the credit.

## PR 5: PDF export with vector pages

- `web/src/lib/pdf.ts`: for a typeset part the reader is seeing, `fetch` its
  `score.pdf` and use `embedPdf` for its pages. If that fails, fall back to the
  scans for that part, and list those parts on the export's last line.
- `exportParts.ts`: passes each part's current view (typeset or scans) from the
  switches.
- **Tests**:
  - vitest: a fixture two-page PDF is embedded as pages; mixed export order; the
    fallback path;
  - Playwright: an export with one typeset part and one scanned part has the
    expected page count.

## PR 6: Typeset queues in the admin screen

- Review queue 2, **Typeset matches**:
  - from `review.json` and `parts.yml`: the file's rendered SVG beside the
    candidate parts' scans (and GregoBase notation, through the existing chant
    component);
  - actions **This part** (target picker, prefilled with the candidates),
    **Not in the catalogue**, and **A different setting**.
  - Each is a correction on `typeset:<file>` (field `target` or `status`).
    `noh apply-corrections` writes the effective `parts.yml`, and a change
    re-renders through PR 3.
- Queue 3, **Typeset errors**: from `review.json`, with the error and its line
  highlighted. The editor itself arrives in PR 7; until then it shows the error
  only.
- Queue 4, **Proofreading**:
  - each typeset part beside the scan of the same systems;
  - **Proofread** is a `reviewed` correction on `typeset:<file>` with `was` =
    its hash, so an edit reopens it;
  - **Problem** keeps it listed, with the note.
- **Tests**:
  - Python: `typeset:` targets in corrections (target, status, reviewed), and
    apply writing `parts.yml`;
  - vitest: the new endpoints and validation;
  - Playwright: choose a match, mark proofread, publish.

## PR 7: Editing source, with preview

**Admin**
- `web/src/pages/admin/typeset/edit.astro`:
  - CodeMirror 6 (bundled through pnpm, not a CDN), with the part's scan above
    and the preview beside it;
  - the source check runs on each save and on preview (a TypeScript port of the
    same denylist, sharing test fixtures with the Python one).
- D1 `0004_typeset_drafts.sql`: `typeset_drafts` (file, text ≤ 60 KB, base hash,
  editor, updated).
- **Preview**:
  - `POST /admin/api/typeset/preview` saves the draft, checks it, and dispatches
    `typeset-preview`, rate-limited (one running per editor, 20 an hour);
  - the page then polls `PUBLIC_ASSET_BASE/typeset-preview/<hash>/result.json`
    every 5 seconds for up to 4 minutes.
- **Publish**, when a batch includes drafts:
  1. the App creates `corrections/<batch>` from `main`;
  2. it commits the drafts (Git Data API: blobs, a tree, a commit);
  3. it dispatches the batch with `branch` set.
  - A draft whose base hash no longer matches `main` is refused, with both
    versions shown.

**CI**
- `.github/workflows/typeset-preview.yml`, on `repository_dispatch`:
  - job `render`: `permissions: {}`, no secrets, `unshare --net`; the source check,
    then the render; outputs the SVG, the error text and the melody result as an
    artifact;
  - job `upload`: the R2 secrets, no LilyPond; svgcheck, then write-if-absent to
    `typeset-preview/<hash>/`.
- `corrections-batch.yml`: when the payload has `branch`, it checks out that
  branch instead of `main`, and commits the corrections on top.

**Owner action**: an R2 lifecycle rule deleting `typeset-preview/` after 14 days.
Documented in `ADMIN-SETUP.md`, or set by `noh r2-lifecycle` if the Actions token
is allowed to.

**Tests**
- vitest:
  - the draft endpoints (size, source check, stale base);
  - preview dispatch and its rate limit;
  - the Git Data API calls against a fake GitHub;
  - the TypeScript and Python source checks agree on the shared fixtures.
- Workflow: a PR check runs `typeset-preview`'s render job on a fixture.
- Playwright:
  - edit, preview (with a fixture `result.json` served locally), publish;
  - a stale draft is refused.

**Done when** an editor can fix a broken file, preview it, and publish it without
leaving the browser, and the batch merges itself when CI passes.

---

## Risks and how each is handled

| Risk | Handling |
|---|---|
| Upstream files that `convert-ly` can't fix | Imported as `broken`, and fixed in the browser from PR 7 (before that, by hand). The site keeps showing the scans. |
| The matcher is wrong | Only high melody scores are `matched` automatically. Everything else waits in Review, and a person can re-target any file. |
| LilyPond run on hostile input | No secrets or network in the render job, the source check, svgcheck, and display only through `<img>`. |
| Render time in CI | Content hashes: only changed files render. The first full render (about 990 files) runs once. |
| R2 or GitHub API outages | Write-if-absent is safe to re-run. A failed batch goes back to the admin screen (PR #26). |
| The manifest commit-back races the auto-merge | The App commits the manifest before the checks finish, and auto-merge waits for the checks on the new head. |

## Rollback

Each PR stands alone:
- PRs 4-5 can be switched off by emptying `manifest.json`, and the site shows
  scans again.
- PR 1's reviews are ordinary corrections, and `noh corrections --drop` removes
  one.
- Nothing is deleted from R2.
