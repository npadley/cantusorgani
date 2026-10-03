#!/usr/bin/env bash
# Regenerate every generated data file, in the order they depend on each other.
#
#   scripts/regenerate.sh                 # after a hand edit: corrections, sections, typeset
#   scripts/regenerate.sh noh1 noh3       # also rebuild those volumes from the scans first
#   scripts/regenerate.sh all             # every volume (about half an hour)
#
# Run it after editing anything under data/ by hand, after merging main into a
# branch (with the generated files taken from main), or whenever a check says a
# generated file is not current. It is safe to run twice: the second run changes
# nothing. See docs/OPERATIONS.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VOLUMES=("$@")
if [[ "${VOLUMES[*]:-}" == "all" ]]; then
  VOLUMES=(noh1 noh2 noh3 noh4 noh5 noh8)
fi

step() { printf '\n== %s\n' "$*"; }

# 1. The scans: each volume's pieces, systems and parts (data/catalog.base.json,
#    data/review-queue.json), with data/corrections.yml applied on top.
for volume in ${VOLUMES[@]+"${VOLUMES[@]}"}; do
  step "noh catalog --volume $volume  (a few minutes)"
  uv run noh catalog --volume "$volume"
done

# 2. The overlay: corrections and reviewed section lists into data/catalog.json,
#    the Vespers lineup, reviewed.json, the public log and the typeset manifest.
step "noh apply-corrections"
uv run noh apply-corrections

# 3. The chant notation every part names (CI insists it is current).
step "noh chants"
uv run noh chants

# 4. Which part each typeset transcription is, then the overlay again: the
#    typeset corrections in corrections.yml are checked against parts.yml.
step "noh typeset-match"
uv run noh typeset-match
step "noh apply-corrections"
uv run noh apply-corrections

# 5. The typeset manifest and its checks.
step "noh typeset-manifest"
uv run noh typeset-manifest
step "noh typeset-check"
uv run noh typeset-check

# 6. NOH8 is the Vespers book: its lineup follows a rebuild of it.
if [[ " ${VOLUMES[*]:-} " == *" noh8 "* ]]; then
  step "noh vespers-lineup"
  uv run noh vespers-lineup
fi

# 7. Confirmations a rebuild has undone: their items are back in Review.
step "noh corrections --lapsed"
uv run noh corrections --lapsed

step "done. What changed:"
git status --short data/
