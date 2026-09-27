import { describe, expect, it } from "vitest";

import { defaultTicked, defaultsNote, exportSegments, seasonGroup } from "./exportParts";
import type { ExportSegment } from "./exportParts";
import { parseCatalog } from "./catalog";
import type { Piece } from "./catalog";

function piece(slug: string, systems: number, parts: readonly [string, number, string?][] = [],
               division = "sanctorale"): Piece {
  const refs = Array.from({ length: systems }, (_, i) => `noh3/0100/${String(i).padStart(3, "0")}`);
  return parseCatalog({
    schema_version: 2, volumes: { noh3: { title: "III", part: "III" } }, chant_source: null,
    pieces: [{
      id: `noh3-${slug}`, volume: "noh3", slug, section: "S", label: slug, title: `Title ${slug}`,
      incipit: null, genre: "proper", mode: null, mass: null, printed_pages: [1, 2], pdf_pages: [3, 4],
      division, systems: refs, system_assets: refs.map(() => ""), system_aspect: refs.map(() => [1000, 250]),
      chant: null, review_status: "verified", movements: [],
      parts: parts.map(([part, system, variant]) => ({
        part, variant: variant ?? "", system, ref: refs[system], placed: "label",
      })),
    }],
  }).pieces[0]!;
}

const THERESE = piece("therese", 12, [
  ["introit", 0], ["gradual", 2], ["alleluia", 4], ["tract", 6], ["alleluia", 8, "paschal"],
  ["offertory", 9], ["communion", 11],
]);

describe("exportSegments", () => {
  it("should split a Proper into its parts, each running to the next part", () => {
    const segments = exportSegments([THERESE]);
    expect(segments.map((s) => [s.label, s.systems])).toEqual([
      ["Introit", 2], ["Gradual", 2], ["Alleluia", 2], ["Tract", 2], ["Paschal Alleluia", 1],
      ["Offertory", 2], ["Communion", 1],
    ]);
    expect(segments[1]!.stems[0]).toContain("noh3/0100/002");
  });

  it("should keep what comes before the Introit as its own segment", () => {
    const candlemas = piece("candlemas", 6, [["introit", 3], ["communion", 5]], "sanctorale");
    expect(exportSegments([candlemas]).map((s) => [s.label, s.systems])).toEqual([
      ["Title candlemas (before the Introit)", 3], ["Introit", 2], ["Communion", 1],
    ]);
  });

  it("should keep a piece without parts whole, and give every segment a unique id", () => {
    const mass = piece("missa-xii", 30, [], "kyriale");
    const segments = exportSegments([THERESE, mass]);
    expect(segments.at(-1)).toMatchObject({ label: "Title missa-xii", systems: 30, part: null });
    expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
  });

  it("should give nothing for a piece with no systems", () => {
    expect(exportSegments([piece("empty", 0)])).toEqual([]);
  });
});

describe("season defaults", () => {
  const segs = exportSegments([THERESE]);
  const ticked = (season: ReturnType<typeof seasonGroup>) =>
    segs.filter((s) => defaultTicked(s, segs, season)).map((s) => s.label);

  it("should group the seasons that change a Proper's parts", () => {
    expect(seasonGroup("septuagesima")).toBe("lent");
    expect(seasonGroup("passiontide")).toBe("lent");
    expect(seasonGroup("easter")).toBe("easter");
    expect(seasonGroup("pentecost")).toBe("other");
    expect(seasonGroup(null)).toBe("all");
  });

  it("should exclude the Tract and the Paschal Alleluia in October", () => {
    expect(ticked("other")).toEqual(["Introit", "Gradual", "Alleluia", "Offertory", "Communion"]);
  });

  it("should take the Tract instead of the Alleluia in Lent", () => {
    expect(ticked("lent")).toEqual(["Introit", "Gradual", "Tract", "Offertory", "Communion"]);
  });

  it("should take the Paschal Alleluia instead of the Gradual and Alleluia in Eastertide", () => {
    expect(ticked("easter")).toEqual(["Introit", "Paschal Alleluia", "Offertory", "Communion"]);
  });

  it("should tick everything on a piece page", () => {
    expect(ticked("all")).toHaveLength(segs.length);
  });

  it("should always tick a piece's only Alleluia or only Tract", () => {
    const feria = exportSegments([piece("feria", 6, [["introit", 0], ["tract", 2], ["communion", 4]])]);
    expect(feria.filter((s) => defaultTicked(s, feria, "other")).map((s) => s.label))
      .toEqual(["Introit", "Tract", "Communion"]);
    const easterless = exportSegments([piece("x", 6, [["introit", 0], ["alleluia", 2], ["communion", 4]])]);
    expect(easterless.filter((s) => defaultTicked(s, easterless, "lent")).map((s) => s.label))
      .toEqual(["Introit", "Alleluia", "Communion"]);
  });
});

describe("defaultsNote", () => {
  const segs = exportSegments([THERESE]);

  it("should say which date set the defaults and what they left out", () => {
    expect(defaultsNote(segs, "other", "Saturday, 3 October 2026"))
      .toBe("Defaults for Saturday, 3 October 2026 (Tract and Paschal Alleluia unticked).");
  });

  it("should say nothing when everything is ticked or there is no date", () => {
    expect(defaultsNote(segs, "all", null)).toBeNull();
    const plain: readonly ExportSegment[] = exportSegments([piece("m", 3, [], "kyriale")]);
    expect(defaultsNote(plain, "other", "Monday")).toBeNull();
  });
});

describe("exportSegments and uncertain parts", () => {
  it("should fold a part placed by order into the part before it", () => {
    const refs = Array.from({ length: 6 }, (_, i) => `noh3/0100/${String(i).padStart(3, "0")}`);
    const p = parseCatalog({
      schema_version: 2, volumes: { noh3: { title: "III", part: "III" } }, chant_source: null,
      pieces: [{
        id: "noh3-o", volume: "noh3", slug: "o", section: "S", label: "o", title: "O", incipit: null,
        genre: "proper", mode: null, mass: null, printed_pages: [1, 2], pdf_pages: [3, 4],
        division: "sanctorale", systems: refs, system_assets: refs.map(() => ""),
        system_aspect: refs.map(() => [1000, 250]), chant: null, review_status: "verified", movements: [],
        parts: [
          { part: "introit", system: 0, ref: refs[0], placed: "label" },
          { part: "alleluia", system: 2, ref: refs[2], placed: "order" },
          { part: "communion", system: 4, ref: refs[4], placed: "label" },
        ],
      }],
    }).pieces[0]!;
    expect(exportSegments([p]).map((s) => [s.label, s.systems])).toEqual([["Introit", 4], ["Communion", 2]]);
  });
});
