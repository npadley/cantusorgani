-- Undo migration 0003. Export first (skipped items' notes are lost):
--   npx wrangler d1 export cantusorgani-corrections --remote --output backups/pre-0003-down.sql
-- then apply by hand (never from migrations/):
--   npx wrangler d1 execute cantusorgani-corrections --remote --file rollback/0003_reviews_down.sql
DROP TABLE IF EXISTS review_skips;
ALTER TABLE corrections DROP COLUMN seen;
