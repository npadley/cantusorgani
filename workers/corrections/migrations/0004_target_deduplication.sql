-- A report names a target, not just its containing piece. Keep all rows;
-- equivalent legacy NULL and explicit piece targets share an identity.
-- The old index already prevents duplicates within the new identity.
DROP INDEX idx_corrections_dedupe;
CREATE UNIQUE INDEX idx_corrections_dedupe
  ON corrections(COALESCE(target, 'piece:' || piece_id), field, proposed)
  WHERE status = 'pending';

-- Rollback: rollback/0004_target_deduplication_down.sql. Restoring the old
-- constraint may be impossible once different targets have received reports
-- with equal values. The rollback refuses that case; never delete reports.
