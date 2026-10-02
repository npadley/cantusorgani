import { describe, expect, it } from "vitest";

import { allPieces, pieceBySlug } from "../catalog";
import { targets, piece } from "./testing";
import { typesetTargetExists } from "./targets";
import { TYPESET, typesetTargets } from "./typesetData";
import type { TypesetData } from "./typesetData";
import { parseError, targetLabel, targetSpan, typesetEntries, volumeOf } from "./typesetQueues";

// A Mass the catalogue has, with its Kyrie matched in the committed manifest.
const MASS = allPieces().find((p) => p.genre === "mass_ordinary" && p.movements.some((m) => m.movement === "kyrie"))!;
const KYRIE = `movement:${MASS.slug}/kyrie`;

function data(extra: Partial<TypesetData> = {}): TypesetData {
  return {
    prefix: "typeset",
    parts: [{ target: KYRIE, file: "vol-5/k.ly", hash: "a".repeat(32) }],
    items: [
      { file: "vol-5/g.ly", status: "proposed", target: null, hash: "b".repeat(32), incipit: "Gloria in excelsis",
        melody: 0.5, candidates: [{ target: `movement:${MASS.slug}/gloria`, melody: 0.5 }] },
      { file: "vol-5/i.ly", status: "broken", target: null, error: "line 5:2: error: not a note name: d’",
        excerpt: { first: 3, line: 5, lines: ["a", "b", "c d’", "e"] } },
      { file: "vol-5/n.ly", status: "no-match", target: null, source: "editor", hash: "c".repeat(32) },
    ],
    ...extra,
  };
}

describe("typesetEntries", () => {
  it("should put each file in its queue: undecided in Matches, broken in Errors, shown parts in Proofreading", () => {
    const entries = typesetEntries(data(), {}, allPieces(), undefined, "https://assets.example.org");
    expect(entries.map((e) => [e.file, e.queue])).toEqual([
      ["vol-5/g.ly", "matches"], ["vol-5/i.ly", "errors"], ["vol-5/k.ly", "proofreading"]]);
    const [match, error, proof] = entries;
    expect(match!.render).toEqual({ wide: `https://assets.example.org/typeset/${"b".repeat(32)}/wide.svg`,
                                    narrow: `https://assets.example.org/typeset/${"b".repeat(32)}/narrow.svg` });
    expect(match!.candidates[0]).toMatchObject({ target: `movement:${MASS.slug}/gloria`, melody: 0.5,
                                                 href: `/piece/${MASS.slug}/` });
    expect(error!.error).toEqual({ line: 5, column: 2, message: "not a note name: d’" });
    expect(error!.excerpt).toEqual([[3, "a"], [4, "b"], [5, "c d’"], [6, "e"]]);
    expect(error!.render).toBeNull();
    expect(proof!.fingerprint).toBe("a".repeat(32));
    expect(proof!.shownAs?.label).toBe(targetLabel(KYRIE, MASS));
    expect(proof!.scans.length).toBeGreaterThan(0);
  });

  it("includes every scan of long matched parts, including the last system", () => {
    const long = TYPESET.parts.find((p) => {
      const slug = /^(?:piece|movement|part):([a-z0-9-]+)/.exec(p.target)?.[1];
      const piece = slug ? pieceBySlug(slug) : undefined;
      const span = piece ? targetSpan(piece, p.target) : null;
      return span && span[1] - span[0] > 8;
    })!;
    expect(long).toBeDefined();
    const slug = /^(?:piece|movement|part):([a-z0-9-]+)/.exec(long.target)![1]!;
    const piece = pieceBySlug(slug)!;
    const span = targetSpan(piece, long.target)!;
    const entry = typesetEntries({ ...TYPESET, parts: [long], items: [] }, {})[0]!;
    expect(entry.scans.map((s) => s.ref)).toEqual(piece.systems.slice(span[0], span[1]));
  });

  it("should leave out a part proofread at its current drawing, and bring it back when the drawing changes", () => {
    const proofread = { [`typeset:vol-5/k.ly`]: { was: "a".repeat(32), date: "2026-09-29" } };
    expect(typesetEntries(data(), proofread).some((e) => e.queue === "proofreading")).toBe(false);
    const edited = data({ parts: [{ target: KYRIE, file: "vol-5/k.ly", hash: "d".repeat(32) }] });
    expect(typesetEntries(edited, proofread).some((e) => e.queue === "proofreading")).toBe(true);
  });

  it("should list every undecided and broken file of the committed data once", () => {
    const entries = typesetEntries();
    const open = TYPESET.items.filter((i) => ["proposed", "melody-differs", "broken"].includes(i.status));
    expect(entries.filter((e) => e.queue !== "proofreading")).toHaveLength(open.length);
    expect(new Set(entries.map((e) => e.target)).size).toBe(entries.length);
  });
});

describe("parseError", () => {
  it("should read the line and column LilyPond names", () => {
    expect(parseError("line 39:25: error: syntax error, unexpected '*'"))
      .toEqual({ line: 39, column: 25, message: "syntax error, unexpected '*'" });
  });

  it("should keep an error that names no line whole", () => {
    expect(parseError("LilyPond crashed")).toEqual({ line: null, column: null, message: "LilyPond crashed" });
  });
});

describe("targetLabel and targetSpan", () => {
  it("should name a movement in words and find its systems", () => {
    expect(targetLabel(KYRIE, MASS)).toBe(`${MASS.label} (${MASS.volume}) · Kyrie`);
    const span = targetSpan(MASS, KYRIE);
    expect(span?.[0]).toBe(MASS.systems.indexOf(MASS.movements.find((m) => m.movement === "kyrie")!.ref));
  });

  it("should say when a target is not in the catalogue", () => {
    expect(targetLabel("piece:nowhere", pieceBySlug("nowhere"))).toBe("piece:nowhere (not in the catalogue)");
    expect(targetSpan(MASS, "movement:nowhere/kyrie")).toBeNull();
  });

  it("should read a volume from a file's folder", () => {
    expect(volumeOf("vol-3/in_x.ly")).toBe("noh3");
    expect(volumeOf("other/x.ly")).toBe("other");
  });
});

describe("typesetTargets", () => {
  it("should give each file its current answer, and say which cannot be shown", () => {
    const t = typesetTargets(data());
    expect(t["vol-5/k.ly"]).toEqual({ label: KYRIE, match: KYRIE, broken: null });
    expect(t["vol-5/g.ly"]!.match).toBe("");
    expect(t["vol-5/n.ly"]!.match).toBe("none");
    expect(t["vol-5/i.ly"]!.broken).toMatch(/cannot draw it \(line 5:2/);
  });
});

describe("typesetTargetExists", () => {
  const all = targets(
    piece("missa-ix", { genre: "mass_ordinary", movements: ["kyrie"], systems: 3 }),
    piece("credo-i", { genre: "credo", systems: 4 }),
    piece("dominica", { genre: "proper", systems: 5, parts: [
      { part: "introit", variant: "", system: 1, borrowed: null, chant: null },
      { part: "offertory", variant: "", system: null, borrowed: "elsewhere", chant: null }] }),
  );

  it("should accept a movement a Mass has, a whole single-chant piece and a printed part", () => {
    expect(typesetTargetExists(all, "movement:missa-ix/kyrie")).toBe(true);
    expect(typesetTargetExists(all, "piece:credo-i")).toBe(true);
    expect(typesetTargetExists(all, "part:dominica/introit")).toBe(true);
  });

  it("should refuse a movement a Mass lacks, a part printed elsewhere, a Proper as a whole and a stranger", () => {
    expect(typesetTargetExists(all, "movement:missa-ix/gloria")).toBe(false);
    expect(typesetTargetExists(all, "part:dominica/offertory")).toBe(false);
    expect(typesetTargetExists(all, "piece:dominica")).toBe(false);
    expect(typesetTargetExists(all, "piece:__proto__")).toBe(false);
    expect(typesetTargetExists(all, "javascript:alert(1)")).toBe(false);
  });
});
