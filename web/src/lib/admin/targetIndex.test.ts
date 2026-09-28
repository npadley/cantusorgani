import { describe, expect, it } from "vitest";

import { allPieces, systemUrlStem } from "../catalog";
import { namedSystems, pieceSystems, shown } from "./scans";
import { buildScans, buildTargets } from "./targetIndex";
import { describeTarget } from "./targets";

// The real catalogue and lineup, as the site builds them.
describe("buildScans", () => {
  const scans = buildScans();

  it("should give every system of every piece the image the piece page shows", () => {
    for (const piece of allPieces()) {
      expect(pieceSystems(scans, piece.slug)).toEqual(piece.systems);
      piece.systems.forEach((ref, i) => {
        expect(shown(scans, ref, "x").stem).toBe(systemUrlStem(piece, i));
      });
    }
  });

  it("should know where an Ordinary's movements begin", () => {
    const mass = allPieces().find((p) => p.genre === "mass_ordinary" && p.movements.length > 1)!;
    expect(scans.movements[mass.slug]?.[mass.movements[0]!.movement]).toBe(mass.movements[0]!.ref);
  });
});

describe("buildTargets", () => {
  const targets = buildTargets();

  it("should give each piece its first and last system, and each Vespers item its systems", () => {
    const piece = allPieces().find((p) => p.systems.length > 1)!;
    expect(targets.pieces[piece.slug]?.range).toEqual([piece.systems[0], piece.systems.at(-1)]);
    const [name, item] = Object.entries(targets.vespers ?? {})[0]!;
    expect(item.refs?.length).toBeGreaterThan(0);
    const info = describeTarget(targets, name)!;
    expect(namedSystems(buildScans(), info, "tone")[0]?.stem).toBe(item.stem);
  });
});
