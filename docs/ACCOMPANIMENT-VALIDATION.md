# Accompaniment validation against source scans

The local audit compares LilyPond alto, tenor and bass with independently
recorded source-scan readings. It exports evidence, not proofreading
acknowledgments, and changes no source, catalogue match or published data.

## Run an audit

Use an explicit list of matched source files. Supply local system crops with
names such as `scans/noh5/0099/000.png` (PNG, JPEG or WebP), or the flat name
`noh5-0099-000.png`. The catalogue determines the part's complete system span.

```sh
uv run noh typeset-accompaniment-check \
  --file vol-5/missa-ix/kyrie_IX.ly \
  --scan-root build/accompaniment-pilot/scans \
  --out build/accompaniment-pilot/kyrie-report
```

Repeat `--file` for a bounded batch. `index.html` contains original scans,
candidate overlays and localized discrepancies; `report.json` includes the
expected musical events, observed evidence, per-property verdicts and hashes.
Exit status 1 means at least one file was blocked; `discrepancy` and
`needs-review` are successful audit outcomes and do not mean a score passed.

Results are cached under `out/cache/<input-hash>/`. Changing the source,
scan bytes or identities, annotations, GABC, code, printed prototypes, includes,
settings or pinned LilyPond version gives a new identity. Interrupted writes
use an atomic temporary-file replacement. Failed score extraction is retried
rather than treated as a reusable pass.

The source reader names voices from explicit `altoMusic`, `tenorMusic` and
`bassMusic` bindings in its temporary wrapper, never by their vertical pitch
ordering. It retains written tied segments, exact onset/duration fractions,
pitch spelling/alteration and LilyPond source locations. Unknown voice bindings,
malformed events and invalid ties prevent acceptance.

## Add independent readings

Every packet includes `observations-template.json`. Read the original scan
before using the expected events as a comparison. Record observed pitches,
timing, voice identity, rests and ties; retain uncertainty instead of copying
the typeset into the observation document. The hash binds readings to the exact
ordered scan images. A reviewer name identifies the asserted reading; the
software does not independently authenticate a reviewer or certify their work.

Example of a deliberately partial observation:

```json
{
  "schema_version": 1,
  "scan_hash": "use the hash from observations-template.json",
  "reviewer": "Your name",
  "basis": "source-scan",
  "complete": false,
  "systems": ["noh5/0099/000"],
  "events": [
    {
      "voice": "alto", "kind": "note", "step": 2,
      "alteration": "0", "onset": "0",
      "box": [619, 193, 649, 221], "system": "noh5/0099/000"
    }
  ]
}
```

Use the entire packet's system list even if reading only a selected passage.
Coordinates are pixels of the supplied original crop, with no hidden rotation
or scaling. `step` counts diatonic steps from middle C: C4=0, D4=1, E4=2,
C3=-7. `alteration` is measured in whole tones: sharp=`"1/2"`, flat=`"-1/2"`.
Onsets and durations are exact whole-note fractions, aligned to the printed
chant sequence; do not derive them from horizontal distance alone. A partial
event needs a known onset to be compared safely; unanchored readings remain
unresolved. Missing duration or tie properties cannot become an agreement.

For a complete reading, record all three voices through the ending, including
silence/rest evidence and each tied segment. Set `complete: true` only after
that independent reading; each note then requires `duration`, `tie_in` and
`tie_out` as well as pitch and onset. Printed silence can be boxed in the scan
region it occupies; invisible LilyPond spacers are not printed rest glyphs.

```sh
uv run noh typeset-accompaniment-check \
  --file vol-5/missa-ix/kyrie_IX.ly \
  --scan-root build/accompaniment-pilot/scans \
  --annotations my-observations.json \
  --out build/accompaniment-pilot/kyrie-reviewed
```

For a batch, supply an annotation directory. Its filenames replace slashes in
the source filename with `__`, and append `.json`: for example,
`vol-5__missa-ix__kyrie_IX.ly.json`. A stale hash, different system span or
out-of-image observation box blocks that file.

## Verdicts and limitations

The properties are voice, pitch/alteration, onset, held span, rests, ties and
completeness. Each is `agrees`, `differs`, `unresolved` or `not-assessed`.
Any known disagreement yields `discrepancy`; incomplete evidence yields
`needs-review`. `agrees` requires complete independently reviewed observations
for all required properties and no extraction flags. Every report still says
`full_proofread: false`: lyrics, layout and full part identity need separate
proofreading, and nothing changes the admin proofread count automatically.

The independent detector uses staff geometry, geometric templates and three
printed glyph prototypes from NOH5 Kyrie IX. It receives no expected pitches.
Its overlays preserve the original scan and show candidates, which may include
clef dots or other non-note glyphs. Correlation scores are not probabilities.
Clefs/keys, accidental scope, voices, rests, durations and ties are currently
unassessed by the automatic detector. It cannot autonomously establish
accompaniment ground truth. Independently reviewed observations are the
usable comparison path while recognition is calibrated.

## Initial measurements (2026-10-03)

The real-scan fixtures include four existing-volume excerpts and one NOH4
excerpt. Only selected head centers and selected lower-voice pitches were
annotated; they are not whole-score ground truth. The NOH5 family supplied
prototypes and is calibration material, excluded from held-out figures.

| Source system | Partition | Selected heads recovered | Total candidates |
|---|---|---:|---:|
| NOH1/0033/004 | held out | 0/3 | 29 |
| NOH2/0044/002 | held out | 1/2 | 26 |
| NOH3/0412/002 | held out | 0/2 | 12 |
| NOH4/0247/000 | held out | 0/2 | 10 |
| NOH5/0099/000 | calibration | 2/3 | 32 |

This small benchmark demonstrates poor transfer of open-head detection; it is
not enough to estimate whole-system precision or corpus accuracy. Do not use
this detector to auto-clear the existing proofreading queue or run unattended
acceptance. The next recognition milestone needs better open-head detection,
complete held-out annotations, and independent measurements of correction time.

The comparison layer was separately exercised against selected source-scan
readings in Books 1, 2, 3 and 5: changing a known alto, tenor or bass pitch in
the extracted expected events produced localized discrepancies. Additional
tests cover omissions, extra notes, endings, swapped voices, wrong accidentals,
rests, durations and ties, incomplete observations and stale evidence. This
checks the validator's behavior; it does not prove automated scan recognition.

The audit also makes catalogue span issues visible. Initial inspection of
`Si consurrexistis` found its catalogue span contained one system while the
typeset source continued beyond it. Treat that as a boundary-review candidate,
not an accompaniment correction or an automatically changed match.
