import { describe, expect, it } from "vitest";

import { checkValue, describeTarget, kindOf, normalise, readerField } from "./targets";
import { piece, targets } from "./testing";

const T = {
  ...targets(piece("dominica-i-adventus", {
    genre: "proper", mode: null, systems: 6,
    parts: [{ part: "introit", variant: "", system: 1, borrowed: null, chant: 132 },
            { part: "gradual", variant: "1", system: 3, borrowed: null, chant: null },
            { part: "offertory", variant: "", system: null, borrowed: "dominica-ii, p. 9", chant: 7 }],
  })),
  vespers: { "vespers:adv1/magnificat": { label: "Ne timeas", when: "Advent I, II Vespers", href: "/vespers/2026-11-29/",
                                           tone: "VIII.G", chant: null, refs: ["noh8/0086/000", "noh8/0086/001"],
                                           stem: null, aspect: null } },
};

describe("describeTarget", () => {
  it("should read a piece by target, slug or id, and a part with its neighbours", () => {
    expect(describeTarget(T, "noh5-dominica-i-adventus")?.target).toBe("piece:dominica-i-adventus");
    const gradual = describeTarget(T, "part:dominica-i-adventus/gradual:1")!;
    expect(gradual).toMatchObject({ kind: "part", values: { start_system: "3", chant: "none" }, bounds: { after: 1, before: 7 } });
    expect(gradual.label).toBe("dominica-i-adventus (noh5) · Gradual 1");
  });

  it("should read a Vespers item, mark a borrowed part as fixed, and return null for anything unknown", () => {
    expect(describeTarget(T, "vespers:adv1/magnificat")).toMatchObject({ kind: "vespers", values: { tone: "VIII.G", chant: "none" } });
    expect(describeTarget(T, "part:dominica-i-adventus/offertory")?.fixed).toMatch(/another volume/);
    expect(describeTarget(T, "part:dominica-i-adventus/tract")).toBeNull();
    expect(describeTarget(T, "vespers:nowhere/magnificat")).toBeNull();
    expect(kindOf("day:x")).toBeNull();
  });
});

describe("checkValue", () => {
  it("should keep a part's start between its neighbours and read an empty chant as none", () => {
    const gradual = describeTarget(T, "part:dominica-i-adventus/gradual:1")!;
    expect(checkValue(T, gradual, "start_system", "2")).toEqual({ ok: true, value: "2" });
    expect(checkValue(T, gradual, "start_system", "1")).toMatchObject({ ok: false });
    expect(checkValue(T, gradual, "chant", "")).toMatchObject({ ok: false, error: expect.stringMatching(/already “none”/) });
    expect(normalise("chant", " ", "part")).toBe("none");
  });

  it("should refuse a field of another kind and map the form's names", () => {
    const vespers = describeTarget(T, "vespers:adv1/magnificat")!;
    expect(checkValue(T, vespers, "title", "Ne timeas")).toMatchObject({ ok: false });
    expect(checkValue(T, vespers, "tone", "I.g")).toEqual({ ok: true, value: "I.g" });
    expect(checkValue(T, vespers, "refs", " noh8/0086/001   noh8/0086/002 ")).toEqual({ ok: true, value: "noh8/0086/001 noh8/0086/002" });
    expect(checkValue(T, vespers, "refs", "noh8/0086/000 noh8/0086/001")).toMatchObject({ ok: false });
    expect(checkValue(T, vespers, "refs", "noh5/0001/000")).toMatchObject({ ok: false });
    expect([readerField("startSystem"), readerField("gregobaseId"), readerField("nope")]).toEqual(["start_system", "chant", null]);
  });
});
