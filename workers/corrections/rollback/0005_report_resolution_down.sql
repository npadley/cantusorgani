-- Back up first: pnpm exec wrangler d1 export cantusorgani-corrections --remote --output backups/pre-rollback.sql
-- Export first. Removing links loses the explanation of a resolution, while
-- retaining reports, notes and accepted statuses.
DROP TRIGGER IF EXISTS resolve_reports_after_merge;
DROP TRIGGER IF EXISTS reopen_reports_after_withdrawal;
DROP INDEX IF EXISTS idx_corrections_resolution;
ALTER TABLE corrections DROP COLUMN resolved_by;
ALTER TABLE corrections DROP COLUMN duplicate_of;
