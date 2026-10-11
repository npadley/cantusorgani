import { describe, expect, it } from "vitest";
import { parseRuns, readSelectionInput } from "./exportSelection";
import type { PartBox } from "./exportSelection";

const typesetRun = { count: 4, key: "dominica-x:4", label: "Gradual", letter: "l.pdf", a4: "a.pdf",
                     target: "part:dominica-x/gradual", hash: "a".repeat(32) };
const scanRun = { count: 2, key: null, label: null, letter: null, a4: null, target: null, hash: null };

const box = (over: Partial<PartBox> & { dataset?: Record<string, string | undefined> }): PartBox => ({
  checked: true, value: "gradual",
  ...over,
  dataset: { label: "Gradual", stems: "s1,s2,s3,s4,s5,s6", runs: JSON.stringify([typesetRun, scanRun]), ...over.dataset },
});

describe("parseRuns", () => {
  it("should read well-formed runs, keeping a typeset run's target and hash", () => {
    expect(parseRuns(JSON.stringify([typesetRun, scanRun]))).toEqual([typesetRun, scanRun]);
  });

  it("should read runs from an older page without target or hash as null", () => {
    expect(parseRuns(JSON.stringify([{ count: 3, key: null, label: null, letter: null, a4: null }])))
      .toEqual([{ ...scanRun, count: 3 }]);
  });

  it.each([undefined, "", "not json", "{}", "[1]", "[null]", '[{"count":"4"}]', '[{"count":-1}]', '[{"count":1.5}]'])(
    "should read %j as no runs, sending the part as scans", (json) => {
      expect(parseRuns(json)).toEqual([]);
    });
});

describe("readSelectionInput", () => {
  it("should keep only ticked parts, in page order", () => {
    const input = readSelectionInput([box({ value: "introit" }), box({ checked: false, value: "gradual" }),
                                      box({ value: "communion" })], "Dominica X", () => false);
    expect(input.title).toBe("Dominica X");
    expect(input.segments.map((s) => s.segmentId)).toEqual(["introit", "communion"]);
  });

  it("should mark the runs the reader is looking at as scans, and never a scan run's", () => {
    const asked: string[] = [];
    const [seg] = readSelectionInput([box({})], "t", (key) => { asked.push(key); return true; }).segments;
    expect(seg?.runs.map((r) => r.showsScans)).toEqual([true, false]);
    expect(seg?.runs[0]).toMatchObject({ target: "part:dominica-x/gradual", hash: "a".repeat(32) });
    expect(asked).toEqual(["dominica-x:4"]);
  });

  it("should read stems, rubrics and labels, with absent or empty values as null", () => {
    const [plain, rubric] = readSelectionInput([
      box({ dataset: { rubric: "", stems: "a,,b" } }),
      box({ dataset: { label: undefined, rubric: "Ps. 54", rubricTranslation: "Psalm 54" } }),
    ], "t", () => false).segments;
    expect(plain).toMatchObject({ label: "Gradual", rubric: null, rubricTranslation: null, credit: null, stems: ["a", "b"] });
    expect(rubric).toMatchObject({ label: "", rubric: "Ps. 54", rubricTranslation: "Psalm 54" });
  });

  it("should read a part with no stems as none", () => {
    const [seg] = readSelectionInput([box({ dataset: { stems: undefined } })], "t", () => false).segments;
    expect(seg?.stems).toEqual([]);
  });
});
