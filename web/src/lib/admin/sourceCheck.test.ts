import { describe, expect, it } from "vitest";
import fixtures from "../../../../tests/fixtures/typeset-source-check.json";
import { checkSource, validSourceSize } from "./sourceCheck";

describe("shared source checker fixtures", () => {
  it.each(fixtures)("matches Python for $name", (f) => expect(checkSource(f.text, f.includes)).toEqual(f.problems));
  it("limits source by UTF-8 bytes", () => {
    expect(validSourceSize("é".repeat(30720))).toBe(true);
    expect(validSourceSize("é".repeat(30721))).toBe(false);
  });
});
it("refuses unpaired UTF-16 surrogates before UTF-8 hashing",()=>{expect(validSourceSize('\ud800')).toBe(false);expect(validSourceSize('🎵')).toBe(true);});
