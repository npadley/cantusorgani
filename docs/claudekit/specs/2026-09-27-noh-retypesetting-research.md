# Spec (research): re-typesetting the Nova Organi Harmonia

**Status**: research only, not scheduled. Written 2026-09-27.
**Related**: `docs/claudekit/specs/2026-09-07-nova-organi-harmonia-design.md`,
`docs/claudekit/plans/2026-09-26-proper-parts-export-chant-links-plan.md`

## Question

Could the site replace (or supplement) the scanned 1942 pages with freshly typeset
music: notation that reflows to a tablet, prints large, transposes and plays back?
What would it take?

## Short answer

Yes. The collection is large (10,952 systems) and hand transcription alone would
take hundreds of volunteer-weeks, so the work has to be mostly automated. The best
route is **chant-first**:

1. Take the melody and its text from GABC (749 chants are already mapped to the
   site's Proper parts).
2. Recognise only the accompanying voices with a detector built for NOH's very
   regular engraving.
3. Check the result against the known melody, and proofread only what an
   automatic scan-versus-typeset comparison flags.

Much of Volumes 1, 2, 3 and 5 has already been transcribed by volunteers, and that
work is the natural starting point.

## Rights

The 1942 edition (*Nova Organi Harmonia ad Graduale*, Lemmens Institute /
Mechelen, H. Dessain, 1942) is **public domain**. No licence is needed to
typeset, publish or redistribute it (owner's determination, 2026-09-27; see
`data/LICENSES.md`).

For the record, the research noted the credited collaborators: Jules Van Nuffel
(†1953), Flor Peeters (†1986), Jules Vyverman (†1989), Marinus de Jong (†1984),
Gustaaf Nees (†1965), Edgard De Laet (†1973) and H. Durieux. It also noted Corpus
Christi Watershed's report that the books carry no copyright marking, and that
enquiries to the Lemmens Institute showed a reprint to be possible.

The volunteer transcriptions below are separate files whose repositories carry no
licence. Working with their authors is the courteous route and avoids duplicated
effort.

## What exists already

| Source | What | Extent | Status | Licence |
|---|---|---|---|---|
| [joeegan2202/nova-organi-harmonia](https://github.com/joeegan2202/nova-organi-harmonia) | LilyPond, one file per chant: chant + text, alto, tenor, bass | Vol. 1: 262 accompanied files; Vol. 2: 221; Vol. 3: 238 (+121 chant only); Vol. 5: Masses, Credos, Requiem | Vol. 5 hand-transcribed 2022–23 and marked proofread ("%Proofed 3/14"); Vols 1–3 generated, proofreading status unknown | none stated |
| [ahinkley/nova-organi-harmonia](https://github.com/ahinkley/nova-organi-harmonia), [ahinkley/gabc-to-ly](https://github.com/ahinkley/gabc-to-ly) | The pipeline behind Vols 1–3: melody and text from GABC, lower voices typed into a CSV aligned to each chant note, LilyPond generated | — | last active 2022 | none stated |
| [joeegan2202/gabcchords](https://github.com/joeegan2202/gabcchords) | Java tool: GABC to LilyPond, with chord entry for the accompaniment | — | 2023, early | none stated |
| [CMAA/nova-organi-harmonia](https://github.com/CMAA/nova-organi-harmonia) | A few Vol. 5 pieces in LilyPond | 8 files | 2023 | none stated |
| MusicaSacra forum: [transcription thread](https://forum.musicasacra.com/forum/discussion/20759/nova-organi-harmonia-transcription/p1) | Volunteer coordination; users have asked for MusicXML | — | — | — |

The one-file-per-chant layout matches the site's Proper parts (introit, gradual,
…), so an imported transcription could attach to a part directly.

## The notation, and why off-the-shelf recognition struggles

NOH engraving: a grand staff. The upper staff carries the chant (filled noteheads
without stems, grouped by slurs) over a held alto voice (open noteheads). The
lower staff carries tenor and bass. There is no time signature and there are no
measures, only phrase bars (divisio lines). Text sits above the upper staff,
hyphenated by syllable. The mode is printed in the left margin. Chants are
transposed into keys that suit the organ.

Optical music recognition (OMR) tools assume metred music with stems and beams.
Tested 2026-09-27 with **homr** (PyPI) on St Thérèse's Introit (NOH3
`noh3/0397/000`). It read the key signature (two flats) and, apparently, the
repeated reciting note. But it parsed only the upper staff and dropped the bass
staff entirely. It invented a 16/16 time signature and took the lyrics for a title.

Published figure: Audiveris 5.x matched 76.9% of measures on a standard,
metred benchmark ([source](https://audiveris.com/how-accurate-is-audiveris-music-recognition/)).
NOH's unmetred, stemless chant is outside what these tools are trained for.

Conclusion: generic OMR is not a viable main path. At most it can supply a
second opinion on the lower staff.

## Approaches compared

| Approach | How | For | Against |
|---|---|---|---|
| **A. Import and proofread the existing LilyPond** | Map each file to a catalogued part; render; compare with the scan; fix | ~720 accompanied chants exist; Vol. 5 is already proofread | Vols 1–3 not proofread; gaps (Vol. 4, Vol. 8, much of Vol. 3's chant-only files); coordination with the authors |
| **B. Hinkley method (manual chord entry)** | Melody and text from GABC; a person types the lower voices per chant note | Proven; exact | Slow: ~7 weeks of spare time for the Requiem (~87 systems), so the full collection would be hundreds of volunteer-weeks |
| **C. Chant-first recognition (recommended)** | Melody and text from GABC; a NOH-specific notehead detector reads the lower voices; fit them to the chant note sequence | Uses what the site already has (staff and system segmentation, 749 GABC chants per part); the known melody checks every system | A new detector to build and calibrate; transposition to match per piece; ornaments and small notes need care |
| D. Generic OMR | Audiveris / homr / oemer | No development | Tested: misses the lower staff, invents metre, misreads text |

A and C combine well: the proofread Vol. 5 files are ground truth for measuring C,
and C can fill the gaps that A leaves.

## Chant-first recognition in outline

1. **Inputs per part**:
   - the part's systems (slices and bounding boxes, already catalogued);
   - its GABC from `data/chants.json` (melody, text, note count and order);
   - the printed key signature and clefs.
2. **Transposition**: find the interval that maps the GABC pitches onto the
   upper-staff noteheads. Try each candidate; the right one aligns best. Record
   it per part.
3. **Noteheads**: detect filled and open noteheads, accidentals, ties and slurs
   on each staff. NOH's printing is uniform, so template or small-CNN detection
   is enough.
4. **Pitch**: from staff position, clef and key signature.
5. **Voices**:
   - upper staff: filled heads are the chant, open heads the alto;
   - lower staff: by vertical order, tenor over bass;
   - held notes span chant notes, as in the Hinkley CSV model (a lower-voice note
     carries a duration measured in chant notes).
6. **Alignment**: attach each lower-voice onset to the chant note it sounds under,
   by x-position. The chant sequence from GABC is fixed, so a missed or extra chant
   notehead is caught immediately. This is the same two-independent-signals check
   that made Proper-part detection reliable.
7. **Output**: MEI or MusicXML per part, plus LilyPond for print.
8. **Proofing**: render each typeset system, register it against the scan, and
   rank systems by their difference. A person checks the flagged systems, never
   the whole corpus.
9. **Review queue**: unaligned systems, low-confidence heads and transposition
   ties go to `data/review-queue.json`, as today.

## Output and display

- **Source of truth**: MEI (or MusicXML) per part, tracked in git, one file per
  catalogued part, keyed by piece slug and part.
- **Web**: [Verovio](https://www.verovio.org) renders MEI or MusicXML to SVG in the
  browser (it handles unmetred music and lyrics). That gives:
  - reflow to tablet width and larger print;
  - transposition, useful for matching a choir's range;
  - MIDI playback.
- **Print and PDF**: LilyPond, or Verovio's SVG pages; the existing export would
  gain a typeset option.
- **Scans stay**: until a part is proofread, the scan is what the page shows.
  Afterwards the scan stays one tap away ("view original"), and the organist
  chooses, like the chant switch.
- **Chant notation**: the square-note chant already shown per part (Exsurge) and
  the typeset accompaniment share the part structure.

## Scale

| Volume | Systems (catalogued) |
|---|---|
| NOH1–5 and NOH8 | 10,952 in total |
| Proper parts placed (label or text) | 757 |
| Chants with GABC | 749 |

Proofreading, not recognition, is the cost that decides feasibility, so the
pilot's job is to measure proofreading minutes per system.

## Pilot (when scheduled)

- **Material**: NOH5 Missa IX and the Requiem (ground truth: the proofread
  Vol. 5 LilyPond files), plus St Thérèse (NOH3), for transposition and a Proper.
- **Build**: steps 1–6 above for those pieces only.
- **Measure**:
  - notehead recall and precision, and pitch accuracy, against ground truth;
  - share of systems aligned without error;
  - human minutes per system to correct the rest.
- **Decide**: from the measured minutes per system × 10,952, whether the full
  collection is weeks or years of work, and whether to fold in approach A for
  Vols 1–3.

## Open decisions

1. **Collaboration**: approach Joe Egan, Andrew Hinkley and the CMAA about joining
   efforts (their files, our catalogue and pipeline).
2. **Fidelity**: reproduce the 1942 book exactly, or correct the chant where it
   differs from the Vatican edition or 1962 usage (and record each correction)?
3. **Format**: MEI (richer, Verovio's native format) or MusicXML (what forum users
   asked for; wider editor support)? Both can be generated; one must be the
   source of truth.
4. **Scope order**: Kyriale first (small, proofread ground truth, used every Sunday)
   or the Propers (where the site's new part structure pays off)?

## Sources

- [Jules Van Nuffel (Wikipedia)](https://en.wikipedia.org/wiki/Jules_Van_Nuffel)
- [Flor Peeters (Wikipedia)](https://en.wikipedia.org/wiki/Flor_Peeters)
- [Jules Vyverman (Wikipedia, nl)](https://nl.wikipedia.org/wiki/Jules_Vyverman)
- [NOH preface (Corpus Christi Watershed)](https://archive.ccwatershed.org/pdfs/7033-jules-van-nuffel-preface-noh-nova-organi-harmonia/download/)
- [Organ Harmonies for Catholic Chants (Corpus Christi Watershed)](https://www.ccwatershed.org/2013/08/17/nova-organi-harmonia)
- [NOH transcription thread (MusicaSacra)](https://forum.musicasacra.com/forum/discussion/20759/nova-organi-harmonia-transcription/p1)
- [How accurate is Audiveris?](https://audiveris.com/how-accurate-is-audiveris-music-recognition/)
- [homr (PyPI)](https://pypi.org/project/homr/), [oemer](https://github.com/BreezeWhite/oemer)
