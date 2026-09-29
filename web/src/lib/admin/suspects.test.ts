import { describe, expect, it } from "vitest";

import { allPieces } from "../catalog";
import type { Piece, PrintedPart } from "../catalog";
import { suspectParts } from "./suspects";
import { buildTargets } from "./targetIndex";
import { describeTarget } from "./targets";

function part(name: PrintedPart["part"], system: number, placed: PrintedPart["placed"] = "label"): PrintedPart {
  return { kind: "printed", part: name, variant: "", label: null, title: null, system, ref: `noh1/0029/${system}`, gregobaseId: null, placed };
}

function proper(slug: string, systems: number, parts: PrintedPart[]): Piece {
  const piece = allPieces().find((p) => p.parts.length > 0)!;
  return { ...piece, slug, label: slug, systems: Array.from({ length: systems }, (_, n) => `noh1/0029/${n}`), parts };
}

describe("suspectParts", () => {
  it("should flag a guessed start and a part too short for its kind, naming the next part to check", () => {
    const advent = proper("dominica-i-adventus", 28, [part("introit", 0), part("gradual", 3, "text"),
      part("alleluia", 8, "order"), part("offertory", 21), part("communion", 26)]);
    const [found] = suspectParts([advent]);
    expect(found!.parts.map((p) => [p.target, p.start, p.length])).toEqual([
      ["part:dominica-i-adventus/introit", 1, 3], ["part:dominica-i-adventus/alleluia", 9, 13]]);
    expect(found!.parts[0]!.reasons).toEqual(["it runs for only 3 systems: check where it starts, and where the Gradual starts"]);
    expect(found!.parts[1]!.reasons[0]).toMatch(/guessed from the order of the parts/);
  });

  it("should take a part corrected by hand as checked, and leave out pieces with nothing to check", () => {
    const fixed = proper("fixed", 28, [part("introit", 0), part("gradual", 8, "hand"), part("alleluia", 14, "hand"),
      part("offertory", 21), part("communion", 26)]);
    expect(suspectParts([fixed])).toEqual([]);
    const last = proper("last", 6, [part("introit", 0), part("communion", 5)]);
    expect(suspectParts([last])[0]!.parts[0]!.reasons).toEqual(["it runs for only 1 system"]);
  });

  it("should list a start the pipeline inferred, and take a reviewed list as checked", () => {
    const inferred = proper("inferred", 28, [part("introit", 0), part("gradual", 8), part("alleluia", 14, "inferred"),
      part("offertory", 21), part("communion", 26)]);
    expect(suspectParts([inferred])[0]!.parts.map((p) => [p.name, p.reasons])).toEqual([["Alleluia",
      ["no label or words placed it: its start is the one chant start the page allows between its neighbours"]]]);
    const reviewed = proper("reviewed", 28, [part("introit", 0, "reviewed"), part("gradual", 2, "reviewed"),
      part("offertory", 21, "reviewed"), part("communion", 26, "reviewed")]);
    expect(suspectParts([reviewed])).toEqual([]);
  });

  it("should leave out a part reviewed as it is now, and bring it back when it changes", () => {
    const advent = proper("dominica-i-adventus", 28, [part("introit", 0), part("gradual", 3, "text"),
      part("alleluia", 8, "order"), part("offertory", 21), part("communion", 26)]);
    const [found] = suspectParts([advent]);
    expect(found!.parts[0]!.fingerprint).toBe("start 1, 3 systems");
    const reviewed = { "part:dominica-i-adventus/introit": { was: "start 1, 3 systems", date: "2026-09-28" } };
    expect(suspectParts([advent], reviewed)[0]!.parts.map((p) => p.target)).toEqual(["part:dominica-i-adventus/alleluia"]);
    const lapsed = { "part:dominica-i-adventus/introit": { was: "start 1, 4 systems", date: "2026-09-28" } };
    expect(suspectParts([advent], lapsed)[0]!.parts).toHaveLength(2);
  });

  it("should name only parts the edit page can open, in the real catalogue", () => {
    const targets = buildTargets();
    for (const piece of suspectParts(allPieces())) {
      for (const p of piece.parts) expect(describeTarget(targets, p.target)?.kind).toBe("part");
    }
  });
});
