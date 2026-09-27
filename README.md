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

Two datasets from elsewhere, pinned and checked by `noh doctor`:

| Data | Where | Tracked | Refresh |
|---|---|---|---|
| **jgabc** per-day chant ids — which parts each Proper has, and the GregoBase id of each ([bbloomf/jgabc](https://github.com/bbloomf/jgabc), Unlicense) | `data/jgabc-propers.json`, with the source commit and a content sha256 in its header | yes | `uv run noh jgabc-fetch [--commit SHA]`; never hand-edit |
| **GregoBase** dump — chant texts, used inside the pipeline to find each part in the scans; not published | `vendor/gregobase_online.sql` | no (17 MB) | download `gregobase_online.sql` from [gregorio-project/GregoBase](https://github.com/gregorio-project/GregoBase) and check its sha256 against `DUMP_SHA256` in `pipeline/gregobase.py` |

The site publishes **links** to GregoBase and jgabc, not their chant data; see
the open licence question in `data/LICENSES.md`.
