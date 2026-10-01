import { describe, expect, it } from "vitest";

import { allPieces } from "./catalog";
import type { Piece, PrintedPart } from "./catalog";
import { MANIFEST, exportRuns, hasTypeset, renderFor, segments } from "./typeset";
import type { Render } from "./typeset";

function part(name: PrintedPart["part"], system: number, placed: PrintedPart["placed"] = "label"): PrintedPart {
  return { kind: "printed", part: name, variant: "", label: null, title: null, system, ref: `noh1/0029/${String(system).padStart(3, "0")}`,
           gregobaseId: null, placed };
}

function proper(slug: string, systems: number, parts: PrintedPart[]): Piece {
  const piece = allPieces().find((p) => p.parts.length > 0)!;
  return { ...piece, slug, label: slug, movements: [], hymns: [], chant: [],
           systems: Array.from({ length: systems }, (_, n) => `noh1/0029/${String(n).padStart(3, "0")}`),
           systemAspect: Array.from({ length: systems }, () => [1600, 400] as const), parts };
}

const drawn = (file: string): Render => ({ narrow: `n/${file}`, wide: `w/${file}`, letter: `l/${file}`, a4: `a/${file}`,
                                           proofread: false, file });

describe("segments", () => {
  it("should split a Proper at its parts and show typeset only where a part has a render", () => {
    const piece = proper("dominica-x", 10, [part("introit", 0), part("gradual", 4), part("communion", 8)]);
    const found = segments(piece, (t) => (t === "part:dominica-x/gradual" ? drawn("gr.ly") : null));
    expect(found.map((s) => [s.start, s.end, s.target, s.render?.file ?? null])).toEqual([
      [0, 4, "part:dominica-x/introit", null],
      [4, 8, "part:dominica-x/gradual", "gr.ly"],
      [8, 10, "part:dominica-x/communion", null],
    ]);
  });

  it("should keep systems before the first heading as scans, and cover every system once", () => {
    const piece = proper("dominica-y", 6, [part("gradual", 2)]);
    const found = segments(piece, () => drawn("x.ly"));
    expect(found.map((s) => [s.start, s.end, s.render !== null])).toEqual([[0, 2, false], [2, 6, true]]);
  });

  it("should treat a piece with no heading as one segment, typeset when the piece is matched", () => {
    const piece = { ...proper("credo-z", 3, []), genre: "credo" as Piece["genre"] };
    expect(segments(piece, (t) => (t === "piece:credo-z" ? drawn("credo.ly") : null)))
      .toEqual([{ start: 0, end: 3, target: "piece:credo-z", render: drawn("credo.ly") }]);
    expect(segments({ ...piece, systems: [] })).toEqual([]);
  });

  it("should give Mass IX's four movements and its listed Ite their typeset music, in the real catalogue", () => {
    const mass = allPieces().find((p) => p.slug === "ordinarium-missae-ix")!;
    const found = segments(mass);
    expect(found.map((s) => s.target)).toEqual(["movement:ordinarium-missae-ix/kyrie", "movement:ordinarium-missae-ix/gloria",
      "movement:ordinarium-missae-ix/sanctus", "movement:ordinarium-missae-ix/agnus", "part:ordinarium-missae-ix/other:ite"]);
    expect(found.every((s) => s.render?.wide.endsWith("/wide.svg"))).toBe(true);
    expect(hasTypeset(mass)).toBe(true);
  });
});

describe("renderFor", () => {
  const manifest = { ...MANIFEST, prefix: "typeset",
                     parts: [{ target: "part:dominica-i-adventus/introit", file: "vol-1/in_ad_te_levavi.csv.ly", hash: "ab12" }] };

  it("should give the render's three addresses, not yet proofread", () => {
    const found = renderFor("part:dominica-i-adventus/introit", manifest, {}, []);
    expect(found).toMatchObject({ proofread: false, file: "vol-1/in_ad_te_levavi.csv.ly" });
    expect(found!.narrow).toMatch(/\/typeset\/ab12\/narrow\.svg$/);
    expect(found!.letter).toMatch(/\/typeset\/ab12\/letter\.pdf$/);
    expect(found!.a4).toMatch(/\/typeset\/ab12\/a4\.pdf$/);
  });

  it("should call it proofread only when the review confirmed this very render", () => {
    const reviewed = { "typeset:vol-1/in_ad_te_levavi.csv.ly": { was: "ab12", date: "2026-09-29" } };
    expect(renderFor("part:dominica-i-adventus/introit", manifest, reviewed, [])!.proofread).toBe(true);
    const older = { "typeset:vol-1/in_ad_te_levavi.csv.ly": { was: "0000", date: "2026-09-29" } };
    expect(renderFor("part:dominica-i-adventus/introit", manifest, older, [])!.proofread).toBe(false);
  });

  it("should hold back a part still on Parts to check, and one with no render", () => {
    const short = proper("dominica-i-adventus", 28, [part("introit", 0), part("gradual", 3)]);
    expect(renderFor("part:dominica-i-adventus/introit", manifest, {}, [short])).toBeNull();
    expect(renderFor("part:elsewhere/introit", manifest, {}, [])).toBeNull();
  });
});

describe("exportRuns", () => {
  const piece = proper("dominica-x", 10, [part("introit", 0), part("gradual", 4), part("communion", 8)]);
  const find = (t: string) => (t === "part:dominica-x/gradual" ? drawn("gr.ly") : null);

  it("should give a typeset part's whole run its PDFs, and scans around it", () => {
    expect(exportRuns(piece, 0, 10, find).map((r) => [r.count, r.key, r.letter])).toEqual([
      [4, null, null], [4, "dominica-x:4", "l/gr.ly"], [2, null, null]]);
    expect(exportRuns(piece, 4, 8, find)[0]).toMatchObject({ count: 4, label: "Gradual", a4: "a/gr.ly" });
  });

  it("should use scans for a typeset part only partly inside the export", () => {
    expect(exportRuns(piece, 5, 10, find)).toEqual([{ count: 5, key: null, label: null, letter: null, a4: null }]);
  });
});
