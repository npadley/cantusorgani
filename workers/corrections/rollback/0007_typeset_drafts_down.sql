-- Back up first: pnpm exec wrangler d1 export cantusorgani-corrections --remote --output backups/pre-rollback.sql
-- Export first. Deploy old code before removing source draft/snapshot support.
-- Refuse rollback while source corrections are active.
CREATE TABLE typeset_rollback_guard(n INTEGER CHECK(n=0));
INSERT INTO typeset_rollback_guard SELECT COUNT(*) FROM corrections WHERE field='source' AND status IN ('approved','queued');
DROP TABLE typeset_rollback_guard;
DROP TRIGGER freeze_typeset_source;
DROP TRIGGER immutable_typeset_snapshot;
DROP TRIGGER retain_typeset_snapshot;
DROP INDEX idx_typeset_active_source;
DROP TABLE typeset_snapshots;
DROP TABLE typeset_drafts;
