import { describe, expect, it } from "vitest";
import coverage from "../../../data/ordinary-form-coverage.json";
import { allPieces } from "./catalog";
import { exportSegments } from "./exportParts";
import { ordinaryFormOccasions, ordinaryFormParts, ordinaryFormPiece, ordinaryFormPieces } from "./ordinaryFormPieces";

describe("Ordinary Form accompaniment projection", () => {
  it("keeps synthetic occasions outside the NOH catalogue", () => {
    const before = allPieces();
    const pages = ordinaryFormPieces();
    expect(allPieces()).toBe(before);
    expect(pages.length).toBeGreaterThan(70);
    expect(pages.every((p) => p.slug.startsWith("of-") && p.division === "ordinary-form")).toBe(true);
    expect(pages.every((p) => p.systems.length === 0 && p.days.length === 0 && p.linkedDays.length === 0)).toBe(true);
  });

  it("projects a resolved assignment onto its actual lender and preserves cycle labels", () => {
    const key = ordinaryFormOccasions().find(row => row.parts.some(part => part.lender !== null))!.key;
    const part = ordinaryFormParts(key, "A").find((p) => p.lender);
    expect(part).toBeDefined();
    expect(part?.lender?.piece.volume).toBeTruthy();
    expect(part?.lender?.section.ref).toBe(part?.lender?.ref);
    expect(part?.lender?.section.variant).toBe(part?.lender?.variant);
    expect(ordinaryFormPiece("ot-21")?.parts.some((p) => p.kind === "borrowed")).toBe(true);
  });

  it("preserves a semantic Alleluia assignment in the Gradual source slot", () => {
    const parts = ordinaryFormParts("annunciation", "A", "easter");
    const alleluias = parts.filter(part => part.slot === "alleluia");
    expect(alleluias).toHaveLength(2);
    expect(alleluias.map(part => part.sourceSlot)).toEqual(["gradual", "alleluia"]);
    expect(alleluias.every(part => part.seasons?.includes("easter"))).toBe(true);
    expect(alleluias[0]?.lender?.variant).toBe(alleluias[0]?.lender?.section.variant);
  });

  it("projects every pipeline export mapping to the same lender range in the TypeScript exporter", () => {
    const mappings = coverage.mapping_ids.map((entry: string) => JSON.parse(entry) as {
      occasion: string; slot: string; kind?: string; variant: string; years: string[]; gregobase_id: number;
      lender: { slug: string; ref: string; part: string; variant: string };
      export_range: { start: number; end: number };
    });
    const mappingFor = new Map(mappings.map(mapping => [JSON.stringify([
      mapping.occasion, mapping.gregobase_id, mapping.slot, mapping.kind ?? null,
      mapping.variant, mapping.years.join(","), mapping.lender.slug, mapping.lender.ref,
      mapping.lender.part, mapping.lender.variant,
    ]), mapping]));
    let checked = 0;
    for (const occasion of ordinaryFormOccasions()) {
      const piece = ordinaryFormPiece(occasion.key)!;
      const segments = exportSegments([piece]);
      const segmentForIndex = new Map(segments.map(segment => [Number(segment.id.split(":").at(-1)), segment]));
      occasion.parts.forEach((part, index) => {
        if (!part.lender) return;
        const mapping = mappingFor.get(JSON.stringify([
          occasion.key, part.gregobase_id, part.slot, part.kind ?? null,
          part.variant, part.years.join(","), part.lender.slug, part.lender.ref,
          part.lender.part, part.lender.variant,
        ]));
        expect(mapping, `${occasion.key} / GregoBase ${part.gregobase_id}`).toBeDefined();
        const segment = segmentForIndex.get(index);
        expect(segment, `${occasion.key} / export part ${index}`).toBeDefined();
        expect(segment?.source).toMatchObject({
          slug: mapping!.lender.slug, part: mapping!.lender.part, variant: mapping!.lender.variant,
          start: mapping!.export_range.start, end: mapping!.export_range.end,
        });
        checked += 1;
      });
    }
    expect(checked).toBe(mappings.length);
  });

  it("shows a shared A/C row with the selected cycle label and filters other years", () => {
    const occasion = ordinaryFormOccasions().find(row => row.parts.some(part => part.years.join("") === "AC"));
    expect(occasion).toBeDefined();
    const parts = ordinaryFormParts(occasion!.key, "C");
    expect(parts.every((p) => p.years.includes("C"))).toBe(true);
    expect(parts.some((p) => p.years.join("") === "B")).toBe(false);
    expect(parts.some((p) => p.years.join("") === "AC" && p.label.includes("Year C"))).toBe(true);
  });

  it("retains an unmapped occasion without inventing parts", () => {
    const unmapped = ordinaryFormPieces().find((p) => p.sourceNote?.includes("chants not yet mapped"));
    expect(unmapped).toBeDefined();
    expect(unmapped?.parts).toEqual([]);
  });
});
