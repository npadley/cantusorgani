-- Undo migration 0002. Export first:
--   npx wrangler d1 export cantusorgani-corrections --remote --output backups/pre-0002-down.sql
-- then apply by hand (never from migrations/):
--   npx wrangler d1 execute cantusorgani-corrections --remote --file rollback/0002_admin_workflow_down.sql
--
-- Rows in the admin-only
-- statuses cannot be expressed in 0001's CHECK: 'approved' and 'queued' go
-- back to 'pending' (to be reviewed again), 'duplicate' becomes 'rejected'.
-- The admin columns and admin_log are dropped.
CREATE TABLE corrections_old (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id       TEXT NOT NULL,
  field          TEXT NOT NULL,
  proposed       TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  submitter_hash TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','rejected')),
  commit_sha     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO corrections_old (id, piece_id, field, proposed, note, submitter_hash, status,
                             commit_sha, created_at)
  SELECT id, piece_id, field, proposed, note, submitter_hash,
         CASE status WHEN 'approved' THEN 'pending' WHEN 'queued' THEN 'pending'
                     WHEN 'duplicate' THEN 'rejected' ELSE status END,
         commit_sha, created_at
  FROM corrections
  -- The dedupe index allows one pending row per (piece, field, value).
  WHERE id IN (SELECT MIN(id) FROM corrections GROUP BY piece_id, field, proposed,
               CASE WHEN status IN ('pending','approved','queued') THEN 'p' ELSE id END);
DROP TABLE corrections;
ALTER TABLE corrections_old RENAME TO corrections;
CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_rate ON corrections(submitter_hash, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_corrections_dedupe
  ON corrections(piece_id, field, proposed) WHERE status = 'pending';
DROP TABLE IF EXISTS admin_log;
