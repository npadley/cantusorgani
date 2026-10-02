CREATE TABLE typeset_drafts (
  editor_email TEXT NOT NULL, file TEXT NOT NULL, text TEXT NOT NULL CHECK(length(CAST(text AS BLOB)) <= 61440),
  base_blob_sha TEXT NOT NULL, content_hash TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(editor_email,file)
);
CREATE TABLE typeset_snapshots (
  correction_id INTEGER PRIMARY KEY REFERENCES corrections(id), file TEXT NOT NULL,
  text TEXT NOT NULL, base_blob_sha TEXT NOT NULL, content_hash TEXT NOT NULL, editor_email TEXT NOT NULL,
  draft_revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_typeset_active_source ON corrections(target)
WHERE field='source' AND status IN ('approved','queued');
CREATE TRIGGER freeze_typeset_source AFTER INSERT ON corrections WHEN NEW.field='source'
BEGIN
  INSERT INTO typeset_snapshots(correction_id,file,text,base_blob_sha,content_hash,editor_email,draft_revision)
  SELECT NEW.id, file, text, base_blob_sha, content_hash, editor_email, revision FROM typeset_drafts
  WHERE editor_email=NEW.editor_email AND 'typeset:'||file=NEW.target AND content_hash=NEW.proposed AND base_blob_sha=NEW.seen;
  SELECT RAISE(ABORT,'source draft missing') WHERE changes() <> 1;
END;
CREATE TRIGGER immutable_typeset_snapshot BEFORE UPDATE ON typeset_snapshots
BEGIN SELECT RAISE(ABORT,'source snapshots are immutable'); END;
CREATE TRIGGER retain_typeset_snapshot BEFORE DELETE ON typeset_snapshots
BEGIN SELECT RAISE(ABORT,'source snapshots must be retained'); END;
