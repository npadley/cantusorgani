import { describe, expect, it } from "vitest";

import { annotationFor, chantEntry, chantIds, hasNotation } from "./chants";

describe("chant notation data", () => {
  it("should hold St Therese's Introit, Veni de Libano", () => {
    expect(hasNotation(59)).toBe(true);
    expect(chantEntry(59)?.gabc).toContain("VE(");
    expect(chantEntry(59)?.part).toBe("in");
  });

  it("should know nothing of a missing or empty id", () => {
    expect(hasNotation(null)).toBe(false);
    expect(hasNotation(undefined)).toBe(false);
    expect(hasNotation(-1)).toBe(false);
  });

  it("should hold hundreds of chants", () => {
    expect(chantIds().length).toBeGreaterThan(500);
  });

  it("should annotate by office part and mode", () => {
    expect(annotationFor("in", "3")).toEqual(["Intr.", "3"]);
    expect(annotationFor(null, null)).toEqual(["", ""]);
  });
});
