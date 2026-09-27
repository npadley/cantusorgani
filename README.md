# Cantus Organi

Organ accompaniments from **Nova Organi Harmonia** (Mechelen, 1942), catalogued
against the 1962 Roman calendar and published at
[cantusorgani.org](https://cantusorgani.org) for organists at the console.

- `pipeline/` — Python: page maps, system segmentation, index extraction, the
  catalogue (`data/catalog.json`), slicing and upload to R2.
- `web/` — the Astro site (static), with client-side PDF export.
- `workers/corrections/` — the Cloudflare Worker that takes corrections.
- `data/` — the reviewed indexes, calendar, catalogue and review queue (all
  tracked). Licensing: [`data/LICENSES.md`](data/LICENSES.md).
- `docs/claudekit/` — design, plans and their reviews.

## Pipeline

Python 3.12+ with [uv](https://docs.astral.sh/uv/), Tesseract with the Latin
pack.

```bash
uv sync
uv run noh doctor                      # preflight: every failure names its fix
uv run noh catalog --volume noh3       # rebuild one volume into data/catalog.json
uv run pytest
```

The source PDFs are not in git (`pdf-source/`, 230 MB); `noh doctor` says which
are missing.

## Site

```bash
cd web
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # static site in web/dist, with the Pagefind index
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

| **vesperale** Sunday table — each Sunday's Magnificat antiphon and tone from [jsrjenkins/vesperale](https://github.com/jsrjenkins/vesperale)'s `calendar.sty`, a cross-check on NOH8's own tone labels | `data/vesperale-lineup.json`, with the source commit and a content sha256 | yes | `uv run noh vesperale-fetch [--commit SHA]`; never hand-edit |

A reader can show the chant above each part of a Proper ("Show the chant with
each part", remembered in the browser; off by default), or follow the "Chant"
link to GregoBase. Licensing: `data/LICENSES.md`.

## Vespers

Each green Sunday (after Epiphany and after Pentecost) has a page, `/vespers/<date>/`,
with II Vespers in the order sung: *Deus in adjutorium*, five antiphons and psalms
(each antiphon again after its psalm), the chapter, *Lucis Creator*, the versicle,
the Magnificat antiphon and the Magnificat in its tone, the Benedicamus and the
Marian antiphon. The items are NOH8's own systems, reviewed by hand in
`data/vespers-noh8.yml`; the site's 1962 calendar decides which Sunday a date keeps.

NOH8 prints the Magnificat itself only in VIII G. For other tones the psalm formula
in the same tone and ending is used (the tone bank in `data/vespers-noh8.yml`); a
Sunday whose Magnificat tone NOH8 does not print at all is held back, not guessed.

Rebuild, after `noh catalog` or a change to the reviewed items:

```bash
uv run noh vesperale-fetch        # only to move to a newer vesperale commit
uv run noh vespers-lineup         # data/vespers-lineup.json, with a coverage summary
uv run noh chants                 # picks up the lineup's chants
```

Check one Sunday against the book without building the site:

```bash
uv run noh vespers-lineup --day 2026-11-08
```

`uv run noh vespers-items` proposes Magnificat antiphons and their tones from the
headings and a wide margin crop (`data/vespers-noh8.proposed.yml`), for review.

What the lineup's review entries mean:

| Kind | Meaning | To clear it |
|---|---|---|
| `tone_unprinted` | A Sunday's Magnificat tone is printed nowhere in NOH8; the Sunday has no page | Add a `tone_bank` entry from a printed accompaniment in that exact tone and ending, or leave it held back |
| `tone_disagreement` | NOH8's margin and vesperale's table give different tones; NOH8's is used | Confirm against the scan (all four current ones are confirmed: NOH8 is right) |
| `vesperale_unavailable` | The vendored vesperale table is missing or edited | `uv run noh vesperale-fetch` |
