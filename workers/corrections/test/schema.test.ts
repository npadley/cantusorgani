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

  it("rejects a proposedValue that is not a string", () => {
    expect(parseCorrection({ ...VALID, proposedValue: 4 }).ok).toBe(false);
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

describe("parseCorrection, values in the reader's own terms", () => {
  const base = { pieceId: "kyrie-i", note: "" };

  it("should read a mode typed as 1 to 8 as I to VIII", () => {
    const parsed = parseCorrection({ ...base, field: "mode", proposedValue: " 7 " });
    expect(parsed.ok && parsed.value.proposedValue).toBe("VII");
    expect(parseCorrection({ ...base, field: "mode", proposedValue: "9" }).ok).toBe(false);
  });

  it("should refuse a title or incipit without two letters, saying what it expects in words", () => {
    const parsed = parseCorrection({ ...base, field: "title", proposedValue: "1" });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toBe("“1” is not a valid title: expected at least two letters; letters, digits and . , ' « » ( ) : - only.");
    expect(parseCorrection({ ...base, field: "incipit", proposedValue: "A 1" }).ok).toBe(false);
    expect(parseCorrection({ ...base, field: "title", proposedValue: "Missa I" }).ok).toBe(true);
  });
});

describe("parseCorrection, parts and Vespers items", () => {
  const report = (extra: Record<string, unknown>) =>
    parseCorrection({ pieceId: "dominica-i-adventus", note: "", ...extra });

  it("should accept where a part starts, or its chant, for the same piece", () => {
    const start = report({ target: "part:dominica-i-adventus/gradual", field: "startSystem", proposedValue: "4" });
    expect(start.ok && start.value.target).toBe("part:dominica-i-adventus/gradual");
    expect(report({ target: "part:dominica-i-adventus/communion:2", field: "gregobaseId", proposedValue: "none" }).ok).toBe(true);
    const other = report({ target: "part:kyrie-i/gradual", field: "startSystem", proposedValue: "4" });
    expect(!other.ok && other.error).toMatch(/same piece as pieceId/);
  });

  it("should accept a Vespers item's tone or chant, and only those", () => {
    expect(report({ pieceId: "vespers", target: "vespers:adv1/antiphon-1", field: "tone", proposedValue: "IV.A*" }).ok).toBe(true);
    expect(report({ pieceId: "vespers", target: "vespers:sunday:tempora:Pent04-0/magnificat", field: "gregobaseId", proposedValue: "2205" }).ok).toBe(true);
    expect(report({ pieceId: "vespers", target: "vespers:adv1/antiphon-1", field: "tone", proposedValue: "IX.z" }).ok).toBe(false);
    const wrong = report({ pieceId: "vespers", target: "vespers:adv1/antiphon-1", field: "title", proposedValue: "In illa die" });
    expect(!wrong.ok && wrong.error).toMatch(/A vespers report can correct tone, gregobaseId/);
  });

  it("should refuse a malformed target, and keep piece reports as they were", () => {
    expect(report({ target: "piece:x/<b>", field: "title", proposedValue: "Ad te" }).ok).toBe(false);
    const piece = report({ target: "piece:dominica-i-adventus", field: "title", proposedValue: "Dominica prima" });
    expect(piece.ok && piece.value.target).toBeNull();
    expect(report({ field: "startSystem", proposedValue: "4" }).ok).toBe(false);
  });

});
