# Cantus Organi: guide for coding agents

Organ accompaniments from **Nova Organi Harmonia** (Mechelen, 1942), catalogued
against the 1962 Roman calendar and the Ordinary Form calendar, published as a
static site at [cantusorgani.org](https://cantusorgani.org).

Who it serves: **organists** reading at the console (often on an iPad, and
exporting PDFs for forScore or print), **editors** fixing the catalogue in the
admin screen at `/admin/`, and **the maintainer**, who owns this repository.
Agents ask the maintainer before merging, uploading or deploying. (Correction
batches from the admin screen merge themselves; a merge to `main` deploys.)

This file is the map. The detail lives in the docs below; read the one for
your task before you change anything.

## Read before you work

| Task | Read first |
|---|---|
| Fix something the site shows (title, pages, day, system, Proper part) | `docs/EDITING.md` (recipes by symptom) |
| Regenerate data, run checks, merge `main`, get a change to the site | `docs/OPERATIONS.md` |
| Understand how the parts fit together | `docs/ARCHITECTURE.md` |
| Typeset music, LilyPond, MEI/Verovio, Customize export | `docs/TYPESETTING.md`, then `docs/superpowers/plans/export-layout-decisions.md` |
| Admin screen, Cloudflare Access, GitHub App, D1 migrations | `docs/ADMIN-SETUP.md` |
| Ordinary Form calendar | `docs/OPERATIONS.md` § Ordinary Form calendar, `docs/ORDINARY-FORM-MUSIC-COVERAGE.md` |
| Routes, canonicals, sitemap | `docs/SEO.md` |
| UI or product direction | `docs/reports/2026-10-20-reading-edition-design-correction.md` |
| Licensing of data and vendored code | `data/LICENSES.md` |
| Whether a spec or plan is still live | `docs/design/README.md` (status of every design doc) |
| What a domain term means (Proper, lender, system, polarity…) | `docs/GLOSSARY.md` |

**Decisions already made** are recorded in `docs/DECISIONS.md` (P1–P11) and,
for the export, `docs/superpowers/plans/export-layout-decisions.md` (D1–D30).
Proposals not yet decided are listed separately there. Don't re-propose
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
pnpm test:e2e       # Playwright against dist/
pnpm build:e2e && pnpm test:e2e:export   # export tests, against dist-e2e/
```

`cd workers/corrections && pnpm test && pnpm typecheck` covers the Worker.

## Data: sources versus generated files

**Change `data/corrections.yml` only through `noh correct`, `noh
correct-batch` or the admin screen**; each entry records the value it replaced.

**Edit these sources by hand:** `data/sections/*.yml`,
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
it changes. It reruns `noh vespers-lineup` only when noh8 is rebuilt, so after
editing `data/vespers/*.yml` also run `uv run noh vespers-lineup`. When merging `main`, take `main`'s copy of each generated file and
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
- **Typeset lyrics.** Put every lyric row above the chant staff in LilyPond
  and MEI, including both rows of an Ite response. For catalogue layout
  changes, check narrow and wide SVG, Letter and A4 PDF. Compare render
  failures with the unchanged sources before treating them as regressions.
- **MEI approvals.** Source, include and converter edits can stale approvals.
  Run `uv run noh typeset-mei-stale --fail-on-stale`. Use the conversion and
  carry-forward commands in `docs/TYPESETTING.md`; never patch approval
  digests by hand. Carry-forward needs equal normalized music and identical
  renders in all 13 layout cases after ID normalization. Anything else needs
  a fresh approval. Lyric gaps below 0.3 mm are nonblocking review warnings
  (`info: lyrics:`); other pre-check findings still block automatic approval.
- **MEI releases.** Merge current approved records first, then publish with
  the maintainer's approval. Verify both live artifacts (`score.mei` and
  `boundaries.json`), their hashes, immutable caching and CORS. Build the
  manifest from those live files in a separate PR. Published files stay;
  withdraw a piece through its record and manifest, never by deleting or
  overwriting its assets. Follow `docs/TYPESETTING.md` § Release sequence.
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

## Working with several agents

Claude Code and Codex both work on this repository. Used together, they cost
less and catch more than either one alone. The rule underneath all of this:
**the strongest model plans and reviews; cheaper models execute bounded cards;
the other model family checks.**

**Roles**

| Role | Who | Does |
|---|---|---|
| Coordinator | One strong session (Claude Opus, or Codex at high effort) | Holds the conversation with the maintainer, splits the work into cards, reviews every diff, pushes and opens PRs |
| Executor | Claude Sonnet or Haiku subagents; Codex at low or medium effort | One card each, in its own worktree; commits locally, never pushes |
| Cross-checker | The *other* model family from the one that wrote the change | Reviews the diff or re-checks the facts before it reaches the maintainer |

**Pick the cheapest model that can do the card**

| Card | Use |
|---|---|
| Find files, list references, inventory, mechanical sweeps, apply a listed set of fixes | Haiku, or Codex `gpt-6-luna` at low effort |
| A bounded change with clear done criteria (a script fix, a doc section, tests) | Sonnet, or Codex `gpt-6.1-sol` at medium effort |
| Design, hard debugging, risky reviews, anything touching the data model or the export pipeline | Opus, or Codex `gpt-6-astra` at high effort (use sparingly; costs more of Codex's limit) |

The Codex models by role: `gpt-6-luna` is fast and affordable, for easier
tasks (mechanical work). `gpt-6.1-sol` is the workhorse for coding and everyday
work, and the default: most cards, reviews included. `gpt-6-astra` is the
frontier model for the most demanding work: rare, for hard debugging, design
and risky reviews. By position, Astra is the top tier, Sol the flagship
workhorse and Luna the light tier.

**Route by remaining usage.** Claude (Pro) and Codex (Plus) have separate
weekly limits. Before each batch of cards, check both:

- Claude: the usage card in the Claude app (Claude Code can also read it
  with its usage tool).
- Codex: `uv run python -m tools.codex_usage`, which reads the limit Codex
  logs after each run. It updates only after the next run, so treat an old
  figure as approximate.

Then route:

| Situation | Executors | Cross-checker |
|---|---|---|
| Codex has more weekly limit left (the usual case) | Codex, at low or medium effort | Claude Haiku or Sonnet, read-only |
| Claude has more left | Claude Sonnet or Haiku subagents | Codex, read-only |
| Either is above 80% of its weekly limit | The other one only; defer non-urgent cards | The other one too, or the coordinator spot-checks |

Keep about 20% of each in reserve for coordinating and for fixes. A writing
card costs far more than a review, so send the writing to whichever tool has
more limit left, and keep the cross-check with the other family. The 80% row
overrides the others: past 80%, that tool does no new cards or reviews, and the
coordinator spot-checks instead.

**Write cards that don't need the conversation.** An executor starts cold.
A good card says:

- the goal, in one line
- the worktree path and branch
- which files it may edit, and that it must not touch others
- the inputs to read, named by path and section; don't paste their contents
- the done criteria and the exact command that proves them
- what it must not do (push, run remote commands, edit generated files)
- the report shape: a word limit and a fixed structure, so the result costs
  few tokens to read

**One writer per set of files.** Each writing card gets its own worktree,
under `.claude/worktrees/` for Claude and Codex alike, branched from
`origin/main`. Read-only cards can share a checkout. Run at most 3–4 cards at
once. Codex's `workspace-write` sandbox cannot write a worktree's git metadata,
so Codex leaves its changes uncommitted and the coordinator commits them.
Worktrees have no `.venv`; run Python with `uv run` there (it creates one), or
with the main checkout's `.venv/bin/python`.

**Treat reports as claims.** Before acting on a finding, the coordinator
spot-checks it against the code; on 2026-10-22 a spot check caught an agent
reading a stale branch. Before pushing, it reads the diff and runs the card's
check.

**Saving tokens**

- Point to `file:line` or a doc section instead of pasting text.
- Reuse a warm agent for the next related card (Claude: SendMessage; Codex:
  `codex exec resume --last`) instead of starting a cold one.
- Ask for structured reports with a word cap. Keep raw output in a scratch
  file and read only what you need.
- Run audits and research read-only, with no edit permissions.

**Calling one from the other**

```bash
# Claude → Codex: a card in a worktree. Close stdin, or it waits forever.
codex exec -m gpt-6-luna -s workspace-write -c model_reasoning_effort=low \
  -C .claude/worktrees/<card> -o /tmp/<card>.md "<card text>" < /dev/null
# Claude → Codex: a second-opinion review of a branch (no custom prompt allowed)
codex exec review --base main < /dev/null
# … or a focused review with your own instructions
codex exec -s read-only -C .claude/worktrees/<card> \
  "Review git diff origin/main...HEAD for <what to check>. Report only problems." < /dev/null
# Codex → Claude: a read-only review or check, on a cheaper model
claude -p "<card text>" --model sonnet --tools Read,Grep,Glob
```

## Known gaps

Remove each line once it is fixed. The documentation audit
(`docs/reports/2026-10-22-documentation-audit.md`) has the detail.

- There is no current-state UI baseline yet (page templates, screenshots,
  breakpoints, journeys, WCAG target). Read `web/src/styles/tokens.css` and the
  pages themselves before any redesign work.
- Some `noh` subcommands, npm scripts and environment variables are documented
  only in code (`pipeline/cli.py`, `web/package.json`, `wrangler.toml`).
