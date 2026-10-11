import { describe, expect, it } from "vitest";
import { initialPartSelection } from "./ordinaryFormPageClient";

describe("cycle-aware Ordinary Form exports", () => {
  const rows = [
    { years: "A,C", seasons: "", checked: true },
    { years: "B", seasons: "", checked: true },
    { years: "A,B,C", seasons: "easter", checked: true },
    { years: "A,B,C", seasons: "", checked: true },
  ];

  it("selects every applicable same-cycle alternative and all-season rows", () => {
    expect(initialPartSelection(rows, "C", "easter")).toEqual([true, false, true, true]);
  });

  it("keeps every assignment selected on an unscoped static page", () => {
    expect(initialPartSelection(rows, null, null)).toEqual([true, true, true, true]);
  });

  it("does not apply an invalid cycle or season as a filter", () => {
    expect(initialPartSelection(rows, null, null)).toEqual([true, true, true, true]);
  });
});
