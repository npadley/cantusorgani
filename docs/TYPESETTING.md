# Typeset music

The site is starting to show typeset music where volunteers have transcribed a
piece in LilyPond, in place of the scan. The design is
`docs/claudekit/specs/2026-09-28-typesetting-design.md`, and the plan is
`docs/claudekit/plans/2026-09-28-typesetting-plan.md`. What exists so far:

## Where it comes from

`data/typeset/` holds the LilyPond transcriptions by Joe Egan (joeegan2202)
and the nova-organi-harmonia volunteers, from
[github.com/joeegan2202/nova-organi-harmonia](https://github.com/joeegan2202/nova-organi-harmonia),
imported at a pinned commit. The music is public domain (NOH, 1942). The
repository states no licence, so the transcriptions are credited wherever they
are shown.

| Path | What |
|---|---|
| `src/vol-1`, `vol-2`, `vol-3`, `vol-5` | the transcriptions, updated to our pinned LilyPond; ours to edit from now on |
| `include/` | the shared house style (`noh.ily`, `noh2.ily`) |
| `UPSTREAM.yml` | the commit imported, the credit, and each file's sha256 upstream and as imported |
| `parts.yml` | which part of the catalogue each file is, and how sure we are |
| `lilypond.yml` | the LilyPond version every render uses, with each build's checksum |
| `manifest.json` | the parts the site shows typeset: each matched file's target and render hash |
| `review.json` | every other file, for the admin screen's queues: status, candidates, render hash, or the error and the lines around it |

## Commands

```bash
uv run noh lilypond-install                  # the pinned LilyPond, into vendor/ (checksum-checked)
uv run noh typeset-import --commit <sha>     # (re-)import upstream at a commit
uv run noh typeset-match                     # propose parts.yml from pages, names and melodies
uv run noh typeset-manifest                  # manifest.json and review.json, from the sources (no LilyPond)
uv run noh typeset-check                     # the source check, parts.yml and the manifest (CI runs this)
uv run noh typeset-render                    # draw into build/typeset/out/ (CI: only what R2 lacks)
uv run noh typeset-publish                   # check and upload build/typeset/out/ to R2 (needs the R2 variables)
uv run noh typeset-prune                     # what the cleanup would delete from R2 (--delete to do it)
uv run noh typeset-mei-batch --help          # and typeset-mei-{stale,carry,review,manifest,publish,revoke}: see Custom export (MEI)
```

After changing a source, an include or parts.yml, run `noh typeset-manifest`
and commit what it writes; CI fails when the manifest is not current.

A re-import adds new files and updates the ones nobody has edited here. A file
edited here is kept. If it has also changed upstream, it is reported as a
conflict to merge by hand. Empty placeholder files upstream are not imported.

## How files are matched

Each file says which volume it belongs to (its folder) and usually its page
(`%Page reference: page i.109`). Its name says the kind of part (`in_`, `gr_`,
`al_`, `tr_`, `of_`, `co_`, `se_`), or for the Kyriale, the Mass and movement
(`missa-ix/kyrie_IX.ly`). Those give the candidates.

LilyPond then reads the file, and its chant voice is compared with the
GregoBase chant of each candidate, twice over (`pipeline/typeset/melody.py`):

- **the melody**, by intervals, so it doesn't matter when NOH transposes a
  chant; repeated notes count once;
- **the words**, as bare letters (no accents, `i` for `j`), for the best four
  candidates by melody.

GregoBase abbreviates what NOH prints in full, so the chant is also read with
those written out, and the better score kept: "ij." and "iij." repeat the
phrase before them (a Kyrie's invocations, an Alleluia before its jubilus), and
an Introit's "Gloria Patri. E u o u a e" becomes the whole doxology, sung to the
psalm verse's tone.

Melody and words both at 85% or more is the strongest match (`evidence.melody`
and `evidence.words` in `parts.yml`). That is enough even when the file has no
page or name to go by, provided no other candidate comes close. Words that
agree also carry a melody that is only close (60% or more). The same notes
under other words (less than half) are a type-melody, never a match.

| Status | Meaning |
|---|---|
| `matched` | its page or name points at the part, and the melody agrees (at least 85% of its notes, clearly better than any other candidate, the words not another text); or melody and words both agree; or the file is named for the part (below) |
| `proposed` | no confident answer: found by melody alone, a weak melody, no chant to compare, or no candidate |
| `melody-differs` | the file points at one part whose melody disagrees |
| `broken` | LilyPond cannot read the file; the error names the line |

A file named for its part is matched on the name, without the melody
(`evidence.name` in `parts.yml` says what agreed):

- **The Kyriale**: `missa-i/kyrie_I.ly` is Mass I's Kyrie, `credo_V.ly` Credo V,
  `kyrie_ad_libitum_III.ly` the Kyrie ad libitum III. A name with a letter (`ite_IIa`, `kyrie_XVIIa`) does
  not say which of two it is, and is left to the melody and to an editor.
- **A Proper**: `in_adorate_deum` is the Introit on its page that the catalogue
  titles "Adorate Deum" (or whose GregoBase chant opens so). With no page to go
  by, the name must fit exactly one part of that kind in the volume, and the
  melody must not disagree (60%). Only a piece's first file counts
  (`an_lumen_ad_revelationem.1`, not `.3`).

A Mass may list rows of its own (`data/sections/noh5.yml`: a second Kyrie,
each of its dismissals). A file in that Mass's folder whose name is not the
whole answer (`ite_IIa`, `benedicamus_IV`, `kyrie_XVIIa`) is offered those rows:
the ones whose key begins with the file's first word (`benedicamus_IV` is the
row `benedicamus`, not `ite`, though they share a melody), or failing any, the
ones not named for another movement (`ite_XVIIa` may be `deo-gratias-i`, never
`kyrie-b`). Among those the melody decides, and where two share a melody, the
words (Easter week's Ite with its alleluias, and the plain one).

When two files claim one part, the one named for it keeps it (`ite_IV`, not
`benedicamus_IV`, for a Mass's Ite), then the better melody.

Only `matched` files are shown on the site. Editors settle the rest on the
admin screen's **Typeset music** page (`/admin/typeset/`, docs/EDITING.md):
which part a file is, or `none` (not in the catalogue), or `other-setting`.
Each answer is a `match` correction on `typeset:<file>` in
`data/corrections.yml`:

```yaml
- id: c-0012
  target: typeset:vol-1/al_confitemini_domino.csv.ly
  field: match
  was: null            # what the matcher settled on: a target only when matched
  value: part:dominica-iv-adventus/alleluia
```

`manifest.json` and `review.json` are written from `parts.yml` with these
applied (a chosen part is matched, and a file the matcher gave that part goes
back to `proposed`; `none` and `other-setting` become the statuses `no-match`
and `other-setting`). `noh apply-corrections` rewrites them too, so a batch of
corrections carries them. A match's `was` guards it like any correction: if a
new `noh typeset-match` settles the file differently, the build stops and asks.
A file LilyPond can't draw can't be chosen as a part until it is fixed.

A proofreading is a `reviewed` correction on `typeset:<file>` whose `was` is
the render hash, so any edit to the file (or to the render settings) reopens it.
`noh typeset-match` never changes an entry marked `source: editor`.

## Drawing and publishing

Each file is drawn four times by LilyPond's Cairo backend, which draws text
as outlines, so no fonts are needed (`pipeline/typeset/render.py`):

| File | For | Layout |
|---|---|---|
| `narrow.svg` | phones | 90 mm lines, staff 17; the book's line breaks removed, so lines break to fit (`narrow.ily`) |
| `wide.svg` | tablets and desktops | 190 mm lines, staff 18; the book's own line breaks, to read against the scan |
| `letter.pdf` | the PDF export | US Letter pages, staff 18, printer's margins; the book's line breaks |
| `a4.pdf` | the PDF export | the same on A4 |

There are no titles or running heads (`render.ily`): the page names the part.

Desktop and print renders first keep the transcription's own line breaks.
Some unmetred chants have no breaks, and LilyPond can report success while
drawing one staff wider than its page. The renderer checks the staff lines in
the resulting SVG or PDF and redraws clipped music with `auto-wrap.ily`, which
allows breaks between notes. Drawings that already fit keep their original
layout; a staff still clipped after this retry fails the render.

The PDF export (`web/src/lib/pdf.ts`) makes Letter pages, or A4 if the reader
chooses (remembered in their browser). A part whose systems are all typeset,
and which the reader sees typeset, goes in as `letter.pdf` or `a4.pdf`'s own
pages, drawn as vectors with the part's heading above; everything else goes
in as scans. If a typeset PDF cannot be fetched, the export uses the scans
for that part and says so.
A render is published at `typeset/<hash>/` on R2. The hash covers the source,
the includes, the render settings and the LilyPond version, so a changed file
gets a new address and nothing published is ever overwritten.

So old renders pile up on R2. To clear them, run **Actions → typeset-prune →
Run workflow** (`.github/workflows/typeset-prune.yml`). It keeps every render
main's manifest.json and review.json name, and anything uploaded in the last 14
days (a pull request's renders go up before it merges), and deletes the rest.
It never touches the scans. Leave **Delete them** unticked for a dry run: the
run's summary says how many renders and megabytes would go. Tick it and run
again to delete them.

In CI (`.github/workflows/site.yml`):
- **typeset-render** draws every hash the manifest and review files name that
  is not yet at `PUBLIC_ASSET_BASE`. It has no secrets, and LilyPond runs with
  no network (`NOH_SANDBOX=1`).
- **typeset-upload** checks each file and uploads it, write-if-absent. It has
  the R2 secrets and never runs LilyPond. Every SVG must be a drawing and
  nothing else (`svgcheck.py`), and every PDF free of script.
- **check-build-deploy** checks every render the manifest names answers at
  its public address before building, so the site never links to music that
  isn't there.

A matched part that fails to render, or whose melody no longer matches its
chant (an edit gone wrong), fails CI. A part matched below 85% (by its name, or
by an editor) is held to the score `parts.yml` records for it. A file only on the review list that
fails is reported and left for the admin screen. LilyPond's warnings about
the transcriptions' own small slips (a slur with nothing to attach to, an
unfinished hyphen) don't fail a render. A LilyPond "programming error" does,
except two it recovers from with the drawing otherwise whole: a tie dropped
where it meets a line break, and a loose spacing column.

## Custom export (MEI)

"Customize export" lays a part out again in the reader's browser, from MEI (music notation XML) instead of
from LilyPond's fixed pages. `pipeline/typeset/mei/` converts a LilyPond source to MEI. An independent oracle
and a render pre-check then judge each conversion. Everything below is the operator's side: converting,
approving, releasing and withdrawing. The history and reasons are in the plans
(`docs/superpowers/plans/2026-10-06-mei-conversion-plan.md`,
`docs/superpowers/plans/2026-10-12-export-phase-2.md`) and the decisions log
(`docs/superpowers/plans/export-layout-decisions.md`); this section does not repeat them.

On a page, a part reflows when it has a current approved conversion in `data/typeset/mei/manifest.json`.
Without one it is placed as its LilyPond pages (fixed) or its scan systems (D23), and the editor's
"Applies to / Not to" note says which is which.

| Path | What |
|---|---|
| `data/typeset/mei/records/*.json` | one record per source: its inputs, the judgement, the review and the state (`approved`, `needs-review`, `failed`, `unsupported` or `revoked`) |
| `data/typeset/mei/manifest.json` | the parts that reflow on the site, built from the records; CI and the site read this |
| `https://images.cantusorgani.org/mei/<sha256>/{score.mei,boundaries.json}` | the published artifacts, write-once, named by the MEI's own sha256 |
| `build/mei/stale/stale.json` | the stale report the site build reads for the admin list (written by `mei-stale`) |

### What approves a conversion

**Automatically (D22, D24).** A conversion is approved with reviewer `auto (D22)` when all five hold:
no unsupported or unknown feature; the MEI is schema-valid; the independent oracle finds 0 differences
from the LilyPond events; every one of the 13 layout cases (page sizes, orientations, music sizes) lays out
without an error; and the pre-check finds nothing in any case. The pre-check looks for notes that were
dropped, ties that lose an end (including across a page break), unison heads, divisio ticks, lyric counts,
syllable gaps and glissandi. Lines starting `info:` are not findings. D24: where no word boundary lets a
system start without squeezing a syllable below 0.3 mm or overfilling a line, a hyphenated break in
the middle of a word is allowed and reported as `info:`. Any other finding leaves the piece in
needs-review with the failed criteria in `record.json`, and it waits for a person (below). The record stores the
oracle, pre-check and profile versions it was judged under.

**By carry-forward (D20).** When a source, include or converter change makes a record stale, the piece is
converted again. If its normalized music is equal to the approved artifact's and all 13 layout cases draw
identically (after id normalization), the old approval moves to the new record, which says what changed and
that CI made the decision (`carried_from`). If anything visible differs, the new record is needs-review.

**By a person.** `typeset-mei-review` (below) records a reviewer's decision for a piece that was not approved
automatically. Only the maintainer approves this way. A new notation feature needs its own implementation
task, mutation fixture and profile version before any score using it can be approved, and a sibling that
passed is never grounds to approve another.

### Convert in batches: `typeset-mei-batch`

```bash
printf '%s\n' data/typeset/src/vol-5/missa-ix/{kyrie,gloria,sanctus,agnus,ite}_IX.ly > build/missa-ix.txt
uv run noh typeset-mei-batch --sources build/missa-ix.txt --out build/mei/missa-ix --workers 2 --auto-approve
```

`--sources` lists one source path per line (`#` comments allowed). The run prints one line per source
(`approved`, `needs-review`, `unsupported` or `failed`, with `(cached)` for a reused folder) and the counts;
it exits 1 only when a source failed.

- **Output.** Each finished build sits in `OUT/<inputs digest>/`: `score.mei`, `ir.json`, `diagnostics.json`,
  `evidence/index.html` (the review packet) and `batch-result.json`. The digest covers the source, every
  include it loads, the extractor and converter code, the profile, the schema and the tool versions, so a
  changed input is a new folder. Each run also writes `OUT/reports/report-<list hash>-<n>.json`.
- **Resuming.** A rerun reuses every folder whose digest is unchanged and converts the rest. A folder is
  renamed into place only when complete, so an interrupted run leaves nothing half-written. Rerun the same
  command after a crash or Ctrl-C.
- **`--workers N`** bounds the LilyPond runs in flight (default 2). Start with about five scores and size
  later batches from how long their packets take to review.
- **`--auto-approve`** judges each clean conversion by the D22 criteria and writes the approved ones to
  `OUT/records/<name>.json`. It never writes into `data/typeset/mei/records/`; the coordinator copies the
  records worth keeping into a pull request. Without the flag nothing is approved. `--no-evidence` converts and
  validates only (and so cannot auto-approve).
- **Failures.** One bad score is `failed` and the others continue. An unsupported feature is reported, never
  forced.
- **Spot-checking** an auto-approved batch is optional: open a few of the `evidence/index.html` packets
  and compare against the scan.

### Review a piece: `typeset-mei-review`

For a needs-review piece, the reviewer compares the packet's 13 layout cases and the LilyPond original with
the scan (every voice, the lyrics, ties, divisions, endings, and the Letter, Large and Automatic stress
layouts), then writes a decision file. Its fields are `reviewer`, `timestamp`, `inputs_digest` and
`artifact_sha256` (both from the convert directory), `matrix_results` (`pass`, `fail` or
`accepted-difference` for each of the 13 case ids), `accepted_differences` and `decision` (`approve` or
`reject`).

```bash
uv run noh typeset-mei-review build/mei/missa-ix/<digest> --decision build/decision.json --out build/mei/records/ite_IX.json
```

The command refuses (exit 1, printing the codes) a decision bound to other inputs or another artifact, a
piece with a blocking diagnostic or oracle difference, and a matrix with a missing or failed case.
Otherwise it writes the record, `approved` or `failed`.

### Find stale approvals: `typeset-mei-stale`

```bash
uv run noh typeset-mei-stale                              # a table; exit 0
uv run noh typeset-mei-stale --json --out build/mei/stale/stale.json
uv run noh typeset-mei-stale --fail-on-stale              # exit 1 when anything is stale
```

It compares every approved record's inputs and render hash with the working tree and lists each piece whose
approval no longer matches, with the reason per input (source, include, converter, extractor, profile, schema,
LilyPond, Verovio, fonts, or a moved render hash). Such a piece loses its Customize button until it is
approved again. It reads files only, no LilyPond. A revoked record is not listed, because it is no longer
approved. A clean tree prints `none stale: 728 approved conversion(s) checked`.

### Carry an approval forward: `typeset-mei-carry`

```bash
uv run noh typeset-mei-carry build/mei/carry/convert \
  --prior data/typeset/mei/records/ite_IX.json --prior-dir build/mei/carry/prior \
  --out build/mei/carry/record.json
```

`convert_dir` is the new conversion (from `typeset-mei-convert`). `--prior` is the approved record.
`--prior-dir` is a convert directory built from the approved artifact, that is, from the revision before the
change; omit it when the new conversion is byte-identical to the approved artifact. The command lays out
both for the 13 cases and compares. It writes the new record to `--out` (approved with a `carried_from` block, or
plain needs-review), and `<name>.carry.json` beside it says which cases or inputs differed. Exit 1 means the
comparison could not be made; needs-review is still exit 0. It never commits or publishes: a person reviews the
result and commits the record.

### Build the manifest: `typeset-mei-manifest`

```bash
uv run noh typeset-mei-manifest --records data/typeset/mei/records \
  --artifacts build/mei/live --out data/typeset/mei/manifest.json
```

A record reaches the manifest only when it is approved, its approval matches the current inputs, its
target and render hash match `data/typeset/manifest.json`, and its artifacts exist and hash correctly. The
command prints `excluded <source>: <reason>` for every record left out (`state is revoked`,
`STALE_APPROVAL`, `UNMATCHED_TARGET`, `TARGET_HASH_MISMATCH`, `ASSET_MISSING`, `HASH_MISMATCH`,
`KEY_COLLISION`) and then `wrote N approved conversion(s)`.

`--artifacts` is a folder laid out as `<sha256>/score.mei` and `<sha256>/boundaries.json`, one folder per
record (default: the records folder). Build it from the **live** files, so the manifest describes what readers
will actually fetch: download each `https://images.cantusorgani.org/mei/<sha256>/<file>` into it. Verification
cannot be skipped; an entry whose files are not there is excluded, not guessed.

### Publish: `typeset-mei-publish` and the `mei-conversion` workflow

`typeset-mei-publish` verifies approved records against their artifacts and uploads `mei/<sha256>/...`
write-once to the asset host. It never compiles. Check what it would upload first:

```bash
uv run noh typeset-mei-publish --records data/typeset/mei/records --artifacts build/mei/artifacts \
  --sources build/missa-ix.txt --dry-run
```

`--sources` limits it to the listed sources; each must have exactly one record or the batch is blocked
(exit 1, codes printed). Without `--dry-run` it needs the R2 variables and never overwrites a key.

The upload is normally done by **Actions → mei-conversion → Run workflow** (`.github/workflows/mei-conversion.yml`),
run on `main`:

| Input | Meaning |
|---|---|
| `sources` | Newline-separated paths under `data/typeset/src/`, each ending `.ly`. Anything else is rejected. |
| `publish` | Off (default): only convert and attach the artifacts and evidence packets for a look. On: also publish. |

The `convert` job has no secrets and no network: it converts, validates and builds the evidence packet for
each source. The `publish` job runs only when `publish` is ticked and the run is on the default branch. It
runs in the **`mei-publish` environment** and uses the R2 secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, variable `R2_BUCKET`). The environment currently has no required reviewers, so ticking
`publish` on `main` is the only gate: check the source list before running. The job checks out `main`, so **the
records must already be merged**. It verifies each artifact the convert job built against its record; if
CI's conversion is not byte-identical to the approved artifact, it refuses, and the cause must be found
before retrying.

### Release sequence

1. **Records.** Merge a pull request that adds or updates records in `data/typeset/mei/records/` (the
   batch's `OUT/records/`, or reviewed and carried ones). `typeset-mei-stale` should report nothing.
2. **Publish run.** Run `mei-conversion` on `main` with `publish: true` and the new sources.
3. **Verify the live files.** For each new sha: `https://images.cantusorgani.org/mei/<sha>/score.mei` and
   `boundaries.json` answer 200, with `immutable` caching and CORS `*`, and the sha256 of `score.mei`
   equals the sha in its record.
4. **Manifest PR.** Download the live files into `<sha>/...` and run `typeset-mei-manifest` as above. Build
   production with the CI variables (`PUBLIC_ASSET_BASE=https://images.cantusorgani.org`,
   `PUBLIC_CORRECTIONS_ENDPOINT=https://api.cantusorgani.org`, `PUBLIC_TURNSTILE_SITE_KEY=<site key>`), run
   the Playwright suite, open a page with a new piece, **Customize export**, and merge when it lays out.

**Rollback.** Published files are immutable and stay; the manifest decides what readers see. Revert the
manifest pull request to return to the previous set (the pieces drop to fixed placement). One piece is
withdrawn by revoking its record (below). Never delete or overwrite a published file.

### Revoke a record: `typeset-mei-revoke`

```bash
uv run noh typeset-mei-revoke data/typeset/mei/records/ite_IX.json --reason "wrong rhythm in bar 3"
```

The record is rewritten in place with state `revoked` and the reason and time; nothing else changes. It
is exit 1, with the file untouched, for an empty reason or a record that is not approved. A revoked
record is never current: `typeset-mei-manifest` excludes it (`state is revoked`) and `typeset-mei-stale`
no longer lists it. Commit the record, then rebuild the manifest with the steps above in a pull request.
The part then shows as fixed typeset pages in Customize export while the others still reflow. To undo,
restore the record from git and rebuild the manifest. A drill that did this on a live record
and checked it on the built site is in `docs/superpowers/reviews/2026-10-17-o5-revocation-drill/`.

### When approvals go stale: `mei-stale` and the admin list

`.github/workflows/mei-stale.yml` runs on every push to `main` that touches `data/typeset/src/**`,
`data/typeset/include/**` or `pipeline/typeset/mei/**` (and by hand). It runs `typeset-mei-stale`, puts the table
in the run summary, converts each stale source again, and tries `typeset-mei-carry` against the
revision before the push. It never publishes, commits or opens a pull request. Its artifacts are
`mei-stale-report` (`stale.json`) and `mei-carry-results` (one record per piece, 14 days). Commit the
carried records you trust, then follow the release sequence above. Whatever is not carried needs review.

The admin screen's **Custom export paused** list (`/admin/`) shows every approved piece whose
approval no longer matches: a moved render hash or unmatched target (always known from the committed files), and,
when `build/mei/stale/stale.json` was present at site build, which other input changed. A piece on it has
lost its button. A revoked piece is not on this list, since revoking is deliberate.

## Safety

LilyPond runs Scheme code written in the files it reads. So every file passes
`pipeline/typeset/source_check.py` first: no Scheme that reaches the system,
files, the network or LilyPond's options; no commands that read or write files;
no `\include` except our own include files and LilyPond's. In CI, LilyPond runs
only in jobs with no secrets. The event logger (`pipeline/typeset/listen.ily`)
writes a file, so it is pipeline code, not a source any file can include.

## Melody-first proofreading audit

`uv run noh typeset-proofread` writes a local 30-file, stratified pilot under
`build/typeset/proofread/`. Open `index.html` for source locations, matched scan
systems, available wide renders and compact JSON packets. It does not change
`corrections.yml`, `reviewed.json`, matches, source files or public assets.

```bash
uv run noh typeset-proofread --limit 30
uv run noh typeset-proofread --limit 0 --out build/typeset/proofread-all
uv run noh typeset-proofread --file vol-5/missa-xvi/sanctus_XVI.ly
```

`--local-assets /absolute/path/to/build` reads an existing checkout's exact-key
LilyPond event cache and matching scan/render images, copying them into this
report. A cache miss writes only into the report's own event directory. To use
an existing pinned executable without installing another copy, set
`NOH_LILYPOND=/absolute/path/to/vendor/lilypond-2.26.0/bin/lilypond`.

The remaining inventory checks actual render hashes before excluding acknowledged
files. A stale manifest is reported rather than silently trusting an old review.
The old candidate-matching score is a sampling hint only. The new audit compares
complete note sequences under a global transposition, preserves repeated attacks,
joins valid ties, and checks chromatic intervals separately. Missing endings,
unknown syntax, accidental scope, reconstructed repetitions, ambiguous voice gaps
and invalid ties cannot produce an unqualified melody-agreement result.

Statuses: `melody-agrees`, `differences`, `review-normalization`, `no-reference`,
`blocked`. Discrepancies are grouped as `repeated-attacks`,
`ending-or-extra-section` or `pitch-or-order`. These are triage categories, not
confirmed errors: NOH and GregoBase may represent different editions, and NOH
may tie pitches that GABC spells as repeated attacks. Scans decide whether the
transcription is faithful to NOH.

For low-cost assisted review, give a small read-only agent 10–20 related packets,
without the whole project conversation. Ask it to cite the source line and scan
ref, and return one of: scan-confirmed error, likely edition/notation difference,
sampled agreement, or inconclusive. Escalate unclear cases to a stronger reviewer
or an editor. A worker must name the passage it inspected; it cannot extrapolate
a spot-check into full proofreading. See `docs/CHANT-PROOFREADING-PILOT.md` for the
first run's evidence and a reusable review prompt.

### Publish melody audit counts

Run the deterministic comparison against the current checkout and commit its compact evidence:

```sh
noh typeset-proofread --limit 0 --summary data/typeset/melody-audit.json
```

Use `--local-assets /path/to/existing/build` to reuse local event and image caches. The detailed report stays in `build/typeset/proofread/`; only compact per-file evidence belongs in Git. Admin melody counts are separate from full proofreading. A changed render, target, or selected GABC invalidates the previous melody result. Run the audit again after catalog or notation changes. Melody agreement does not approve lyrics, engraving, or the scanned edition, and never writes a full-proofreading acknowledgment.
