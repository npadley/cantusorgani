#!/usr/bin/env bash
# Print the private docs clone beside the main checkout, including from worktrees.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)"
printf '%s/../cantusorgani-docs\n' "$(dirname "$COMMON")"
