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

  it("should show a list of sections in a line, each kind and where it starts", () => {
    const [entry] = parseLog({ schema_version: 1, corrections: [
      { id: "c-0003", target: "sections:dominica-i-adventus", field: "sections", date: "2026-09-29", by: "editor",
        was: [{ kind: "introit", ref: "noh1/0029/000", chant: 132 }],
        value: [{ kind: "introit", ref: "noh1/0029/000", chant: 132 }, { kind: "gradual", n: 2, ref: "noh1/0031/002", chant: "none" }] }] });
    expect(entry).toMatchObject({ label: "Dominica I Adventus (noh1) · sections", fieldLabel: "Sections",
                                  was: "Introit at noh1/0029/000",
                                  value: "Introit at noh1/0029/000; Gradual 2 at noh1/0031/002" });
  });
});
