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

Done means: on the live site, the 14th Sunday after Pentecost (2026-09-06),
the 1st Sunday of Advent and Christmas each show a Vespers lineup:

1. *Deus in adjutorium* (the seasonal form);
2. five antiphons, each followed by its psalm in the antiphon's tone;
3. the chapter (text, as a note);
4. the hymn, with its versicle;
5. the Magnificat antiphon, then the Magnificat in its tone;
6. *Benedicamus Domino* (the seasonal form);
7. the Marian antiphon of the season.

Each item jumps, exports to the PDF in that order, and links to its chant.

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
TeX + GABC, **no licence**, last active 2023-11) builds 1962 Sunday Vespers
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

| Source | Role | Licence | Vendored? |
|---|---|---|---|
| NOH8, NOH7 scans | The accompaniments (what the site shows) | public domain (owner's determination) | as now: slices on R2 |
| Divinum Officium | **The ordo**: which antiphons, psalms, hymn, chapter and Magnificat antiphon for each day under the 1960 rubrics | MIT | yes, pinned commit + sha256, like jgabc; only the Latin Vespers sections we read |
| jsrjenkins/vesperale | **Cross-check** of the tone (ending) for each Sunday antiphon and the seasonal *Deus in adjutorium* / Benedicamus; a golden table for tests | none stated | **no**: facts checked against it, files not copied; ask the author (open question 3) |
| GregoBase | Chant notation and links for each antiphon, hymn and versicle | CC0 | as now (`data/chants.json`) |

Tones come from **NOH8's own margin labels** first (they are what the
organist plays). vesperale and GregoBase's mode confirm them. A disagreement
goes to the review queue; it is never silently resolved.

## Architecture

```
Divinum Officium (1960)   ─┐
  per-day Vespers sections  │  noh vespers-ordo  → data/vespers-ordo.json
  rank / occurrence rules  ─┘   {day: [items in sung order]}     (what is sung)

NOH8 / NOH7 scans ── noh catalog ── segment each office into ITEMS
                                     antiphon, psalm, hymn, versicle,
                                     magnificat-antiphon, magnificat, ...
                                     each with its tone label and systems
                                   → catalog.json  piece.items[]          (what is printed)

noh vespers-lineup  ordo × items × tone bank → data/vespers-lineup.json
                    {day: [{item, source: {piece, systems} | tone-bank | note,
                            chant: gregobase id | null}]}

web  /vespers/<day>/  (and the day page's Vespers section links to it)
```

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
- Show `/vespers/<day>/` for those Sundays only. The day page's Vespers
  section links to it; other days keep today's piece list.

**Release gate**: the 14th Sunday after Pentecost's lineup matches a hand
reading of the book, item for item. Every Magnificat antiphon among the 26
Sundays has a tone and a bank entry (or a review item).

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
- `vespers_ordo(day_key, calendar)` returns the sung order for II Vespers of
  that day (and I Vespers of the next day where 1960 gives it the evening). The
  day key is the site's own (`tempora:Pent14-0`); the mapping to Divinum
  Officium's file names is a small table plus rules, like `jgabc_key`.
- **Tests**: golden ordos for Pent14-0, Adv1-0, Christmas (II Vespers:
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

  vesperale's table is the test oracle for the Sundays it covers.
- `noh vespers-lineup` prints a coverage summary:
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
  and the GregoBase mode must agree, and a melody check decides between
  candidates: compare the first notes of the GABC with the NOH chant line's
  pitch contour from the slice. Where it can't decide, show no chant; never
  the wrong melody.
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

- **`/vespers/<day>/`** (static): the lineup in sung order.
  - Each item has an h2 heading, its systems (or its note), a separate "Chant"
    link, and the same chant-notation switch as Mass pages.
  - A jump-link nav ("Order of Vespers") lists the items, as `MovementNav`
    does for parts.
  - Tone-bank items say where the music comes from: "Magnificat in I g, as
    printed on p. 112".
- **Day page**: the Vespers section shows the lineup's summary (antiphons,
  hymn, Magnificat antiphon) and one link, "Full Vespers", instead of a list
  of whole pieces. Days without a lineup keep today's list.
- **Export**: the Vespers page's "Export" builds the PDF in sung order. It
  reuses `exportSegments` with item headings and the shared 300-system
  ceiling; notes print as a line of text.
- **Accessibility**: the headings are an outline; the tone is text, not only
  an image; the chant SVG keeps its aria-label; the nav is a `<nav>` with an
  accessible name.

### 8. Verify and ship

- Hand-check 3 Sundays (the green 14th, Advent I, Lent II) and 2 feasts
  (Christmas, the Assumption) item by item against the book. Record the
  results in the review file, as for parts (44 of 45 was the bar).
- Golden tests in `test_catalog_invariants.py` for those five days.
- Coverage floors: every Sunday of 2026-2027 has a lineup; at least 90% of
  its items come from printed music (own section or tone bank), not notes.
- Deploy with the usual checks: the asset base, 0 local fallbacks, the chant
  file count.

## Releases

1. **Green Sundays** (step 0, with steps 1-4 as far as they need): about 26
   Sundays a year.
2. **The seasons**: Advent, Septuagesima, Lent, Passiontide, Easter and its
   Sundays.
3. **Feasts and the Commons**: NOH8's feast sections, and the Commons for
   saints' days that have Vespers.
4. **NOH7 hymns, and Compline** (Compline is already printed in full,
   pp. 28-39).

## Risks

| Risk | Mitigation |
|---|---|
| OCR misreads tone labels (the key to the bank) | Three signals: NOH margin, GregoBase mode, vesperale's table; disagreement → review, no guess |
| 1942 vs 1962: NOH8 prints the suffrage, 1942 antiphons for later-revised feasts, abolished octaves | The ordo (DO 1960) decides what is sung; NOH is only the music; differences logged |
| A Sunday's Magnificat tone has no printed Magnificat in NOH8 | `tone_unprinted` review item; note on the page; count reported |
| Hymn melody ambiguity → wrong chant shown | No chant unless mode + melody agree (step 5) |
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

1. **I Vespers**: should a Sunday's page also show I Vespers (Saturday
   evening), or only II Vespers (Sunday evening)? Parishes usually sing Sunday
   evening.
2. **Commemorations**: show the commemoration of an occurring feast (1960: at
   most one at Sunday Vespers) as an item, or leave it out as a note?
3. **vesperale**: ask its author (jsrjenkins) for a licence so its
   hand-checked table could be vendored, not only used as a test oracle?
4. **Psalm verses**: for a psalm NOH8 prints only two verses of, is the
   printed opening plus "continue in this tone" enough, or do you want the full
   psalm text on the page as well?
