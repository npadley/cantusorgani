import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { approvedConversionFor, loadManifest, parseManifest } from "./mei";
import fixture from "./export-layout/__fixtures__/manifest.fixture.json";
import production from "../../../data/typeset/mei/manifest.json";

const part = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  target: "t/a", renderHash: "a".repeat(32), digest: "b".repeat(64), meiUrl: "/m.mei", meiSha256: "c".repeat(64),
  sourceRevision: "a".repeat(32), profile: "p", verovio: "6.3.0", capabilities: { manualBreaks: true },
  boundaries: [{ id: "b001", onset: "7", sourceBreak: true, division: null, measureId: "m008", afterText: null }], ...over,
});
const manifest = (...parts: unknown[]): unknown => ({ schemaVersion: 1, parts });

describe("parseManifest", () => {
  it("should accept a valid manifest and ignore unknown top-level keys", () => {
    const m = parseManifest({ ...(manifest(part()) as object), _note: "x" });
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0]?.boundaries[0]?.measureId).toBe("m008");
  });

  it("should drop a malformed part and keep the rest", () => {
    const m = parseManifest(manifest(part({ profile: 3 }), part({ target: "t/b" }), part({ boundaries: [{ id: "x" }] })));
    expect(m.parts.map((p) => p.target)).toEqual(["t/b"]);
  });

  it("should return an empty manifest for a wrong schema version or shape", () => {
    expect(parseManifest({ schemaVersion: 2, parts: [part()] }).parts).toEqual([]);
    expect(parseManifest(null).parts).toEqual([]);
    expect(parseManifest({ schemaVersion: 1, parts: "no" }).parts).toEqual([]);
  });

  it("should drop parts with bad hex lengths or case", () => {
    const m = parseManifest(manifest(part({ renderHash: "a".repeat(31) }), part({ digest: "b".repeat(63) }),
      part({ meiSha256: "C".repeat(64) })));
    expect(m.parts).toEqual([]);
  });
});

describe("approvedConversionFor", () => {
  const m = parseManifest(manifest(part()));
  it("should match on both target and render hash", () => {
    expect(approvedConversionFor("t/a", "a".repeat(32), m)?.digest).toBe("b".repeat(64));
    expect(approvedConversionFor("t/a", "d".repeat(32), m)).toBeNull();
    expect(approvedConversionFor("t/z", "a".repeat(32), m)).toBeNull();
  });
});

describe("shipped manifests", () => {
  it("should parse the fixture and match the fixture MEI hash", () => {
    const m = parseManifest(fixture);
    expect(m.parts).toHaveLength(1);
    const mei = readFileSync(new URL("./export-layout/__fixtures__/kyrie-ix.mei", import.meta.url));
    const sha = createHash("sha256").update(mei).digest("hex");
    expect(m.parts[0]?.meiSha256).toBe(sha);
    expect(m.parts[0]?.digest).toBe(sha);
    expect(m.parts[0]?.boundaries).toHaveLength(81);
  });

  it("should ship an empty production manifest", () => {
    expect(parseManifest(production).parts).toEqual([]);
    expect(loadManifest().parts).toEqual([]);
  });
});
