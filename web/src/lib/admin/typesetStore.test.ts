import { beforeEach, expect, it } from "vitest";
import { testDb } from "./testing";
import { typesetStore, sourceContentHash } from "./typesetStore";
import { d1Store } from "./store";
let db: ReturnType<typeof testDb>;
beforeEach(() => { db = testDb(); });
const file = "vol-5/x.ly", email = "ed@example.org", baseBlobSha = "a".repeat(40);
async function draft(text = "c4") { return { file, text, baseBlobSha, contentHash: await sourceContentHash(text) }; }
it("saves durable drafts and isolates editors", async () => {
  const s = typesetStore(db.d1);
  expect(await s.saveDraft(email, await draft(), 0)).toMatchObject({ revision: 1, text: "c4" });
  expect(await typesetStore(db.d1).getDraft(email, file)).toMatchObject({ revision: 1, text: "c4" });
  expect(await s.getDraft("other@example.org", file)).toBeNull();
});
it("allows only one concurrent save at a revision", async () => {
  const s = typesetStore(db.d1); await s.saveDraft(email, await draft(), 0);
  const results = await Promise.all([s.saveDraft(email, await draft("d4"), 1), s.saveDraft(email, await draft("e4"), 1)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await s.getDraft(email, file))?.revision).toBe(2);
});
it("freezes approvals and leaves later drafts independent", async () => {
  const s = typesetStore(db.d1); await s.saveDraft(email, await draft(), 0);
  const id = await s.approveDraft(email, file, 1, "Checked scan"); expect(id).toBeGreaterThan(0);
  await s.saveDraft(email, await draft("d4"), 1);
  expect(await s.snapshots([id!])).toMatchObject([{ correctionId: id, text: "c4", baseBlobSha }]);
  expect(await s.approveDraft("other@example.org", file, 2, "")).toBeNull();
  expect(await s.approveDraft(email, file, 1, "")).toBeNull();
  expect(await d1Store(db.d1).withdraw(id!)).toBe(true);
  expect((await s.getDraft(email, file))?.text).toBe("d4");
});
it("links only eligible same-file reports atomically and resolves after merge", async () => {
  const s = typesetStore(db.d1); await s.saveDraft(email, await draft(), 0);
  const report = Number(db.sqlite.prepare("INSERT INTO corrections (piece_id,target,field,proposed,seen,note) VALUES ('typeset',?,'issue','lyrics',?,'private evidence')").run(`typeset:${file}`, "b".repeat(32)).lastInsertRowid);
  expect(await s.approveDraft(email, file, 1, "", report + 99)).toBeNull();
  const id = await s.approveDraft(email, file, 1, "", report); expect(id).toBeGreaterThan(0);
  expect(db.sqlite.prepare("SELECT resolved_by FROM corrections WHERE id=?").get(report)).toMatchObject({ resolved_by: id });
  await d1Store(db.d1).queueBatch("b-testing", [id!]); await d1Store(db.d1).acceptBatch("b-testing", "c".repeat(40));
  expect(db.sqlite.prepare("SELECT status,note FROM corrections WHERE id=?").get(report)).toMatchObject({ status: "accepted", note: "private evidence" });
});
it("rolls back the whole batch if a statement fails", async () => {
  await expect(db.d1.batch([db.d1.prepare("INSERT INTO admin_log (email,action) VALUES ('e','test')"), db.d1.prepare("INSERT INTO no_such_table VALUES (1)")])).rejects.toThrow();
  expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM admin_log").get()).toMatchObject({ n: 0 });
});
it("rejects stale first saves and prevents snapshot modification", async () => {
  const s = typesetStore(db.d1); expect(await s.saveDraft(email, await draft(), 99)).toBeNull();
  await s.saveDraft(email, await draft(), 0); const id = await s.approveDraft(email, file, 1, "");
  expect(() => db.sqlite.prepare("UPDATE typeset_snapshots SET text='changed' WHERE correction_id=?").run(id!)).toThrow(/immutable/);
});
it("can link another same-file issue to an existing immutable approved correction", async () => {
  const s = typesetStore(db.d1); await s.saveDraft(email, await draft(), 0);
  const fix = await s.approveDraft(email, file, 1, "");
  const report = Number(db.sqlite.prepare("INSERT INTO corrections (piece_id,target,field,proposed,seen) VALUES ('typeset',?,'issue','notation',?)").run(`typeset:${file}`, "b".repeat(32)).lastInsertRowid);
  expect(await d1Store(db.d1).resolveReport(report,fix!,email)).toBe(true);
});
