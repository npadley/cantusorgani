-- Preserve original reports and private notes; link them to their published fixes.
ALTER TABLE corrections ADD COLUMN resolved_by INTEGER REFERENCES corrections(id);
ALTER TABLE corrections ADD COLUMN duplicate_of INTEGER REFERENCES corrections(id);
CREATE INDEX idx_corrections_resolution ON corrections(resolved_by);
CREATE TRIGGER resolve_reports_after_merge AFTER UPDATE OF status ON corrections
WHEN NEW.status = 'accepted' AND OLD.status <> 'accepted'
BEGIN
  UPDATE corrections SET status = 'accepted', commit_sha = NEW.commit_sha,
    pr_number = NEW.pr_number, updated_at = datetime('now')
  WHERE resolved_by = NEW.id AND status = 'pending';
END;
CREATE TRIGGER reopen_reports_after_withdrawal AFTER UPDATE OF status ON corrections
WHEN NEW.status IN ('rejected', 'duplicate') AND OLD.status NOT IN ('rejected', 'duplicate')
BEGIN
  UPDATE corrections SET resolved_by = NULL, updated_at = datetime('now')
  WHERE resolved_by = NEW.id AND status = 'pending';
END;
