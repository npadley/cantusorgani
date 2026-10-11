# S1: iteration-time extraction for the pilot fixtures

Date: 2026-10-09. Extractor: **`listen_full/1`** (`pipeline/typeset/mei/listen_full.ily`). LilyPond 2.26.0, the repository pin.

## Decision

Use an **iteration-time listener**. `listen_full.ily` gives every `ScoreIR` property for F1–F5 while LilyPond iterates and engraves. **No compiler-tree fallback is needed**, so python-ly's `xml-export.ily` (GPL) stays out of the repository. Lyric anchoring is exact for every fixture.

## Mechanism

`listen_full.ily` adds four Scheme engravers (`\consists`) to the default `\layout`. The runner never edits the source. It writes a throwaway wrapper into a temporary directory:

```lilypond
\version "2.26.0"
#(define listen-full-root "<absolute repo root>/")
\include "listen_full.ily"
\include "<absolute path of the source .ly>"
```

It then runs `pipeline.typeset.lilypond.run(["-dno-print-pages", "-o", <tmp>/out, <wrapper>], cwd=<tmp>, includes=(INCLUDE, MEI_DIR))`, where `MEI_DIR = pipeline/typeset/mei`. That keeps the existing sandbox, timeout and include path. The TSV is written to `<tmp>/out.listen.tsv`.

Because the source is included rather than rewritten:
- line numbers in `loc` are the source's own;
- `listen-full-root` lets the listener strip the absolute prefix, so locations from both the source and `data/typeset/include/noh2.ily` are repo-relative.

The source must pass `source_check.check_file` first, as for every render. Sources with a `\midi` block (F2, F5) also write `out.midi` into the temporary directory, which is harmless.

| Engraver context | Records | How |
|---|---|---|
| `Score` | `version`, `break` | `initialize`; a `line-break-event` listener (only `break-permission` `'force`) |
| `Staff` | `staff`, `key`, `clef`, `acc` | `initialize`; a `key-change-event` listener (fifths = Σ sign of `pitch-alist` alterations); acknowledgers on `clef-interface` (`glyph`, `staff-position`, emitted only on change) and `accidental-interface` (`alteration` of visible accidentals; the layer comes from the note event via `cause`) |
| `Voice` | `voice`, `note`, `rest`, `skip`, `tie`, `slur`, `gliss`, `col`, `head`, `rhead`, `stem`, `div` | Listeners for note, rest, skip, tie, slur and glissando events. Acknowledgers on `note-head-interface`, `rest-interface`, `stem-interface` and `breathing-sign-interface` |
| `Lyrics` | `lyric`, `hyphen`, `extender` | Listeners. The anchor layer is `(ly:context-property lyrics 'associatedVoiceContext)` at that moment |

Key techniques, one per open question on the card:
- **Lyric anchor.** `\lyricsto` sets `associatedVoiceContext` on the Lyrics context. The lyric row carries that voice's layer and the exact current moment. The anchor is therefore the note of `<assoc-layer>` starting at the lyric's onset, with no heuristic. The verifier checks that such a note exists for every lyric row in all six TSVs, and that no Lyrics context has two syllables at one onset.
- **Effective staff.** Every Voice row writes `ly:context-find voice 'Staff` at event time. `\change Staff` reparents the Voice, so this is the effective staff. The layer name keeps the **home** staff, which is fixed at the voice's first record.
- **Notehead.**
  - The transparent flag is `(eq? (ly:grob-property g 'transparent) #t)`. An unset property reads as `'()`, which Guile treats as true; the first prototype fell into exactly that trap.
  - The stencil is `ly:grob-property-data` (the raw procedure, never evaluated), compared with `eq?`:
    - `ly:note-head::print` gives `normal`;
    - `ly:text-interface::print` (noh2 `\quil`) gives `quilisma`;
    - `#f` gives `none`;
    - anything else gives `other`.
- **Stem.** The row reports hidden when the stem is transparent or has no stencil. `\hide Stem` in noh2's `Staff` hides every stem. LilyPond 2.26 also makes a Stem for each rest, so stem rows also appear at rests.
- **Division kind.** The `BreathingSign` stencil procedure is compared `eq?` against the four `ly:breathing-sign::*` procedures that `noh2.ily` installs. This also covers `\halfBar`/`\singleBar`/`\quarterBar`/`\doubleBar`, which are aliases.
- **Entry markers.** At each lyric event the listener reads the `stanza` property and emits it on that syllable when it is not `eq?` to the last one emitted. Each `\set stanza` stores a fresh string, so markers that repeat the same text are still detected. Unlike `listen.ily`, it never resets the property.
- **Voice command.** It is read from the Voice's grob definitions at the voice's first record: `Stem.direction` ±1 and `NoteColumn.horizontal-shift` 0/1 are exactly what `make-voice-props-set` sets.
- **Spacing overrides (`col`).** These are read from the Voice's `NoteColumn` definition at the note event, not from the grob. noh2's `Slur_spacing_engraver` rewrites column extents during acknowledgement, so the grob holds the engraver's value rather than the source override.

## ScoreIR field → TSV rows

| ScoreIR | From |
|---|---|
| `lilypond_version`, `extractor_version` | `version` row (columns 5, 6) |
| `staves[].id`, `index` | `staff` row (`staff#<n>` when unnamed) |
| `staves[].clef_shape`, `clef_line` | first `clef` row per staff: `clefs.G` with position -2 → G/2. Line = (position + 6) / 2 |
| `staves[].key_fifths` | first `key` row per staff (duplicates are per voice) |
| `layers[].id`, `home_staff_id`, `ordinal`, `voice_command` | `voice` row (column 2, column 3, columns 5 and 6) |
| `layers[].role` | `chant` if any lyric row names the layer as `<assoc-layer>`; `voice-line` if every `head` row of the layer has `transparent=1`; otherwise `accompaniment` |
| `events[].kind`, `onset`, `duration` | `note`/`rest`/`skip` rows (onset in column 1, `dur`) |
| `events[].staff_id` | `note`/`rest`/`skip` column 3 (effective) |
| `events[].notated` | `note` `log dots scale_num/scale_den` (rests and skips have no notated value in v1; see Limitations) |
| `events[].pitch` | `note` `step alter octave`, already in IR units |
| `events[].printed_accidental` | the `acc` row with the same (onset, layer, loc); `none` if absent |
| `events[].notehead` | `head` row with the same (onset, layer, loc): `transparent=1` → `hidden`, else stencil `quilisma` → `quilisma`, else `normal` |
| `events[].stem_visible` | `stem` row at the same (onset, layer, loc of the chord's first note); `hidden=0` |
| `events[].tie_to_next` | a `tie` row at the same (onset, layer) |
| `events[].location` | `note`/`rest`/`skip` `loc` |
| `spans` (`tie`) | `tie` row → the next event of that layer with the same pitch |
| `spans` (`slur`) | `slur -1` … `slur 1` per layer, matched in order (no nesting in the pilots) |
| `spans` (`voice-line`) | a `gliss` row → from that layer's note at the gliss onset to its next note |
| `lyrics[]` | `lyric` rows; `hyphen_after`/`extender_after` from `hyphen`/`extender` rows at the same (onset, lyrics ctx); `anchor_event_id` = the `<assoc-layer>` note at the onset |
| `entry_markers[]` | `lyric` rows with `stanza ≠ "-"` (the marker precedes that syllable) |
| `divisions[]` | `div` rows (`other` → `UNKNOWN_FEATURE`) |
| `boundaries[].source_break` | `break` rows |
| `total_duration` | the maximum over layers of (last onset + dur) |
| `features` | `note` scale ≠ 1/1 (scaled-duration), `tie`, `slur`, `stem` hidden (hidden-stem), `rhead` hidden (hidden-rest), `skip`, `div` kinds, `break`, stanza markers, blank lyrics, melisma (a chant note with no lyric at its onset), the voice-line role, a `gliss` in a voice-line layer, staff ≠ home (cross-staff), quilisma, `key`/`clef` after onset 0, and `col` (note-shift when `force_hshift ≠ 0`; manual-spacing when `x_extent` is set) |

`dependency_digest`, `source_path`, `boundaries` (apart from `source_break`), `diagnostics` and event ids are computed by A2.

## Grammar (final, `listen_full/1`)

Contracts §4 is the normative copy; it also lists the format rules (escaping, `loc` format, row order).

```
onset  -            -        version  extractor(listen_full/N) lilypond(X.Y.Z)
onset  -            <staff>  staff    index
onset  <layer>      <home>   voice    ordinal voice_command(voiceOne..voiceFour|none)
onset  -            <staff>  key      fifths loc
onset  -            <staff>  clef     glyph position loc
onset  <layer>      <staff>  note     step alter(semitones) octave(sci) log dots scale_num scale_den dur loc
onset  <layer>      <staff>  rest     dur loc
onset  <layer>      <staff>  skip     dur loc
onset  <layer>      <staff>  head     transparent(0|1) stencil(normal|quilisma|none|other) loc
onset  <layer>      <staff>  rhead    hidden(0|1) loc
onset  <layer>      <staff>  stem     hidden(0|1) loc
onset  <layer|->    <staff>  acc      kind(natural|sharp|flat|double-sharp|double-flat|other) loc
onset  <layer>      <staff>  col      force_hshift(num|-) x_extent(a,b|-) loc
onset  <layer>      <staff>  tie      loc
onset  <layer>      <staff>  slur     dir(-1|1) loc
onset  <layer>      <staff>  gliss    loc
onset  <layer>      <staff>  div      kind(finalis|maxima|maior|minima|other) loc
onset  -            -        break    loc
onset  lyrics:<ctx> <assoc-layer|->  lyric    text stanza(-|text) loc
onset  lyrics:<ctx> <assoc-layer|->  hyphen   loc
onset  lyrics:<ctx> <assoc-layer|->  extender loc
```

## Observed counts

Fixtures are in `tests/fixtures/mei/extraction/`. "Hidden heads" counts `head` rows with `transparent=1`; "x-staff" counts note rows whose effective staff ≠ home staff.

| | F1 kyrie_IX | F2 al_ego_dilecto.csv | F3 agnus_IX | F4 ite_Ib | F5 co_inclina_aurem_tuam.csv | (supp.) agnus_XI |
|---|---|---|---|---|---|---|
| layers | 4 | 4 | 5 | 4 | 4 | 5 |
| notes | 358 | 220 | 272 | 41 | 90 | 251 |
| rests | 0 | 7 | 0 | 0 | 2 | 8 |
| skips | 5 | 0 | 8 | 0 | 0 | 3 |
| syllables (blank) | 82 (22) | 41 (16) | 57 (3) | 14 (4) | 18 (2) | 55 (1) |
| Lyrics contexts | 1 | 1 | 1 | 2 | 1 | 1 |
| hyphens / extenders | 42 / 0 | 14 / 0 | 29 / 0 | 5 / 0 | 9 / 0 | 29 / 0 |
| stanza markers | 3 | 2 | 3 | 0 | 1 | 3 |
| div finalis / maxima / maior / minima | 18 / 0 / 0 / 4 | 8 / 4 / 9 / 12 | 6 / 0 / 6 / 10 | 4 / 0 / 0 / 0 | 4 / 4 / 0 / 2 | 12 / 0 / 12 / 12 |
| glissandi | 0 | 0 | 8 | 0 | 0 | 3 |
| hidden heads | 0 | 0 | 8 | 0 | 0 | 6 |
| quilismas | 0 | 0 | 0 | 1 | 0 | 0 |
| force breaks | 5 | 0 | 4 | 0 | 1 | 3 |
| ties / slur starts | 68 / 59 | 63 / 33 | 50 / 37 | 7 / 6 | 27 / 10 | 64 / 35 |
| printed accidentals | 0 | 0 | 0 | 0 | 0 | 3 |
| x-staff notes | 0 | 0 | 0 | 0 | 0 | 3 |
| layer ends | 373/8 | 201/8 | 115/4, 29 | 5 | 41/4 | 101/4, 103/4 |

Notes on the counts:
- F2, F4 and F5 have an empty `voiceLines` voice. It emits no record, so it produces no layer.
- In F3 and agnus_XI the voice-line layer ends before the others (`VOICE_ENDS_UNEQUAL` for A2 to report, not an extraction error).
- F3's 8 glissandi are 4 `\voiceLine` glissandi in `down:#4` and 4 ordinary `\glissando`s in the alto (`up:#1`).

## Verification (2026-10-09)

The verifier is `build/s1/verify.py` (not committed); every check passed:
- **Grammar.** Every row of all six TSVs matches the §4 regexes, and no row holds an absolute path.
- **Kyrie against the baseline.** Per-layer note and skip onsets, durations, steps, alterations and octaves equal `tests/fixtures/mei/kyrie-ix/baseline-events.json`:
  - `up:chant` = voice 165 (180 events);
  - `up:#1` = voice 168 (61);
  - `down:#2` = voice 175 (61);
  - `down:#3` = voice 178 (61);
  - in total, 358 notes and 5 skips.
- **Kyrie lyrics.** All 82 lyric rows have `<assoc-layer>` = `up:chant`. There are 3 stanza markers: `*` on "e" at 25/8, `*` on a blank at 38 and `**` on a blank at 42.
- **All fixtures.**
  - One `head` row per note, keyed by (onset, layer, loc).
  - Every lyric is anchored to a note at its onset in its associated layer.
  - At most one syllable per Lyrics context per onset.
  - Every layer is gap-free and overlap-free.
- **F3:** `gliss` rows and hidden voice-line heads.
- **F4:** `head … quilisma` at 1/2 (`ite_Ib.ly:22:27`, `\quil bes'`).
- **F5:** `div maxima` ×4.
- **Determinism:** two complete runs gave byte-identical TSVs (`cmp`).

## Limitations and findings

1. **F3 cannot show a staff change.** `agnus_IX.ly` uses only `\voiceLine "down" "down"`, so its effective staff never differs from the home staff. The card's "note rows show the effective staff changing" is impossible on F3 as chosen. Of the catalogue's `\voiceLine` calls, 164 are down→down, 80 down→up, 15 up→down and 1 up→up. S1 therefore checks in `agnus_XI.tsv` (from `vol-5/missa-xi/agnus_XI.ly`, which has three `\voiceLine "down" "up"`) as a supplementary fixture. It proves cross-staff tracking: the end note of each voice line is on `up` while the layer stays `down:#4`. It also proves `acc` rows, since none of F1–F5 prints an accidental. **The coordinator should decide whether F3 changes or agnus_XI becomes a sixth fixture.**
2. **Rows that follow a chord.** `head`/`stem`/`acc` rows are keyed by `loc`. Two notes of one chord in one layer would share an onset but not a `loc`, so this holds. If one music variable were played twice *at the same onset in the same layer*, the keys would collide, which is impossible in practice.
3. **Grace notes.** These are not in any pilot. Their onsets are written `main@grace`, which makes A2b fail loudly; supporting them is out of scope.
4. **Rest and skip notation.** `rest`/`skip` rows give `dur` only, not log/dots/scale. `Event.notated` for rests and skips must be derived from `dur` (A2b), or the grammar gains the fields later.
5. **Voice command.** It is sampled once, at the voice's first record. A mid-piece `\voiceTwo` would not be seen; no pilot does this.
6. **Stanza markers.** A marker is detected by `eq?` on the property value. Re-entering the same lyric variable without an intervening `\set` would not re-emit, which is correct. A marker whose text is literally `-` would be unreadable; there is none.
7. **Clef rows.** These are emitted only on a change of glyph or position. A restated identical clef is not a record, and that restatement is not the clef-change feature.
8. **`gliss`.** This covers every glissando. A2c tells a voice-line glissando from an ordinary one by the layer's role (all heads hidden), as `LayerRole` defines.
9. **Ordering.** Rows sharing an onset are in LilyPond's iteration order, which is deterministic for a fixed source and LilyPond version but not semantic. Readers sort stably by `Fraction(onset)` and key by fields.
