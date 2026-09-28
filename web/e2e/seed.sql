-- Reader reports for the browser tests, inserted the way the Worker inserts them.
DELETE FROM corrections;
DELETE FROM admin_log;
INSERT INTO corrections (piece_id, field, proposed, note, submitter_hash) VALUES
  ('noh5-ordinarium-missae-iv', 'mode', 'VII', 'The Liber Usualis gives mode VII.', 'e2e'),
  ('ordinarium-missae-iii', 'title', '1', '', 'e2e'),
  ('dominica-ii-adventus', 'title', 'Dominica secunda Adventus', '', 'e2e');
