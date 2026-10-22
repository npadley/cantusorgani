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
- **Subagents.** Run at most 3–4 at once. Reuse an agent (SendMessage) for
  follow-on cards, and use Sonnet or Haiku for bounded cards while Opus
  coordinates.
- **Codex** is installed and logged in, and can take delegated tasks. Run it
  with stdin closed, or it waits forever:
  `codex exec -s read-only -C . -o <out.md> "<prompt>" < /dev/null`.
  Use `-s workspace-write` only in a worktree.
- **Hooks** (`.claude/settings.local.json`) auto-format on edit and block
  dangerous shell commands. If a hook blocks something, don't route around it.
