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
  it("follows a whole-Mass reference chain and stops cycles", () => {
    const first = { ...jerome(), slug: "first", id: "first", volume: "noh4", printedPages: [1, 1] as const,
      reference: "Missa. In medio Ecclesiae, p. 2." };
    const second = { ...first, slug: "second", id: "second", printedPages: [2, 2] as const,
      reference: "Missa. In medio Ecclesiae, p. 71." };
    expect(massSources(first, [first, second, pieceBySlug("commune-doctorum")!])[0]?.slug).toBe("commune-doctorum");
    expect(massSources(first, [first, { ...second, reference: "Missa. p. 1." }])).toEqual([]);
  });
});
