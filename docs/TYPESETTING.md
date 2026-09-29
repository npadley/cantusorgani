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

## Commands

```bash
uv run noh lilypond-install                  # the pinned LilyPond, into vendor/ (checksum-checked)
uv run noh typeset-import --commit <sha>     # (re-)import upstream at a commit
uv run noh typeset-match                     # propose parts.yml from pages, names and melodies
uv run noh typeset-check                     # the source check and parts.yml (CI runs this)
```

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

## Safety

LilyPond runs Scheme code written in the files it reads. So every file passes
`pipeline/typeset/source_check.py` first: no Scheme that reaches the system,
files, the network or LilyPond's options; no commands that read or write files;
no `\include` except our own include files and LilyPond's. In CI, LilyPond runs
only in jobs with no secrets. The event logger (`pipeline/typeset/listen.ily`)
writes a file, so it is pipeline code, not a source any file can include.
