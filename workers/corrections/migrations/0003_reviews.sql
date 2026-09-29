-- Migration 0003: reviews in the admin screen (docs/claudekit/plans/
-- 2026-09-28-typesetting-plan.md, PR 1).
--
-- A review ("looks right") is an ordinary approved row with field 'reviewed'
-- and proposed 'yes'. `seen` is what the editor was shown -- a review-queue
-- item's fingerprint, or a part's start and length -- sent with the batch so
-- `noh correct-batch` refuses a review of something that has since changed.
--
-- review_skips: an editor looked, could not settle it, and left a note for the
-- others. Kept here only; never published.
--
-- Additive only. Rollback: rollback/0003_reviews_down.sql.

ALTER TABLE corrections ADD COLUMN seen TEXT;

CREATE TABLE IF NOT EXISTS review_skips (
  target       TEXT PRIMARY KEY,
  note         TEXT NOT NULL,
  editor_email TEXT NOT NULL,
  at           TEXT NOT NULL DEFAULT (datetime('now'))
);
