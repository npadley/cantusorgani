import { describe, expect, it } from "vitest";

import { MAX_SHOWN, namedSystems, pieceSystems, shown } from "./scans";
import type { Scans } from "./scans";
import { describeTarget } from "./targets";
import { piece, targets } from "./testing";

const refs = Array.from({ length: 8 }, (_, n) => `noh1/0034/00${n}`);
const S: Scans = {
  base: "https://images.example.org",
  order: [...refs, "noh8/0077/000", "noh8/0077/001"],
  hash: [...refs.map((_, n) => `h${n}`), "", "v1"],
  aspect: [...refs.map(() => [1800, 400] as const), [1700, 380], [1700, 390]],
  pieces: { "dominica-ii": [0, 5], "missa-ix": [5, 3] },
  movements: { "missa-ix": { kyrie: "noh1/0034/005", gloria: "noh1/0034/007" } },
};
const T = {
  ...targets(
    piece("dominica-ii", { genre: "proper", systems: 5, range: ["noh1/0034/000", "noh1/0034/004"],
                           parts: [{ part: "introit", variant: "", system: 1, borrowed: null, chant: null },
                                   { part: "gradual", variant: "", system: 3, borrowed: null, chant: null }] }),
    piece("missa-ix", { genre: "mass_ordinary", movements: ["kyrie", "gloria"] })),
  vespers: { "vespers:adv1/antiphon-1": { label: "Ecce nomen", when: "Advent I", href: "/vespers/2026-11-28/", tone: "VIII.G",
                                           chant: null, refs: ["noh8/0077/000"], stem: null, aspect: null } },
};
const info = (target: string) => describeTarget(T, target)!;
const captions = (target: string, field: string, value = "") => namedSystems(S, info(target), field, value).map((s) => s.caption);

describe("shown", () => {
  it("should build the published image's stem, fall back to the ref when not sliced, and say when a system is unknown", () => {
    expect(shown(S, "noh1/0034/002", "First")).toEqual({ ref: "noh1/0034/002", stem: "https://images.example.org/systems/noh1/0034/002-h2",
                                                         aspect: [1800, 400], caption: "First (noh1/0034/002)" });
    expect(shown(S, "noh8/0077/000", "Printed").stem).toBe("https://images.example.org/noh8/0077/000");
    expect(shown(S, "noh1/0099/000", "Proposed")).toMatchObject({ stem: null, caption: "Proposed (noh1/0099/000, not in the catalogue)" });
    expect(pieceSystems(S, "nowhere")).toEqual([]);
  });
});

describe("namedSystems", () => {
  it("should show a part's start now and the start proposed, but not an impossible one", () => {
    expect(captions("part:dominica-ii/gradual", "start_system", "4")).toEqual(
      ["Starts now: system 3 (noh1/0034/002)", "Would start: system 4 (noh1/0034/003)"]);
    expect(captions("part:dominica-ii/gradual", "start_system", "9")).toEqual(["Starts now: system 3 (noh1/0034/002)"]);
    expect(captions("part:dominica-ii/gradual", "chant", "1169")).toEqual(["Starts now: system 3 (noh1/0034/002)"]);
  });

  it("should show a piece's first and last systems for its pages, and where a proposed range would begin and end", () => {
    expect(captions("piece:dominica-ii", "title")).toEqual(["First system (noh1/0034/000)"]);
    expect(captions("piece:dominica-ii", "system_range", "noh1/0034/000 to noh1/0034/006")).toEqual(
      ["First system now (noh1/0034/000)", "Last system now (noh1/0034/004)", "Would be the last (noh1/0034/006)"]);
  });

  it("should show a Vespers item's systems and the ones proposed, and a movement where it begins", () => {
    expect(captions("vespers:adv1/antiphon-1", "refs", "noh8/0077/001")).toEqual(
      ["Printed on, 1 of 1 (noh8/0077/000)", "Proposed, 1 of 1 (noh8/0077/001)"]);
    expect(captions("pairing:missa-ix/gloria", "chant")).toEqual(["Where it begins (noh1/0034/007)"]);
  });

  it(`should show no more than ${MAX_SHOWN} pictures`, () => {
    const many = Array.from({ length: 5 }, (_, n) => `noh1/0034/00${n}`).join(" ");
    const target = { ...info("vespers:adv1/antiphon-1"), values: { refs: many } };
    expect(namedSystems(S, target, "refs", "noh8/0077/000 noh8/0077/001")).toHaveLength(MAX_SHOWN);
  });
});
