# Plan: the full music of Vespers for every Sunday, with chant links

**Required Skill**: executing-plans
**Design doc**: `docs/claudekit/specs/2026-09-07-nova-organi-harmonia-design.md`
**Status**: plan, not started. Written 2026-09-27.

## Goal

**Problem** (reported 2026-09-27): a day page's "Vespers" section links one
NOH8 piece — for most Sundays, the section that prints the day's Magnificat
antiphon ("Dominicae IV-XXIV post Pentecosten", 69 systems, all twenty-one
Sundays in one stack). The organist has to find the rest of the office in the
book: the opening versicle, five antiphons and their psalms, the hymn, the
Magnificat in the antiphon's tone, the Benedicamus and the Marian antiphon.
Nothing in Vespers links to its chant.

**Goal**: each Sunday (and each feast NOH8 provides for) gets a **Vespers
page in the order it is sung**, every item of which is either the NOH8 (or
NOH7) accompaniment, cut to exactly that item, or a clearly marked note of what
is sung without a printed accompaniment. Each chant item has its GregoBase
chant beside it, on the same reader's switch as the Mass.

Done means: on the live site, the 15th Sunday after Pentecost (2026-09-06,
calendar key `tempora:Pent15-0`; the site's Missalemeum calendar counts Trinity,
2026-05-31, as `Pent01-0r`), the 1st Sunday of Advent and Christmas each show a
Vespers lineup:

1. *Deus in adjutorium* (the seasonal form);
2. five antiphons, each followed by its psalm in the antiphon's tone;
3. the chapter (text, as a note);
4. the hymn, with its versicle;
5. the Magnificat antiphon, then the Magnificat in its tone;
6. *Benedicamus Domino* (the seasonal form);
7. the Marian antiphon of the season.

Each item jumps, exports to the PDF in that order, and links to its chant.
Every golden test names a civil date and its calendar key, never an ordinal.

**Demand evidence (before release 2 starts)**:

- (a) record who asked for this (the site's owner, 2026-09-27) and how often
  they play Sunday Vespers;
- (b) compare Cloudflare analytics for the Vespers pages, Saturday and Sunday
  afternoons and evenings over the 8 weeks after release 1, against the Mass
  Propers;
- (c) ask 5 organists at 1962-rite parishes what they play in a typical month:
  Sunday Vespers, feast Vespers, Benediction, the Marian antiphon, Compline.

**Stop or defer**: if fewer than 2 of the 5 play Sunday Vespers monthly and
Vespers views are under 5% of Proper views, stop after release 1. Benediction
and the Marian antiphons (NOH7, step 6) then move ahead of releases 2-3.

## Verified facts (measured 2026-09-27, not assumed)

**NOH8 (Vesperale)**, 344 PDF pages, 55 catalogued pieces, 1,713 systems,
59 hymns indexed by name:

- **"Dominica ad Vesperas"** (pp. 1-27, 152 systems) prints the whole Sunday
  office *per annum*: *Deus in adjutorium* (a ferial and a solemn tone), Psalms
  109-113 **accompanied verse by verse** under the Sunday antiphons (*Dixit
  Dominus* VII c2 ...), the Eastertide antiphon, the chapter, *Lucis Creator*
  in three tones, the versicle, the Magnificat's text (p. 25: "juxta tonum
  Antiphonae propriae" — **text only, no music**), the suffrage, the
  Eastertide commemoration of the Cross, and the Benedicamus.
- **Seasonal and feast sections** (Advent I-IV, Christmas, Epiphany, Easter,
  Ascension, Pentecost, Trinity, Corpus Christi, Sacred Heart, Christ the King,
  feasts of Our Lady and the saints, and the Commons) print each antiphon with
  its tone in the margin ("5. Ant. IV. A*", "VIII. G"). After each antiphon
  come **the first two verses of its psalm in that tone** (p. 50: *Laudate
  pueri*, then *In exitu Israel*).
  - The Magnificat antiphon is followed by the first two verses of the
    Magnificat in its tone (p. 53, "Ne timeas Maria", VIII G).
  - Then a reference: "Quia respexit, ut supra, p. 25".
- **The Sundays after Epiphany and after Pentecost** (pp. 135-136, 189-201)
  print **only the Magnificat antiphon** for each Sunday ("Ad Magnif. Ant.
  VII b"). The psalms are the Sunday psalter of pp. 1-27. The Magnificat's
  accompaniment for that tone has to come from wherever NOH8 prints a
  Magnificat in the same tone and ending.
- Compline (pp. 28-39) and the four **final antiphons of Our Lady**
  (pp. 40-44) are catalogued as pieces.
- The printed tone labels (mode + ending: "VIII.G", "I.g2", "IV.A*", "VII.c2")
  are the key that links an antiphon to a psalm accompaniment.

**NOH7 (Varia)**, 274 pages, **not catalogued**. Its index lists hymns in
alternative tones (*Iste Confessor* in tones 4, 5 and 7; *Ave maris stella*;
*Creator alme siderum*; *Deus tuorum militum* ...), the Marian antiphons, *Te
Deum*, Benediction music and Psalms 116 and 50. Some Vespers hymns are
printed only here.

**Divinum Officium** ([DivinumOfficium/divinum-officium](https://github.com/DivinumOfficium/divinum-officium),
**MIT**, active 2026-09-26) has the 1960 rubrics. Its per-day files
(`horas/Latin/Tempora/Pent04-0.txt`, `Sancti/12-25.txt`) hold:

- each Vespers antiphon's text with its psalm number
  (`Tecum principium * ...;;109`);
- the chapter, the hymn and the versicle;
- the Magnificat antiphons (`[Ant 1]` for I Vespers, `[Ant 3]` for II Vespers);
- rules such as `Psalmi Dominica`, and its rank table for 1960.

It has **no chant tones and no music**.

**jsrjenkins/vesperale** ([repo](https://github.com/jsrjenkins/vesperale),
TeX + GABC, last active 2023-11) builds 1962 Sunday Vespers
booklets. Its `calendar.sty` is a hand-made lineup table by season and Sunday:

- *Deus in adjutorium*: simple, or the Septuagesima form;
- each psalm's antiphon with the psalm's tone file (`109-8G`, `110-8Gstar`,
  `113-per`);
- the hymn with its versicle and response, by season;
- the Magnificat antiphon with its tone (`quaerite_primum` → `1g`);
- the Benedicamus by season (Advent/Lent form, or *Benedicamus XI*);
- the Office of the Dead.

Its coverage: Advent I-IV, Septuagesima to Passion Sunday, most Sundays after
Epiphany and Pentecost (several marked TODO), and the Office of the Dead; **no
feasts**. Its antiphon files are named after GregoBase exports
(`an--quaerite_primum--solesmes`).

**GregoBase** (vendored dump, CC0) has **8,611 publishable antiphons**
(office part `an`) and **1,661 hymns**, among them the Sunday antiphons (*Dixit
Dominus Domino meo*, *Ne timeas Maria*, *Praevaluit David*). The dump records
each chant's mode, and its sources give the edition (Antiphonale 1912, Liber
Usualis 1961 ...).

**The site today**: the day page filters `division === "vesperale"` into one
"Vespers" list of whole pieces. Hymns are jump points inside a piece.
`data/catalog.json` has no antiphon, psalm or Magnificat divisions.

## Sources and how each is used

All of it is public domain or openly licensed (the owner's determination,
2026-09-27): no licence question stands in the way of any source.

| Source | Role | Vendored? |
|---|---|---|
| NOH8, NOH7 scans | The accompaniments (what the site shows) | as now: slices on R2 |
| Divinum Officium (MIT) | **The ordo**: which antiphons, psalms, hymn, chapter and Magnificat antiphon for each day under the 1960 rubrics | yes, pinned commit + sha256, like jgabc; only the Latin Vespers sections we read |
| jsrjenkins/vesperale | **The Sunday lineup table**: the tone (ending) of each Sunday antiphon and Magnificat, the seasonal *Deus in adjutorium*, hymn and Benedicamus; a golden table for tests | yes: `calendar.sty` parsed into `data/vesperale-lineup.json`, pinned commit + sha256; its GABC files are not needed (GregoBase has them) |
| GregoBase (CC0) | Chant notation and links for each antiphon, hymn and versicle | as now (`data/chants.json`) |

Tones come from **NOH8's own margin labels** first (they are what the
organist plays). vesperale and GregoBase's mode confirm them. A disagreement
goes to the review queue; it is never silently resolved.

## Architecture

```
data/calendar/<year>.json (1962) ── which office, which commemoration, each date
Divinum Officium (1960)   ─┐
  per-day Vespers texts     │  noh officium-fetch → data/divinum-officium-vespers.json (vendored);
                           ─┘  vespers_ordo() is called inside noh vespers-lineup, and no
                               separate ordo file is written                  (what is sung)
jsrjenkins/vesperale ────────  noh vesperale-fetch → data/vesperale-lineup.json (vendored)

NOH8 / NOH7 scans ── noh catalog ── segment each office into ITEMS
                                     antiphon, psalm, hymn, versicle,
                                     magnificat-antiphon, magnificat, ...
                                     each with its tone label and systems
                                   → catalog.json  piece.items[]          (what is printed)

noh vespers-lineup  calendar × ordo × items × tone bank → data/vespers-lineup.json

web  /vespers/<date>/ (II Vespers)  /vespers/<date>/i/ (I Vespers, sung the evening before)
```

- **Calendar authority**: `data/calendar/<year>.json` (Missalemeum, 1962) alone
  decides which office is celebrated on a date, and which commemoration (if
  any).
  - Divinum Officium supplies only texts (antiphons, psalm numbers, chapter,
    hymn, versicle), looked up by the key the calendar gives.
  - Its rank table is used only to decide which I Vespers wins when two offices
    meet on an evening (concurrence).
  - Any disagreement with the calendar is a review item
    (`ordo_calendar_conflict`), never resolved silently.
- **Lineup contract**: `data/vespers-lineup.json` =
  `{schema_version, catalog_sha256, days: {"YYYY-MM-DD": {office: <calendar key>,
  vespers: "I"|"II", items: [{item_key, kind, number|null, label, tone|null,
  source: {type:"printed", piece, first_ref, last_ref} | {type:"bank", piece,
  first_ref, last_ref, borrowed_from_page} | {type:"note", text}, chant:
  int|null}]}}}`.
  - It is keyed by civil date, because I Vespers and commemorations depend on
    the year.
  - Multi-Mass keys (`sancti:12-25m1..m3`, `sancti:11-02m1..m3`) collapse to
    one office.
  - `item_key` (`<date>/<office>/<kind>/<n>`) does not depend on the source,
    so a re-typeset item can later replace a scan slice without changing the
    lineup.
  - `web/src/lib/vespers.ts` gets a `parseLineup` that validates the file the
    way `parseCatalog` does and rejects an unknown `kind` or `source.type`.
  - `noh doctor` fails if any `first_ref`/`last_ref` is missing from
    `catalog.json`, or if `catalog_sha256` is out of date.
  - `piece.items[]` is optional and does not bump `SCHEMA_VERSION`.
- **Export**: a new `exportLineup(day)` in `exportParts.ts` builds segments
  from lineup items. Its ids are `${date}:${index}`, so reused bank systems
  don't collide, and it keeps the shared 300-system ceiling. `exportSegments`
  stays unchanged.

- **Items, not pieces.** A Vespers office is cut into items the way a Proper
  is cut into parts. The item kinds are:
  - `initium`, `antiphon` (numbered 1-5), `psalm` (with its number) and
    `chapter`;
  - `hymn` (already indexed by name) and `versicle`;
  - `magnificat-antiphon` and `magnificat`;
  - `benedicamus`, `marian-antiphon`, `commemoration`.
- **The tone bank.** Every printed psalm or Magnificat opening is indexed by
  tone and ending (for example `magnificat@VIII.G`, `psalm-109@VII.c2`,
  `psalm@I.g2`). When a Sunday prints only its Magnificat antiphon, the lineup
  takes the Magnificat from the bank entry with the same tone and ending, and
  says so: "Magnificat in VIII G, as printed for Advent I, p. 53".
  - Psalm verses are sung to one formula, so a printed opening in the right
    tone serves any psalm. The lineup shows the psalm's own opening where NOH
    prints it, and the tone-bank formula (labelled) where it doesn't.
- **What is sung without accompaniment** (the chapter, the oration, the
  suffrage's versicles) appears as a one-line note with its text from Divinum
  Officium, so the order stays complete and nothing looks missing.
- **1962 rubrics** apply, not 1942:
  - the suffrage NOH8 prints was abolished in 1955, so it is left out;
  - commemorations follow the 1960 rules (at most one at a Sunday's Vespers);
  - I Vespers is kept only for a Sunday and for I class feasts;
  - where Divinum Officium's 1960 table and NOH8 disagree, the ordo wins and
    the difference is recorded.

## Work

### 0. Ship-first wedge (release 1): the green Sundays

The Sundays after Pentecost and after Epiphany are the most frequent case and
need the least: the Sunday psalter (pp. 1-27, fully accompanied), *Lucis
Creator*, the day's Magnificat antiphon, and the Magnificat from the tone bank.

- Segment "Dominica ad Vesperas" into items (step 2).
- Segment "Dominicae IV-XXIV post Pentecosten" and "Dominicae II-VI post
  Epiphaniam" into one Magnificat antiphon per Sunday, keyed by the "DOMINICA
  XIV. POST PENTECOSTEN." headings (already in the text layer) with their tone
  labels.
- Build the tone bank from the Magnificat openings NOH8 prints (step 3).
- Show `/vespers/<date>/` for those Sundays only. The day page's Vespers
  section links to it; other days keep today's piece list.
- **Release 1 is step 0 only**:
  - step 2 applied to "Dominica ad Vesperas" and the two Magnificat-antiphon
    sections;
  - step 3 limited to Magnificat openings;
  - the step 7 page.

  There is no Divinum Officium fetch, no NOH7 and no hymn table beyond *Lucis
  Creator*. The chapter, hymn, versicle and Benedicamus are the fixed
  *per annum* items on pp. 1-27. Chant links come from a hand-reviewed table
  of GregoBase ids. Steps 1, the general join of step 4, the matcher of
  step 5, and step 6 start with release 2.
- **Calendar cases the wedge must handle, each with a golden test by date**:
  - the resumed Sundays after Epiphany in November (2026-11-08
    `tempora:Epi5-0`, 2026-11-15 `tempora:Epi6-0`), whose Magnificat antiphons
    come from pp. 135-136;
  - the last Sunday, which is always `Pent24-0` (2026-11-22);
  - a green Sunday taken by Christ the King (2026-10-25 `sancti:10-DU`) or All
    Saints (2026-11-01 `sancti:11-01`), which gets no green lineup;
  - Pent II and III (2026-06-07 `Pent02-0r`, 06-14 `Pent03-0r`), which fall
    outside "Dominicae IV-XXIV": find their Magnificat antiphons or list them
    as excluded.

  The key suffix `r` is stripped the same way `jgabc_key` strips it. The
  Magnificat-antiphon lookup is keyed by the calendar key, never by position
  in the 21-item stack.
- **Tone-bank dependency**: release 1 cuts only the Magnificat openings from
  every NOH8 section (not their antiphons or psalms), so the bank exists before
  release 2. A green Sunday whose Magnificat tone has no bank entry gets no
  page in release 1 rather than shipping with a note.
- **Tone vocabulary**: a normalised tone must be one of a fixed list of the
  endings NOH8 prints (I.D, I.D2, I.f, I.g, I.g2, I.g3, I.a, I.a2, I.a3, II.D,
  III.a, III.a2, III.b, III.g, IV.E, IV.A, IV.A*, V.a, VI.F, VI.C, VII.a, VII.b,
  VII.c, VII.c2, VII.d, VII.e, VII.e2, VIII.G, VIII.G*, VIII.c, peregrinus).
  - Extend the list from the book, not by guessing.
  - An OCR reading outside the list is a review item (`tone_unreadable`) with
    the margin crop attached.
  - For feasts, the ending has only one signal (GregoBase gives the mode only,
    and vesperale has no feasts). It must be read from the text layer or
    confirmed by a person before a bank entry uses it.

**Release gate**: the 15th Sunday after Pentecost's lineup (2026-09-06,
`tempora:Pent15-0`) matches a hand reading of the book, item for item. Every
Magnificat antiphon among the green Sundays has a tone and a bank entry, or the
Sunday is listed as held back. The calendar goldens above pass.

### 1. Vendor the ordo — `pipeline/officium.py`, `data/divinum-officium-vespers.json`

- `noh officium-fetch [--commit SHA]` downloads, at a pinned commit, only:
  - `Tempora/*.txt`, `Sancti/*.txt` and `Commune/*.txt`;
  - `Psalterium/Psalmi/Psalmi major.txt`.

  It keeps only the Vespers sections, with the source commit and a content
  sha256. A hand edit fails the integrity check ("re-run `noh
  officium-fetch`; do not hand-edit"), as for jgabc.
- The section parser reads the file format: `[Ant Vespera]`, `[Ant Vespera 3]`,
  `[Capitulum Vespera]`, `[Hymnus Vespera]`, `[Versum 1]`, `[Ant 1]` / `[Ant 3]`.
  - It follows references (`@Tempora/Pent01-1`, `@:Ant 1_`) and skips
    conditionals such as `(sed rubrica cisterciensis)` unless they name 1960.
  - It is a strict parser that never runs anything, like the jgabc literal
    parser.
- `noh vesperale-fetch [--commit SHA]` downloads jsrjenkins/vesperale's
  `calendar.sty` at the pinned commit and writes `data/vesperale-lineup.json`
  with the source commit and a content sha256.
  - It uses the same integrity check and hand-edit message as
    `officium-fetch`.
  - Both fetch verbs print what they wrote, for example: "wrote
    data/divinum-officium-vespers.json: 412 files, 1,187 Vespers sections,
    commit a1b2c3d".
- `vespers_ordo(day_key, calendar)` returns the sung order for II Vespers of
  that day (and I Vespers of the next day where 1960 gives it the evening).
  - The day key is the site's own (`tempora:Pent15-0`).
  - The mapping to Divinum Officium's file names is a small table plus rules,
    like `jgabc_key`.
- **Tests**: golden ordos for Pent15-0, Adv1-0, Christmas (II Vespers:
  *Tecum principium* 109 ... *De fructu* 131), Easter (a single antiphon under
  five psalms) and Christ the King. Also a test for a Sunday that yields to an
  occurring I class feast.

### 2. Segment the offices into items — `pipeline/vesperitems.py`

The same two-signal approach as Proper parts:

- **Labels**: margin OCR reads "Ant.", "1. Ant.", the tone ("VIII.G", "IV. A*"),
  "Ps.", "HYMNUS", "Capitulum", "Ad Magnificat", "Benedicamus". The
  text-layer patterns are strict, as in `TEXT_LABELS`.
- **Words**: each antiphon's opening words from the ordo (Divinum Officium's
  text), matched with `movement_score_for`.
- **Order**: the ordo fixes the sequence, so an item is sought only after the
  one before. An item placed by order alone is hidden and queued
  (`item_by_order`), exactly as for parts.
- Each item records `kind`, `number`, `tone` (as printed), `system`, `ref`,
  and `placed` ("label" | "text" | "order").
- **Tests** (named `test_[function]_[scenario]_[expected]`):
  - Advent I's five antiphons with their tones, against the scan;
  - the Christmas psalm 131 opening;
  - a tone label read wrong by OCR ("IV.A*" as "IV. A~");
  - an antiphon repeated after its psalm, which is not the next antiphon.

### 3. The tone bank — `pipeline/tonebank.py`

- Index every psalm opening and Magnificat opening item by tone and ending.
  Normalise the tone ("VIII. G" = "VIII.G"; "I.g2"; the starred "IV.A*").
- `bank_entry(kind, tone)` returns the printed item that serves. It prefers
  the same psalm, then the same kind, then any psalm formula in that tone (for
  a psalm only).
- A tone with no entry anywhere in NOH8 is a review item (`tone_unprinted`),
  and the lineup shows a note instead of guessing a neighbouring tone.
- Review-queue kinds and their messages. Each says what failed, why, and what
  to do:
  - `tone_unprinted`: "Magnificat in II.D for Pent 7 has no printed Magnificat
    in that tone anywhere in NOH8/NOH7; the page shows a note. Add a bank entry
    by hand in data/tonebank-overrides.yml or accept the note." Page note: "No
    printed accompaniment for the Magnificat in II D; sing it in that tone."
  - `tone_disagreement`: "Ant. 3 'Beatus vir' on p. 14: NOH8 margin reads
    VIII.G, vesperale says VIII.G*, GregoBase mode 7. The NOH8 label is used;
    confirm against the scan."
  - `tone_unreadable`: "p. 191: margin reads 'VII. l'; not a tone NOH8 prints.
    Read it from the scan and add it to data/tonebank-overrides.yml."
  - `ordo_differs`: "Pent15-0 II Vespers: NOH8 prints the suffrage; the 1960
    ordo omits it, so it is left out."
  - Parser failures in `pipeline/officium.py` name the file, the section and
    the fix, for example: "Sancti/08-15.txt [Ant Vespera]: reference
    @Commune/C11:Ant 1 not found in the vendored copy; re-run `noh
    officium-fetch` or add it to the key table in officium.py".
- **Tests**: `magnificat@VIII.G` resolves to p. 53; a missing tone reports
  rather than falls back.

### 4. The lineup — `pipeline/vesperslineup.py`, `data/vespers-lineup.json`

- Per calendar day with Vespers, join the ordo to printed items:
  - the day's own office section first (a feast's antiphons);
  - then the season's section (Advent Sunday);
  - then the Sunday psalter;
  - then the tone bank.
- Each lineup entry records `item`, `label`, `source`, `tone`, `chant` (a
  GregoBase id or null) and a `note` when nothing is printed.
- The seasonal choices vesperale encodes become explicit rules with the source
  cited:
  - *Deus in adjutorium*: simple, solemn, or the Septuagesima-to-Easter form
    without Alleluia;
  - the Benedicamus form;
  - the Marian antiphon: *Alma* Advent to Candlemas, *Ave Regina* to Holy
    Week, *Regina caeli* in Eastertide, *Salve Regina* after Trinity.

  vesperale's vendored table seeds these rules and is the test oracle for
  the Sundays it covers.
- `noh vespers-lineup [--day 2026-09-06 | --day tempora:Pent15-0] [--json]`.
  - With `--day` it prints only that day's lineup in sung order, one line per
    item: number, kind, label, tone, source (`NOH8 p. 12 sys 3-7` \| `tone
    bank: magnificat@VIII.G (Advent I, p. 53)` \| `note`), and chant id or `no
    chant (reason)`. The day can be checked against the book without building
    the site.
  - Dates are mapped to day keys through the site calendar. An unknown date
    fails with "2026-09-07 has no Vespers entry in data/calendar; pass a
    Sunday or feast date, or a key such as tempora:Pent15-0".
  - Without `--day` it prints a coverage summary:
  - Sundays and feasts with a complete lineup;
  - items from the tone bank;
  - notes;
  - review items.

### 5. Chant links for Vespers

- **Antiphons**: match the ordo's antiphon text to GregoBase antiphons by
  normalised incipit, **and** the mode from NOH8's tone label. Prefer the
  1961 Liber Usualis / Antiphonale sources. A match on text without the mode
  (a different melody of the same words) is not shown.
- **Hymns**: GregoBase has several melodies for one hymn text (*Lucis
  Creator*, *Iste Confessor* in several tones). The NOH label ("alius tonus")
  and the GregoBase mode must agree. Where more than one GregoBase melody
  remains, a small reviewed table (hymn, NOH tone label → GregoBase id)
  decides. With no table entry, no chant is shown, never the wrong melody.
  Reading pitch contour from the scan (optical music recognition) is out of
  scope.
- **Versicles, Benedicamus, Deus in adjutorium**: a small, reviewed table of
  GregoBase ids (they are few, and fixed).
- `select_chants` gains the Vespers ids, so `data/chants.json` includes them;
  copyrighted ones stay excluded.

### 6. Catalogue NOH7 (Varia) — enough for Vespers

- Add NOH7 to `data/volumes.yml` and index it with `noh index-extract` (its
  index is p. 274).
- Catalogue the hymns and antiphons Vespers uses: alternative hymn tones, and
  hymns NOH8 names but prints only in NOH7.
- The rest of NOH7 (Benediction, litanies, *Te Deum*) is catalogued too, since
  that costs little once the volume is in, but gets no special pages here.

### 7. Site

- **`/vespers/<date>/`** (static): the lineup in sung order.
  - **Header**: the h1 is the day ("15th Sunday after Pentecost"). Under it,
    one `meta ui small muted` line reads "II Vespers · 1962 rubrics · Nova
    Organi Harmonia VIII", or "I Vespers of …" when that is what is shown.
  - **Outline**: items are grouped into h2 sections:
    - *Deus in adjutorium*;
    - Psalm 1 to Psalm 5, each holding its antiphon and psalm as h3 (h2 "1.
      Dixit Dominus — VII c2", h3 "Antiphon", h3 "Psalm 109");
    - Chapter;
    - Hymn and versicle;
    - Magnificat (antiphon and canticle as h3);
    - Benedicamus;
    - Marian antiphon.

    The tone as printed is always part of the heading text, never only in a
    note. Each heading keeps the existing `.part-head` layout: the heading is
    never the link, and a separate "Chant" link and the same chant-notation
    switch are used as on Mass pages.
  - **Nav**: a jump-link `<nav aria-label="Order of Vespers">` lists the h2
    sections only (at most 9 links), styled as in `MovementNav`, with each
    link at least `--tap-min` tall.
    - It must fit in two rows on a landscape tablet, so the first system of
      *Deus in adjutorium* shows without scrolling.
    - The page passes `skipTo` to the first section.
    - Screen readers hear tone labels in full: "IV.A*" is "tone 4, ending A
      star".
  - **Console header**: above the lineup, one line gives each psalm's tone
    and ending ("Pss. 109-113: VII c2, VIII G, III a, VIII G, I g"), the
    Magnificat tone, and the Marian antiphon, readable without scrolling.
  - **Psalm text** (release 2, when Divinum Officium is vendored): under each
    psalm item whose verses NOH prints only the opening of, the full unpointed
    text from the vendored psalter. Pointing stays out of scope.
  - Tone-bank items say where the music comes from: "Magnificat in I g, as
    printed on p. 112".
  - After each psalm and after the Magnificat, the page prints the antiphon's
    systems again, so a sung repeat is never a jump back up the page.
    - The repeat has an h3 "Antiphon (repeated)" and is left out of the nav.
    - The export includes it too.
  - Where only two verses are printed, a `ui small` line follows the last
    system: "Continue every verse to this formula, then *Gloria Patri*."
- **`LineupStack.astro`** (new, beside `SystemStack`) renders slices from
  several pieces and volumes, one `<figure>` per h2 section.
  - All systems on the page share one scale: `widest` is taken over every
    system in the lineup, not per piece.
  - The sr-only figcaption names the volume and pages of each source; the
    hard-coded "part V … 1942" text is not reused.
  - A note is a single `ui small` paragraph with a 2px `--rule` left border,
    not the `.notice` box, which means something is wrong.
  - A tone-bank provenance line is `ui small muted` directly under the
    heading. No new colours or tokens.
- **States per item**:
  - (a) *Printed*: the systems.
  - (b) *Tone bank*: the systems plus the provenance line.
  - (c) *Sung unaccompanied* (chapter, oration): a note with the text.
  - (d) *Tone not printed* (`tone_unprinted`): a note, "No accompaniment for
    Magnificat in III a is printed in NOH VIII; sing unaccompanied or improvise
    in III a."
  - (e) *Placed by order only* (`item_by_order`, hidden): the heading stays,
    with the note "Printed in NOH VIII near p. N; not yet confirmed here" and
    a link to that piece's page.
  - (f) *No chant match*: no Chant link.
  - (g) *A slice fails to load*: the message names the item ("System 3 of 7
    of Psalm 110 could not be loaded").
  - (h) *Export over the 300-system ceiling*: the same refusal text as
    ExportBar today.

  On the day page, a Sunday with no lineup yet keeps today's list plus one
  `muted` line: "The full order of Vespers for this day is not ready yet."
- **Day page**: the Vespers section shows the lineup's summary (antiphons,
  hymn, Magnificat antiphon) and one link, "Full Vespers", instead of a list
  of whole pieces. Days without a lineup keep today's list.
- **Export**: the Vespers page's "Export" builds the PDF in sung order through
  `exportLineup` (see Architecture), with item headings and the shared
  300-system ceiling.
- **Accessibility**: the headings are an outline; the tone is text, not only
  an image; the chant SVG keeps its aria-label; the nav is a `<nav>` with an
  accessible name.

### 8. Verify and ship

- Hand-check 3 Sundays (the green 15th, 2026-09-06; Advent I; Lent II) and 2 feasts
  (Christmas, the Assumption) item by item against the book. Record the
  results in the review file, as for parts (44 of 45 was the bar).
- Golden tests in `test_catalog_invariants.py` for those five days.
- Coverage floors: every Sunday of 2026-2027 has a lineup; at least 90% of
  its items come from printed music (own section or tone bank), not notes.
  The floor counts only items that *can* have music: the chapter, oration and
  other notes are excluded from the denominator.
- **Test matrix** (named `test_[function]_[scenario]_[expected]`):
  - step 4: the join order (own section, then season, then psalter, then
    bank); each Marian-antiphon boundary date; the Septuagesima *Deus in
    adjutorium* without Alleluia; oracle tests against the vendored vesperale
    table for every Sunday it covers, where a mismatch fails unless it is
    listed in a reviewed exceptions file;
  - step 5: a text match with the wrong mode shows no chant; a hymn with two
    candidate melodies and no table entry shows no chant; a copyrighted id is
    excluded from `chants.json`;
  - step 6: NOH7 index extraction finds the hymns NOH8 names but prints only
    in NOH7;
  - calendar goldens by date: 2026-09-06, 2026-11-01, 2026-11-08, 2026-10-25
    and 2026-12-25 (m1-m3 collapsed);
  - web (vitest): `parseLineup` rejects bad input; `exportLineup` keeps sung
    order and gives unique ids when a bank item is reused; the Vespers nav
    lists items in lineup order; the day page falls back to the piece list
    when a date has no lineup.
- `noh doctor` gains `check_officium()`, `check_vesperale()` and
  `check_lineup()`, modelled on `check_jgabc`.
  - On success they report, for example, "Divinum Officium Vespers for N days
    (commit abc1234)".
  - On failure they give the error plus "Fix: uv run noh officium-fetch" (or
    `vesperale-fetch`, or `vespers-lineup`).
- README.md gets a "Vespers" section, in this order:
  - (1) the rebuild order as a copy-pasteable block;
  - (2) checking one Sunday: `uv run noh vespers-lineup --day 2026-09-06`;
  - (3) what each review-queue kind means and how to clear it.
- Deploy with the usual checks: the asset base, 0 local fallbacks, the chant
  file count.

## Releases

1. **Green Sundays** (step 0 only; see its scope list): about 26 Sundays a
   year.
2. **The seasons**: Advent, Septuagesima, Lent, Passiontide, Easter and its
   Sundays.
3. **Feasts and the Commons**: NOH8's feast sections, and the Commons for
   saints' days that have Vespers.
4. **NOH7 hymns, and Compline** (Compline is already printed in full,
   pp. 28-39).

**Rollback.** A date gets a Vespers page and the "Full Vespers" link only if
it is in `vespers-lineup.json` and every item there is placed by label or text,
not by order alone.

- Removing a date, or deleting the file, puts the day page back to today's
  piece list with no other change. That is the rollback for releases 1-3. A
  release that fails its hand-check ships without its dates.
- The new data files are additive; each can be reverted as a single commit.
- Release 4 (NOH7) adds a volume to `catalog.json`, and `merge_catalog` never
  drops a volume. Its rollback is:
  - remove `noh7` from `volumes.yml`;
  - rebuild the catalog from scratch with the other volumes;
  - delete the `noh7/` slices from R2.

  Test this once on a branch before release 4 ships.

## Risks

| Risk | Mitigation |
|---|---|
| OCR misreads tone labels (the key to the bank) | A fixed tone vocabulary (`tone_unreadable`); GregoBase mode and vesperale's table confirm the Sundays; feast endings confirmed from the text layer or by a person; no guess |
| 1942 vs 1962: NOH8 prints the suffrage, 1942 antiphons for later-revised feasts, abolished octaves | The ordo (DO 1960) decides what is sung; NOH is only the music; differences logged |
| A Sunday's Magnificat tone has no printed Magnificat in NOH8 | `tone_unprinted` review item; note on the page; count reported |
| Hymn melody ambiguity → wrong chant shown | A reviewed (hymn, tone) → id table; no entry, no chant (step 5) |
| Divinum Officium's file format changes | Pinned commit + sha256; parser tests on the vendored copy |
| Scope creep into the whole Office | Vespers (and Compline, release 4) only |

## Out of scope

- Pointing the psalm text for singing (marking the mediant and termination
  syllables for each verse). This is a possible later addition: Divinum
  Officium has the texts, and the tone formulas are known.
- Lauds, Matins and the Little Hours.
- Typesetting new accompaniments (see the re-typesetting research spec).
- Monastic or Dominican use.

## Open questions for the user

1. **I Vespers**: release 1 shows II Vespers (Sunday evening) at
   `/vespers/<date>/`. `/vespers/<date>/i/` is reserved for I Vespers (Saturday
   evening). Should it be built in release 2?
2. **Commemorations**: show the commemoration of an occurring feast (1960: at
   most one at Sunday Vespers) as an item, or leave it out as a note?
   Release 1 shows it as a note when the calendar lists one.
