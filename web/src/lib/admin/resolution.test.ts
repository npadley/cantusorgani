import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { readerReport, testDb } from "./testing";

const root = resolve(__dirname, "../../../../workers/corrections");
it("upgrades a populated database and rolls back links without losing reports or notes", () => {
  const { sqlite } = testDb(4);
  const report = readerReport(sqlite, "dominica", "sections", "missing tract", "private evidence");
  sqlite.exec(readFileSync(resolve(root, "migrations/0005_report_resolution.sql"), "utf8"));
  const fix = Number(sqlite.prepare("INSERT INTO corrections (piece_id, target, field, proposed, status, source) VALUES ('dominica', 'sections:dominica', 'sections', '[]', 'approved', 'editor')").run().lastInsertRowid);
  sqlite.prepare("UPDATE corrections SET resolved_by = ? WHERE id = ?").run(fix, report);
  sqlite.prepare("UPDATE corrections SET status = 'accepted', commit_sha = ? WHERE id = ?").run("a".repeat(40), fix);
  expect(sqlite.prepare("SELECT status, resolved_by, note, commit_sha FROM corrections WHERE id = ?").get(report))
    .toMatchObject({ status: "accepted", resolved_by: fix, note: "private evidence", commit_sha: "a".repeat(40) });
  sqlite.exec(readFileSync(resolve(root, "rollback/0005_report_resolution_down.sql"), "utf8"));
  expect(sqlite.prepare("SELECT status, note, commit_sha FROM corrections WHERE id = ?").get(report))
    .toMatchObject({ status: "accepted", note: "private evidence", commit_sha: "a".repeat(40) });
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM corrections").get()).toMatchObject({ n: 2 });
  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all()).toEqual([]);
});
