-- Down migration for 0001.
--
-- This destroys the pending correction queue. Export before running it:
--   npx wrangler d1 export cantusorgani-corrections --output backups/pre-down.sql
--
-- Lives in rollback/, NOT migrations/. `wrangler d1 migrations apply` runs every
-- .sql file in the migrations directory in lexical order, so a down script kept
-- beside its up script creates the table and immediately drops it again — and
-- reports both with a green tick. That is exactly what happened on the first
-- deploy of this database. Apply this by hand only:
--   npx wrangler d1 execute cantusorgani-corrections --remote --file rollback/0001_create_corrections_down.sql
--
-- Reaching for it should be rare. Pausing intake via CORRECTIONS_ENABLED is
-- almost always the right move instead.
DROP INDEX IF EXISTS idx_corrections_dedupe;
DROP INDEX IF EXISTS idx_corrections_rate;
DROP INDEX IF EXISTS idx_corrections_status;
DROP TABLE IF EXISTS corrections;
