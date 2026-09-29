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
| `review.json` | every other file, for the admin screen's queues: status, candidates, render hash or error |

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

LilyPond then reads the file, and the chant voice's melody is compared with the
GregoBase chant of each candidate. The comparison uses intervals, so it doesn't
matter when NOH transposes a chant; repeated notes count once.

| Status | Meaning |
|---|---|
| `matched` | its page or name points at the part, and the melody agrees (at least 85% of its notes, clearly better than any other candidate) |
| `proposed` | no confident answer: found by melody alone, a weak melody, no chant to compare, or no candidate |
| `melody-differs` | the file points at one part whose melody disagrees |
| `broken` | LilyPond cannot read the file; the error names the line |

Only `matched` files will be shown on the site. The admin screen's Review area
will settle the rest (PR 6). `noh typeset-match` never changes an entry marked
`source: editor`.

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
chant (an edit gone wrong), fails CI. A file only on the review list that
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
