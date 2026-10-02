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
it("saves preview drafts, counts failed dispatches and releases their leases",async()=>{
  let attempts=0;deps={...deps,previewDispatch:async()=>{attempts++;throw Error('dispatch failed');}};
  const env={DB:db.d1,PUBLIC_ASSET_BASE:'https://assets.example.test'} as AdminEnv;
  const preview=async(revision:number)=>handleAdmin(new Request(`${origin}/admin/api/typeset/preview`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({file,text:'d4',baseBlobSha:current.blobSha,expectedRevision:revision})}),env,deps);
  expect((await preview(0)).status).toBe(502);
  expect((await preview(1)).status).toBe(502);
  expect(attempts).toBe(2);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM typeset_previews WHERE released=1').get()).toMatchObject({n:2});
  deps={...deps,previewDispatch:async(payload)=>{expect(JSON.stringify(payload)).not.toContain('private-note');}};
  const success=await preview(2);expect(success.status).toBe(200);
  const data=await success.json();expect(data.resultUrl).toBe(`https://assets.example.test/typeset-preview/${data.key}/result.json`);
  expect((await preview(3)).status).toBe(429);
});
it('shows the active immutable approval for comparison and linking another report',async()=>{
  await call('draft',{file,text:'d4',baseBlobSha:current.blobSha,expectedRevision:0});
  const approved=await call('approve',{file,expectedRevision:1,note:'Checked'});
  await call('draft',{file,text:'e4',baseBlobSha:current.blobSha,expectedRevision:1});
  expect((await call(`source?file=${file}`)).data.approved).toMatchObject({correctionId:approved.data.id,text:'d4',status:'approved'});
});
