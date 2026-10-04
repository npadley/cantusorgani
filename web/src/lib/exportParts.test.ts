import { describe, expect, it } from "vitest";

import { defaultTicked, defaultsNote, exportSegments, seasonGroup } from "./exportParts";
import type { ExportSegment } from "./exportParts";
import { jumpTargets, movementStarts, parseCatalog } from "./catalog";
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

describe("exportSegments with borrowed parts", () => {
  function catalog() {
    const lenderRefs = Array.from({ length: 8 }, (_, i) => `noh3/0387/${String(i).padStart(3, "0")}`);
    const ownRefs = Array.from({ length: 4 }, (_, i) => `noh3/0395/${String(i).padStart(3, "0")}`);
    const base = { volume: "noh3", section: "S", incipit: null, genre: "proper", mode: null, mass: null,
                   printed_pages: [1, 2], pdf_pages: [3, 4], division: "sanctorale", chant: null,
                   review_status: "verified", movements: [] };
    return parseCatalog({
      schema_version: 2, volumes: { noh3: { title: "III", part: "III" } }, chant_source: null,
      pieces: [
        { ...base, id: "noh3-michael", slug: "michael", label: "M", title: "S. Michael",
          systems: lenderRefs, system_assets: lenderRefs.map(() => ""), system_aspect: lenderRefs.map(() => [1000, 250]),
          parts: [{ part: "introit", system: 0, ref: lenderRefs[0], placed: "label" },
                  { part: "gradual", system: 3, ref: lenderRefs[3], placed: "label" },
                  { part: "communion", system: 6, ref: lenderRefs[6], placed: "label" }] },
        { ...base, id: "noh3-angels", slug: "angels", label: "A", title: "Ss. Angeli",
          systems: ownRefs, system_assets: ownRefs.map(() => ""), system_aspect: ownRefs.map(() => [1000, 250]),
          parts: [{ part: "introit", borrowed_volume: "noh3", borrowed_page: 354, borrowed_from: "michael",
                    borrowed_ref: lenderRefs[0] },
                  { part: "offertory", system: 0, ref: ownRefs[0], placed: "label" },
                  { part: "communion", borrowed_volume: "noh3", borrowed_page: 361, borrowed_from: "michael",
                    borrowed_ref: lenderRefs[6] }] },
      ],
    }).pieces;
  }

  it("should take a borrowed part's systems from the lender, in the order of Mass", () => {
    const pieces = catalog();
    const segments = exportSegments([pieces[1]!], pieces);
    expect(segments.map((s) => [s.label, s.systems])).toEqual([
      ["Introit (from S. Michael)", 3], ["Offertory", 4], ["Communion (from S. Michael)", 2],
    ]);
    expect(segments[0]!.stems[0]).toContain("noh3/0387/000");
  });

  it("keeps the borrower rubric with borrowed music without importing the lender instruction", () => {
    const [lender, borrower] = catalog();
    const source = { ...lender!, parts: lender!.parts.map((p) => ({ ...p, rubric: "Source-only instruction." })) };
    const destination = { ...borrower!, parts: borrower!.parts.map((p) => p.kind === "borrowed" && p.part === "introit"
      ? { ...p, rubric: "Tempore Paschali.", rubricTranslation: "During Paschaltide." } : p) };
    const segments = exportSegments([destination], [source]);
    expect(segments[0]).toMatchObject({ rubric: "Tempore Paschali.", rubricTranslation: "During Paschaltide." });
    expect(segments[2]!.rubric).toBeUndefined();
    expect(exportSegments([{ ...destination, excludedParts: ["introit"] }], [source]).some((s) => s.rubric)).toBe(false);
  });

  it("should leave out a borrowed part whose lender is unknown", () => {
    const pieces = catalog();
    const angels = { ...pieces[1]!, parts: pieces[1]!.parts.map((x) =>
      x.kind === "borrowed" ? { ...x, borrowedFrom: null, borrowedRef: null } : x) };
    expect(exportSegments([angels], pieces).map((s) => s.label)).toEqual(["Offertory"]);
  });
});

describe("exportSegments for a Mass with rows of its own", () => {
  // Mass IV: its movements, and the two dismissals listed for it. The Ite's row
  // takes the place of the movement found on the same system.
  const refs = Array.from({ length: 8 }, (_, i) => `noh5/0074/${String(i).padStart(3, "0")}`);
  const mass = parseCatalog({
    schema_version: 3, volumes: { noh5: { title: "Kyriale", part: "V" } }, chant_source: null,
    pieces: [{
      id: "noh5-iv", volume: "noh5", slug: "ordinarium-missae-iv", section: "S", label: "IV", title: "Missa IV",
      incipit: null, genre: "mass_ordinary", mode: null, mass: "IV", printed_pages: [1, 2], pdf_pages: [3, 4],
      division: "kyriale", systems: refs, system_assets: refs.map(() => ""), system_aspect: refs.map(() => [1000, 250]),
      chant: null, review_status: "verified",
      movements: [["kyrie", 0], ["sanctus", 3], ["agnus", 4], ["ite", 6]].map(([movement, i]) => ({
        movement, score: 0.9, pdf_page: 74, system: i, ref: refs[i as number], mode_marker: null })),
      sections: [
        { kind: "other", key: "ite", variant: "", label: "Ite, missa est", system: 6, ref: refs[6], placed: "reviewed" },
        { kind: "other", key: "benedicamus", variant: "", label: "Benedicamus Domino", system: 7, ref: refs[7], placed: "reviewed" }],
    }],
  }).pieces[0]!;

  it("should give a segment for each heading on the page, movements and rows alike", () => {
    expect(exportSegments([mass]).map((s) => [s.label, s.systems])).toEqual([
      ["Kyrie", 3], ["Sanctus", 1], ["Agnus Dei", 2], ["Ite, missa est", 1], ["Benedicamus Domino", 1]]);
  });

  it("should let a row named for a movement move it: its heading, anchor and chant, on the row's system", () => {
    const moved = { ...mass, parts: [{ kind: "printed" as const, part: "other" as const, variant: "sanctus", label: null,
                                       title: null, system: 2, ref: refs[2]!, gregobaseId: null, placed: "reviewed" as const }],
                    chant: [{ source: "gregobase" as const, id: 2518, movement: "sanctus" as const, incipit: "Sanctus IV",
                              mode: "8", score: 1, status: "verified" as const }] };
    expect(movementStarts(moved).map((m) => m.movement)).toEqual(["kyrie", "agnus", "ite"]);
    const row = jumpTargets(moved).find((t) => t.kind === "part")!;
    expect(row).toMatchObject({ label: "Sanctus", anchor: "sanctus", index: 2, chantId: 2518,
                                target: "part:ordinarium-missae-iv/other:sanctus" });
    expect(exportSegments([moved]).map((s) => [s.label, s.systems])).toEqual([
      ["Kyrie", 2], ["Sanctus", 2], ["Agnus Dei", 2], ["Ite, missa est", 2]]);
  });

  it("should leave the movement out where a row starts on its system, and name the row in its target", () => {
    expect(movementStarts(mass).map((m) => m.movement)).toEqual(["kyrie", "sanctus", "agnus"]);
    expect(jumpTargets(mass).filter((t) => t.kind === "part").map((t) => [t.target, t.anchor])).toEqual([
      // The row named for the dismissal keeps the movement's own anchor.
      ["part:ordinarium-missae-iv/other:ite", "ite"],
      ["part:ordinarium-missae-iv/other:benedicamus", "other-benedicamus"]]);
  });
});
describe("audited seasonal references", () => {
  it("selects both Paschal Alleluias, including the shared verse, in Eastertide", () => {
    const segments = exportSegments([piece("two-alleluia", 8, [
      ["introit", 0], ["gradual", 2, "extra-paschal"], ["alleluia", 3, "shared"],
      ["alleluia", 5, "paschal"], ["communion", 7],
    ])]);
    expect(segments.filter((s) => defaultTicked(s, segments, "easter")).map((s) => s.variant))
      .toEqual(["", "shared", "paschal", ""]);
    expect(segments.filter((s) => defaultTicked(s, segments, "other")).map((s) => s.variant))
      .toEqual(["", "extra-paschal", "shared", ""]);
  });
  it("selects both numbered Paschal references and labels them as Alleluias", () => {
    const segments = exportSegments([piece("paschal-2", 8, [
      ["introit", 0], ["alleluia", 2, "paschal"], ["alleluia", 4, "paschal-2"], ["communion", 6],
    ])]);
    expect(segments.filter((s) => defaultTicked(s, segments, "other")).map((s) => s.part))
      .toEqual(["introit", "communion"]);
    expect(segments[2]?.label).toBe("Paschal Alleluia 2");
  });
  it("honors a rubric omitting the Tract in both the export and inline projection", () => {
    const segments = exportSegments([{ ...THERESE, excludedParts: ["tract"] }]);
    expect(segments.map((s) => s.part)).not.toContain("tract");
    expect(segments.reduce((n, s) => n + s.systems, 0)).toBe(10);
  });
});

it("keeps borrowed Vespers psalms before the hymn and Magnificat", () => {
  const lender = piece("vespers-source", 6, [["other", 0], ["hymn", 3]], "vesperale");
  const own = piece("vespers-sunday", 2, [["other", 0]], "vesperale");
  const borrower: Piece = { ...own, parts: [
    { kind: "borrowed", part: "other", variant: "", borrowedVolume: "noh3", borrowedPage: 1,
      borrowedFrom: lender.slug, borrowedRef: lender.systems[0]!, gregobaseId: null, label: null, title: null },
    { kind: "borrowed", part: "hymn", variant: "", borrowedVolume: "noh3", borrowedPage: 2,
      borrowedFrom: lender.slug, borrowedRef: lender.systems[3]!, gregobaseId: null, label: null, title: null },
    ...own.parts,
  ] };
  expect(exportSegments([borrower], [lender]).map((s) => s.part)).toEqual(["other", "hymn", "other"]);
});
