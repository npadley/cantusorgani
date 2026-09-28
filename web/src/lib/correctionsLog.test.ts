import { describe, expect, it } from "vitest";

import { parseLog } from "./correctionsLog";

describe("parseLog", () => {
  it("should name each target in words, with its page, and say who reported it", () => {
    const [entry] = parseLog({ schema_version: 1, corrections: [
      { id: "c-0002", target: "piece:dominica-i-adventus", field: "printed_pages", was: [3, 7], value: [3, 8],
        date: "2026-09-28", by: "reader" }] });
    expect(entry).toMatchObject({ label: "Dominica I Adventus (noh1)", href: "/piece/dominica-i-adventus/",
                                  fieldLabel: "Printed pages", was: "3–7", value: "3–8", by: "reader" });
  });

  it("should show a cleared chant as none, keep an unknown target as written, and refuse another schema", () => {
    const [entry] = parseLog({ schema_version: 1, corrections: [
      { id: "c-0001", target: "part:gone/introit", field: "chant", was: 12, value: null, date: "2026-09-28", by: "editor" }] });
    expect(entry).toMatchObject({ label: "part:gone/introit", href: null, value: "none", by: "editor" });
    expect(() => parseLog({ schema_version: 2 })).toThrow(/schema_version 2/);
  });
});
