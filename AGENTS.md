# Cantus Organi: guide for coding agents

Organ accompaniments from **Nova Organi Harmonia** (Mechelen, 1942), catalogued
against the 1962 Roman calendar and the Ordinary Form calendar, published as a
static site at [cantusorgani.org](https://cantusorgani.org).

Who it serves: **organists** reading at the console (often on an iPad, and
exporting PDFs for forScore or print), **editors** fixing the catalogue in the
admin screen at `/admin/`, and **the maintainer**, who owns this repository and
approves every pull request, upload and deploy.

This file is the map. The detail lives in the docs below; read the one for
your task before you change anything.

## Read before you work

| Task | Read first |
|---|---|
| Fix something the site shows (title, pages, day, system, Proper part) | `docs/EDITING.md` (recipes by symptom) |
| Regenerate data, run checks, merge `main`, get a change to the site | `docs/OPERATIONS.md` |
| Understand how the parts fit together | `docs/ARCHITECTURE.md` (out of date; see [Known gaps](#known-gaps)) |
| Typeset music, LilyPond, MEI/Verovio, Customize export | `docs/TYPESETTING.md`, then `docs/superpowers/plans/export-layout-decisions.md` |
| Admin screen, Cloudflare Access, GitHub App, D1 migrations | `docs/ADMIN-SETUP.md` |
| Ordinary Form calendar | `docs/OPERATIONS.md` § Ordinary Form calendar, `docs/ORDINARY-FORM-MUSIC-COVERAGE.md` |
| Routes, canonicals, sitemap | `docs/SEO.md` |
| UI or product direction | `docs/reports/2026-10-20-reading-edition-design-correction.md` |
| Licensing of data and vendored code | `data/LICENSES.md` |
| Whether a spec or plan is still live | `docs/reports/2026-10-22-documentation-audit.md` § 3 |

**Decisions already made** are recorded in
`docs/superpowers/plans/export-layout-decisions.md` (D1–D30). Don't re-propose
a rejected option. Raise it only if new evidence changes the case, and say what
the new evidence is.

## Repository map

| Path | What it is |
|---|---|
| `pipeline/` | Python: page maps, segmentation, index extraction, the catalogue, chant, Vespers, OF, typesetting and MEI, slicing and upload. CLI: `noh` (`pipeline/cli.py`) |
| `tools/`, `tests/` | Python review tools; pytest suites |
| `data/` | Reviewed sources, generated catalogue, calendars, vendored data (all tracked) |
| `pdf-source/` | The scanned NOH volumes (only `NOH*.pdf` is tracked) |
| `web/` | Astro static site: `src/pages`, `src/components`, `src/lib`, `src/styles`, `src/scripts`, `src/workers` (PDF and export workers), `e2e/` (Playwright) |
| `web/functions/` | Cloudflare Pages Functions: the admin API and GitHub webhook (code in `web/src/lib/admin/`) |
| `workers/corrections/` | Cloudflare Worker for reader corrections; D1 `migrations/` with matching `rollback/*_down.sql` |
| `scripts/` | `regenerate.sh`, `check.sh`, `test-all.sh`, `cloudflare-setup.sh` |
| `.github/workflows/` | CI and deploy (`site.yml`), corrections batches, catalogue rebuild, publish, MEI conversion, typeset preview |
| `docs/` | Manuals at the top level; designs and plans in `claudekit/` and `superpowers/`; `reports/` |

## Commands

```bash
uv sync && uv run noh doctor            # set up; doctor names the fix for every failure
uv run noh catalog --volume noh3        # rebuild one volume from the scans
uv run noh apply-corrections            # apply data/corrections.yml (no PDFs needed)
scripts/regenerate.sh [noh1 …]          # every generated file, in dependency order
scripts/check.sh --quick                # what a PR checks, minus build and browser tests (~5 min)
scripts/check.sh                        # everything (~8 min)
uv run pytest -q -m "not slow"          # pipeline tests
uv run ruff check pipeline tools tests  # lint
```

```bash
cd web && pnpm install
pnpm dev            # http://localhost:4321
pnpm build          # static site + Pagefind; fails on unreachable pages or broken links
pnpm test           # vitest
pnpm typecheck      # astro check
pnpm test:e2e       # Playwright (pnpm build:e2e first for export tests)
```

`cd workers/corrections && pnpm test && pnpm typecheck` covers the Worker.

## Data: sources versus generated files

**Edit these sources by hand:** `data/corrections.yml`, `data/sections/*.yml`,
`data/index-*.yml`, `data/vespers/vespers-noh8.yml`,
`data/vespers/vespers-offices.yml`, `data/vespers/hymns-noh7.yml`,
`data/hymn-pairings.yml`, `data/ordinary-form/*.yml`, `data/good-friday.json`,
`data/typeset/src/`.

**Never hand-edit generated or vendored files.** Commands rewrite them, and a
hand edit is either lost or fails its checksum. They include:

- `data/catalog.json`, `catalog.base.json`, `chants.json`, `review-queue.json`,
  `reviewed.json`, `corrections-log.json`
- `data/vespers/vespers-lineup.json`, `data/vespers/hymn-links.json`
- `data/ordinary-form-*.json`, `data/hymn-pairings.json`
- `data/typeset/manifest.json`, `parts.yml`, `review.json`, `data/typeset/mei/`
- vendored: `data/jgabc-*.json`, `divinum-officium-vespers.json`,
  `vesperale-lineup.json`, `web/public/vendor/exsurge/`

After any hand edit under `data/`, run `scripts/regenerate.sh` and commit what
it changes. When merging `main`, take `main`'s copy of each generated file and
regenerate (`docs/OPERATIONS.md` § Merging main into a branch). Don't resolve
generated-file conflicts by hand.

## Ask the maintainer first

- Uploading to R2, deploying, running `wrangler … --remote`, applying remote D1
  migrations, or dispatching a workflow. To re-upload images, use the `publish`
  workflow rather than local credentials.
- Merging any pull request, or pushing to `main`.
- Removing or hiding an existing feature. A control missing from a mockup is
  **not** approval to delete it. These must stay: every export control, the
  scan/typeset switch, polarity inversion, skip-to-music and clean printing.

## Never

- Read, print, copy or commit secrets. `web/.env` and `.dev.vars` are
  1Password named pipes. If one returns nothing, stop and ask; don't work
  around it.
- Commit anything in `pdf-source/` except the NOH scans. A test enforces this.
- Edit an existing D1 migration. Add a new one, with its `rollback/` file.
- Auto-fix a chant melody from a proofreading result. The printed NOH scans
  govern corrections.

## Conventions

- **Branches and PRs.** Branch from `main` and open one PR per change. Titles
  look like `feat(of): …`, `fix: …`, `docs(export): …`, `chore(deps): …`. A PR
  that builds on another targets `main`, not the other branch
  (`docs/OPERATIONS.md` § Pull requests that build on each other). Run
  `scripts/check.sh --quick` before opening one, and the full check if you
  touched `web/`.
- **Tests.**
  - Python tests live in `tests/`, named `test_<thing>_<scenario>_<expected>`.
    The markers `source`, `slow` and `lilypond` mark tests that need the PDFs,
    renders or LilyPond.
  - TypeScript tests are colocated `*.test.ts` files (vitest). Playwright tests
    are in `web/e2e/*.e2e.ts`.
  - Write the failing test first for a bug fix.
- **Styling.** Plain CSS with the tokens in `web/src/styles/tokens.css` and
  `base.css`. No Tailwind or other framework. House rules from the token file:
  no gradients, no card shadows, radius at most 2px, one accent colour, 44px
  tap targets. Use tokens rather than raw colours or sizes. Mark Latin text
  `lang="la"`.
- **Pages must be reachable.** `pnpm build` fails if a page has no link to it.
  Link every new page from its day, section or index.
- **Writing (docs and UI copy).** Plain and short. Say what the reader sees
  and what to do. Match the voice of `docs/EDITING.md`.
- **Docs.** Update the doc your change affects in the same PR. If a plan's
  status changes, update its `Status:` line.

## Known gaps

These are tracked in `docs/reports/2026-10-22-documentation-audit.md`. Remove
each line here once it is fixed.

- `docs/ARCHITECTURE.md` predates several subsystems: the OF calendar, the PDF
  and MEI/Verovio exports, chant in export, typeset source editing in admin,
  the Good Friday page, and the `mei-conversion`, `mei-stale`,
  `typeset-preview` and `r2-check` workflows. It also wrongly says the
  maintainer merges every corrections batch; most auto-merge
  (`corrections-batch.yml`). Check the code before relying on it.
- `scripts/regenerate.sh all` omits `noh7`. Name the volume explicitly.
- Many specs and plans under `docs/claudekit/` and `docs/superpowers/` have
  stale status headers. Check the audit's status table before treating one as
  live.
- `.claude/rules/*` are generic templates written for another stack (Next.js,
  Tailwind, Zod). Where they conflict with this file, this file wins.
