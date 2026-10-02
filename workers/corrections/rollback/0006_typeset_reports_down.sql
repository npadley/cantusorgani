-- Back up first: pnpm exec wrangler d1 export cantusorgani-corrections --remote --output backups/pre-rollback.sql
-- Refuse rollback if distinct drawings would collide; preserve every report.
CREATE UNIQUE INDEX idx_corrections_rollback_guard ON corrections
(COALESCE(target, 'piece:' || piece_id), field, proposed) WHERE status = 'pending';
DROP INDEX idx_corrections_dedupe;
CREATE UNIQUE INDEX idx_corrections_dedupe ON corrections
(COALESCE(target, 'piece:' || piece_id), field, proposed) WHERE status = 'pending';
DROP INDEX idx_corrections_rollback_guard;
