---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/tests/**"
  - "**/test_*"
  - "**/__tests__/**"
---

# Test Writing Rules

- Python test naming: `test_[function]_[scenario]_[expected]`
- TypeScript test naming: `describe('[Component]', () => { it('should [behavior]') })`
- Each test file must have at least one happy path and one error case
- Mock external dependencies, not internal modules
- Use factories/fixtures over inline test data
- Never commit `.skip()` or `.only()` — remove before pushing
- Minimum coverage: 80% overall, 95% for critical paths
- Prefer pytest for Python, vitest for TypeScript
