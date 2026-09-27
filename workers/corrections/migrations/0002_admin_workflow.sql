-- Migration 0002: the admin screen's workflow (docs/claudekit/plans/
-- 2026-09-27-editing-admin-refactor-plan.md, Part 2).
--
-- A table rebuild, not an ALTER: SQLite cannot change a CHECK constraint. Every
-- existing row is copied; the old columns keep their meaning, so the reader
-- intake (src/index.ts) keeps working unchanged against the new table.
--
-- Statuses:
--   pending    a reader's report, not yet reviewed
--   approved   accepted (or written) by an editor, waiting to be published
--   queued     sent in a batch; its pull request is open or being opened
--   accepted   merged into data/corrections.yml (commit_sha records the merge)
--   rejected   turned down (reason says why)
--   duplicate  the same report as another row
--
-- Rollback: rollback/0002_admin_workflow_down.sql (export first: pnpm backup).

CREATE TABLE corrections_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  piece_id       TEXT NOT NULL,
  -- What is corrected: 'piece:<slug>'. NULL on reader rows, which name a
  -- piece_id only; readers use COALESCE(target, 'piece:' || piece_id).
  target         TEXT,
  field          TEXT NOT NULL,
  proposed       TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  submitter_hash TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','queued','accepted','rejected','duplicate')),
  source         TEXT NOT NULL DEFAULT 'reader' CHECK (source IN ('reader','editor')),
  commit_sha     TEXT,
  editor_email   TEXT,
  reason         TEXT,
  batch_id       TEXT,
  pr_number      INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT
);

INSERT INTO corrections_new (id, piece_id, field, proposed, note, submitter_hash, status,
                             commit_sha, created_at)
  SELECT id, piece_id, field, proposed, note, submitter_hash, status, commit_sha, created_at
  FROM corrections;

DROP TABLE corrections;
ALTER TABLE corrections_new RENAME TO corrections;

CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_rate ON corrections(submitter_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_corrections_batch ON corrections(batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_corrections_dedupe
  ON corrections(piece_id, field, proposed) WHERE status = 'pending';

-- Who did what, and when: every admin action. Also the admin rate limit.
CREATE TABLE IF NOT EXISTS admin_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  action        TEXT NOT NULL,
  correction_id INTEGER,
  detail        TEXT NOT NULL DEFAULT '',
  at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_log_rate ON admin_log(email, at);
