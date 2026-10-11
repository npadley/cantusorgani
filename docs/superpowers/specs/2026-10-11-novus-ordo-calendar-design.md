# Novus Ordo calendar: Graduale Romanum (1974) over the NOH substrate

Status: draft for review · 2026-10-11

## Intent

Organists who play the Ordinary Form ("Novus Ordo") should be able to pick a
date and see which NOH accompaniments serve that day's proper chants, as the
1962 calendar already does for the Extraordinary Form.

What the user decided:

- Add a second calendar beside the existing 1962 one, linked from the site
  header.
- The chant book is the *Graduale Romanum* (1974), the Solesmes edition that
  carries out the *Ordo Cantus Missae* (1972; 2nd ed. 1987).
- Scope is **Sundays and solemnities only**. Weekdays come later.
- The Sunday cycle (A/B/C) must be correct. The weekday cycle (I/II) is shown.
- Switches for **Epiphany** and **Ascension** (proper day, or transferred to
  Sunday) make the calendar usable outside any one country.

Assumptions, open to correction:

- A third switch for **Corpus Christi** (Thursday, or the following Sunday) sits
  beside the other two. Most bishops' conferences transfer it, and it is the
  same kind of choice. Strike it if unwanted.
- The default is the General Roman Calendar: all three feasts on their proper
  days.
- NOH stays the substrate. This calendar is a second projection over the same
  catalogue, the same way `pipeline/litcal.py` describes the 1962 calendar. A
  chant the 1974 book assigns but NOH does not print is recorded as missing,
  never forced.

Success criteria:

1. For any date 2024–2050, under any switch setting, the page names the right
   occasion and the right Sunday cycle. This is checked against published
   ordos.
2. Every occasion page lists the proper chants of the 1974 book. Each chant
   either links to the NOH system where it is printed, or says plainly that NOH
   does not have it.
3. Coverage does not silently regress. The resolution step reports it, and
   `scripts/check.sh` guards it.

## Research findings this design rests on

- **The melodies are shared.** The 1974 Graduale mostly reassigns the
  Vatican-edition melodies NOH accompanies. It rarely introduces new ones. The
  link is the GregoBase chant ID, which NOH sections already carry
  (`sections[].gregobase_id`).
- **The day-to-chant data exists.** jgabc (`bbloomf/jgabc`, Unlicense, already
  vendored for 1962 as `propersdata.js`) has `propersdatanovus.js`, the object
  `propriumNoviOrdinis`. It covers 77 occasions: all Sundays plus the
  solemnities and major feasts. Each proper is given as `{incipit, id}`, either
  a single list or an `{A, B, C}` map when the chant changes with the year.
- **Coverage today: 357 of 387 proper slots (92%)** resolve to an NOH section
  by exact GregoBase ID. Part of the shortfall is the ~380 NOH sections that do
  not yet have an ID.
- **The cycles barely touch the chants.** Years A/B/C change mainly some
  communions (Lent 3–5, a few Ordinary Time Sundays) and a few graduals
  (Advent 3, Year B). Years I/II change readings only.
- **Every NOH section can already be addressed.** `musicView`
  (`web/src/lib/music.ts`) composes one inline score from `borrowed` parts in
  other pieces, and the PDF export (`exportSegments`) uses the same segments.
  An occasion that draws on four NOH pieces is therefore a Proper whose every
  part is borrowed. That machinery already exists.

## Approaches considered

**Computing the calendar**

1. **Recommended: compute it in TypeScript, in the browser and at build.** A
   pure module, `web/src/lib/ordinaryForm.ts`. With Sundays and solemnities
   only, the rules are small and depend on Easter, which `liturgy.ts` already
   computes. The switches take effect instantly, with no data file for each
   combination.
2. Generate per-year JSON in Python, as for 1962. That means eight switch
   combinations × 27 years of files, and still a hand-written rules engine,
   because Missalemeum does not do the Ordinary Form.
3. Depend on romcal. It is a large dependency with its own national calendars
   and key names. For this scope it brings more to verify than it saves.

**Getting the chant assignments**

1. **Recommended: vendor jgabc's `propersdatanovus.js`** with the existing
   non-executing parser, plus a small reviewed overrides file for occasions it
   lacks.
2. Transcribe the *Ordo Cantus Missae* by hand. This is the authoritative
   source, but it is much more work. Keep it as the spot-check reference
   instead (see Verification).

## Design

### 1. Vendored assignments: `data/jgabc-novus-propers.json`

`pipeline/jgabc.py` gains a second source: `propersdatanovus.js`, the
assignment to `propriumNoviOrdinis`.

- It is parsed with the same strict literal parser, never executed. The file's
  last line (`sundaysNovusOrdo = [...].concat(Object.keys(...))`) is a call. The
  parser reads only the `propriumNoviOrdinis` literal and ignores the rest.
- Occasion names contain soft hyphens (`Twenty­first`, U+00AD). They are
  stripped on import.
- The output records repo, commit, path and `source_sha256`, and has the same
  integrity check as `data/jgabc-propers.json`.
- Refresh: `uv run noh jgabc-fetch` fetches both files. Neither is ever
  hand-edited.

### 2. Occasion vocabulary: `data/novus-ordo/occasions.yml` (hand-reviewed)

This file gives each occasion a stable key we own, so that jgabc's English
names never become URLs or keys:

```yaml
- key: ot-21                     # URL slug and calendar key
  jgabc: "Twenty-first Sunday"   # after soft-hyphen stripping; null if absent
  title_en: Twenty-first Sunday in Ordinary Time
  title_la: Dominica XXI per annum
  rank: sunday                   # see §3
  color: g
```

The file is checked against the vendored data in both directions:

- Every jgabc occasion must be mapped to a key.
- Every key that names a jgabc occasion must find it.

The 77 jgabc occasions, plus the following occasions the scope needs but jgabc
lacks:

- Saint Joseph (19 Mar)
- the Sacred Heart
- the Dedication of the Lateran Basilica (9 Nov)
- the Second Sunday after Christmas
- the Christmas Vigil and Mass at Dawn

These get their chants from `data/novus-ordo/overrides.yml`, with GregoBase IDs
taken from the 1974 Graduale and marked `reviewed: <initials>`. Until an
override is filled in, the occasion appears on the calendar with "chants not
yet mapped". A missing override does not stop the occasion from being
scheduled.

### 3. Calendar rules: `web/src/lib/ordinaryForm.ts`

This is a pure module with no I/O. Its interface:

```ts
export interface OfSettings {
  readonly epiphany: "jan6" | "sunday";     // Sunday 2–8 Jan
  readonly ascension: "thursday" | "sunday"; // Easter + 42, replacing Easter 7
  readonly corpusChristi: "thursday" | "sunday";
}
export interface OfDay {
  readonly occasion: string | null;   // occasions.yml key, or null for a weekday
  readonly vigil: string | null;      // Easter Vigil, Pentecost Vigil (evening)
  readonly sundayCycle: "A" | "B" | "C";
  readonly weekdayCycle: "I" | "II";
  readonly season: OfSeason;          // advent | christmas | lent | triduum | easter | ordinary
  readonly otWeek: number | null;     // for "chants of the preceding Sunday may be used"
}
export function ofDay(date: LocalDate, settings: OfSettings): OfDay;
```

**Temporal cycle**, all computed from `easter()` and Advent:

- **Advent 1:** the Sunday from 27 Nov to 3 Dec.
- **Christmas season:**
  - Christmas, 25 Dec.
  - Holy Family: the Sunday within the octave, or 30 Dec when there is none.
  - Mary, Mother of God, 1 Jan.
  - Second Sunday after Christmas: only when Epiphany is on 6 Jan and a Sunday
    falls on 2–5 Jan.
  - Epiphany: 6 Jan, or the switch.
  - Baptism of the Lord: the Sunday after Epiphany. If a transferred Epiphany
    falls on 7 or 8 Jan, Baptism moves to the next day (Monday).
- **Lent:**
  - Ash Wednesday is Easter − 46.
  - Lent 1–5, then Palm Sunday.
  - The Triduum: Holy Thursday, Good Friday, the Easter Vigil.
- **Easter season:**
  - Easter, Easter 2–7.
  - Ascension: Easter + 39, or + 42 under the switch, which replaces Easter 7.
  - Pentecost Vigil (Saturday evening) and Pentecost, Easter + 49.
- **After Pentecost:**
  - Trinity, Easter + 56.
  - Corpus Christi: Easter + 60, or + 63 under the switch.
  - Sacred Heart: Easter + 68 in either case.
  - Christ the King: the Sunday before Advent 1.
- **Ordinary Time numbering:**
  - Before Lent, the Sunday after Baptism is the 2nd, counting up.
  - After Pentecost, count back from Christ the King, which is the 34th.
  - Trinity and a transferred Corpus Christi take the place of their Sunday
    numbers.

**Sanctoral, Sundays-and-solemnities scope:** each fixed-date occasion has a
rank, following the *Universal Norms on the Liturgical Year*, table of
precedence:

| Rank in `occasions.yml` | Table | Members |
|---|---|---|
| `triduum` | 1 | Holy Thursday (evening), Good Friday, Easter Vigil |
| `privileged` | 2 | Christmas, Epiphany, Ascension, Pentecost; Sundays of Advent, Lent, Easter; Ash Wednesday |
| `solemnity` | 3 | Mary Mother of God, St Joseph, Annunciation, Trinity, Corpus Christi, Sacred Heart, John the Baptist, Peter & Paul, Assumption, All Saints, Immaculate Conception, Christ the King; All Souls |
| `feast-of-the-lord` | 5 | Holy Family, Baptism, Presentation, Transfiguration, Exaltation of the Cross, Lateran Dedication |
| `sunday` | 6 | Sundays of Christmas and Ordinary Time |
| `feast` | 7 | Birth of the BVM |
| `memorial` | 10 | Presentation of the BVM |

The resolution rules:

- **The higher rank wins.**
- **Solemnities and Sundays.** A solemnity that falls on a Sunday of Advent,
  Lent or Easter is transferred to the nearest following day outside ranks 1–8.
  Examples:
  - Immaculate Conception on Advent 2 moves to Monday 9 Dec.
  - Annunciation in Holy Week or the Easter octave moves to the Monday after
    Easter 2.
  - The exception: St Joseph in Holy Week moves to the Saturday before Palm
    Sunday.

  A solemnity on an Ordinary Time Sunday is celebrated on that Sunday.
- **All Souls.** On a Sunday it is celebrated on that Sunday.
- **Feasts of the Lord** replace a Sunday of Ordinary Time or Christmas.
  Elsewhere they are omitted that year.
- **Feasts and memorials** appear only on weekdays. On a Sunday they are
  omitted.

**Cycles:** take the liturgical year as the civil year in which it ends. Advent
2025 begins 2026.

- Sunday cycle = `{1: "A", 2: "B", 0: "C"}[year % 3]`. 2025 is C, 2026 is A,
  2027 is B, 2028 is C.
- Weekday cycle = odd year → I, even year → II.

**Weekdays (out of scope, but handled honestly):** the day shows season and
cycles, and says:

- In Ordinary Time: "the chants of the preceding Sunday may be used", linking
  to that Sunday's occasion. This is the 1974 Graduale's own rubric for weekdays
  *per annum*.
- In other seasons: "weekday chants are not yet covered".

### 4. Resolution: `pipeline/novus.py` → `data/novus-ordo-propers.json`

This build-time step joins assignments to the catalogue. For each occasion and
each slot (introit, gradual, alleluia, tract, sequence, offertory, communion,
and each year variant):

1. Take the candidate GregoBase IDs from jgabc, or from the overrides.
2. Find NOH `printed` sections with that `gregobase_id`. Prefer, in order:
   1. the same section kind;
   2. the piece where it is the piece's own chant, not a borrowed one;
   3. volume order, then page, so that rebuilds are stable.
3. Emit
   `{slot, variant, years, gregobase_id, incipit, lender: {slug, ref, part, variant} | null}`.

A match across kinds (a chant ID found under a different section kind) is
accepted but listed in the report. A missing ID is reported, with a GregoBase
link.

The output is committed, like the other generated files in `data/`. It is
regenerated by `scripts/regenerate.sh` after a catalogue or jgabc change.

`data/novus-ordo-coverage.json` records slots matched / total, by kind and by
occasion. `scripts/check.sh` fails if the total falls below the committed
figure. This is a ratchet: an improvement raises the bar in the same pull
request.

### 5. Pages and navigation

- **Header:** `Calendar` becomes two links, **1962 Calendar** (`/calendar/`,
  unchanged URL) and **Novus Ordo** (`/calendar/novus-ordo/`). On narrow
  screens they share one row.
- **`/calendar/novus-ordo/`:**
  - The same date picker and controls as the 1962 page.
  - Below the picker, a "Calendar settings" group of three two-way switches:
    Epiphany *6 January / Sunday*, Ascension *Thursday / Sunday*, Corpus Christi
    *Thursday / Sunday*.
  - The result shows the occasion, colour, "Year A · Weekday Year II", and the
    proper chants. Each chant is labelled with its incipit and links to the NOH
    occasion page anchor. Where NOH has no setting, the chant is labelled "Not
    in Nova Organi Harmonia".
  - Where the year matters, only that year's chant is shown, with "Year B"
    beside it.
  - The settings live in the URL query (`?epiphany=sunday&ascension=sunday`) so
    that a link reproduces the view. They are also remembered in
    `localStorage`, read and written inside try/catch. The page works without
    storage.
  - The footer credits jgabc and states that the rules follow the General Roman
    Calendar, with the three switches as the only national variations.
- **`/novus-ordo/[key]/`:**
  - One static page per occasion. Each is a synthetic `Piece` (division
    `novus-ordo`, genre `proper`) whose every part is a `BorrowedPart` pointing
    at its lender. `musicView` composes the score, and the existing `ExportBar`
    exports it.
  - Year variants appear as separate parts labelled "Communion (Year A)" and so
    on.
  - An unresolved slot uses the existing missing-music notice.
  - Corrections and typeset switches still address the lending piece through
    `sourceTarget`. This is unchanged.
- **Wiring:**
  - The home page gets a second line: "Find the Mass for any date in the
    Ordinary Form".
  - The occasion pages go into the sitemap and search index.
  - `llms.txt` and `data/LICENSES.md` name the new source.

The synthetic pieces never enter `allPieces()`. They are built in a separate
`novusOrdoPieces()`, so the 1962 indexes, admin queues and review data are
unaffected.

## Error handling

| Situation | Behaviour |
|---|---|
| jgabc file changes shape or adds a call | `jgabc-fetch` fails naming the line; vendored files untouched |
| jgabc adds or renames an occasion | the `occasions.yml` cross-check fails in `check.sh`, naming it |
| Chant ID not in NOH | page says "Not in Nova Organi Harmonia" with GregoBase link; counted in coverage |
| Occasion without assignments (override unfilled) | scheduled and titled; "chants not yet mapped" |
| Date outside 2024–2050 | picker bounds as on the 1962 page |
| Unknown query values | ignored; defaults applied |

## Verification and tests

- **Calendar rules** (`ordinaryForm.test.ts`):
  - A fixture of dated occasions, liturgical years 2025–2030, transcribed from
    published ordos: the USCCB ordo for the Sunday-transfer settings, and the
    General Roman Calendar for the defaults.
  - Edge years are named in the fixture:
    - Christmas on a Sunday (Holy Family on 30 Dec);
    - Epiphany on 7/8 Jan (Baptism on Monday);
    - Immaculate Conception on an Advent Sunday;
    - Annunciation in Holy Week;
    - St Joseph in Holy Week (2035);
    - Peter & Paul and All Souls on a Sunday;
    - the earliest and latest Easter in range.
  - Each of the 8 switch combinations is run over every year, and asserts that
    every Sunday has exactly one occasion.
- **Cycles:** spot dates either side of each Advent 1.
- **Parser and resolution** (pytest):
  - The literal parser on the real file and on a fixture containing the
    trailing `.concat` line.
  - Soft-hyphen stripping.
  - Resolution tie-breaks.
  - The coverage ratchet.
- **Source accuracy:** before release, spot-check 15 occasions' assignments
  against the CMAA scan of the 1974 Graduale. Include every A/B/C case and four
  Ordinary Time Sundays. Record this as `reviewed:` in `occasions.yml`.
  Disagreements go into `overrides.yml` and are reported upstream to jgabc.
- **Pages:** build, then check one occasion page whose chants come from at least
  three lenders. Its composed score and PDF export must show the right systems.

## Out of scope

- Weekday propers of Advent, Lent and Easter, and 17–24 Dec. That would need a
  hand transcription of the *Ordo Cantus Missae*, and is a separate spec.
- Saints' memorials and the Commons.
- National proper calendars beyond the three switches.
- The *Graduale Simplex*.
- Readings.
- Page numbers in the 1974 Graduale.

## Open questions for review

1. Header labels: "1962 Calendar" / "Novus Ordo", or "Ordinary Form"?
2. Keep the Corpus Christi switch?
3. Default settings: the General Roman Calendar, or the US practice (all three
   on Sunday)?
