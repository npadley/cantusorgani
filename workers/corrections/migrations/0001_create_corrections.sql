-- Migration 0001: corrections intake.
-- Additive only. Never remove or rename a column in the same deploy that stops
-- writing it: deploy the reader first, the writer second, the removal a week later.
CREATE TABLE IF NOT EXISTS corrections (
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

CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status, created_at DESC);

-- Rate limiting counts rows in this window, so this index is load-bearing rather
-- than an optimisation: KV's get-then-put is not atomic and limits nothing.
CREATE INDEX IF NOT EXISTS idx_corrections_rate ON corrections(submitter_hash, created_at);

-- One pending correction per (piece, field, value): resubmitting the same fix
-- must not flood the triage queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_corrections_dedupe
  ON corrections(piece_id, field, proposed) WHERE status = 'pending';
