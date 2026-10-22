# Documentation audit

2026-10-22 · audited against `origin/main` at `178fb27` (#139) · read-only; no
docs were changed.

Why: every future change, bug fix and the eventual UI/UX redesign will be done
with AI agents (Claude Code, Codex). An agent can only be as good as what it is
told, and it trusts what it reads. This audit asks: can an agent that starts
cold find the right documents, and are they true?

How: four slices in parallel, each spot-checked before inclusion.

| Slice | Done by |
|---|---|
| Every path, command, CLI flag, script, workflow, env var and link in `README.md`, `docs/*.md`, `data/LICENSES.md`, `.claude/rules/*` | Codex (`codex exec`, read-only) |
| `ARCHITECTURE.md` and `OPERATIONS.md` claims against code and workflows | Claude subagent |
| Status of every spec, plan, review and report | Claude subagent |
| UI inventory and what a redesign brief would need | Claude subagent |
| Agent config (`.claude/`, `.codex/`, rules, hooks, memory, worktrees), `EDITING.md`, `ADMIN-SETUP.md` freshness | Claude (this session) |

## Summary

The docs are **accurate where they exist** and **silent about most of
October's work**. References are almost all valid (Codex: ~870 checked, 26
broken, 15 of them screenshots knowingly not committed). The problems are
coverage, discoverability and status:

1. **No `CLAUDE.md` or `AGENTS.md`.** Nothing points an agent at the good docs.
2. **The agent rules are generic boilerplate for a different stack** (Next.js,
   Tailwind, Zod) and their path globs match nothing here.
3. **`ARCHITECTURE.md` predates the OF calendar, PDF and MEI/Verovio export,
   chant-in-export, typeset source editing and Good Friday**, and contradicts
   `OPERATIONS.md` on how batches merge.
4. **~60 specs/plans in two trees with stale status headers.** Seven say
   "ready to build" / "not started" / "proposed" for work that has shipped.
5. **Durable decisions are scattered** across the export decision log, plan
   headers, untracked reports and private agent memory.
6. **No current-state UI baseline** for a redesign; the design direction lives
   in untracked reports and mockups outside the repo.

Two real bugs surfaced on the way (see [Bugs found](#bugs-found)).

## 1. Agent entry points

| Item | Finding |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | None in the repo (only vendored `vendor/missalemeum/AGENTS.md`). Claude and Codex each start every session with no map. |
| `README.md` | Good human entry point; links OPERATIONS, ARCHITECTURE, EDITING. Last changed 2026-10-03, 359 commits ago. |
| `.claude/rules/*.md` | Generic claudekit templates, also copied in `~/development/.claude/rules/`. Wrong for this repo: Next.js server components, Tailwind, Zod, `{error, code, details}` envelopes, OpenAPI comments, "every migration reversible" (repo uses `workers/corrections/rollback/*.sql`), 80% coverage. 12 of 16 path globs match no file, so they rarely load — and when they do (security, testing) they partly mislead. |
| `.claude/modes/*` | Generic claudekit modes; harmless, not project knowledge. |
| `.claude/agent-memory/` | Reviewer agents' memories hold real project facts (calendar keys, Verovio scale, MEI v1 decision). Uncommitted edits in `claudekit-eng-reviewer`. Facts here are invisible to Codex and to humans. |
| Claude auto-memory (`~/.claude/projects/.../memory`) | Holds repo-level facts (R2 upload route, export direction, stacked-PR retargeting, agent concurrency) that belong in the repo. Its "presets rejected" wording is ambiguous: D1 rejected *pre-rendered LilyPond* presets; iPad page-size presets shipped (D4). |
| `.claude/launch.json` | Good: five named dev/preview/admin servers. Undocumented elsewhere. |
| `.codex/` | Ignored via `.git/info/exclude`; mirrors the Claude hooks with absolute paths. Codex therefore has hooks but no project instructions. |
| Worktrees | 13 linked worktrees (11 under `.claude/worktrees/`, 2 under `~/.codex/worktrees/`). 7 branches merged by PR (#127, #129, #134, #136–#139); 6 have no PR (`chant/k0`, `chant/k1`, `chant/k2`, `review/proofreading`, `review/scan-queue`, `codex/noh4-recognition-pilot`). `review/scan-queue` has 9 uncommitted files — check before removing. Agents that grep the tree can hit stale copies. |

## 2. Core manuals

Last change vs commits since (on this branch's history):

| Doc | Last changed | Commits since | Verdict |
|---|---|---|---|
| `README.md` | 10-03 | 359 | Accurate; omits OF, export, MEI, chant |
| `ARCHITECTURE.md` | 10-03 | 359 | Reliable for the original EF core; materially out of date |
| `OPERATIONS.md` | 10-11 | 120 | Mostly accurate; incomplete inventories |
| `EDITING.md` | 10-04 | 320 | Recipes valid (170 refs, 0 broken); no recipes for OF, chant, typeset/MEI, export |
| `ADMIN-SETUP.md` | 10-02 | 457 | Refs valid; covers migrations 0001–0008 |
| `TYPESETTING.md` | 10-19 | 11 | Current; best doc for MEI/Verovio. 2 broken links |
| `SEO.md` | 10-03 | 359 | Refs valid |
| `ADMIN-UX-REVIEW.md` | 10-03 | 359 | Shipped (#77, #80, #81); 15 screenshots referenced but never committed |

### ARCHITECTURE.md — inaccurate

- **Lines 87–88: "The owner merges it, and the merge deploys."** Batches
  auto-merge (`corrections-batch.yml:171`, `gh pr merge --auto`) unless
  `hold_reasons` fires (`pipeline/corrections.py:1267–1281`: moves systems
  between pieces, or ≥25 non-review changes). `OPERATIONS.md:313–317` is
  right; the two docs contradict.
- **Lines 89–91, webhook outcomes:** a failed site check on a
  `corrections/<batch>` branch also returns rows to approved and closes the PR
  (`web/src/lib/admin/api.ts:625–641`); "closed unmerged" returns editor rows to
  `approved` and twins to `duplicate` (`store.ts:84`), not all to review.
- **Line 70:** corrections-batch also runs `typeset-manifest`, `ordinary-form`
  and a sandboxed `source-check` job for typeset source snapshots.
- **Line 17:** `data/vespers-*.yml` → `data/vespers/vespers-*.yml`.

### ARCHITECTURE.md — missing subsystems

| Subsystem | Where it lives |
|---|---|
| Ordinary Form calendar | `pipeline/ordinary_form.py`, `data/ordinary-form/`, `web/src/lib/ordinaryForm*.ts`, `pages/ordinary-form/[key].astro` (OPERATIONS:580–617 covers operations only) |
| Basic PDF export | `web/src/lib/pdf.ts`, `exportParts.ts`, `exportSelection.ts`, `web/src/workers/pdf.worker.ts` (pdf-lib) |
| MEI/Verovio Customize export | `pipeline/typeset/mei/` (~20 modules, 13 `typeset-mei-*` commands), `data/typeset/mei/`, R2 `mei/<sha256>/`, `web/src/lib/export-layout/`, `web/src/workers/export-layout*.worker.ts`, `exportPaused.ts` |
| Chant in export (on main since #138/#139) | `export-layout/chant*.ts`, `exportChants.ts`, `exsurgeLoader.ts` |
| Typeset source editing in admin | `/admin/api/typeset/{source,draft,preview}` (`typesetApi.ts`), migrations 0006–0008 |
| Good Friday chant-only page | `data/good-friday.json` → `noh chants` (`pipeline/chants.py`) → `pages/good-friday/`, `lib/goodFriday.ts` |
| Workflows | `mei-conversion`, `mei-stale` (in TYPESETTING only), `typeset-preview`, `r2-check` (in ADMIN-SETUP only) — none in the ARCHITECTURE parts table |
| Smaller | `pages/chant/[id].json.ts`; GoatCounter analytics (`Layout.astro`, `exportAnalytics.ts`); `web/public/_headers`; admin auth (Access JWT + `EDITORS`, `auth.ts`); webhook Function `web/functions/api/github/webhook.ts`; Worker route `api.cantusorgani.org` and `CORRECTIONS_ENABLED` kill switch; rate limit is a D1 row count (5 per hashed submitter), not a Cloudflare binding |

CI description (line 69) omits OF coverage, typeset render/upload, remote
typeset check, both browser suites, LilyPond tests and the path-filtered scan
tests, and that deploy waits on typeset render/upload (`site.yml:121–127`).

### OPERATIONS.md

- **Lines 194–201:** volume list is noh1–5, noh8. **NOH7 (Varia) is catalogued**
  (118 of 576 pieces). See [Bugs found](#bugs-found).
- **Lines 175–178:** what `regenerate.sh` runs omits `noh ordinary-form`, and
  that `vespers-lineup` runs only when noh8 is rebuilt.
- **Lines 240–243:** `check.sh --quick` also checks OF coverage. "Everything a
  PR checks except build/browser tests" is not true: `check.sh` does not run
  gitleaks, `typeset-check --remote`, export e2e, LilyPond tests or scan tests.
- **Lines 388–389:** typeset music renders on every PR and uploads for same-repo
  PRs (`site.yml:49–119`), not only "when main changes".
- **Lines 148–160 and the `--theirs` merge list (332)** miss generated files:
  `ordinary-form-propers.json`, `ordinary-form-coverage.json`,
  `jgabc-novus-propers.json` (vendored), `hymn-pairings.json`,
  `vespers/hymn-links.json`, `typeset/mei/manifest.json`.

### Undocumented anywhere (Codex)

- **`noh` subcommands:** `crosscheck`, `typeset-source-evidence`,
  `typeset-source-batch`, `typeset-preview-render`, `typeset-preview-publish`,
  `typeset-mei-audit`, `typeset-mei-extract`, `typeset-mei-evidence`,
  `typeset-mei-validate`.
- **Scripts:** `scripts/cloudflare-setup.sh`, `scripts/test-all.sh`.
- **web npm scripts:** `build:e2e`, `serve:device`, `check:no-fixture`,
  `check:links`, `preview`, `test:e2e`, `test:e2e:export`. Worker: `dev`,
  `migrate:local`, `backup`.
- **Env vars / bindings:** `ADMIN_DEV_EMAIL`, `ALLOWED_ORIGIN`,
  `CORRECTIONS_ENABLED`, `GITHUB_REPO`, `PUBLIC_ASSET_BASE_REMOTE`,
  `PUBLIC_MEI_MANIFEST`, and test switches (`E2E_TEST_PAGES`, `E2E_WEBKIT`,
  `DEVICE_TEST`, `NOH_EXPECT_BOUNDARIES`, …).

### Broken references (Codex, full list)

| Doc | Reference | Fix |
|---|---|---|
| ARCHITECTURE.md:17 | `data/vespers-*.yml` | `data/vespers/vespers-*.yml` |
| TYPESETTING.md:5–6 | `docs/claudekit/{specs,plans}/2026-09-28-typesetting-*` | Exist only on `origin/feat/typesetting-2ykxyb` (c1544b2, f4e7e2d): bring them to main or drop the links |
| ADMIN-UX-REVIEW.md | 15 `*.png` screenshots | Acknowledged as uncommitted (lines 5–6); regenerate in the UI baseline or remove |
| `.claude/rules/*` | 12 path globs | Replace the rules (see §1) |

## 3. Specs, plans and reports

Two parallel trees (`docs/claudekit/`, `docs/superpowers/`) plus
`docs/reports/` and top-level reports. No index; status is only in each file's
header, and many headers are stale.

| Status | Documents |
|---|---|
| **Shipped** | claudekit: design spec (09-07), NOH5 Kyriale, proper-parts export, editing/admin refactor, proper sections. superpowers: typesetting review completion, corrections compatibility, chant proofreading pilot, hymns Book VII, export layout editor design, execution packet, deferred MEI coverage, P1 prall brief, OF calendar spec + plan, OF seasonal weekdays (main only), chant-in-export spec + cards (K9 user review open), export mockup. `ADMIN-UX-REVIEW.md` |
| **Partial** | Vespers full lineup (Releases 1–3 done; **Compline not built**). Export phase 2 (open: P6 resource profile still provisional, O2 paused list, 131 deferred sources, spot-check cadence) |
| **Active reference** | `export-layout-decisions.md` (D1–D30, G0–G4: the canonical decision log), export contracts, export editor UI spec, `ORDINARY-FORM-MUSIC-COVERAGE.md` (generated), `b10b-device-checklist.md` |
| **Active proposal (untracked)** | `reports/2026-10-20-reading-edition-design-correction.md` (governing product intent); `reports/2026-10-19-multiple-sources-and-language-direction.md` (its mockup rejected); `reports/2026-10-19-architecture-build-and-design-review.md` (product framing superseded by 10-20) |
| **Superseded** | Export Plans 0/A/B/C (by the execution packet), NOH re-typesetting research (by the 09-28 typesetting docs, not on main), chant spec §4.2 (by D30), execution-packet §6 board (by phase 2) |
| **Reference** | All experiments, all reviews, REFERENCE-AUDIT, hymn/alleluia research reports, export layout audit |

**Stale headers** (status says unbuilt, work is shipped): hymns Book VII
("proposed; awaiting approval"), OF calendar spec ("implementation not
started"), proper sections and editing refactor ("ready to build"), execution
packet ("ready for approval"), Vespers lineup ("NOH7 not started"), typesetting
review plan (checkboxes unticked), export layout design ("G0/G1 not yet
approved").

**Contradictions an agent could act on**

1. GregoBase licence: 09-07 design says CC-BY-SA; c9a0f0b and D9 say CC0.
2. Product framing: 10-19 reports put "find music for a date" first; 10-20 says
   the product is a continuous chant + accompaniment reading page feeding one
   PDF, and a control missing from a mockup is never an approved deletion.
3. "Presets rejected" (memory) vs iPad page presets shipped (D4).
4. Superseded passages still reading as live: D5 vs D23, "only the user
   approves" vs D22, chant spec §4.2 vs D30.
5. Phase-2 O1 marked done while the 10-19 review reports a `mei-stale`
   prior-revision path bug (not independently confirmed).

**Decisions worth lifting into a project-wide log** (beyond D1–D30): GregoBase
is CC0; corrections are an overlay and never edit generated files; the printed
NOH scans govern corrections; melody proofreading never auto-fixes sources;
LilyPond is master and MEI derived; OF scope (2024–2050, Sundays and
solemnities plus named exceptions, seasonal weekdays); a date gets a Vespers
page only if every item is placed by label or text; product intent per the
10-20 report; agent concurrency (3–4, Opus coordinates). Mark the 10-19
proposals (keep static Astro, source-independent identities, English UI with
`lang="la"`) as *proposed*.

## 4. UI/UX baseline for a redesign

**What exists:** ~1,744 static pages across `/`, 5 divisions, 466 day pages,
576 piece pages, 579 Vespers pages, Kyriale, 83 OF pages, two calendars, Good
Friday, hymns, search (Pagefind), corrections, 6 admin screens. ~20 Astro
components. Plain CSS (no Tailwind): `styles/tokens.css` (paper/ink/rubric
palette with contrast notes, fluid 4-step type scale, 6 spacing steps,
`--tap-min: 44px`, house rules: no gradients, no card shadows, radius ≤2px, one
accent) and `base.css`. Dark mode via `prefers-color-scheme` plus scan polarity
override; print styles; good a11y groundwork (skip link, focus ring, 44px
targets, `lang="la"`, ~168 ARIA uses).

| A redesign brief needs | Status |
|---|---|
| Token reference | Comments in `tokens.css` only; export UI spec §1.2 |
| Type scale / fonts | Steps exist; **Source Serif 4 is declared but never loaded** — readers get Georgia |
| Breakpoints | None tokenised; ~10 raw values (34–62rem) |
| Page templates | Undocumented; route list in the 09-07 spec is stale |
| User journeys / IA | Proposals only (10-19, 10-20 reports); no current-state map |
| States (empty/loading/error) | Export editor and admin only; public pages none |
| Accessibility target | Implied (AAA text contrast in comments); no declared site-wide WCAG level |
| Device constraints | Scattered (iPad at console, 17px min body, forScore) |
| Visual direction | 10-20 report; mockups in `~/.codex/visualizations`, outside the repo |
| Must-keep features | Listed in 10-20 report (every export control, scan/typeset, polarity, skip-to-music, clean print) |

**Design debt to know about:** base button border uses `--rule` (~1.7:1,
below WCAG 1.4.11's 3:1; `--control-border` exists but is barely used);
`.status` styles duplicated in 5 admin pages; hardcoded liturgical colours in
`calendar/index.astro`; `AdminNav.astro:49` box-shadow against the house rule;
42 raw px values in `exportEditor.css`; a font size outside the scale
(`exportEditor.css:109`); guard tests for forbidden styles cover export
components only.

## Bugs found

1. **`scripts/regenerate.sh all` skips NOH7.** Line 17 lists
   `noh1 noh2 noh3 noh4 noh5 noh8`; `catalog-rebuild.yml:71` includes `noh7`.
   A local full rebuild silently omits 118 pieces' volume. Confirmed.
2. **Commons orphan pages on main.** The fix (`0ec36dd`, link the Saturdays of
   Our Lady from the Commons index) and `9a8d406` are on
   `fix/christ-the-king-noh3` only; #135 merged before them. Until they land,
   main's link check reports the 4 commune pages.
3. *(Reported, not confirmed)* `mei-stale.yml` prior-revision path handling,
   per the 10-19 architecture review.

## Recommended next steps

In order; each is small enough for one session.

1. **Write `CLAUDE.md`** (≤150 lines: purpose, repo map, commands, never-do
   list, "read X before Y" table) and an `AGENTS.md` that points to it for
   Codex. Add short `pipeline/`, `web/`, `workers/` CLAUDE.md files.
2. **Replace `.claude/rules/`** with project rules that match the stack (Astro +
   plain CSS + tokens, Pages Functions, D1 migrations with rollback files,
   pytest/vitest naming as practised). Remove the copies in
   `~/development/.claude/rules/`.
3. **`docs/DECISIONS.md` and `docs/GLOSSARY.md`.** Promote the export decision
   log; add the decisions above; move repo facts out of agent memory.
4. **One design tree with an index.** Merge `docs/claudekit/` and
   `docs/superpowers/` into `docs/design/{active,reference,archive}` with
   `git mv`; a `Status:` line on every file; fix the stale headers; commit or
   discard the three untracked reports; resolve the TYPESETTING links.
5. **Bring ARCHITECTURE and OPERATIONS current** using §2 above; add EDITING
   recipes for OF, chant, typeset/MEI and export.
6. **UI baseline** (`docs/ui/`): page-template catalogue with screenshots at
   390/768/1024px in both polarities, token reference, breakpoints, journeys,
   state matrix, must-keep feature checklist, declared WCAG target; bring the
   10-20 mockups into the repo.
7. **Keep it true:** a `check.sh` step that fails when a doc names a missing
   path, `noh` subcommand or workflow (the Codex check, made permanent); a
   "docs updated?" line in a PR template.
8. **Housekeeping:** fix the NOH7 bug, land `0ec36dd`, prune merged worktrees
   after checking `review/scan-queue`.
