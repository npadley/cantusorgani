#!/usr/bin/env bash
# Run the checks a pull request runs on GitHub (.github/workflows/site.yml), here.
#
#   scripts/check.sh            # everything: about 8 minutes
#   scripts/check.sh --quick    # skip the build and the browser tests: about 5 minutes
#
# Stops at the first failure and says which step. See docs/OPERATIONS.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=false
if [[ "${1:-}" == "--quick" ]]; then QUICK=true; fi

step() { printf '\n== %s\n' "$*"; }
trap 'printf "\nFAILED at: %s\n" "${CURRENT:-setup}" >&2' ERR

CURRENT="lint";               step "$CURRENT";  uv run ruff check pipeline tools tests
CURRENT="pipeline tests";     step "$CURRENT";  uv run pytest -q -m "not slow"
CURRENT="corrections applied"; step "$CURRENT"; uv run noh apply-corrections --check
CURRENT="typeset sources";    step "$CURRENT";  uv run noh typeset-check
CURRENT="chant notation current"; step "$CURRENT"
uv run noh chants
git diff --exit-code --stat data/chants.json || {
  echo "data/chants.json changed: commit it (it was not current)"; false; }

# A fresh checkout or worktree has no packages installed yet.
for dir in web workers/corrections; do
  [[ -d "$dir/node_modules" ]] || (cd "$dir" && pnpm install --frozen-lockfile)
done

cd web
CURRENT="site type check";    step "$CURRENT";  pnpm exec astro check
CURRENT="site tests";         step "$CURRENT";  pnpm exec vitest run
CURRENT="corrections worker tests"; step "$CURRENT"
(cd ../workers/corrections && pnpm exec tsc --noEmit && pnpm exec vitest run)

if ! $QUICK; then
  # A build needs the site's public settings. The main checkout reads them from
  # web/.env (the 1Password mount). Elsewhere (a worktree), these public
  # defaults stand in; the Turnstile key is Cloudflare's always-pass test key.
  if [[ ! -e .env ]]; then
    export PUBLIC_ASSET_BASE="${PUBLIC_ASSET_BASE:-https://images.cantusorgani.org}"
    export PUBLIC_CORRECTIONS_ENDPOINT="${PUBLIC_CORRECTIONS_ENDPOINT:-https://api.cantusorgani.org}"
    export PUBLIC_TURNSTILE_SITE_KEY="${PUBLIC_TURNSTILE_SITE_KEY:-1x00000000000000000000AA}"
  fi
  CURRENT="build and link check"; step "$CURRENT"; pnpm build
  CURRENT="browser tests";      step "$CURRENT";  CI=true pnpm exec playwright test < /dev/null
fi

trap - ERR
printf '\nAll checks passed.\n'
