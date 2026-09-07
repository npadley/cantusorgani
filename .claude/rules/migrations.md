---
paths:
  - "**/migrations/**"
  - "**/*.migration.*"
  - "**/alembic/**"
---

# Database Migration Rules

- Every migration must be reversible — include down/rollback logic
- Never modify existing migrations — create new ones
- Add indexes for foreign keys and frequently queried columns
- Use transactions for multi-step migrations
- Test migrations against a copy of production data when possible
