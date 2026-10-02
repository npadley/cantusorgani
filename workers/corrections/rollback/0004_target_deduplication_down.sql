-- Export first. This guard must succeed BEFORE dropping the new index.
-- If distinct targets now collide under the old constraint, stop and keep
-- the new index; deploy a forward fix instead of discarding those reports.
CREATE UNIQUE INDEX idx_corrections_dedupe_rollback_guard
  ON corrections(piece_id, field, proposed) WHERE status = 'pending';
DROP INDEX idx_corrections_dedupe;
CREATE UNIQUE INDEX idx_corrections_dedupe
  ON corrections(piece_id, field, proposed) WHERE status = 'pending';
DROP INDEX idx_corrections_dedupe_rollback_guard;
