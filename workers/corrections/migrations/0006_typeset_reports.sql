-- Music issues on different drawings must not hide each other.
DROP INDEX idx_corrections_dedupe;
CREATE UNIQUE INDEX idx_corrections_dedupe ON corrections
(COALESCE(target, 'piece:' || piece_id), field, proposed,
 CASE WHEN field = 'issue' THEN COALESCE(seen, '') ELSE '' END) WHERE status = 'pending';
