---
paths:
  - "data/**"
  - "pipeline/**"
---

# Data and pipeline

- Change `corrections.yml` only through `noh correct`, `noh correct-batch` or
  the admin screen.
- Edit sources only (`sections/`, `index-*.yml`,
  `vespers/vespers-*.yml`, `ordinary-form/*.yml`, `good-friday.json`,
  `typeset/src/`). Generated and vendored files are rewritten by `noh`
  commands; the list is in `AGENTS.md`.
- After a hand edit, run `scripts/regenerate.sh` (name volumes to rebuild from
  the scans) and commit everything it changes.
- Corrections are an overlay on the generated catalogue; the printed NOH scans
  decide what is right.
- New `noh` subcommands are added in `pipeline/cli.py` and documented in
  `docs/OPERATIONS.md` in the same PR.
