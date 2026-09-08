import { describe, expect, it } from "vitest";

import { CORRECTABLE_FIELDS, MAX_NOTE, parseCorrection } from "../src/schema";

const VALID = {
  pieceId: "noh5-ordinarium-missae-i",
  field: "mode",
  proposedValue: "IV",
  note: "checked against the Liber Usualis",
};

describe("parseCorrection", () => {
  it("accepts a well-formed correction", () => {
    const result = parseCorrection(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.proposedValue).toBe("IV");
  });

  it("defaults a missing note to empty", () => {
    const result = parseCorrection({ ...VALID, note: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.note).toBe("");
  });

  it("rejects an unknown field and names the legal ones", () => {
    const result = parseCorrection({ ...VALID, field: "systems" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const field of CORRECTABLE_FIELDS) expect(result.error).toContain(field);
    }
  });

  it("rejects an oversized note", () => {
    const result = parseCorrection({ ...VALID, note: "a".repeat(MAX_NOTE + 1) });
    expect(result.ok).toBe(false);
  });

  it("rejects a proposedValue failing its field pattern", () => {
    expect(parseCorrection({ ...VALID, proposedValue: "<script>" }).ok).toBe(false);
    expect(parseCorrection({ ...VALID, proposedValue: "IX" }).ok).toBe(false);
  });

  it("rejects a non-object body", () => {
    for (const body of [null, undefined, "string", 42, []]) {
      expect(parseCorrection(body).ok).toBe(false);
    }
  });

  it("rejects a pieceId that is not a slug", () => {
    for (const id of ["../etc/passwd", "Missa I", "a".repeat(200), ""]) {
      expect(parseCorrection({ ...VALID, pieceId: id }).ok).toBe(false);
    }
  });

  it("keeps Latin diacritics in a title", () => {
    const result = parseCorrection({
      ...VALID, field: "title", proposedValue: "Kýrie eléison, æternam",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects markup in every free-ish field", () => {
    for (const field of ["title", "incipit", "chant"]) {
      const result = parseCorrection({
        ...VALID, field, proposedValue: "<img src=x onerror=alert(1)>",
      });
      expect(result.ok, `${field} accepted markup`).toBe(false);
    }
  });

  it("validates printedPages as a numeric range", () => {
    expect(parseCorrection({ ...VALID, field: "printedPages", proposedValue: "5-10" }).ok).toBe(true);
    expect(parseCorrection({ ...VALID, field: "printedPages", proposedValue: "5" }).ok).toBe(false);
    expect(parseCorrection({ ...VALID, field: "printedPages", proposedValue: "a-b" }).ok).toBe(false);
  });

  it("constrains genre to the controlled set", () => {
    expect(parseCorrection({ ...VALID, field: "genre", proposedValue: "kyrie" }).ok).toBe(true);
    expect(parseCorrection({ ...VALID, field: "genre", proposedValue: "motet" }).ok).toBe(false);
  });
});
