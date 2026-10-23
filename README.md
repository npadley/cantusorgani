# Cantus Organi

Organ accompaniments from **Nova Organi Harmonia** (Mechelen, 1942), catalogued
against the 1962 Roman and Ordinary Form calendars and published at
[cantusorgani.org](https://cantusorgani.org) for organists at the console.

Design docs, decisions, specs and manuals live in the private repo
`npadley/cantusorgani-docs`, cloned next to this one:
`git clone git@github.com:npadley/cantusorgani-docs.git ../cantusorgani-docs`.

## Commands

Python 3.12+ with uv; catalogue extraction also needs Tesseract with Latin.

```bash
uv sync
uv run noh doctor
uv run noh catalog --volume noh3
uv run noh apply-corrections
scripts/regenerate.sh [noh1 …]
scripts/check.sh [--quick]
uv run pytest -q -m "not slow"
```

```bash
cd web
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm test:e2e
pnpm build:e2e && pnpm test:e2e:export
```

```bash
cd workers/corrections
pnpm test && pnpm typecheck
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
| **GregoBase** dump — chant texts and notation (CC0) | `vendor/gregobase_online.sql` | no (17 MB) | `uv run noh gregobase-fetch`: the pinned commit of [gregorio-project/GregoBase](https://github.com/gregorio-project/GregoBase), checked against `DUMP_SHA256` in `pipeline/gregobase.py`. CI and the publishing workflow fetch it themselves |
| **Chant notation** the site publishes — the GABC of every chant a Proper part names, leaving out those GregoBase flags copyrighted | `data/chants.json` | yes | `uv run noh chants` (after `noh catalog`) |
| **Exsurge** — draws the notation in the browser ([bbloomf/exsurge](https://github.com/bbloomf/exsurge), MIT) | `web/public/vendor/exsurge/`, with its licence and source commit | yes | replace `exsurge.min.js` from a newer commit and update `SOURCE` |

| **Divinum Officium** Vespers texts (1960) — each office's antiphons with their psalms, Magnificat antiphons, hymn, chapter, and the psalms' verses ([DivinumOfficium/divinum-officium](https://github.com/DivinumOfficium/divinum-officium), MIT) | `data/vespers/divinum-officium-vespers.json`, with the source commit and a content sha256 | yes | `uv run noh officium-fetch [--commit SHA]`; never hand-edit |
| **vesperale** Sunday table — each Sunday's Magnificat antiphon and tone from [jsrjenkins/vesperale](https://github.com/jsrjenkins/vesperale)'s `calendar.sty`, a cross-check on NOH8's own tone labels | `data/vespers/vesperale-lineup.json`, with the source commit and a content sha256 | yes | `uv run noh vesperale-fetch [--commit SHA]`; never hand-edit |

A reader can show the chant above each part of a Proper ("Show the chant with
each part", remembered in the browser; off by default), or follow the "Chant"
link to GregoBase. Licensing: `data/LICENSES.md`.
