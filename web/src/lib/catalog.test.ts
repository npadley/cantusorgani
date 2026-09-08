import { describe, expect, it } from "vitest";

import {
  MOVEMENT_ORDER,
  SCHEMA_VERSION,
  allPieces,
  assetBase,
  loadCatalog,
  orderedChant,
  ordinaryMasses,
  pieceBySlug,
} from "./catalog";

describe("catalog", () => {
  it("loads with the expected schema version", () => {
    expect(loadCatalog().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("maps snake_case to camelCase rather than casting", () => {
    // A double cast would compile and ship `undefined` to every template.
    const piece = pieceBySlug("ordinarium-missae-i");
    expect(piece).toBeDefined();
    expect(piece?.printedPages).toEqual([5, 10]);
    expect(piece?.pdfPages).toEqual([51, 56]);
  });

  it("exposes all 46 pieces", () => {
    expect(allPieces()).toHaveLength(46);
  });

  it("lists the eighteen ordinary Masses in printed order", () => {
    const masses = ordinaryMasses();
    expect(masses).toHaveLength(18);
    expect(masses[0]?.label).toBe("I");
    expect(masses.at(-1)?.label).toBe("XVIII");
    const pages = masses.map((m) => m.printedPages[0]);
    expect([...pages].sort((a, b) => a - b)).toEqual(pages);
  });

  it("gives every system a matching aspect ratio", () => {
    for (const piece of allPieces()) {
      expect(piece.systemAspect).toHaveLength(piece.systems.length);
      for (const [w, h] of piece.systemAspect) {
        expect(w).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(0);
      }
    }
  });

  it("keeps record status separate from chant pairing status", () => {
    // A piece can have a verified chant pairing and an unverified record.
    for (const piece of allPieces()) {
      expect(["verified", "unmatched", "review"]).toContain(piece.status);
      for (const chant of piece.chant) {
        expect(["verified", "unverified", "unpaired"]).toContain(chant.status);
      }
    }
  });

  it("orders chant pairings liturgically, not alphabetically", () => {
    const missaI = pieceBySlug("ordinarium-missae-i");
    const order = orderedChant(missaI!).map((c) => c.movement);
    expect(order).toEqual(["kyrie", "gloria", "sanctus", "agnus", "ite"]);
    // Alphabetical would put agnus first, which is liturgically nonsense.
    expect(order[0]).not.toBe("agnus");
  });

  it("never publishes an unpaired chant", () => {
    for (const piece of allPieces()) {
      for (const chant of piece.chant) {
        expect(chant.status).not.toBe("unpaired");
      }
    }
  });

  it("carries chant attribution with the data", () => {
    const source = loadCatalog().chantSource;
    expect(source?.licence).toBe("CC BY-SA 4.0");
    expect(source?.url).toContain("gregobase");
  });

  it("falls back to a local asset base before R2 is configured", () => {
    expect(assetBase()).toMatch(/^(https?:\/\/|\/)/);
    expect(assetBase().endsWith("/")).toBe(false);
  });

  it("has a movement order that is liturgical", () => {
    expect(MOVEMENT_ORDER[0]).toBe("kyrie");
    expect(MOVEMENT_ORDER.indexOf("gloria")).toBeLessThan(MOVEMENT_ORDER.indexOf("sanctus"));
    expect(MOVEMENT_ORDER.at(-1)).toBe("ite");
  });
});

describe("systemUrlStem", () => {
  it("uses the published content-hashed key, not the bare ref", async () => {
    const { systemUrlStem, pieceBySlug } = await import("./catalog");
    const piece = pieceBySlug("ordinarium-missae-i")!;
    const stem = systemUrlStem(piece, 0);
    // Published keys carry a content hash. Deriving a URL from the ref alone
    // 404s every image in production while working fine against local files.
    expect(stem).toMatch(/systems\/noh5\/\d{4}\/\d{3}-[0-9a-f]{12}$/);
    expect(stem).not.toMatch(/\/noh5\/\d{4}\/\d{3}$/);
  });

  it("gives every system a distinct URL", async () => {
    const { systemUrlStem, pieceBySlug } = await import("./catalog");
    const piece = pieceBySlug("ordinarium-missae-i")!;
    const stems = piece.systems.map((_, i) => systemUrlStem(piece, i));
    expect(new Set(stems).size).toBe(stems.length);
  });

  it("records an asset key for every system", async () => {
    const { allPieces } = await import("./catalog");
    for (const piece of allPieces()) {
      expect(piece.systemAssets).toHaveLength(piece.systems.length);
      for (const asset of piece.systemAssets) {
        expect(asset).toMatch(/^systems\//);
      }
    }
  });
});
