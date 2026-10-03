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
