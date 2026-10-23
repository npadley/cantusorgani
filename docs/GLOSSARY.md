# Glossary

Terms an agent tends to confuse in this repository. Alphabetical. Paths are
from the repository root.

**Batch.** A group of corrections published together as one pull request on a
branch named `corrections/<batch>`. Most merge themselves when checks pass; one
that moves systems between pieces, or has 25 or more non-review changes, waits
for the maintainer (`docs/OPERATIONS.md`). Also the id in `noh correct-batch`.

**Catalogue (base vs overlay).** `data/catalog.base.json` is what `noh catalog`
builds from the scans. `data/catalog.json` is the base with `data/corrections.yml`
applied on top. Never hand-edit either.

**Commune, Commons.** Texts and music shared by a class of saints (Martyrs,
Confessors, Virgins, Our Lady…), used when a feast has no Proper of its own.
NOH4 prints them.

**Correction.** One entry in `data/corrections.yml`: a hand fix or a review
confirmation, with the value it replaced (`was`). Rebuilds keep it.

**Customize export.** The in-browser editor that reflows approved typeset
music (MEI through Verovio) to a chosen page size, music size and systems per
page, then writes a PDF. Separate from Quick export. See `docs/TYPESETTING.md`.

**Divinum Officium.** The open-source Breviary project. Its 1960 Vespers texts
are vendored in `data/vespers/divinum-officium-vespers.json` and decide what is
sung; NOH8 supplies the music.

**EF / OF.** Extraordinary Form (the 1962 Roman calendar, the default) and
Ordinary Form (the 1970 calendar with the 1974 *Graduale Romanum*). The site
has a calendar for each. OF scope is in `docs/DECISIONS.md` (P6).

**GABC.** The plain-text notation for Gregorian chant used by GregoBase and
drawn in the browser by Exsurge.

**GregoBase.** The chant database that supplies GABC transcriptions (CC0). A
catalogue piece's `chant` field is a list (possibly empty) of chant pairings,
each naming a GregoBase id.

**Gradual, Introit, Alleluia, Offertory, Communion.** The sung Proper parts of
a Mass (Tract or Sequence in some seasons). See *Proper*.

**jgabc.** [bbloomf/jgabc](https://github.com/bbloomf/jgabc), the source of
`data/jgabc-propers.json` and `jgabc-novus-propers.json`: per day, which parts a
Proper has and each part's GregoBase id.

**Kyriale.** The Ordinary of the Mass (Kyrie, Gloria, Sanctus, Agnus Dei, Ite)
in its numbered settings (Missa IX…). NOH5.

**Lender (OF).** An NOH piece "borrowed" to serve an Ordinary Form chant: its
section must set the same GregoBase chant id (`pipeline/ordinary_form.py`);
matching text alone is not enough. OF pages are synthetic and borrowed-only; "lender" counts are
in `docs/ORDINARY-FORM-MUSIC-COVERAGE.md`.

**LilyPond.** The engraving language of the volunteers' transcriptions in
`data/typeset/src/`. Master source; MEI is derived from it (`docs/DECISIONS.md`
P5).

**Magnificat tone.** The psalm tone (1–8, with endings) in which the Magnificat
is sung at Vespers, set by the day's Magnificat antiphon. Held in
`data/vespers/vespers-noh8.yml` (`magnificat_antiphons`, tone bank).

**MEI.** Music Encoding Initiative XML. The derived form of each approved
LilyPond score, which Verovio reflows. Approval records and the manifest are in
`data/typeset/mei/`; the scores themselves are published to R2 at
`mei/<sha256>/score.mei`.

**NOH.** *Nova Organi Harmonia* (Mechelen, 1942), the organ accompaniment books
this site publishes. Volumes (`data/volumes.yml`): **noh1** Part I, Proprium de
Tempore, Advent to Holy Saturday; **noh2** Part II, Proprium de Tempore, Easter
to the last Sunday after Pentecost; **noh3** Part III, Proprium Sanctorum;
**noh4** Part IV, Commune Sanctorum, votive Masses and local feasts; **noh5**
Part V, Kyriale; **noh7** Part VII, Varia (hymns, sequences, antiphons and
responsories, litanies, psalms); **noh8** Part VIII, Vesperale. (There is no
noh6.)

**Ordinary.** The unchanging parts of the Mass (Kyriale). Contrast *Proper*.

**Page map.** The mapping from PDF page to printed folio for a volume, derived
by `noh offset` into `data/derived-offsets.json`; hints and fixes are in
`data/volumes.yml`.

**Polarity.** The reader's switch between normal and inverted (light-on-dark)
scan images, kept in `localStorage` as `scan-polarity`. Must stay.

**Proper (parts).** The texts and music that change by day: Introit, Gradual,
Alleluia or Tract, Offertory, Communion. A *Proper part* is one of these within
a piece; `data/sections/*.yml` says where each starts.

**Review queue.** `data/review-queue.json`: items `noh catalog` was unsure of,
worked through in the admin screen or by `noh correct-batch`.

**Rubric.** A printed liturgical instruction (traditionally red). In the data, a
piece that prints only a rubric (for example "resumitur Missa Feriae
praecedentis") borrows another day's music; see `data/rubrics-1962.yml`. On the
site, rubric characters in chant stay red.

**Slicing.** Cutting a scanned page into one image per system. Done by
`pipeline/`; images upload to R2 through the `publish` workflow.

**System.** One line of music (usually voice staff plus organ staves) on a
printed page. Referenced as `noh<N>/<PDF page>/<n>`; counted from 1 in words,
from 0 in the ref.

**Tempora / Sancti.** The two cycles of the 1962 calendar: *Tempora*, the
Proper of Time (keys like `tempora:Adv1-0`) and *Sancti*, the Proper of Saints
(fixed dates). A feast's key says which.

**Typeset.** Music engraved from LilyPond in place of the scan. Listed in
`data/typeset/manifest.json`. Contrast *scan*.

**Verovio.** The music engraving library, built to WebAssembly, that renders
MEI in the browser for Customize export.

**Vespers I / II.** First Vespers (the evening before a Sunday or feast) and
Second Vespers (the evening of the day). The calendar must resolve a date to
the actual evening office, including tomorrow's First Vespers.

**Vesperale.** Either NOH8 itself, or the third-party
[jsrjenkins/vesperale](https://github.com/jsrjenkins/vesperale) Sunday table
vendored as `data/vespers/vesperale-lineup.json`, used only to cross-check NOH8's
tone labels.
