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

  it("should keep all 46 pieces of the Kyriale volume", () => {
    expect(allPieces().filter((p) => p.volume === "noh5")).toHaveLength(46);
  });

  it("should give every piece a slug unique across all volumes", () => {
    const slugs = allPieces().map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
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
    expect(source?.licence).toBe("CC0");
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

/** Factory for a minimal valid raw piece, so each rejection test changes one thing. */
function rawPiece(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "noh5-x", volume: "noh5", slug: "x", section: "S", label: "I", title: "T",
    incipit: null, genre: "kyrie", mode: null, mass: null,
    printed_pages: [1, 2], pdf_pages: [47, 48],
    systems: ["noh5/0047/000"], system_assets: ["systems/noh5/0047/000-aaaaaaaaaaaa"],
    system_aspect: [[1000, 250]], movements: [], chant: null, review_status: "verified",
    ...overrides,
  };
}

function rawCatalog(pieces: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2, volumes: { noh5: { title: "Kyriale", part: "V", page_map: [] } },
    chant_source: null, pieces, ...overrides,
  };
}

describe("parseCatalog", () => {
  it("should map a valid document", async () => {
    const { parseCatalog } = await import("./catalog");
    const catalog = parseCatalog(rawCatalog([rawPiece()]));
    expect(catalog.pieces[0]?.printedPages).toEqual([1, 2]);
    expect(catalog.pieces[0]?.chant).toEqual([]);
  });

  it("should reject a schema version it does not understand", async () => {
    const { parseCatalog } = await import("./catalog");
    expect(() => parseCatalog(rawCatalog([], { schema_version: 1 }))).toThrow(/schema_version 1/);
  });

  it("should reject a piece from a volume the catalog does not record", async () => {
    const { parseCatalog } = await import("./catalog");
    expect(() => parseCatalog(rawCatalog([rawPiece({ volume: "noh9" })]))).toThrow(/unknown volume/);
  });

  it("should expose each volume's title and part", async () => {
    const { parseCatalog } = await import("./catalog");
    expect(parseCatalog(rawCatalog([])).volumes).toEqual({ noh5: { title: "Kyriale", part: "V" } });
  });

  it("should reject an unknown genre", async () => {
    const { parseCatalog } = await import("./catalog");
    expect(() => parseCatalog(rawCatalog([rawPiece({ genre: "motet" })]))).toThrow(/unknown genre/);
  });

  it("should reject an unknown review status", async () => {
    const { parseCatalog } = await import("./catalog");
    expect(() => parseCatalog(rawCatalog([rawPiece({ review_status: "maybe" })])))
      .toThrow(/unknown review_status/);
  });

  it("should reject systems and aspects that disagree in count", async () => {
    const { parseCatalog } = await import("./catalog");
    expect(() => parseCatalog(rawCatalog([rawPiece({ system_aspect: [] })])))
      .toThrow(/1 systems but 0 aspects/);
  });

  it("should reject a page range that is not exactly two numbers", async () => {
    // Asserting the tuple shape instead of checking it is how undefined reaches a page.
    const { parseCatalog } = await import("./catalog");
    expect(() => parseCatalog(rawCatalog([rawPiece({ printed_pages: [5] })])))
      .toThrow(/printed_pages: expected exactly two numbers/);
  });

  it("should name an addendum's pages by the addendum, which numbers them afresh", async () => {
    const { pagesLabel, parseCatalog } = await import("./catalog");
    const volumes = { noh5: { title: "Kyriale", part: "V", addenda: { extra: "Addenda ad Partem V" } } };
    const catalog = parseCatalog(rawCatalog(
      [rawPiece(), rawPiece({ id: "noh5-y", slug: "y", pagination: "extra", printed_pages: [3, 11] })], { volumes }));
    expect(catalog.pieces.map((p) => p.pagination)).toEqual([null, "Addenda ad Partem V"]);
    expect(catalog.pieces.map(pagesLabel)).toEqual(["pp. 1–2", "Addenda ad Partem V, pp. 3–11"]);
    expect(() => parseCatalog(rawCatalog([rawPiece({ pagination: "other" })], { volumes })))
      .toThrow(/unknown pagination other in noh5/);
  });

  it("should tolerate a catalog written before asset keys existed", async () => {
    const { parseCatalog, systemUrlStem } = await import("./catalog");
    const catalog = parseCatalog(rawCatalog([rawPiece({ system_assets: undefined })]));
    const piece = catalog.pieces[0]!;
    expect(piece.systemAssets).toEqual([]);
    expect(systemUrlStem(piece, 0)).toMatch(/\/noh5\/0047\/000$/);   // falls back to the ref
  });
});

describe("catalog navigation helpers", () => {
  it("should list every section once, in catalog order", async () => {
    const { sections } = await import("./catalog");
    const list = sections();
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain("Ordinarium Missae");
  });

  it("should return only the pieces of the requested section", async () => {
    const { piecesInSection } = await import("./catalog");
    const pieces = piecesInSection("Missa pro Defunctis");
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.section === "Missa pro Defunctis")).toBe(true);
  });

  it("should return nothing for an unknown slug", async () => {
    const { pieceBySlug } = await import("./catalog");
    expect(pieceBySlug("no-such-piece")).toBeUndefined();
  });
});

describe("citedBy", () => {
  it("should find the pieces that carry a piece's days by citation", async () => {
    const { citedBy, parseCatalog } = await import("./catalog");
    const catalog = parseCatalog(rawCatalog([
      rawPiece({ id: "noh3-annunciation", slug: "annunciation", days: ["sancti:03-25"],
                 reference: "Introitus. Vultum tuum, Pars IV, p. 115." }),
      rawPiece({ id: "noh5-vultum", slug: "vultum", days: ["sancti:03-25"], linked_days: ["sancti:03-25"] }),
      rawPiece({ id: "noh5-other", slug: "other", days: ["sancti:05-01"] }),
    ]));
    const [annunciation] = catalog.pieces;
    expect(annunciation?.reference).toBe("Introitus. Vultum tuum, Pars IV, p. 115.");
    expect(citedBy(annunciation!, catalog.pieces).map((p) => p.slug)).toEqual(["vultum"]);
  });
});

describe("hymns", () => {
  it("should make readable anchors without accents or punctuation", async () => {
    const { hymnAnchor } = await import("./catalog");
    expect(hymnAnchor("Ave maris stella (alius tonus)")).toBe("hymn-ave-maris-stella-alius-tonus");
    expect(hymnAnchor("Iste Confessor", 1)).toBe("hymn-iste-confessor-2");
  });

  it("should index every hymn A-Z with its office and skip ones outside the piece", async () => {
    const { hymnIndex, jumpTargets, parseCatalog } = await import("./catalog");
    const catalog = parseCatalog(rawCatalog([
      rawPiece({ id: "noh5-a", slug: "a", systems: ["noh5/0047/000", "noh5/0047/001"],
                 system_assets: ["", ""], system_aspect: [[1000, 250], [1000, 250]],
                 hymns: [{ title: "Te lucis", ref: "noh5/0047/001", printed_page: 29 },
                         { title: "Lost", ref: "noh5/9999/000", printed_page: 1 }] }),
      rawPiece({ id: "noh5-b", slug: "b",
                 hymns: [{ title: "Ave maris stella", ref: "noh5/0047/000", printed_page: 174 }] }),
    ]));
    expect(hymnIndex(catalog.pieces).map((h) => [h.title, h.piece.slug])).toEqual([
      ["Ave maris stella", "b"], ["Te lucis", "a"]]);
    expect(jumpTargets(catalog.pieces[0]!).map((t) => t.anchor)).toEqual(["hymn-te-lucis"]);
  });
});

describe("Proper parts", () => {
  it("should read printed and borrowed parts, and none from a catalog without them", async () => {
    const { parseCatalog } = await import("./catalog");
    const piece = parseCatalog(rawCatalog([rawPiece({ parts: [
      { part: "introit", variant: "", system: 0, ref: "noh5/0047/000", gregobase_id: 59, placed: "label" },
      { part: "gradual", variant: "", borrowed_volume: "noh4", borrowed_page: 78,
        borrowed_from: "confessor", borrowed_ref: "noh4/0110/000", gregobase_id: null },
    ] })])).pieces[0]!;
    expect(piece.parts[0]).toMatchObject({ kind: "printed", part: "introit", gregobaseId: 59 });
    expect(piece.parts[1]).toMatchObject({ kind: "borrowed", borrowedFrom: "confessor", borrowedPage: 78 });
    expect(parseCatalog(rawCatalog([rawPiece()])).pieces[0]!.parts).toEqual([]);
  });

  it("should read a schema 3 catalogue's sections, the 2nd of a kind numbered by n", async () => {
    const { parseCatalog } = await import("./catalog");
    const raw = rawCatalog([rawPiece({ sections: [
      { kind: "gradual", variant: "", system: 0, ref: "noh1/0050/000", gregobase_id: 12, placed: "label" },
      { kind: "gradual", n: 2, variant: "", system: 3, ref: "noh1/0050/003", gregobase_id: null, placed: "label" },
      { kind: "alleluia", variant: "paschal", system: 5, ref: "noh1/0050/005", gregobase_id: null, placed: "text" },
    ] })]);
    const piece = parseCatalog({ ...raw, schema_version: 3 }).pieces[0]!;
    expect(piece.parts.map((x) => [x.part, x.variant])).toEqual([["gradual", ""], ["gradual", "2"], ["alleluia", "paschal"]]);
    expect(() => parseCatalog({ ...raw, schema_version: 4 })).toThrow(/schema_version 4, expected 3/);
  });

  it("should reject an unknown part or a printed part without a placement", async () => {
    const { parseCatalog } = await import("./catalog");
    expect(() => parseCatalog(rawCatalog([rawPiece({ parts: [{ part: "gloria", system: 0, ref: "r", placed: "label" }] })])))
      .toThrow(/unknown part gloria/);
    expect(() => parseCatalog(rawCatalog([rawPiece({ parts: [{ part: "introit", system: 0, ref: "r" }] })])))
      .toThrow(/needs system, ref and placed/);
  });

  it("should keep only jgabc's own propers links", async () => {
    const { parseCatalog } = await import("./catalog");
    const ok = "https://bbloomf.github.io/jgabc/propers.html#saint=Oct3";
    const url = (u: string) => parseCatalog(rawCatalog([rawPiece({ jgabc_url: u })])).pieces[0]!.jgabcUrl;
    expect(url(ok)).toBe(ok);
    expect(url("javascript:alert(1)")).toBeNull();
    expect(url("https://evil.example/jgabc/propers.html#saint=Oct3")).toBeNull();
  });

  it("should label and anchor parts, including the Paschal Alleluia and repeated Graduals", async () => {
    const { partAnchor, partLabel } = await import("./catalog");
    expect(partLabel("alleluia", "paschal")).toBe("Paschal Alleluia");
    expect(partLabel("gradual", "2")).toBe("Gradual 2");
    expect(partAnchor("alleluia", "paschal")).toBe("alleluia-paschal");
    expect(partAnchor("offertory")).toBe("offertory");
  });

  it("should build GregoBase links from positive integer ids only", async () => {
    const { gregobaseUrl } = await import("./catalog");
    expect(gregobaseUrl(59)).toBe("https://gregobase.selapa.net/chant.php?id=59");
    expect(gregobaseUrl(null)).toBeNull();
    expect(gregobaseUrl(-1)).toBeNull();
    expect(gregobaseUrl(1.5)).toBeNull();
  });

  it("should link a borrowed part to the lending piece's anchor, or to nothing when unresolved", async () => {
    const { borrowedLinks, parseCatalog } = await import("./catalog");
    const lender = rawPiece({ id: "noh5-l", slug: "lender", title: "Commune", parts: [
      { part: "gradual", variant: "", system: 0, ref: "noh5/0047/000", placed: "label" }] });
    const borrower = rawPiece({ id: "noh5-b", slug: "borrower", parts: [
      { part: "gradual", borrowed_volume: "noh5", borrowed_page: 1, borrowed_from: "lender",
        borrowed_ref: "noh5/0047/000" },
      { part: "offertory", borrowed_volume: "noh5", borrowed_page: 9, borrowed_from: null, borrowed_ref: null },
    ] });
    const pieces = parseCatalog(rawCatalog([lender, borrower])).pieces;
    const links = borrowedLinks(pieces[1]!, pieces);
    expect(links[0]).toMatchObject({ label: "Gradual", href: "/piece/lender/#gradual", lenderTitle: "Commune" });
    expect(links[1]!.href).toBeNull();
  });
});
