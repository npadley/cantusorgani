import { describe, expect, it } from "vitest";
import { pieceBySlug } from "./catalog";
import { massSources } from "./references";

const jerome = () => pieceBySlug("s-hieronymi-presbyteris-confessoris-et-ecclesi-doctoris")!;
describe("printed Mass references", () => {
  it("resolves the explicit volume and page without relying on calendar links", () => {
    expect(massSources({ ...jerome(), days: [] }).map((p) => p.slug)).toEqual(["commune-doctorum"]);
  });
  it("does not treat an Introit citation as a whole Mass", () => {
    expect(massSources({ ...jerome(), reference: "Introitus. In medio Ecclesiae, Pars IV, p. 71." })).toEqual([]);
  });
  it("resolves same-volume citations", () => {
    expect(massSources({ ...jerome(), volume: "noh4", reference: "Missa. In medio Ecclesiae, p. 71." })[0]?.slug)
      .toBe("commune-doctorum");
  });
  it("uses the whole-Mass sources the index records, whatever the rubric's opening words", () => {
    // NOH4 p. 272: "Extra Tempus Paschale Missa. Statuit, p. 3. Tempore autem Paschali Missa. Protexisti, p. 29."
    const gregory = pieceBySlug("s-gregorii-episcopi-majoris-armeniae-et-martyris")!;
    const found = massSources(gregory);
    expect(found).toHaveLength(2);
    expect(found.map((p) => p.title)).toEqual([expect.stringMatching(/Statuit — outside Eastertide$/),
                                               expect.stringMatching(/Protexisti — during Eastertide$/)]);
    expect(found.every((p) => p.systems.length > 0)).toBe(true);
    expect(massSources({ ...gregory, referenceSources: [] })).toEqual([]);   // the wording alone is not a whole Mass
  });
  it("follows a whole-Mass reference chain and stops cycles", () => {
    const first = { ...jerome(), slug: "first", id: "first", volume: "noh4", printedPages: [1, 1] as const,
      reference: "Missa. In medio Ecclesiae, p. 2." };
    const second = { ...first, slug: "second", id: "second", printedPages: [2, 2] as const,
      reference: "Missa. In medio Ecclesiae, p. 71." };
    expect(massSources(first, [first, second, pieceBySlug("commune-doctorum")!])[0]?.slug).toBe("commune-doctorum");
    expect(massSources(first, [first, { ...second, reference: "Missa. p. 1." }])).toEqual([]);
  });
});
