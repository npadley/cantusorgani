import { describe, expect, it } from "vitest";
import { pieceBySlug, jumpTargets, systemUrlStem } from "./catalog";
import { musicView } from "./music";
import { segmentKey } from "./typeset";

// Catch omission of borrowed sections, wrong ranges, and loss of source assets.
describe("inline borrowed music", () => {
  it("places the Common of Doctors' borrowed Tract before its Offertory", () => {
    const original = pieceBySlug("commune-doctorum")!;
    const view = musicView(original);
    expect(view.systems).toHaveLength(50);
    expect(view.systems.slice(30, 41)).toEqual([
      "noh4/0045/004", "noh4/0046/000", "noh4/0046/001", "noh4/0046/002", "noh4/0046/003",
      "noh4/0046/004", "noh4/0046/005", "noh4/0047/000", "noh4/0047/001", "noh4/0047/002", "noh4/0047/003",
    ]);
    expect(view.systems[41]).toBe("noh4/0107/000");
    // The Communion is cited too: Fidelis servus, p. 65.
    expect(view.systems.slice(46)).toEqual(["noh4/0096/002", "noh4/0096/003", "noh4/0096/004", "noh4/0096/005"]);
    const tract = jumpTargets(view).find((t) => t.anchor === "tract")!;
    expect(tract.index).toBe(30);
    expect(tract.target).toBe("part:commune-unius-martyris-pontificis-alia-missa/tract");
    expect(tract.source).toContain("part IV");
    expect(tract.source).toContain("p. 14");
    expect(systemUrlStem(view, 30)).toMatch(/systems\/noh4\/0045\/004-[a-f0-9]{12}$/);
    expect(segmentKey(view, 30)).toBe("commune-unius-martyris-pontificis-alia-missa:20");
    expect(original.systems).toHaveLength(35);
  });

  it("preserves pieces with no borrowed sections", () => {
    const piece = pieceBySlug("ordinarium-missae-i")!;
    expect(musicView(piece)).toBe(piece);
  });
});

it("keeps repeated source systems at their own headings for separate alternatives", () => {
  const original = pieceBySlug("commune-doctorum")!;
  const loan = original.parts.find((p) => p.kind === "borrowed")!;
  const view = musicView({ ...original, systems: [], systemAssets: [], systemAspect: [],
    parts: [{ ...loan, variant: "1" }, { ...loan, variant: "2" }] });
  expect(jumpTargets(view).map((p) => [p.anchor, p.index])).toEqual([["tract-1", 0], ["tract-2", 11]]);
});

it("distinguishes a chained rubric citation from the resolved source pages", () => {
  const view = musicView(pieceBySlug("s-nicolai-episcopi-et-confessoris")!);
  const source = jumpTargets(view).find((p) => p.anchor === "alleluia")!.source!;
  expect(source).toContain("pp. 71–76");
  expect(source).toContain("rubric cites");
  expect(source).toContain("p. 78");
});


it("uses the borrowing section's rubric in the inline score and omits source-only instructions", () => {
  const original = pieceBySlug("commune-doctorum")!;
  const source = pieceBySlug("commune-unius-martyris-pontificis-alia-missa")!;
  const lender = { ...source, parts: source.parts.map((p) => ({ ...p, rubric: "Source-only instruction." })) };
  const borrower = { ...original, parts: original.parts.map((p) => p.kind === "borrowed" && p.part === "tract"
    ? { ...p, rubric: "Tempore Paschali.", rubricTranslation: "During Paschaltide." } : p) };
  const view = musicView(borrower, [borrower, lender, ...[pieceBySlug("commune-confessoris-non-pontificis")!].filter(Boolean)]);
  expect(jumpTargets(view).find((p) => p.anchor === "tract")).toMatchObject({
    rubric: "Tempore Paschali.", rubricTranslation: "During Paschaltide.",
  });
  const without = musicView(original, [original, lender]);
  expect(jumpTargets(without).find((p) => p.anchor === "tract")?.rubric).toBeUndefined();
});
