import { beforeEach, expect, it } from "vitest";
import { handleAdmin } from "./api";
import type { AdminEnv, Deps } from "./api";
import { d1Store } from "./store";
import { testDb, targets } from "./testing";
let db: ReturnType<typeof testDb>;
let current = { text: "c4", blobSha: "a".repeat(40) };
const file = "vol-5/x.ly", origin = "http://localhost:8799";
let deps: Deps;
beforeEach(() => {
  db = testDb(); current = { text: "c4", blobSha: "a".repeat(40) };
  deps = { reviews: async () => ({items:{}}), store: d1Store(db.d1), targets: async () => ({ ...targets(), typeset: { [file]: { label: "Kyrie", match: "", broken: null } } }),
    authenticate: async () => ({ ok: true, editor: { email: "ed@example.org", owner: false } }), dispatch: async () => {},
    source: { readMain: async () => ({ commitSha: "b".repeat(40), treeSha: "c".repeat(40) }), readSource: async () => current } };
});
async function call(path: string, input?: unknown, requestOrigin = origin) {
  const response = await handleAdmin(new Request(`${origin}/admin/api/typeset/${path}`, { method: input ? "POST" : "GET",
    headers: { origin: requestOrigin, "content-type": "application/json" }, ...(input ? { body: JSON.stringify(input) } : {}) }), { DB: db.d1 } as AdminEnv, deps);
  return { status: response.status, data: await response.json() };
}
it("loads, saves, reloads and approves a private durable draft", async () => {
  expect((await call(`source?file=${file}`)).data).toMatchObject({ current, draft: null });
  expect((await call("draft", { file, text: "d4", baseBlobSha: current.blobSha, expectedRevision: 0 })).status).toBe(200);
  expect((await call(`source?file=${file}`)).data.draft).toMatchObject({ text: "d4", revision: 1 });
  expect((await call("approve", { file, expectedRevision: 1, note: "Checked scan" })).status).toBe(201);
});
it("rejects cross-origin, unknown files, unsafe source and oversized UTF-8", async () => {
  const input = { file, text: "d4", baseBlobSha: current.blobSha, expectedRevision: 0 };
  expect((await call("draft", input, "https://evil.test")).status).toBe(403);
  expect((await call("draft", { ...input, file: "../x.ly" })).status).toBe(422);
  expect((await call("draft", { ...input, text: '#(system "evil")' })).status).toBe(422);
  expect((await call("draft", { ...input, text: "é".repeat(30721) })).status).toBe(413);
  expect((await call("draft", { ...input, text: "é".repeat(30720) })).status).toBe(200);
});
it("returns current and draft versions when the repository base is stale", async () => {
  await call("draft", { file, text: "d4", baseBlobSha: current.blobSha, expectedRevision: 0 });
  current = { text: "e4", blobSha: "d".repeat(40) };
  const conflict = await call("approve", { file, expectedRevision: 1 });
  expect(conflict.status).toBe(409); expect(conflict.data).toMatchObject({ current, draft: { text: "d4" } });
  expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM corrections").get()).toMatchObject({ n: 0 });
});
