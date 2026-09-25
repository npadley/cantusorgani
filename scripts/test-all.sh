#!/usr/bin/env bash
# Every suite, with coverage floors enforced. Needs the source PDFs in pdf-source/
# and Tesseract with Latin data; `uv run noh doctor` checks both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== pipeline and tools (python) =="
uv run pytest tests/ -q --cov --cov-report=term

echo "== corrections worker =="
(cd workers/corrections && pnpm vitest run --coverage && pnpm typecheck)

echo "== site library =="
(cd web && pnpm vitest run --coverage && pnpm astro check)

echo "== lint =="
uv run ruff check pipeline/ tools/ tests/
