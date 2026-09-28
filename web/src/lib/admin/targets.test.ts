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

describe("chant pairings", () => {
  const P = targets(piece("missa-ix", { genre: "mass_ordinary", pairings: [{ movement: "kyrie", id: 1143 }],
                                        movements: ["kyrie", "gloria"] }),
                    piece("kyrie-i"), piece("proper-x", { genre: "proper" }));

  it("should read a movement's pairing, or none when not yet paired", () => {
    expect(describeTarget(P, "pairing:missa-ix/kyrie")).toMatchObject({ kind: "pairing", values: { chant: "1143" } });
    const gloria = describeTarget(P, "pairing:missa-ix/gloria")!;
    expect(gloria.label).toBe("missa-ix (noh5) · Gloria chant");
    expect(checkValue(P, gloria, "chant", "2980")).toEqual({ ok: true, value: "2980" });
  });

  it("should know only the movements a genre has, and none for a Proper", async () => {
    const { pairingMovements } = await import("./targets");
    expect(describeTarget(P, "pairing:missa-ix/credo")).toBeNull();
    expect(describeTarget(P, "pairing:kyrie-i/kyrie")).not.toBeNull();
    expect(describeTarget(P, "pairing:proper-x/chant")).toBeNull();
    expect(pairingMovements("proper")).toEqual([]);
    expect(pairingMovements("mass_ordinary", ["kyrie", "sanctus", "agnus", "ite"])).toEqual(["kyrie", "sanctus", "agnus", "ite"]);
  });
});

describe("system ranges and notes", () => {
  const R = { ...targets(piece("dominica-ii", { genre: "proper", range: ["noh1/0034/000", "noh1/0034/004"] })),
    vespers: { "vespers:adv1/antiphon-1": { label: "Ecce nomen", when: "Advent I, I Vespers", href: "/vespers/2026-11-28/",
                                              tone: "VIII.G", chant: null, refs: ["noh8/0077/000"], note: null,
                                              stem: null, aspect: null },
               "vespers:adv1/magnificat": { label: "Ne timeas", when: "Advent I, I Vespers", href: "/vespers/2026-11-28/",
                                            tone: "I.g", chant: null, refs: ["noh8/0078/000"], note: "Sung from the Antiphonale.",
                                            stem: null, aspect: null } } };

  it("should read a range typed with to, spaces or a hyphen, in the piece's own volume and forwards", () => {
    const info = describeTarget(R, "piece:dominica-ii")!;
    expect(info.values["system_range"]).toBe("noh1/0034/000-noh1/0034/004");
    expect(checkValue(R, info, "system_range", "noh1/0034/000 to noh1/0034/005")).toEqual({ ok: true, value: "noh1/0034/000-noh1/0034/005" });
    expect(checkValue(R, info, "system_range", "noh1/0034/000 noh1/0034/003")).toEqual({ ok: true, value: "noh1/0034/000-noh1/0034/003" });
    expect(checkValue(R, info, "system_range", "noh2/0034/000-noh2/0034/004")).toMatchObject({ ok: false, error: expect.stringMatching(/in noh1/) });
    expect(checkValue(R, info, "system_range", "noh1/0034/004-noh1/0034/000")).toMatchObject({ ok: false, error: expect.stringMatching(/backwards/) });
    expect(checkValue(R, info, "system_range", "noh1/0034/000-noh1/0034/004")).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
  });

  it("should set a note, remove one with none or an empty value, and refuse to remove a note that is not there", () => {
    const plain = describeTarget(R, "vespers:adv1/antiphon-1")!;
    const noted = describeTarget(R, "vespers:adv1/magnificat")!;
    expect(noted.values["note"]).toBe("Sung from the Antiphonale.");
    expect(checkValue(R, plain, "note", "  Sung   unaccompanied. ")).toEqual({ ok: true, value: "Sung unaccompanied." });
    expect(checkValue(R, noted, "note", "")).toEqual({ ok: true, value: "none" });
    expect(checkValue(R, plain, "note", "none")).toMatchObject({ ok: false, error: expect.stringMatching(/no note to remove/) });
    expect(checkValue(R, plain, "note", "<b>x</b>")).toMatchObject({ ok: false });
  });
});
