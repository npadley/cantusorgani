# Ordinary Form seasonal weekdays

Status: SHIPPED · see docs/design/README.md

**Goal:** every weekday of Advent, Christmas, Lent and Easter on the OF calendar
resolves either to its own chant set (with NOH lenders where they exist) or to
the preceding Sunday, as the *Graduale Romanum* (1974) directs. Ordinary Time
weekdays already link the preceding Sunday and are unchanged.

**Source:** the printed GR1974 (CMAA scan; PDF page = printed page − 1). Its
Proper of Time is laid out week by week. For Advent and Easter weeks it prints
the Sunday Mass once and lists weekday exceptions beneath the chant they
replace (“Feria 6 : Dóminus illuminátio mea, 288”), which is the *Ordo Cantus
Missae* rule that the Sunday's chants serve the week except where a weekday
number is marked. Lent, Holy Week, the Easter Octave and 17–24 December have
their own printed Masses.

Audit baseline (29 Nov 2026 – 27 Nov 2027): 108 uncovered weekdays —
Advent 21, Christmas 11, Lent 35, Easter 40, Triduum 1.

## Season-by-season source mapping

| Season / days | GR1974 | What the book says | How it is entered |
|---|---|---|---|
| Advent weeks 1–3, before 17 Dec | pp. 15–24 | Sunday Mass serves the week; weekday exceptions (e.g. wk 1: Wed CO *Manducaverunt* 278, Thu GR *Bonum est confidere* 324, Fri IN *Dominus illuminatio* 288; wk 3 Wed/Fri only “if before 17 Dec”) | Days with an exception get a weekday occasion = Sunday's chants + the printed substitution(s). Days with none link the preceding Sunday. Sunday-only notes (e.g. Advent 3 “Dom. anno B: Fuit homo”) are not carried to weekdays. |
| 17–23 Dec | pp. 24–34 | Own Mass for each weekday, Feria II … Sabbato (by weekday, not date); Alleluia *ad libitum de Tempore*; special interlectional chants for 19 and 20 Dec | Six weekday occasions (`advent-late-monday` …); 19/20 Dec get date occasions carrying their chants. Alleluia left as an empty slot with the rubric, not invented. |
| 24 Dec (morning) | p. 37 | *Die 24 decembris, ad Missam matutinam* | One date occasion; the evening Vigil link stays. |
| Christmas octave weekdays (29–31 Dec) | p. 52–53 | As Christmas at Dawn (44) or Day (47), except AL *Multifarie* (52); 29 Dec CO *Responsum* 544 | One octave-weekday occasion listing Dawn and Day chants as alternatives per slot + 29 Dec variant. |
| 26–28 Dec | Sanctorale | St Stephen, St John, Holy Innocents are feasts that always take these dates | **Question 1** below. |
| Weekdays 2 Jan – Epiphany | p. 55 | As 2nd Sunday after Christmas or Christmas Day; 4 Jan CO *Dicit Andreas* 263 | Occasion with both sets as alternatives; 4 Jan variant. Needs `second-christmas` filled from pp. 53–55 (currently unmapped). |
| Weekdays after Epiphany – Baptism | p. 59 | As Epiphany or Christmas at Dawn; 7 Jan (only where Epiphany is on Sunday 8 Jan) CO *Implete hydrias* 263; 8 Jan or Tuesday after Epiphany CO *Manducaverunt* 278 | Same pattern, settings-aware. |
| Ash Wed – Sat | pp. 62–70 | Own Masses (Thu, Fri, Sat) | One occasion each. |
| Lent weeks 1–5, Mon–Sat | pp. 71–136 | Own Mass every day (mix of printed chants and cross-references) | 30 occasions (`lent-1-monday` …). |
| Holy Week Mon–Wed | pp. 150–157 | Own Masses | 3 occasions. |
| Holy Saturday | — | No Mass during the day | Show “no Mass during the day” with the existing Easter Vigil link. |
| Easter Octave Mon–Sat | pp. 200–215 | Own Masses | 6 occasions. |
| Easter weeks 2–7 | pp. 216–247 | Sunday serves the week with weekday exceptions; wk 6 has Thursday (Ascension on Sunday), Friday/Saturday after Thursday Ascension | As Advent weeks 1–3, settings-aware for the Ascension transfer. |

## Data model

- `occasions.yml`: new weekday rows (`jgabc: null`), with `weekday_of: <sunday
  key>` where the book says “the Sunday's Mass, except”. The pipeline copies
  the base occasion's resolved slots, then applies the weekday's own reviewed
  `overrides.yml` rows. All other weekday chants are `overrides.yml` rows with
  GR page citations, like `christmas-vigil` today.
- `web/src/lib/ordinaryForm.ts`: `ofDay()` gains `weekdayOccasion` (own or
  excepted Mass) and sets `precedingSundayOccasion` for seasonal weekdays with
  no exception. The day→key table lives in TS; a test asserts it matches the
  occasion keys in `occasions.yml`.
- The calendar client renders `weekdayOccasion` like any occasion and otherwise
  the existing preceding-Sunday rubric. “weekday chants are not yet covered”
  disappears.

## GregoBase ID verification

No incipit-similarity matching. Each ID must match the printed chant's incipit,
chant role and mode; where GregoBase has several versions, the ID is the one
GregoBase tags with that GR1974/GR1961 page, or the one jgabc's 1962 data uses
for the same chant, confirmed by comparing the opening against the page image.
Unresolved IDs stay out and are listed as gaps.

## Steps

1. Pipeline + schema: `weekday_of`, weekday rows, tests. (TDD)
2. Data entry by season: Advent → Christmas → Lent → Easter, with page notes.
3. `ofDay()` weekday table, calendar client, tests.
4. `uv run noh ordinary-form`, coverage baseline advance, docs
   (coverage doc gaps, design spec scope).
5. Extended year audit: every weekday resolves to a set or the preceding
   Sunday; `uv run pytest tests/` and `npx vitest run` pass. Commit.

## Decisions (user, 2026-10-19)

- Season mapping approved as above.
- 26–28 Dec: add St Stephen, St John and the Holy Innocents as feasts from the
  GR1974 sanctorale.
- “As X or as Y” Christmas weekdays: both sets listed as alternatives per slot.
- 17–23 Dec Alleluia: empty slot with the *ad libitum* rubric.

## Outcome (2026-10-19)

Implemented as planned. 107 occasions (103 weekday Masses, three
Christmas-octave feasts and the Second Sunday after Christmas) add 512
assignment rows, 484 with an NOH lender. Two refinements from reading the book:
24 December takes that weekday's 17–23 December Mass (p. 37) rather than a
separate set, and almost every Easter weekday carries a printed substitution,
so nearly all of them are weekday Masses rather than Sunday links. The audit of
29 Nov 2026 – 27 Nov 2027 resolves every seasonal weekday under both transfer
presets; `web/src/lib/ordinaryForm.test.ts` checks the same for 2024–2050 under
all eight settings.
