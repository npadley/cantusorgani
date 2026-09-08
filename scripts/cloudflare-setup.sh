#!/usr/bin/env bash
# Create the Cloudflare resources for cantusorgani.org.
#
# Run this AFTER `npx wrangler login`. Safe to re-run: every step checks for an
# existing resource first and skips rather than recreating.
#
# Each resource is independent, so a failure in one is reported and the rest
# still run. A summary at the end says what exists and what is still blocked.
#
# What it creates, and the free-tier allowance for each:
#   R2 bucket   cantusorgani-assets        10 GB storage, no egress charge
#   D1 database cantusorgani-corrections   5 GB, 5M reads/day
#   Pages       cantusorgani               unlimited static requests
#
# It does NOT attach the custom domain, make the bucket public, or deploy the
# Worker. Those three are what actually expose something, and are clearer in the
# dashboard than scripted blind.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER="npx --yes wrangler@4"
BUCKET="cantusorgani-assets"
DB="cantusorgani-corrections"
PAGES="cantusorgani"
TOML="$ROOT/workers/corrections/wrangler.toml"

R2_STATE="not attempted"
D1_STATE="not attempted"
PAGES_STATE="not attempted"
MIGRATE_STATE="not attempted"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m  %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  %s\033[0m\n' "$*"; }

say "Checking authentication"
if ! $WRANGLER whoami 2>&1 | grep -qi "you are logged in"; then
  fail "Not authenticated. Run:  npx wrangler login"
  exit 1
fi
ok "authenticated"

# ---------------------------------------------------------------- R2 ---------
say "R2 bucket: $BUCKET"
if $WRANGLER r2 bucket list 2>/dev/null | grep -q "${BUCKET}"; then
  ok "already exists"
  R2_STATE="ok (existing)"
elif OUT="$($WRANGLER r2 bucket create "$BUCKET" 2>&1)"; then
  ok "created"
  R2_STATE="ok (created)"
else
  echo "$OUT" | sed -n '/ERROR/,+4p'
  if echo "$OUT" | grep -q "10042"; then
    R2_STATE="BLOCKED: R2 not enabled on this account"
    fail "R2 is not enabled yet. Enable it once in the dashboard:"
    fail "  https://dash.cloudflare.com/?to=/:account/r2"
    fail "Cloudflare asks for a payment method even for the free 10 GB tier."
  else
    R2_STATE="FAILED (see output above)"
  fi
fi

# ---------------------------------------------------------------- D1 ---------
say "D1 database: $DB"
if $WRANGLER d1 list --json 2>/dev/null | grep -q "\"name\": *\"${DB}\""; then
  ok "already exists"
  D1_STATE="ok (existing)"
elif OUT="$($WRANGLER d1 create "$DB" 2>&1)"; then
  ok "created"
  D1_STATE="ok (created)"
else
  echo "$OUT" | sed -n '/ERROR/,+4p'
  D1_STATE="FAILED (see output above)"
fi

if [[ "$D1_STATE" == ok* ]]; then
  say "Recording the database id in wrangler.toml"
  DB_ID="$($WRANGLER d1 list --json 2>/dev/null \
    | python3 -c "import json,sys; print(next((d['uuid'] for d in json.load(sys.stdin) if d['name']=='${DB}'), ''))" 2>/dev/null)"
  if [ -z "$DB_ID" ]; then
    fail "could not read the database id; set database_id in $TOML by hand"
  else
    python3 - "$TOML" "$DB_ID" <<'PY'
import pathlib, sys
path, db_id = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text(encoding="utf-8")
if "PLACEHOLDER_SET_BY_SETUP" in text:
    path.write_text(text.replace("PLACEHOLDER_SET_BY_SETUP", db_id), encoding="utf-8")
    print(f"  database_id = {db_id}")
else:
    print("  database_id already set — leaving it alone")
PY
    say "Applying migrations"
    if (cd "$ROOT/workers/corrections" \
        && $WRANGLER d1 migrations apply "$DB" --local \
        && $WRANGLER d1 migrations apply "$DB" --remote); then
      ok "migrations applied"
      MIGRATE_STATE="ok"
    else
      MIGRATE_STATE="FAILED"
      fail "migrations did not apply"
    fi
  fi
fi

# ------------------------------------------------------------- Pages ---------
say "Pages project: $PAGES"
if $WRANGLER pages project list 2>/dev/null | grep -q "${PAGES}"; then
  ok "already exists"
  PAGES_STATE="ok (existing)"
elif OUT="$($WRANGLER pages project create "$PAGES" --production-branch main 2>&1)"; then
  ok "created"
  PAGES_STATE="ok (created)"
else
  echo "$OUT" | sed -n '/ERROR/,+4p'
  PAGES_STATE="FAILED (see output above)"
fi

# ----------------------------------------------------------- summary ---------
say "Summary"
printf '  %-28s %s\n' "R2 bucket"      "$R2_STATE"
printf '  %-28s %s\n' "D1 database"    "$D1_STATE"
printf '  %-28s %s\n' "D1 migrations"  "$MIGRATE_STATE"
printf '  %-28s %s\n' "Pages project"  "$PAGES_STATE"

say "Still yours to do, in the dashboard:"
cat <<'NEXT'
  1. If R2 is blocked above, enable it, then re-run this script.
  2. Attach the custom domain:
       Pages > cantusorgani > Custom domains > cantusorgani.org
  3. Make the R2 bucket publicly readable and note its public URL:
       R2 > cantusorgani-assets > Settings > Public access
     Then set PUBLIC_ASSET_BASE for the site build to that URL.
  4. Create a Turnstile widget for cantusorgani.org and store its secret:
       cd workers/corrections && npx wrangler secret put TURNSTILE_SECRET

  Nothing is public yet: the Worker is not deployed, the bucket has no objects,
  and CORRECTIONS_ENABLED is "false".
NEXT
