import { expect, it } from "vitest";
import { testDb } from "./testing";
import { previewKey, previewStore } from "./typesetPreview";
it("keys cover Unicode source, filename and trusted renderer context",async()=>{
  const key=await previewKey("vol-5/x.ly","é 🎵", "a".repeat(40));
  expect(key).toBe("3e69af309fbe1196a2dfe1f16dd13dcd0f072b75a226bafac90b745f07179c4e");
  expect(await previewKey("vol-5/x.ly","é 🎵","a".repeat(40))).toBe(key);
  expect(await previewKey("vol-5/x.ly","é 🎵","b".repeat(40))).not.toBe(key);
  expect(await previewKey("vol-5/y.ly","é 🎵","a".repeat(40))).not.toBe(key);
});
it("admits exactly one concurrent preview per editor, expires and releases idempotently",async()=>{
  const {d1}=testDb(), store=previewStore(d1);
  const results=await Promise.all([store.acquirePreview("ed","a",0),store.acquirePreview("ed","b",0)]);
  expect(results.filter(r=>r.ok)).toHaveLength(1);
  expect(await store.acquirePreview("ed","c",299999)).toEqual({ok:false,reason:"active"});
  expect((await store.acquirePreview("ed","c",300000)).ok).toBe(true);
  const active=await d1.prepare("SELECT id FROM typeset_previews WHERE preview_key='c'").first<{id:number}>();
  expect(await store.releasePreview("c",active!.id)).toBe(1); expect(await store.releasePreview("c",active!.id)).toBe(0);
});
it("counts dispatch failures and admits only twenty attempts per hour",async()=>{
  const {d1}=testDb(),store=previewStore(d1);
  for(let i=0;i<20;i++){const admitted=await store.acquirePreview("ed",String(i),i);expect(admitted.ok).toBe(true);if(admitted.ok)await store.releasePreview(String(i),admitted.leaseId);}
  expect(await store.acquirePreview("ed","last",20)).toEqual({ok:false,reason:"rate"});
  expect((await store.acquirePreview("ed","later",3600000)).ok).toBe(true);
});
it('failed dispatch cleanup releases only its own lease, even for the same cached key',async()=>{
  const {d1}=testDb(),s=previewStore(d1);
  const first=await s.acquirePreview('one','same',0),second=await s.acquirePreview('two','same',0);
  if(!first.ok || !second.ok)throw Error('admission failed');
  expect(await s.releaseLease(second.leaseId)).toBe(1);
  expect(await s.acquirePreview('one','next',1)).toEqual({ok:false,reason:'active'});
});
it('completion of an old attempt cannot release a newer attempt for the same key',async()=>{
  const {d1}=testDb(),s=previewStore(d1);
  const old=await s.acquirePreview('ed','same',0);if(!old.ok)throw Error('admission');
  await s.releasePreview('same',old.leaseId);
  const newer=await s.acquirePreview('ed','same',1);if(!newer.ok)throw Error('admission');
  expect(await s.releasePreview('same',old.leaseId)).toBe(0);
  expect(await s.acquirePreview('ed','other',2)).toEqual({ok:false,reason:'active'});
});
