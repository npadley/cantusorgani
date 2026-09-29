# Plan: a Proper's sections, as the book prints them

**Date**: 2026-09-29
**Status**: draft for review, no code yet
**Builds on**: `2026-09-26-proper-parts-export-chant-links-plan.md` (parts),
`2026-09-27-editing-admin-refactor-plan.md` (corrections overlay, admin)

## Why

Reported 2026-09-29 on https://cantusorgani.org/piece/sabbato-temporum-adventus/
(Ember Saturday of Advent, NOH1 pp. 24–38, 86 systems). The book prints, in order:

| Systems | Printed (margin label) | Site today |
|---|---|---|
| 1–6 | Intr. II *Veni et ostende* | Introit 1 ✓ |
| 7–15 | Grad. II *A summo caelo* | "Tract" at 3 ✗ |
| 16–24 | 2. Grad. I *In sole posuit* | — |
| 25–32 | 3. Grad. II *Domine Deus virtutum* | — |
| 33–44 | 4. Grad. II *Excita Domine* | — |
| 45–68 | Hymn. VIII *Benedictus es* | — |
| 69–79 | Tract. VIII *Qui regis Israel* | — |
| 80–83 | Offert. III *Exsulta satis* | guessed at 7, hidden ✗ |
| 84–86 | Comm. VI *Ecce Dominus veniet* | "Communion" at 20 ✗ |

The four Graduals and the hymn before the Tract are right: that is the Ember
Saturday Mass (a Gradual after each lesson, *Benedictus es* after Daniel). The
site cannot say so, because of how "parts" were designed.

## What is wrong with parts

1. **Which parts exist comes from jgabc, not from the book.** `expected_parts`
   builds the list from jgabc's `inID`, `grID`, `alID`, `trID`, `seqID`, `ofID`,
   `coID` (and the Paschal variants). jgabc's Ember Saturdays carry
   `{inID, trID, ofID, coID}` only (checked: `EmbSatSept`), so no Gradual and no
   hymn is ever looked for. Four "Grad." labels in the margin have nowhere to go.
2. **One of each, in a fixed order.** `segment_proper` walks `ORDER` (Introit,
   Gradual, Alleluia, Tract, Paschal Alleluia, Sequence, Offertory, Communion),
   placing each part once. A book that prints something twice, or in another
   order (NOH3's Queenship addendum prints its Paschal Alleluia before the
   Gradual), cannot be described. Worse, an expected part the book does not
   print yet is placed anyway: here the Tract lands on system 3, inside the
   Introit, on a strong text match to its Psalm verse *Qui regis Israel*.
3. **Corrections can only move what the pipeline found.** `start_system` moves a
   part; nothing adds one, removes one, or names one. The `parts:` override in
   the index (added for the Queenship Mass) places a part by hand, but only one
   of each, and only for kinds jgabc lists.

## How wide

The pieces with more than one lesson, or with sections outside the fixed order
(measured on `data/catalog.json`, 2026-09-29):

| Piece | Systems | Parts placed today |
|---|---|---|
| NOH1 Ember Wednesday of Advent | 14 | offertory |
| NOH1 Ember Saturday of Advent | 86 | introit, tract, offertory, communion |
| NOH1 Ember Wednesday of Lent | 16 | tract |
| NOH1 Ember Saturday of Lent | 53 | introit, tract, offertory, communion |
| NOH1 Wednesday of the 4th week of Lent | 12 | introit, communion |
| NOH1 Wednesday of Holy Week | 56 | introit, gradual, tract, offertory, communion |
| NOH1 Holy Saturday | 35 | none |
| NOH2 Ember Wednesday of Pentecost | 20 | one Alleluia |
| NOH2 Ember Saturday of Pentecost | 35 | introit, tract, offertory, communion |
| NOH2 Ember Wednesday of September | 22 | introit, communion |
| NOH2 Ember Friday of September | 3 | communion |
| NOH2 Ember Saturday of September | 11 | none |

The September Ember Friday (3 systems) and Saturday (11) are far too short for
their Masses: there **the piece's own range is wrong too**, not only its
labels. So the review below checks each piece's extent (`system_range`) as
well as its sections. A margin-label count adds 10 more Propers whose printed
labels outnumber their placed parts (a floor: the margin OCR is noisy).
Expect roughly 15–25 pieces in all, the Ember days first.

## Design

### Sections replace parts

A piece's `sections`: the ordered list of what the book prints on it.

```jsonc
{ "kind": "gradual",         // introit | gradual | alleluia | tract | sequence
                             // | hymn | offertory | communion | other
  "n": 2,                    // 2nd of its kind on the piece; omitted when alone
  "variant": "",             // "paschal" | "extra-tp" | "votive" | "" (when sung)
  "label": "2. Grad. I",     // as printed, for the heading and the review
  "title": "In sole posuit", // incipit, where known
  "system": 15, "ref": "noh1/0052/003",   // first system (0-based), as parts
  "gregobase_id": 1234,      // chant, where known
  "placed": "label" }        // label | text | mode | order | hand | reviewed
```

- A section runs until the next one starts; systems before the first belong
  to the piece (a heading, a rubric).
- **Names stay compatible.** A section's target is `part:<slug>/<kind>`, with
  `:<n>` or `:<variant>` as today (`part:x/communion:2` already exists). Every
  correction, review key and typeset link (`data/typeset/parts.yml`) keeps its
  meaning. The new kinds (`hymn`, `other`) are new names, not changed ones.
- Borrowed parts ("Graduale. Ecce sacerdos, Pars IV, p. 62") stay as they are:
  a section with `borrowed_*` in place of `system`.
- `catalog.json` gains `sections` and drops `parts` in one schema bump
  (`SCHEMA_VERSION` 2 → 3); the site reads both during the change (step 2).

### Where a piece's sections come from

1. **Reviewed**: a list a person checked against the scan, in
   `data/sections/<volume>.yml`, keyed by slug. When present it is the whole
   truth for that piece: the pipeline does not add, drop or move anything. A
   rebuild that changes the piece's systems (a re-slice, a new range) makes a
   reviewed list whose refs no longer exist **fail the build**, by name, as a
   stale correction does today.
2. **Proposed** by the pipeline, for every other piece:
   - **From the book**: margin labels are read already (`pipeline.margins`).
     `label_of` learns the numbered forms ("2.Grad", "3. Grad.") and
     "Hymn.", "Cant.", "Seq.". A labelled system starts a section of that kind.
   - **From jgabc**: its parts give chant IDs and openings. A jgabc part with
     no label is sought by text as now, but only **between** labelled
     sections, never across one, and never inside the Introit's own verse and
     Gloria Patri (the bug on this page).
   - **No invention**: a kind jgabc lists that neither a label nor a strong text
     match finds is reported (`part_missing`), not placed by order. A part
     placed by order today is hidden on the site anyway; this makes the queue
     honest about it.
3. **Corrections** (`data/corrections.yml`) still apply last, on top of
   either, to fix one start or one chant without rewriting a list.

The index's `parts:` override (Queenship) becomes a reviewed list and is
removed from the index.

### Editing

- **Admin, "Sections" for a piece**: the scans down the side, the list beside
  them. Add a section at a system, remove one, change its kind, number, label,
  variant or chant, move its start. Saving writes the whole reviewed list, as
  one correction entry of a new kind (`sections:<slug>`, `was` = the list it
  replaces), through the existing batch and pull request flow.
- **Command line**: `noh sections <slug>` prints the current list with each
  section's first system text and margin label. `noh sections <slug> --review`
  writes it to `data/sections/<volume>.yml` as the reviewed starting point, to
  edit by hand.
- **Readers' report form**: "a part is missing or mislabelled" goes to the
  queue with the system named; editors fix it in the Sections screen.

### On the site

- Jump links are the sections, in printed order: "Gradual 1 · Gradual 2 ·
  Gradual 3 · Gradual 4 · Benedictus es · Tract".
- Export segments are the sections. The seasonal defaults work by kind and
  variant as now. The Ember days need no new rule: every section on the page is
  sung that day.
- A heading above each section's first system shows the printed label.
- A piece page whose sections are proposed (not reviewed) and that the queue
  flags keeps a quiet notice: "Parts not yet checked against the book".

### Typesetting

`pipeline/typeset/match.py` builds its targets from `parts`. It switches to
`sections` with the same target names, so `data/typeset/parts.yml` does not
change. A new kind (`hymn`) can be matched once a transcription exists.

## Principles kept

- Files in git are the truth; the admin screen writes reviewed data through
  pull requests.
- Hand fixes are never edits to generated files.
- Wrong jump links are worse than none: a section is shown only when a label,
  a strong text match or a person placed it.

## Steps (each a pull request)

0. **Stopgap.** Hide the jump links on the Ember Saturday of Advent and any
   piece whose placed parts contradict its margin labels (a Tract before the
   first Gradual label, a Communion before the Offertory label). Small, ships
   first, reverted by step 4. *Optional: skip if step 4 lands within days.*
1. **Data shape.** `sections` in the pipeline and catalog (schema 3), built from
   today's parts so the catalogue is unchanged except for the field name.
   Invariants move over (`test_catalog_invariants.py`: order, one start per
   system, refs inside the piece). Corrections, review keys and typeset targets
   read sections.
2. **Site.** Read `sections` (and `parts` from a schema-2 catalogue, for one
   release), jump links, headings and export from sections. Browser tests for
   a piece with four Graduals and a hymn.
3. **Reviewed sections.** `data/sections/`, precedence over the proposal, stale
   detection, `noh sections`. Move the Queenship override into it.
4. **Proposal from labels.** Numbered and new labels in `label_of`, sections
   between labels, no order placement, the Introit's own Psalm verse excluded.
   Rebuild every volume and diff: every piece whose sections change is listed
   in the PR, each checked against its scan.
5. **Admin Sections screen**, the new correction kind, and the report form's
   new option.
6. **Review the list above by hand**, piece by piece against the scans,
   extents first (`system_range`), then sections; one PR per volume. Done when
   every piece in the table has a reviewed list.

## Tests that decide it

- Ember Saturday of Advent: nine sections, in the order and at the systems of
  the table at the top, with the Gradual numbers and the hymn.
- The Queenship Mass: its Paschal Alleluia before the Gradual, from a reviewed
  list.
- A Proper with one of each part (St Thérèse, 3 October): unchanged by steps
  1–4.
- A reviewed list naming a system the piece no longer has: the build fails,
  naming the piece and the ref.
- Site: the jump links, headings and export segments of the Ember Saturday
  follow its sections; seasonal defaults unchanged on St Thérèse.

## Open questions

1. **The hymn's chant.** *Benedictus es* is in GregoBase. Link it like the
   other parts, or leave hymns without chant links for now?
2. **"other"**: the blessings and processions (Candlemas, Palm Sunday, Holy
   Saturday) print sections that are not Mass parts. Model them now as
   `other` with a label, or leave those pieces undivided until later?
3. **Order placement.** Step 4 stops placing a part by order. Today 17 NOH3
   parts are placed that way (hidden on the site, queued for review). They
   become `part_missing` until reviewed. Acceptable?
4. **Stopgap (step 0)**: wanted, or go straight to step 1?
