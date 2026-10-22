---
paths:
  - "workers/corrections/migrations/**"
  - "workers/corrections/rollback/**"
---

# D1 migrations

- Add a new numbered file `migrations/NNNN_name.sql` and its
  `rollback/NNNN_name_down.sql`. Never edit a migration that has been applied.
- Test locally with `pnpm migrate:local` in `workers/corrections/`.
- Applying to the live database happens **before** the code that needs it is
  merged, after a backup, and only by the maintainer: `docs/ADMIN-SETUP.md`
  § 6. Don't run `--remote` yourself.
- Check that the deployed site and Worker still work against the migrated
  schema (indexes and table rebuilds count, not just new columns).
