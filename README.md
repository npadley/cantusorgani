# Cantus Organi

Organ accompaniments from **Nova Organi Harmonia** (Mechelen, 1942), catalogued
against the 1962 Roman calendar and published at
[cantusorgani.org](https://cantusorgani.org) for organists at the console.

- `pipeline/` — Python: page maps, system segmentation, index extraction, the
  catalogue (`data/catalog.base.json`, and `data/catalog.json` with the hand
  corrections of `data/corrections.yml` applied), slicing and upload to R2.
- `web/` — the Astro site (static), with client-side PDF export.
- `workers/corrections/` — the Cloudflare Worker that takes readers' corrections,
  and the database migrations the admin screen shares.
- `web/functions/` — the admin screen's API (Pages Functions; the code is in
  `web/src/lib/admin/`).
- `data/` — the reviewed indexes, calendar, catalogue and review queue (all
  tracked). Licensing: [`data/LICENSES.md`](data/LICENSES.md).
- `docs/claudekit/` — design, plans and their reviews.

How the pieces fit together: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**To fix something on the site, start with [`docs/EDITING.md`](docs/EDITING.md)**:
recipes by symptom, most of which need no PDFs. Editors use the admin screen at
`/admin/` ([setup](docs/ADMIN-SETUP.md)).

## Pipeline

Python 3.12+ with [uv](https://docs.astral.sh/uv/), Tesseract with the Latin
pack.

```bash
uv sync
uv run noh doctor                      # preflight: every failure names its fix
uv run noh catalog --volume noh3       # rebuild one volume (data/catalog.base.json), then apply
                                       # data/corrections.yml into data/catalog.json
uv run noh apply-corrections           # only the corrections: no PDFs needed
uv run pytest
```

The source PDFs are not in git (`pdf-source/`, 230 MB); `noh doctor` says which
are missing.

## Site

```bash
cd web
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # static site in web/dist, with the Pagefind index; fails if a page
                  # cannot be reached by a link (scripts/check-links.ts)
pnpm test
```

## Secrets

Secrets live in 1Password, in the "Cantus Organi" Environment, mounted as
`web/.env` (the site's `PUBLIC_` settings) and `.dev.vars` (the pipeline's R2
keys). Neither file is tracked. The mounts are named pipes, which Vite does not
read, so `pnpm dev` and `pnpm build` go through `web/scripts/with-public-env.ts`,
which passes Astro the `PUBLIC_` variables only. The pipeline reads `.dev.vars`
through the environment: `set -a; . ./.dev.vars; set +a`.

## Vendored data

Data and code from elsewhere, each pinned to its source:

| Data | Where | Tracked | Refresh |
|---|---|---|---|
| **jgabc** per-day chant ids — which parts each Proper has, and the GregoBase id of each ([bbloomf/jgabc](https://github.com/bbloomf/jgabc), Unlicense) | `data/jgabc-propers.json`, with the source commit and a content sha256 in its header | yes | `uv run noh jgabc-fetch [--commit SHA]`; never hand-edit |
| **GregoBase** dump — chant texts and notation (CC0) | `vendor/gregobase_online.sql` | no (17 MB) | download `gregobase_online.sql` from [gregorio-project/GregoBase](https://github.com/gregorio-project/GregoBase) and check its sha256 against `DUMP_SHA256` in `pipeline/gregobase.py` |
| **Chant notation** the site publishes — the GABC of every chant a Proper part names, leaving out those GregoBase flags copyrighted | `data/chants.json` | yes | `uv run noh chants` (after `noh catalog`) |
| **Exsurge** — draws the notation in the browser ([bbloomf/exsurge](https://github.com/bbloomf/exsurge), MIT) | `web/public/vendor/exsurge/`, with its licence and source commit | yes | replace `exsurge.min.js` from a newer commit and update `SOURCE` |

| **Divinum Officium** Vespers texts (1960) — each office's antiphons with their psalms, Magnificat antiphons, hymn, chapter, and the psalms' verses ([DivinumOfficium/divinum-officium](https://github.com/DivinumOfficium/divinum-officium), MIT) | `data/divinum-officium-vespers.json`, with the source commit and a content sha256 | yes | `uv run noh officium-fetch [--commit SHA]`; never hand-edit |
| **vesperale** Sunday table — each Sunday's Magnificat antiphon and tone from [jsrjenkins/vesperale](https://github.com/jsrjenkins/vesperale)'s `calendar.sty`, a cross-check on NOH8's own tone labels | `data/vesperale-lineup.json`, with the source commit and a content sha256 | yes | `uv run noh vesperale-fetch [--commit SHA]`; never hand-edit |

A reader can show the chant above each part of a Proper ("Show the chant with
each part", remembered in the browser; off by default), or follow the "Chant"
link to GregoBase. Licensing: `data/LICENSES.md`.

## Vespers

Every Sunday, and every feast NOH8 prints, has its Vespers in the order sung at
`/vespers/<date>/` (II Vespers; on 24 December, I Vespers of Christmas), and each I
class feast its I Vespers, sung the evening before, at `/vespers/<date>/i/`:
*Deus in adjutorium* (with *Laus tibi* from Septuagesima), the five antiphons each
before and after its psalm (one Alleluia antiphon in Paschaltide), the chapter's
response (*Haec dies* in the Easter octave), the hymn and versicle, the Magnificat
antiphon (the O antiphons from 17 December), the Magnificat, the Benedicamus and the
Marian antiphon of the season. The site publishes a rolling window: last year and
five ahead.

- **What is sung** comes from Divinum Officium (1960), vendored in
  `data/divinum-officium-vespers.json`; the site's 1962 calendar decides the office.
- **The music** is NOH8's own systems: the Sunday psalter, Marian antiphons, tone bank
  and seasons in `data/vespers-noh8.yml`, every other office in
  `data/vespers-offices.yml` (both reviewed by hand; every tone read from the page).
- **Psalms**: played from the full psalm where NOH8 prints it in that tone, else from a
  printed formula in the same tone and ending (labelled, with the psalm's text below);
  a tone NOH8 never prints is said so on the page, never guessed.
- NOH8 prints the Magnificat only in VIII G and VIII G*; other tones use the psalm
  formula in the same tone, or a note.

Rebuild, after `noh catalog` or a change to the reviewed items:

```bash
uv run noh officium-fetch         # only to move to a newer Divinum Officium commit
uv run noh vesperale-fetch        # only to move to a newer vesperale commit
uv run noh vespers-lineup         # data/vespers-lineup.json, with a coverage summary
uv run noh chants                 # picks up the lineup's chants
```

Check one day against the book without building the site:

```bash
uv run noh vespers-lineup --day 2026-12-25
```

`uv run noh vespers-items` proposes placements for review: the green Sundays'
Magnificat antiphons (`data/vespers-noh8.proposed.yml`) and every other office's
antiphons, Magnificat, hymn and versicle aligned to Divinum Officium's texts
(`data/vespers-offices.proposed.yml`, each placement with a score).

What the lineup's review entries mean:

| Kind | Meaning | To clear it |
|---|---|---|
| `tone_unprinted` | Magnificat tones NOH8 prints no accompaniment for; the page shows a note | Add a `psalm_formulas` or `magnificats` entry from a printed accompaniment in that exact tone and ending |
| `office_unprinted` | A Sunday whose office NOH8 has no section for (the Transfiguration, the Holy Cross, St Michael, St Joseph the Worker) | Nothing, unless another volume prints it |
| `tone_disagreement` | NOH8's margin and vesperale's table give different tones; NOH8's is used | Confirm against the scan (all four current ones are confirmed: NOH8 is right) |
| `vesperale_unavailable` | The vendored vesperale table is missing or edited | `uv run noh vesperale-fetch` |
