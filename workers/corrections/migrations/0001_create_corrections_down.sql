-- Down migration for 0001.
--
-- This destroys the pending correction queue. Export before running it:
--   npx wrangler d1 export cantusorgani-corrections --output backups/pre-down.sql
--
-- Kept as a file rather than a habit: the rollback contract in the plan requires
-- every migration to have a paired down script, but reaching for this one should
-- be rare. Pausing intake via CORRECTIONS_ENABLED is almost always the right
-- move instead.
DROP INDEX IF EXISTS idx_corrections_dedupe;
DROP INDEX IF EXISTS idx_corrections_rate;
DROP INDEX IF EXISTS idx_corrections_status;
DROP TABLE IF EXISTS corrections;
