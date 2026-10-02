CREATE TABLE typeset_previews (
  id INTEGER PRIMARY KEY,
  editor_email TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  admitted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released INTEGER NOT NULL DEFAULT 0 CHECK(released IN (0,1))
);
CREATE UNIQUE INDEX idx_typeset_preview_active ON typeset_previews(editor_email) WHERE released=0;
CREATE INDEX idx_typeset_preview_rate ON typeset_previews(editor_email,admitted_at);
