# Spec (design): typeset music from the volunteers' LilyPond, and reviewing in the browser

**Status**: design agreed 2026-09-28; plan next.
**Related**: `docs/claudekit/specs/2026-09-27-noh-retypesetting-research.md` (the research),
`tools/typeset-experiment/README.md` (the Kyrie IX experiment and its findings),
`docs/ADMIN-SETUP.md` (auto-merging batches, R2 for GitHub Actions).

## Goal

Where volunteers have already transcribed a piece in LilyPond, show typeset music
instead of the scan, and use it in the PDF export. Let editors handle everything
that needs a person (unmatched files, errors, doubtful scans, proofreading) in the
admin screen, not on GitHub.

Phase 2 (engraving what has no transcription, by recognition and/or AI) is out of
scope here, but it must be able to write into the same place: a LilyPond file in
`data/typeset/src/`, a `parts.yml` entry, and the same checks.

## Decisions

| Question | Decision |
|---|---|
| Use the volunteer transcriptions? | Yes, now, with credit (About page and under each part). The music (NOH, 1942) is public domain. |
| Go live before proofreading? | Yes. Every imported part goes live labelled **"not yet proofread"** until an editor marks it proofread. |
| Can readers still see the scans? | A page-wide **Show the scans** switch (remembered in the browser), and a **Show the scan** link on each typeset part (for that part only, for that visit). |
| What draws the music? | **LilyPond**, the source format. It makes SVG at two widths (phone, tablet/desktop) and a PDF for the export. No Verovio, no MEI. A MusicXML download comes later. |
| Where do the rendered files live? | **R2**, in the shared `cantusorgani-assets` bucket, under content-hashed keys (`typeset/<hash>/…`). Never overwritten. |
| Who renders and uploads? | GitHub Actions, in the site workflow, with its own R2 token (`docs/ADMIN-SETUP.md` §5). Also possible locally with the 1Password Environment. |
| What about parts on "Parts to check"? | No typeset version is shown until the part's start has been checked. |
| Database-driven site? | No. Git stays the source of what the site says, D1 holds work in progress, and batches merge themselves when checks pass (merged 2026-09-28, PR #26). |
| Editor preview while editing LilyPond | A sandboxed GitHub Actions run, about 1-2 minutes per preview. No paid renderer. |

## 1. Sources and matching

**Upstream**: `joeegan2202/nova-organi-harmonia` (Vol. 1: 270 files, Vol. 2: 223,
Vol. 3: 359, Vol. 5: 138).

**Import** (`noh typeset-import --commit <sha>`):
- Copies `.ly`/`.ily` files from a pinned commit into `data/typeset/src/vol-N/…`.
- Updates them to the pinned LilyPond version with `convert-ly`.
- Records the repo, the commit, the credit and each file's upstream sha256 in
  `data/typeset/UPSTREAM.yml`.
- Our copy is the one we edit from then on. A re-import adds new upstream files and
  never overwrites one we have edited. If both sides changed a file, it reports it.

**Match** (`noh typeset-match`) proposes entries in `data/typeset/parts.yml`:

```yaml
- file: vol-5/missa-ix/kyrie_IX.ly
  target: part:missa-ix/kyrie        # or a Proper part: part:<slug>/<part>[:<variant>]
  status: matched                    # proposed | matched | broken | no-match | other-setting
  evidence: {by: folder, melody: 1.00}
```

- Vol. 5 is matched by folder and movement.
- Vols. 1-3 are matched by incipit, then checked by comparing the melody LilyPond
  logs (`listen.ily`) with the part's GregoBase melody, allowing for transposition.
- Only `matched` entries are rendered for the site. **Proofread** is not a
  `parts.yml` status: it is a `reviewed` correction on the typeset target (see §6).
  Marking a part proofread therefore needs no re-render.

## 2. The page and the PDF

- A typeset part shows two `<img>` SVGs chosen by width, with the incipit as alt
  text. The credit line sits under the music, and the "not yet proofread" label
  shows until the part is reviewed.
- The part's scans are in the page but hidden and lazily loaded, so they cost
  nothing until someone switches to them.
- The page-wide **Show the scans** switch is kept in `localStorage`. Every read and
  write is wrapped, so the page works without storage. The per-part link toggles
  one part for the visit.
- **Export**: `exportParts.ts` exports what the reader sees. A typeset part goes in
  as vector pages (`pdf-lib` `embedPdf` of `score.pdf`); a part showing scans goes
  in as images. Both can mix in one export.

## 3. Data flow

```
upstream .ly ──noh typeset-import──▶ data/typeset/src/  ◀── editors' source edits (§6)
                                          │
                     noh typeset-match ──▶ data/typeset/parts.yml  ◀── editors' match choices (§6)
                                          │
        site workflow, job "typeset-render" (NO secrets, NO network):
          source check → LilyPond (pinned) → narrow.svg, wide.svg, score.pdf, events.tsv
          → melody check → SVG check → build artifact
                                          │
        site workflow, job "typeset-upload" (R2 secrets, never runs LilyPond):
          write-if-absent to R2 typeset/<hash>/…  → data/typeset/manifest.json
                                          │
        site build: catalog.ts reads manifest.json + corrections (reviewed) → pages
```

- **Hash** = sha256 of the source, its includes, our house-style include, and the
  LilyPond version. The same hash always means the same files.
- **`data/typeset/manifest.json` is committed**: `{target, file, hash, credit}` for
  each rendered part. The render job skips any hash already on R2, so an unchanged
  push renders nothing.
- **Where it runs**: pushes to `main` and pull requests from this repo. Fork pull
  requests get no secrets. An unmerged pull request's renders are unused objects
  that nothing links to.
- **Site build**: the site job no longer needs LilyPond to build. Two checks run
  before the build, and both are part of `check-build-deploy`:
  - the manifest matches the sources (hashes only, no rendering);
  - every manifest file exists at the public asset URL (no credentials needed).
- If the manifest is missing (a local build without LilyPond), every part shows
  its scans.

### Why two jobs (security)

LilyPond runs arbitrary Scheme embedded in a `.ly` file. Upstream files and
editors' edits are input we do not control. So:

- **The render job has no secrets and no outbound network.** It gets no R2 or App
  credentials, and `permissions: {}`. It hands its outputs on as a build artifact.
- **The upload job never runs LilyPond.** It only verifies and uploads bytes.
- **Source check** (before LilyPond runs, in both jobs' inputs and in the admin
  API):
  - It rejects Scheme that reaches the system: `ly:system`, `system`, `open-*`,
    port and file procedures, `load`, `primitive-load`, `eval-string`, and
    `ly:parser-include-string`.
  - It rejects `\include` of anything other than our own include files.
  - It is a denylist, backed by the sandbox. It is not the only defence.
- **SVG check** (upload job): outputs must be well-formed SVG with no `<script>`,
  no `on*` attributes, no `<foreignObject>` and no external `href`s. The site shows
  them only through `<img>`, where scripts never run anyway.
- The preview (§6) uses the same two-job split.

## 4. Errors

| Where | What goes wrong | What happens |
|---|---|---|
| Import | A file won't convert or compile | Imported but `status: broken`, with LilyPond's error. Never rendered. Shown in the admin **Typeset errors** queue. |
| | An edited file also changed upstream | Ours is kept. The import report and the admin screen show both versions. |
| Match | No confident match | Stays `proposed` with its evidence. Shown in **Typeset matches**. |
| | Melody differs from GregoBase | Flagged in **Typeset matches** for a person to decide. |
| Render | LilyPond error | The render job fails, naming the file and line. Bar-check warnings (meaningless in unmetred chant) are on an allow-list; any other warning fails too. |
| | Melody no longer matches after an edit | The render job fails. The check runs on every render. |
| | Wrong output shape | Each SVG must be one page at the expected width, or the job fails. |
| | Wrong LilyPond version in CI | Fails at once. The version is in the hash, so changing it on purpose re-renders everything. |
| | Source check rejects a file | Fails before LilyPond runs, naming the construct. |
| Upload | R2 error | Retried (as for scan slices), then the job fails. The manifest is written only after every upload succeeds. |
| | SVG check fails | The job fails, and nothing is uploaded for that file. |
| Build | Manifest out of date | Fails with "run `noh typeset-publish`". |
| | A manifest file is missing on R2 | Fails, naming it. |
| | A `parts.yml` target no longer exists | Fails, naming the entry. |
| | A part joins "Parts to check" | Its typeset version is hidden until it is checked. |
| Page | An image fails to load | That part switches to its scans, with a note. |
| Export | A typeset PDF can't be fetched | That part is exported as scans, and the export lists which parts. |

## 5. Testing

- **Python unit tests** (every push):
  - import: never overwrites an edit, reports conflicts;
  - match: folder, incipit, melody comparison with transposition;
  - render planning: hash inputs, skip existing, manifest only after uploads;
  - source check: each rejected construct, and the house style passes;
  - SVG check: script, `on*` attributes, `foreignObject`, external `href`;
  - the build checks;
  - uploads against the existing fake R2 client;
  - `reviewed` corrections, including a review lapsing when its value changes.
- **LilyPond tests** (marker `lilypond`: CI installs the pinned LilyPond; skipped
  where it is missing):
  - Kyrie IX from start to finish. The experiment's 290-of-290 note check against
    LilyPond's MIDI becomes a test.
  - One page per width, the expected width, and a PDF that `pdf-lib` can embed.
  - No pixel-comparison tests.
- **Site (vitest)**:
  - the manifest merge, hiding for "Parts to check", and the proofread label;
  - the export choosing typeset or scans for each part, and a fixture PDF embedding;
  - the admin API: review actions, source drafts, preview dispatch and polling,
    rate limits.
- **Browser (Playwright)**:
  - typeset music and its credit on a piece page;
  - both switches, and the page-wide one surviving a reload;
  - image-failure fallback;
  - a mixed export;
  - the admin Review queues: mark reviewed, choose a match, edit, preview (against
    a fixture result), and publish.

## 6. Working in the browser

Editors handle every person-needed item in the admin screen. Nothing needs GitHub.

### The Review area (`/admin/review/`)

There are four queues, each with a count. Each item shows the evidence side by
side and has one-click actions. Every action is logged with who took it, as edits
are now.

1. **Scans to check**: today's "Parts to check" plus the pipeline's
   `review-queue.json` (1,212 items at present, for example unpaired systems,
   parts placed by order, uncertain Mass movements, the 25 NOH8 hymns). Each kind
   gets a plain-language label and the relevant scans beside the current value.
   Actions: **Correct** (the existing edit form), **Looks right** (reviewed), and
   **Skip, with a note**. Kinds the site cannot act on (for example "part not
   supported") are grouped at the end, so they don't swamp the list.
2. **Typeset matches**: `proposed`, `melody differs` and `other-setting`
   candidates. The file's rendered music sits beside the candidate parts' scans
   and melody. Actions: **This part**, **Not in the catalogue**, and **A different
   setting**.
3. **Typeset errors**: `broken` files and failed renders. Shows the error and the
   line it points to, with the source editor and preview.
4. **Proofreading**: each typeset part beside the scan of the same systems.
   Actions: **Proofread**, **Problem** (with a note, which keeps it in the queue),
   and **Edit the source**.

Unmatched, `proposed` and `broken` files are rendered too (to R2, when they
compile) so that queues 2 and 3 can show them. They are listed in
`data/typeset/review.json` beside the manifest, never in the site's manifest.

### Recording reviews: the `reviewed` correction

- A new correction field `reviewed` works on any target:
  - `part:…` and `piece:…`;
  - `review:<volume>/<kind>/<key>`, a stable key for each review-queue item;
  - `typeset:<file>`.
- Its `was` is the value the reviewer confirmed. For a typeset file that is its
  hash, so an edit reopens the proofreading.
- If a rebuild changes that value, the review lapses and the item returns to its
  queue. This is the `was` mechanism corrections already use, except that it
  reopens the review instead of stopping the build.
- A match choice is a correction on `typeset:<file>` with field `target` (or
  `status: no-match | other-setting`). `noh apply-corrections` writes it into the
  effective `parts.yml`, as it does for the catalogue.
- All of these travel in ordinary batches: Publish → pull request → checks pass →
  merged automatically (PR #26). None of them is structural, so none waits for the
  owner.

### Editing LilyPond source

- The admin screen gets a code editor (CodeMirror, from the allowed CDNs or
  bundled), with the part's scan above and the preview beside it.
- Drafts are saved in D1 (`typeset_drafts`: file, text, editor, base hash), so a
  draft survives a closed tab.
- **Publish** includes the drafts with the batch's corrections:
  1. the admin code creates the batch branch from `main`;
  2. it commits the edited files there through the GitHub API, as the App;
  3. it dispatches `corrections-batch`, which checks out that branch.

  CI then renders the file and re-runs the melody check. If the base hash no
  longer matches `main` (someone else changed the file), Publish refuses and shows
  both versions.
- The source check runs in the admin API when a draft is saved, so an editor finds
  out at once, not a minute later.

### Preview (GitHub Actions)

1. **Preview** saves the draft and dispatches the `typeset-preview` workflow.
   The payload is the draft's text (checked: at most 60 KB, and it must pass the
   source check) and its content hash.
2. The `render` job (no secrets, no network, `permissions: {}`) runs the same
   render and checks as the site workflow. It emits SVG, the error text if any,
   and the melody-check result.
3. The `upload` job verifies the SVG and writes `typeset-preview/<hash>/wide.svg`
   and `result.json` to R2, if they aren't there already. Identical text previews
   instantly the second time.
4. The admin page polls the public URL for `result.json`, about every 5 seconds
   for up to 4 minutes, then shows the music or the error with its line.
5. An R2 lifecycle rule deletes `typeset-preview/` objects after 14 days.
6. Previews are rate-limited per editor (the admin API already counts actions),
   and one preview per editor can run at a time.

### Hold rules

Unchanged. Batches merge themselves when checks pass. `system_range` corrections
and batches of 25 or more wait for the owner. A source edit is checked by CI
(render, melody, source and SVG checks), so it merges like any other correction.

## Delivery order (for the plan)

1. **Reviews first**, since they are useful with scans alone: the Review area with
   "Scans to check", the `reviewed` field, and stable review-queue keys.
2. **Import and match**: `noh typeset-import`, `noh typeset-match`, `parts.yml`,
   the pinned LilyPond, the source check, and Kyrie IX as the first test.
3. **Render and upload**: the two jobs, the SVG check, the manifest, and the build
   checks.
4. **The site**: typeset parts on pages, both switches, credit, labels, fallback.
5. **Export**: vector pages in the PDF.
6. **Typeset queues in the admin screen**: matches, errors, proofreading.
7. **Source editing and preview**: drafts, the preview workflow, and publishing
   files in a batch.

Each step is its own pull request. Steps 1-5 put typeset music on the site; steps
6-7 let editors look after it without GitHub.

## Open points

- **Which LilyPond version to pin.** Ubuntu's 2.24 is the default. Re-check the
  Kyrie on it before step 2.
- **The upstream licence line for the credit.** Confirm the wording with the
  transcriber (Joe Egan).
- **House style**: staff size and the two widths (phone and desktop line widths)
  are decided in step 3 against real pages.
