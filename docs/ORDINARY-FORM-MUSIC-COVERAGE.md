# Ordinary Form music coverage

This document records the current, generated mapping coverage and the limits of the source review. The counts below come from [`data/ordinary-form-coverage.json`](../data/ordinary-form-coverage.json) and [`data/ordinary-form-propers.json`](../data/ordinary-form-propers.json); regenerate them with `uv run noh ordinary-form` after the final catalogue overlay. The pinned input is [`data/jgabc-novus-propers.json`](../data/jgabc-novus-propers.json), fetched at commit `3bf01d3c3248fe11ee17a53c8df70e364dc2e89e` to match the existing Extraordinary Form source revision.

## Current coverage

The generated assignments contain **994 rows; 929 have an eligible Nova Organi Harmonia lender and 65 do not**. These are assignment rows after cycle merging, not separate counts per A/B/C year. Sundays, solemnities and feasts account for 482 rows (445 matched, 37 unmatched, listed under [Unmatched assignment rows](#unmatched-assignment-rows)); the seasonal weekdays, the Christmas-octave feasts and the Second Sunday after Christmas added on 2026-10-19 account for 512 rows (484 matched, 28 unmatched, listed under [Seasonal weekdays](#seasonal-weekdays)). Every unmatched row links to its exact GregoBase chant ID; no chant was selected by incipit similarity.

The report lists **48 distinct unresolved GregoBase URLs** for the unmatched rows. Several rows share a chant ID, which is why this count is lower than 65. It separately lists **96 distinct URLs with at least one rejected catalogue candidate**. A rejected candidate failed exportability checks; another eligible section may still resolve the assignment. These candidates do not add to the unmatched-row count.

## Occasions without any assignment source

These three stable occasions have no jgabc proper and no reviewed assignment override, so they remain wholly unmapped:

| Stable key | Occasion | Printed source reference located | Status |
| --- | --- | --- | --- |
| `st-joseph` | Saint Joseph | *Graduale Romanum* (1974), pp. 552–553 | No reviewed IDs or override rows |
| `sacred-heart` | The Most Sacred Heart of Jesus | *Graduale Romanum* (1974), pp. 384–387 | No reviewed IDs or override rows |
| `lateran-dedication` | Dedication of the Lateran Basilica | *Graduale Romanum* (1974), p. 621 | No reviewed IDs or override rows |

These references were located for future editorial mapping; location alone does not verify GregoBase IDs or authorize an accompaniment. The Second Sunday after Christmas is now mapped from GR1974 pp. 53–55 (its chants also serve the weekdays before Epiphany). These gaps are supported outcomes, not invented assignments.

The reviewed Christmas Vigil and Christmas Dawn overrides are present separately in [`data/ordinary-form/overrides.yml`](../data/ordinary-form/overrides.yml): five chants each. Their source references are GR1974 pp. 38–41 and pp. 44–47 respectively. They are not among the unmapped occasions.

## Unmatched assignment rows

Each entry below has a source assignment but no eligible printed lender in the current catalogue. The season column says `all seasons` when the source assignment has no seasonal restriction. A semantic chant kind, when present, appears in parentheses after the source slot.

| Occasion | Source slot | Year / season scope | GregoBase assignment |
| --- | --- | --- | --- |
| `ascension` | `offertorium` | A, B, C; all seasons | [3315 — Viri Galilaei](https://gregobase.selapa.net/chant.php?id=3315) |
| `ascension` | `communio` | A; all seasons | [1260 — Data est mihi](https://gregobase.selapa.net/chant.php?id=1260) |
| `ascension` | `communio` | B; all seasons | [608 — Signa eos](https://gregobase.selapa.net/chant.php?id=608) |
| `ash-wednesday` | `offertorium` | A, B, C; all seasons | [648 — Exaltabo te](https://gregobase.selapa.net/chant.php?id=648) |
| `assumption` | `introitus` | A, B, C; all seasons | [3312 — Gaudeamus... Mariae... assumptione](https://gregobase.selapa.net/chant.php?id=3312) |
| `assumption` | `offertorium` | A, B, C; all seasons | [3317 — Assumpta est Maria](https://gregobase.selapa.net/chant.php?id=3317) |
| `baptism` | `graduale` | A, B, C; all seasons | [553 — Benedictus Dominus Deus](https://gregobase.selapa.net/chant.php?id=553) |
| `baptism` | `alleluia` | A, B, C; all seasons | [866 — Benedictus qui venit](https://gregobase.selapa.net/chant.php?id=866) |
| `corpus-christi` | `sequentia` | A, B, C; all seasons | [308 — Lauda, Sion](https://gregobase.selapa.net/chant.php?id=308) |
| `all-souls` | `tractus` | A, B, C; all seasons | [338 — Absolve, Domine](https://gregobase.selapa.net/chant.php?id=338) |
| `exaltation-cross` | `offertorium` | A, B, C; all seasons | [195 — Protege, Domine](https://gregobase.selapa.net/chant.php?id=195) |
| `exaltation-cross` | `communio` | A, B, C; all seasons | [346 — Per signum Crucis](https://gregobase.selapa.net/chant.php?id=346) |
| `ot-5` | `alleluia` | A, B, C; all seasons | [8297 — Laudate Dominum](https://gregobase.selapa.net/chant.php?id=8297) |
| `ot-5` | `communio` | B; all seasons | [1267 — Multitudo languentium](https://gregobase.selapa.net/chant.php?id=1267) |
| `easter-5` | `communio` | B, C; all seasons | [3314 — Ego sum vitis](https://gregobase.selapa.net/chant.php?id=3314) |
| `holy-family` | `communio` | B, C; all seasons | [705 — Fili, quid fecisti](https://gregobase.selapa.net/chant.php?id=705) |
| `immaculate-conception` | `introitus` | A, B, C; all seasons | [655 — Gaudens gaudebo](https://gregobase.selapa.net/chant.php?id=655) |
| `holy-thursday` | `offertorium` | A, B, C; all seasons | [3313 — Ubi caritas est vera](https://gregobase.selapa.net/chant.php?id=3313) |
| `trinity` | `communio` | B; all seasons | [1260 — Data est mihi](https://gregobase.selapa.net/chant.php?id=1260) |
| `pentecost-vigil` | `graduale (alleluia)` | A, B, C; all seasons | [8041 — Emitte Spiritum tuum](https://gregobase.selapa.net/chant.php?id=8041) |
| `pentecost-vigil` | `offertorium` | A, B, C; all seasons | [1176 — Emitte Spiritum Tuum](https://gregobase.selapa.net/chant.php?id=1176) |
| `peter-paul` | `communio` | A, B, C; all seasons | [666 — Tu es Petrus](https://gregobase.selapa.net/chant.php?id=666) |
| `ot-2` | `communio` | B; all seasons | [1021 — Dicit Andreas](https://gregobase.selapa.net/chant.php?id=1021) |
| `ot-17` | `offertorium` | A, B, C; all seasons | [648 — Exaltabo te](https://gregobase.selapa.net/chant.php?id=648) |
| `ot-17` | `communio` | C; all seasons | [364 — Petite (cum Alleluia)](https://gregobase.selapa.net/chant.php?id=364) |
| `ot-7` | `introitus` | A, B, C; all seasons | [146 — Domine, in tua misericordia](https://gregobase.selapa.net/chant.php?id=146) |
| `ot-7` | `graduale` | A, B, C; all seasons | [399 — Ego dixi: Domine](https://gregobase.selapa.net/chant.php?id=399) |
| `ot-7` | `alleluia` | A, B, C; all seasons | [103 — Verba mea](https://gregobase.selapa.net/chant.php?id=103) |
| `ot-7` | `communio` | A, B, C; all seasons | [639 — Narrabo omnia](https://gregobase.selapa.net/chant.php?id=639) |
| `easter-7` | `offertorium` | A, B, C; all seasons | [3315 — Viri Galilaei](https://gregobase.selapa.net/chant.php?id=3315) |
| `ot-16` | `communio` | A, B; all seasons | [1221 — Acceptabis](https://gregobase.selapa.net/chant.php?id=1221) |
| `ot-16` | `communio` | C; all seasons | [3316 — Optimam partem](https://gregobase.selapa.net/chant.php?id=3316) |
| `ot-3` | `introitus` | A, B; all seasons | [693 — Dominus secus mare](https://gregobase.selapa.net/chant.php?id=693) |
| `ot-30` | `offertorium` | A, B, C; all seasons | [109 — Domine, vivifica me](https://gregobase.selapa.net/chant.php?id=109) |
| `ot-21` | `communio` | A, B, C; all seasons | [1245 — De fructu](https://gregobase.selapa.net/chant.php?id=1245) |
| `ot-24` | `alleluia` | A, B, C; all seasons | [1097 — Timebunt gentes](https://gregobase.selapa.net/chant.php?id=1097) |
| `ot-29` | `alleluia` | A, B, C; all seasons | [3318 — Lauda, anima mea](https://gregobase.selapa.net/chant.php?id=3318) |

## Seasonal weekdays

The weekdays of Advent, Christmas, Lent and Easter follow the printed *Graduale Romanum* (1974), transcribed from the CMAA scan on 2026-10-19 ([plan and season mapping](superpowers/plans/2026-10-19-of-seasonal-weekdays.md)). Each weekday resolves in one of three ways:

- **Own Mass:** 17–24 December (by weekday; 24 December takes that weekday's Mass in the morning), Ash Thursday–Saturday, every Lent weekday, Holy Monday–Wednesday, the Easter Octave and Easter week 7, plus the Christmas-season weekday Masses. Christmas-season weekdays list both printed options per slot (e.g. Christmas at Dawn or during the Day).
- **The Sunday's Mass with printed substitutions** (`weekday_of` in `occasions.yml`): Advent weeks 1–3 and Easter weeks 2–6, where the book prints "Feria N: …" under the chant it replaces. Sunday-only choices printed as "Dom. anno …" are not carried to weekdays; a weekday that genuinely inherits a cycle-dependent Sunday chant says so in `inherit_cycle_slots`.
- **The Sunday's chants repeated:** weekdays of Advent weeks 1–3 with no printed substitution, and (where the Ascension is kept on Sunday) Saturday of Easter week 6 and Monday of week 7, which the book assigns to the Mass of the Sixth and Seventh Sundays of Easter.

Holy Saturday shows that no Mass is celebrated during the day, with the Easter Vigil link. St Stephen, St John and the Holy Innocents are added as feasts on 26–28 December from the GR1974 sanctorale (pp. 632–639).

Editorial decisions recorded in the data (`rubric_en`):

- 17–23 December: the Alleluia is *ad libitum* from the season (p. 24), so the slot is left empty with that rubric. 19 and 20 December link their optional "chants suited to the readings" (p. 34).
- Easter Octave: the Sequence may be added when the Alleluia is sung (p. 202); Victimae paschali is listed.
- Easter week 2, Wednesday–Saturday: "the Communion antiphons of the Easter Octave may be resumed *ad libitum*" (p. 219). The Sunday's Mitte manum is listed and the rubric is shown; the octave communions are not listed as alternatives.
- Lent 5 Monday: Nemo te condemnavit with the Gospel of the woman taken in adultery (Years A/B), otherwise Panis quem ego dedero (Year C), following the Lectionary default (p. 126).
- Advent weeks 1–3 weekdays that repeat the Sunday link the Sunday page, so in Year B the Third Sunday link also shows its Sunday-only Gradual Fuit homo.
- Where GregoBase holds several transcriptions of one chant, the canonical Solesmes transcription already used by the Sunday data and jgabc's 1962 assignments is chosen; a GR1974-only transcription is used only when nothing else exists (e.g. Voce mea, 8285; Memento nostri, 165). The *Alleluia Confitemini … quoniam bonus* after the Ascension (p. 239) matches the 1908 Rogation melody (1535), not the Easter Vigil Alleluia.

### Weekday slots without a lender


## Matching and ownership rules

The source of truth for Ordinary Form assignments is the pinned jgabc source plus the reviewed corrections in `overrides.yml`. GR1974 is the source for checked chant assignments and corrections; the CMAA six-page proper summary is a locating and corroboration aid, not a substitute where it differs from the book. A source assignment borrows only from a catalogue section with the exact GregoBase ID. The candidate must be a printed, exportable section (`placed` is not `order`), its reference must occur at its declared index in the piece's systems, and it must have a nonempty range from its first system to the next printed-section boundary or the end of the piece.

Candidate ranking prefers a matching semantic chant kind, then an explicitly reviewed owned-day relationship when present, then natural NOH volume order and printed page, followed by stable slug/reference tie-breaks. Cross-kind matches are retained only when no better candidate outranks them and are reported separately. Seasonal availability (`seasons`), semantic kind (`kind`), and A/B/C years remain part of assignment and mapping identity. Mapping identity also records the actual lender export-range start and end; moving a section boundary changes that identity.

The [`data/ordinary-form/coverage-baseline.json`](../data/ordinary-form/coverage-baseline.json) file is a separately reviewed ratchet. It pins the minimum matched/total counts and assignment and lender/range identities. Generation never edits it. Review the generated diff and source evidence before advancing it; `uv run noh ordinary-form --check` verifies counts, identities and committed generated bytes without writing. `scripts/regenerate.sh` generates Ordinary Form data after the final catalogue overlay, while `scripts/check.sh` and the site workflow run the freshness check. The catalogue rebuild, publish and corrections-batch workflows regenerate both Ordinary Form JSON artifacts; corrections-batch stages those two artifacts explicitly and does not stage the baseline automatically.

## Scope of source review

The source-review report records comparison of **60 cycle-sensitive slot maps across 40 upstream occasions**. [`data/ordinary-form/occasions.yml`](../data/ordinary-form/occasions.yml) records those as `source_reviews` with reviewer, date, evidence path, citation and the exact reviewed `cycle_sensitive_slots`. [`data/ordinary-form/review-manifest.yml`](../data/ordinary-form/review-manifest.yml) pins the expected 40/60 scope, and the pipeline checks the declarations against the actual pinned year maps. These are partial slot-level reviews; each occasion's `reviewed: false` remains accurate because the occasion's complete assignment set has not been reviewed.

The scan review added the Lent 3 Introit alternative **Dum sanctificatus** (ID 418; GR1974 p. 96, with the alternate printed on p. 249) and corrected the normal Sunday-cycle Communion to **Qui biberit** (ID 894) in Year A and **Passer invenit** (ID 1090) in Years B/C (p. 99; the latter chant is on p. 306). GR1974 p. 553 also establishes Annunciation's Paschal-time sequence: Ave Maria (ID 1209) and Virga Jesse (ID 281) are consecutive Alleluias, with the first occupying the upstream Gradual slot; the Lenten Gradual and Tract remain season-limited.

The scan prints another Qui biberit melody for Lent 3, but its independent GregoBase identity was not established. It is not represented as a verified accompaniment. Other remaining source questions and table/book discrepancies are recorded in the [source-review report](superpowers/reviews/2026-10-11-ordinary-form-source-review.md). No additional mappings or reviewer identities are inferred here.
