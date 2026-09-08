#!/usr/bin/env bash
# Create the Cloudflare resources for cantusorgani.org.
#
# Run this AFTER `npx wrangler login`. It is safe to re-run: every step checks
# for an existing resource first and skips it rather than recreating it.
#
# What it creates, and what each costs on Cloudflare's free tier as of writing:
#   R2 bucket   cantusorgani-assets        10 GB storage, no egress charge
#   D1 database cantusorgani-corrections   5 GB, 5M reads/day
#   Pages       cantusorgani               unlimited static requests
#
# It does NOT create the DNS records or attach the custom domain; those are done
# once in the dashboard and are easier to see there than to script blind.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER="npx --yes wrangler@4"
BUCKET="cantusorgani-assets"
DB="cantusorgani-corrections"
PAGES="cantusorgani"
TOML="$ROOT/workers/corrections/wrangler.toml"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Checking authentication"
if ! $WRANGLER whoami 2>&1 | grep -qi "account"; then
  echo "Not authenticated. Run:  npx wrangler login" >&2
  exit 1
fi
$WRANGLER whoami 2>&1 | sed -n '3,8p'

say "R2 bucket: $BUCKET"
if $WRANGLER r2 bucket list 2>/dev/null | grep -q "\b${BUCKET}\b"; then
  echo "  already exists — skipping"
else
  $WRANGLER r2 bucket create "$BUCKET"
fi

say "D1 database: $DB"
if $WRANGLER d1 list --json 2>/dev/null | grep -q "\"name\": *\"${DB}\""; then
  echo "  already exists — skipping"
else
  $WRANGLER d1 create "$DB"
fi

say "Recording the database id in wrangler.toml"
DB_ID="$($WRANGLER d1 list --json 2>/dev/null \
  | python3 -c "import json,sys; print(next((d['uuid'] for d in json.load(sys.stdin) if d['name']=='${DB}'), ''))")"
if [ -z "$DB_ID" ]; then
  echo "Could not read the database id. Set database_id in $TOML by hand." >&2
  exit 1
fi
python3 - "$TOML" "$DB_ID" <<'PY'
import pathlib, sys
path, db_id = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text(encoding="utf-8")
path.write_text(text.replace("PLACEHOLDER_SET_BY_SETUP", db_id), encoding="utf-8")
print(f"  database_id = {db_id}")
PY

say "Applying migrations (local, then remote)"
cd "$ROOT/workers/corrections"
$WRANGLER d1 migrations apply "$DB" --local
$WRANGLER d1 migrations apply "$DB" --remote

say "Pages project: $PAGES"
if $WRANGLER pages project list 2>/dev/null | grep -q "\b${PAGES}\b"; then
  echo "  already exists — skipping"
else
  $WRANGLER pages project create "$PAGES" --production-branch main
fi

say "Done. Remaining steps that are yours:"
cat <<'NEXT'
  1. Attach the custom domain in the dashboard:
       Pages > cantusorgani > Custom domains > cantusorgani.org
  2. Make the R2 bucket publicly readable and note its public URL:
       R2 > cantusorgani-assets > Settings > Public access
     Then set PUBLIC_ASSET_BASE in the site build to that URL.
  3. Create a Turnstile widget for cantusorgani.org and store its secret:
       cd workers/corrections && npx wrangler secret put TURNSTILE_SECRET
  4. Leave CORRECTIONS_ENABLED = "false" in wrangler.toml until the site is live.

  Nothing here has been made public yet: the Worker is not deployed, the bucket
  has no objects, and intake is disabled.
NEXT
