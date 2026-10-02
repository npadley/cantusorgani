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
  expect(await store.releasePreview("c")).toBe(1); expect(await store.releasePreview("c")).toBe(0);
});
it("counts dispatch failures and admits only twenty attempts per hour",async()=>{
  const {d1}=testDb(),store=previewStore(d1);
  for(let i=0;i<20;i++){expect((await store.acquirePreview("ed",String(i),i)).ok).toBe(true);await store.releasePreview(String(i));}
  expect(await store.acquirePreview("ed","last",20)).toEqual({ok:false,reason:"rate"});
  expect((await store.acquirePreview("ed","later",3600000)).ok).toBe(true);
});
