import { describe, expect, it } from "vitest";

import { blankRow, insertAt, move, rowName, rowsValue, startingRows, startsBySystem, unchanged } from "./sectionsEditor";
import { checkValue, currentSections, describeTarget, parseSections, sectionsSummary, sectionsText } from "./targets";
import { piece, targets } from "./testing";

/** The Ember Saturday of Advent in brief: a Gradual after each lesson, and a
 * Communion printed elsewhere. */
function ember() {
  return piece("sabbato-temporum-adventus", {
    genre: "proper", mode: null, systems: 20,
    parts: [{ part: "introit", variant: "", system: 1, borrowed: null, chant: 169, label: "Intr. II", title: "Veni" },
            { part: "gradual", variant: "1", system: 5, borrowed: null, chant: 698 },
            { part: "gradual", variant: "2", system: 9, borrowed: null, chant: 203, label: "2. Grad. I" },
            { part: "communion", variant: "", system: null, borrowed: "commune, p. 76", borrowedVolume: "noh4",
              borrowedPage: 76, chant: null }],
  });
}
const T = targets(ember());

describe("sections targets", () => {
  it("should describe a piece's whole list as its current value, in printed order", () => {
    const info = describeTarget(T, "sections:sabbato-temporum-adventus")!;
    expect(info).toMatchObject({ kind: "sections", systems: 20, label: "sabbato-temporum-adventus (noh5) · sections" });
    expect(JSON.parse(info.values["sections"]!)).toEqual([
      { kind: "introit", label: "Intr. II", title: "Veni", system: 1, chant: 169 },
      { kind: "gradual", n: 1, system: 5, chant: 698 },
      { kind: "gradual", n: 2, label: "2. Grad. I", system: 9, chant: 203 },
      { kind: "communion", borrowed_volume: "noh4", borrowed_page: 76, chant: "none" }]);
    expect(describeTarget(T, "sections:no-such-piece")).toBeNull();
  });

  it("should accept a changed list as canonical text, and refuse one unchanged", () => {
    const info = describeTarget(T, "sections:sabbato-temporum-adventus")!;
    const added = [...currentSections(ember()).slice(0, 3), { kind: "hymn", title: "Benedictus es", system: 12, chant: "none" }];
    const checked = checkValue(T, info, "sections", JSON.stringify(added));
    expect(checked.ok && JSON.parse(checked.value).at(-1)).toEqual({ kind: "hymn", title: "Benedictus es", system: 12, chant: "none" });
    expect(checkValue(T, info, "sections", info.values["sections"]!)).toMatchObject({ ok: false, error: expect.stringMatching(/nothing to correct/) });
  });

  it("should name the section at fault in a list that cannot be applied", () => {
    const cases: [unknown, RegExp][] = [
      ["[", /not valid JSON/],
      [[], /1 to 40 sections/],
      [[{ kind: "psalm", system: 1, chant: "none" }], /Section 1: choose what kind/],
      [[{ kind: "introit", system: 21, chant: "none" }], /outside the piece, which has 20 systems/],
      [[{ kind: "introit", system: 5, chant: "none" }, { kind: "gradual", system: 3, chant: "none" }], /Section 2 starts on system 3, not after/],
      [[{ kind: "gradual", system: 1, chant: "none" }, { kind: "gradual", system: 3, chant: "none" }], /two Gradual/],
      [[{ kind: "introit", system: 1, label: "<i>", chant: "none" }], /no < or >/],
      [[{ kind: "introit", system: 1, chant: "twelve" }], /GregoBase id/],
      [[{ kind: "introit", borrowed_page: 3, chant: "none" }], /its volume and page/],
      [[{ kind: "introit", system: 1, chant: "none", colour: "red" }], /colour, which a section does not take/],
      [[{ kind: "other", key: "Kyrie B", system: 1, chant: "none" }], /its own name should be short/],
      [[{ kind: "other", key: "2", system: 1, chant: "none" }], /its own name should be short/],
      [[{ kind: "other", key: "ite", n: 2, system: 1, chant: "none" }], /takes the place of the number/],
      [[{ kind: "other", key: "ite", system: 1, chant: "none" }, { kind: "other", key: "ite", system: 2, chant: "none" }], /same name/],
    ];
    for (const [value, error] of cases) {
      const parsed = parseSections(typeof value === "string" ? value : JSON.stringify(value), 20);
      expect(parsed, JSON.stringify(value)).toEqual(expect.stringMatching(error));
    }
  });

  it("should keep a row's own name through the list, the screen's rows and what it saves", () => {
    const mass = piece("ordinarium-missae-iv", {
      genre: "mass_ordinary", mode: null, systems: 34,
      parts: [{ part: "other", variant: "ite", system: 33, borrowed: null, chant: 353, label: "Ite, missa est" },
              { part: "other", variant: "benedicamus", system: 34, borrowed: null, chant: null, label: "Benedicamus Domino" }],
    });
    const list = currentSections(mass);
    expect(list).toEqual([{ kind: "other", key: "ite", label: "Ite, missa est", system: 33, chant: 353 },
                          { kind: "other", key: "benedicamus", label: "Benedicamus Domino", system: 34, chant: "none" }]);
    expect(parseSections(sectionsText(list), 34)).toEqual(list);
    expect(JSON.parse(rowsValue(startingRows(mass)))).toEqual(list);
    expect(sectionsSummary(sectionsText(list))).toBe("Ite, missa est at system 33; Benedicamus Domino at system 34");
  });

  it("should put a list in a line for the queue and the public log, with systems or refs", () => {
    expect(sectionsSummary(sectionsText(currentSections(ember())))).toBe(
      "Introit at system 1; Gradual 1 at system 5; Gradual 2 at system 9; Communion at noh4 p. 76");
    expect(sectionsSummary([{ kind: "alleluia", variant: "paschal", ref: "noh3/0483/000" }])).toBe("Alleluia (paschal) at noh3/0483/000");
    expect(sectionsSummary("not a list")).toBe("not a list");
  });
});

describe("the Sections screen's list", () => {
  it("should start from the catalogue, or from a list approved but not yet published", () => {
    expect(startingRows(ember()).map(rowName)).toEqual(["Introit", "Gradual 1", "Gradual 2", "Communion"]);
    const pending = JSON.stringify([{ kind: "introit", system: 1, chant: "none" }, { kind: "tract", system: 7, chant: "none" }]);
    expect(startingRows(ember(), pending).map(rowName)).toEqual(["Introit", "Tract"]);
    expect(startingRows(ember(), "not json").map(rowName)).toHaveLength(4);
  });

  it("should insert a new section by where it starts, move rows, and mark each start", () => {
    const rows = insertAt(startingRows(ember()), 7, "hymn");
    expect(rows.map(rowName)).toEqual(["Introit", "Gradual 1", "Hymn", "Gradual 2", "Communion"]);
    expect(move(rows, 0, -1).map(rowName)).toEqual(rows.map(rowName));
    expect(move(rows, 2, 1).map(rowName)).toEqual(["Introit", "Gradual 1", "Gradual 2", "Hymn", "Communion"]);
    expect(startsBySystem(rows).get(7)).toEqual(["Hymn"]);
    const other = { ...blankRow(3), label: "Ant. 1" };
    expect(rowName(other)).toBe("Ant. 1");
  });

  it("should save the rows as the list the API checks, passing on what is not a number to be named", () => {
    const rows = startingRows(ember());
    expect(unchanged(rows, ember())).toBe(true);
    const value = rowsValue([...rows.slice(0, 1), { ...blankRow(4, "gradual"), paschal: true, chant: "38" }]);
    expect(JSON.parse(value)).toEqual([
      { kind: "introit", label: "Intr. II", title: "Veni", system: 1, chant: 169 },
      { kind: "gradual", variant: "paschal", system: 4, chant: 38 }]);
    expect(parseSections(rowsValue([{ ...blankRow(1, "introit"), system: "one" }]), 20)).toMatch(/Section 1: say which system/);
    expect(unchanged([rows[0]!], ember())).toBe(false);
  });
});
