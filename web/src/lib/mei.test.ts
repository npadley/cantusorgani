import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findFixtureMarkers, fixtureMarkers } from "../../scripts/check-no-fixture";
import { approvedConversionFor, loadManifest, parseManifest, withAssetBase } from "./mei";
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

  it("should ship only the approved Kyrie IX conversion, published under its own digest", () => {
    const parts = parseManifest(production).parts;
    expect(parts.map((p) => p.target)).toEqual(["movement:ordinarium-missae-ix/kyrie"]);
    expect(parts[0]?.meiUrl).toBe(`/mei/${parts[0]?.meiSha256}/score.mei`);
    expect(parts[0]?.profile).not.toContain("unapproved");
  });

});

describe("withAssetBase", () => {
  it("should resolve a published MEI path against the asset host", () => {
    const m = withAssetBase(parseManifest(production), "https://images.example.org");
    expect(m.parts[0]?.meiUrl).toMatch(/^https:\/\/images\.example\.org\/mei\/[0-9a-f]{64}\/score\.mei$/);
  });

  it("should leave an absolute MEI URL unchanged", () => {
    const abs = parseManifest({ ...production, parts: production.parts.map((p) => ({ ...p, meiUrl: "https://other.example/x.mei" })) });
    expect(withAssetBase(abs, "https://images.example.org").parts[0]?.meiUrl).toBe("https://other.example/x.mei");
  });
});

describe("the fixture manifest never reaches production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("should return the production manifest unless PUBLIC_MEI_MANIFEST is exactly \"fixture\"", () => {
    const prod = withAssetBase(parseManifest(production));
    for (const value of [undefined, "", "production", "Fixture", "FIXTURE", "fixture ", "true", "1", "fixtures"]) {
      if (value === undefined) vi.stubEnv("PUBLIC_MEI_MANIFEST", undefined as unknown as string);
      else vi.stubEnv("PUBLIC_MEI_MANIFEST", value);
      expect(loadManifest(), String(value)).toEqual(prod);
      expect(loadManifest().parts.some((p) => p.profile.includes("unapproved")), String(value)).toBe(false);
    }
    vi.stubEnv("PUBLIC_MEI_MANIFEST", "fixture");
    expect(loadManifest()).toEqual(parseManifest(fixture));
    expect(loadManifest().parts).toHaveLength(1);
  });

  it("should know markers that exist only in the fixture, and find them in a build output", () => {
    const markers = fixtureMarkers();
    expect(markers).toContain(fixture.parts[0]!.meiUrl);
    // A digest shared with an approved production conversion is published content, not a fixture leak.
    const published = new Set(production.parts.map((p) => p.meiSha256));
    expect(markers.includes(fixture.parts[0]!.meiSha256)).toBe(!published.has(fixture.parts[0]!.meiSha256));
    // The fixture's render hash is the real Kyrie hash that pages use, so it must NOT be a marker.
    expect(markers).not.toContain(fixture.parts[0]!.renderHash);
    const dir = mkdtempSync(join(tmpdir(), "nofixture-"));
    try {
      mkdirSync(join(dir, "_astro"));
      writeFileSync(join(dir, "index.html"), `<p>${fixture.parts[0]!.renderHash}</p>`);
      writeFileSync(join(dir, "_astro", "ok.js"), "export const a = 1;");
      expect(findFixtureMarkers(dir)).toEqual([]);
      writeFileSync(join(dir, "_astro", "leak.js"), `const m = "${fixture.parts[0]!.meiUrl}";`);
      expect([...new Set(findFixtureMarkers(dir).map((h) => h.file))]).toEqual([join(dir, "_astro", "leak.js")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should leave no fixture content in the normal build output when one exists", () => {
    // dist/ is the production build (pnpm build runs the same check); skip when it has not been built.
    const dist = new URL("../../dist/", import.meta.url).pathname;
    let built = true;
    try { findFixtureMarkers(dist, ["x"]); } catch { built = false; }
    if (built) expect(findFixtureMarkers(dist)).toEqual([]);
  });
});
