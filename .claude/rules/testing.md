---
paths:
  - "tests/**"
  - "web/**/*.test.ts"
  - "web/e2e/**"
  - "workers/corrections/test/**"
---

# Tests

- Python (pytest, `tests/`): name tests `test_<thing>_<scenario>_<expected>`.
  Mark tests that need the scanned PDFs `source`, 300dpi renders `slow`,
  LilyPond `lilypond`. CI runs `-m "not slow"`.
- TypeScript (vitest): colocated `*.test.ts`, `describe('<module>')` /
  `it('<does what>')`. Playwright: `web/e2e/*.e2e.ts`; run export tests with
  `pnpm build:e2e && pnpm test:e2e:export`.
- For a bug fix, write the failing test first.
- Prefer the existing fixtures (`web/src/lib/__fixtures__/`, `tests/` fixtures)
  over new inline data; never use the live catalogue where a fixture will do.
- Never commit `.only` or `.skip`.
- Coverage floor is 95% on the full Python suite (`scripts/test-all.sh`, needs
  the PDFs); don't lower it.
