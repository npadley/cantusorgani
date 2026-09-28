# Typesetting experiment: Kyrie IX

A one-piece test (2026-09-28) of whether the volunteers' LilyPond
transcriptions can be converted without losing anything. Kept as the starting
point for the typesetting work; not part of the pipeline yet.

Result page: https://claude.ai/artifact/Gzytyj7eZjX5rYb6g2Lmyg (private).

## Files

- `kyrie_IX.ly`, `noh.ily`, `noh2.ily`: Joe Egan's transcription of Missa IX's
  Kyrie and its include files, from
  [joeegan2202/nova-organi-harmonia](https://github.com/joeegan2202/nova-organi-harmonia)
  (`volume-5/missa-ix/kyrie_IX.ly`, marked "Proofed 3/14"). The music (NOH V,
  1942) is public domain; the transcription is credited to its author.
- `listen.ily`: a LilyPond include that logs every event LilyPond engraves
  (voice, time, spelled pitch, duration, slurs, ties, phrase bars, key, lyric
  syllables with their `stanza` marks) to `<output>.events.tsv`.
- `events2mxl.py`: the log to MusicXML. `--spacers` draws held lower-voice
  notes as their written value plus invisible space (needed only for Verovio).
- `compare.py`: compares LilyPond's MIDI with the MusicXML, note by note.

## Reproduce

```bash
cd tools/typeset-experiment
sed 's/\\include "noh2.ily"/\\include "noh2.ily"\n\\include "listen.ily"/' kyrie_IX.ly > kyrie_log.ly
lilypond -dno-point-and-click -dbackend=null -o kyrie_log kyrie_log.ly     # writes kyrie_log.events.tsv
python3 events2mxl.py kyrie_log.events.tsv kyrie_IX.ly kyrie.musicxml
lilypond --png -o kyrie kyrie_IX.ly                                        # LilyPond's own engraving
```

For the MIDI check, give each voice its own MIDI track (add
`\midi { \context { \Staff \remove "Staff_performer" } \context { \Voice \consists "Staff_performer" } }`
to the score), then `uv run --with mido python compare.py kyrie.midi kyrie.musicxml`.

## Findings

- python-ly's `ly musicxml` writes an empty file for NOH's dialect
  (`\cadenzaOn`, divisio bars, lyrics).
- LilyPond's own event log converts losslessly: 290 of 290 sounding notes
  identical to LilyPond's MIDI, voice by voice (pitch, start, length).
- Verovio needed held notes drawn as written value + space, and lyrics placed
  above via MEI. Still off: divisio/finalis bar forms, "*"/"**" on melisma
  syllables, spacing.

## Decisions so far (brainstorm, 2026-09-28)

- Use the volunteer transcriptions now, with credit (About page and each part).
- Every imported typeset part goes live at once, labelled "not yet proofread",
  with a page-wide **Show the scans** switch; editors mark parts proofread.
- **LilyPond is the source and draws the page**: SVG at a phone width and a
  tablet/desktop width, and a PDF for the export (embedded as vector pages; scans
  and typeset parts can mix). No Verovio, no MEI. MusicXML download: later.
- Import from a pinned commit into `data/typeset/`, updated to the pinned
  LilyPond with `convert-ly`; our copy is the edited one afterwards.
- `data/typeset/parts.yml` maps each file to a Proper part or Mass movement,
  proposed by the pipeline (Vol. 5 by folder and movement; Vols 1-3 by incipit,
  confirmed against the part's GregoBase melody) and reviewed.
- A part on the "Parts to check" list gets no typeset version until its start is
  checked.
- Rendering runs in CI with LilyPond pinned, cached by file hash. Pin the
  version CI and the cloud can install (Ubuntu's 2.24 unless a pinned binary is
  used); re-check the Kyrie on it.
- Phase 2: engrave what has no transcription (Vol. 4, Vol. 8, gaps) by
  chant-first recognition and/or AI, writing the same LilyPond template, measured
  first against Vol. 5's proofread files. See
  `docs/claudekit/specs/2026-09-27-noh-retypesetting-research.md`.

Open: design sections 3-5 (data flow, errors, testing), per-part scan switch or
page-wide only, then the written plan.
