@AGENTS.md

## Claude Code

`AGENTS.md` above is the project guide, shared with Codex. Edit it there, not
here. This section holds only what is specific to Claude Code.

- **Dev servers** are in `.claude/launch.json`. Start them with the preview
  tool, not Bash:
  - `cantusorgani-web` (:4321): local images
  - `cantusorgani-web-public` (:4323): the published R2 images
  - `cantusorgani-prod-preview` (:4322): serves `web/dist` after `pnpm build`
  - `cantusorgani-admin-local` (:8788): the admin screen through
    `wrangler pages dev`, signed in as a dev editor
  - `device-test` (:4330): the export device test, for an iPad on the LAN
- **Worktrees** under `.claude/worktrees/` have no `web/.env`. `pnpm dev`
  still runs, using local image paths. `pnpm build` refuses without
  `PUBLIC_ASSET_BASE`; `scripts/check.sh` exports public defaults for it.
- **Usage.** Read the plan limits (usage tool) and `tools.codex_usage` before
  dispatching. While Claude's weekly limit is the tighter one, give executor
  cards to Codex and keep Claude to coordinating and short read-only reviews.
  Past 80% of Claude's weekly limit, run no Claude subagents at all (see the
  80% rule in `AGENTS.md`).
  A long coordinating session is itself costly: start a fresh session for each
  phase rather than carrying one conversation through everything.
- **Subagents** follow `AGENTS.md` § Working with several agents:
  - Set `model` on every Agent call: `haiku` for search and inventory,
    `sonnet` for bounded cards. Leave Opus for coordinating and reviewing.
  - Use `Explore` for read-only fan-out searches. Give a writing agent its own
    worktree path in the card, rather than letting it work in yours.
  - Run them in the background, at most 3–4 at once, and continue a finished
    agent with SendMessage rather than spawning a fresh one.
- **Codex** is installed and logged in. Hand it mechanical or script cards,
  and use it as the cross-checker for Claude-written diffs. The commands are
  in `AGENTS.md`. Always close stdin (`< /dev/null`), and use
  `-s workspace-write` only inside a card's worktree. Pick the Codex model per
  card with `-m`; the roles are in `AGENTS.md`.
- **Path-scoped rules** in `.claude/rules/` load when you touch matching files.
  They cover the front end, the admin API and Worker, migrations, tests, data
  and security.
- **Hooks** (registered in the maintainer's untracked
  `.claude/settings.local.json`; scripts in `.claude/hooks/`) auto-format on edit and block
  dangerous shell commands. If a hook blocks something, don't route around it.
