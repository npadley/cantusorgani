import { describe, expect, it } from "vitest";
import { NOH_SETTING, defaultIncluded, preselectOrdinaryForm, quickRequest, QUICK_PAPER_KEY, readQuickPaper, readTypesetView, selectionFromBoxes, toSelectionInput, withIncluded } from "./selection";
import type { PartBox } from "./selection";
import { parseChants, parseRuns } from "./exportSelection";
import { snapshotSelection } from "./export-layout/selection";
import { readPreferences } from "./export-layout/preferences";
import { LEGACY_PAPER_KEY } from "./export-layout/types";
import type { ApprovedConversion, ConversionLookup, StorageLike } from "./export-layout/types";
import type { ExportSegment } from "./exportParts";
import type { ExportRun } from "./typeset";
import type { Paper, TypesetInsert } from "./pdf";

const mei: ExportRun = { count: 1, key: "lender:0", label: "First", target: "approved", hash: "hash", letter: "l.pdf", a4: "a.pdf" };
const scan: ExportRun = { count: 1, key: null, label: null, target: null, hash: null, letter: null, a4: null };
const fixed: ExportRun = { ...mei, key: "lender:2", target: "unapproved", label: "Last" };
const box = (id = "one", data: Record<string, string> = {}): PartBox => ({ checked: true, value: id, dataset: { label: "Same label", stems: "a,b,c", runs: JSON.stringify([mei, scan, fixed]), ...data } });
const conversion: ApprovedConversion = { digest: "d", meiUrl: "/score.mei", meiSha256: "s", sourceRevision: "r", profile: "p", verovio: "6", boundaries: [], capabilities: { manualBreaks: true } };
const lookup: ConversionLookup = target => target === "approved" ? conversion : null;
const store = (values: Record<string, string>): StorageLike => ({ getItem: key => values[key] ?? null, setItem() {}, removeItem() {} });

// The pre-refactor reader, independent of the new model and adapter.
function oldInput(boxes: readonly PartBox[], title: string, showsScans: (key: string) => boolean) {
  return { title, segments: boxes.filter(b => b.checked).map(box => ({
    segmentId: box.value, label: box.dataset["label"] ?? "",
    rubric: box.dataset["rubric"] || null, rubricTranslation: box.dataset["rubricTranslation"] || null,
    credit: null, stems: (box.dataset["stems"] ?? "").split(",").filter(Boolean),
    chants: parseChants(box.dataset["chants"]),
    runs: parseRuns(box.dataset["runs"]).map(run => ({ ...run, showsScans: run.key !== null && showsScans(run.key) })),
  })) };
}

function oldQuick(boxes: readonly PartBox[], paper: Paper, showsScans: (key: string) => boolean) {
  const refs: string[] = [];
  const headings: import("./pdf").PdfHeading[] = [];
  const parts: { label: string; systems: number }[] = [];
  const typeset: TypesetInsert[] = [];
  const ticked = oldInput(boxes, "Title", showsScans).segments;
  for (const { stems, label, rubric, rubricTranslation, runs } of ticked) {
    const start = refs.length;
    if (ticked.length > 1 || rubric || rubricTranslation) headings.push({ index: start, label,
      ...(rubric ? { rubric } : {}), ...(rubricTranslation ? { rubricTranslation } : {}) });
    // The runs cover the part's systems in order; if they do not add up,
    // the part goes in as scans.
    if (runs.reduce((n, r) => n + r.count, 0) === stems.length) {
      let at = start;
      for (const run of runs) {
        const pdf = run[paper];
        if (runs.length > 1 && run.label && at !== start) headings.push({ index: at, label: run.label });
        if (pdf && run.key && !run.showsScans) {
          typeset.push({ index: at, count: run.count, pdf, label: run.label ?? label });
        }
        at += run.count;
      }
    }
    refs.push(...stems);
    parts.push({ label, systems: stems.length });
  }
  return { refs, headings, parts, typeset, ticked: ticked.length };
}

describe('selection', () => {
  it('ignores a disabled Ordinary even if a stale caller leaves it checked', () => {
    const selected = selectionFromBoxes([box("chosen"), { ...box("hidden"), disabled: true }], "Dated service", () => false);
    expect(selected.segments.map(s => s.id)).toEqual(["chosen"]);
    expect(quickRequest(selected, "letter").ticked).toBe(1);
    expect(toSelectionInput(selected).segments.map(s => s.segmentId)).toEqual(["chosen"]);
  });
  it('keeps page order, inclusion, run slices and the NOH setting', () => {
    const sel = selectionFromBoxes([box(), { ...box("two"), checked: false }], "Title", () => false);
    expect(sel.segments.map(s => [s.id, s.included, s.setting])).toEqual([["one", true, NOH_SETTING], ["two", false, NOH_SETTING]]);
    expect(sel.segments[0]!.runs.map(r => [r.index, r.stems, r.capability, r.fallback])).toEqual([[0, ["a"], "mei", "scan"], [1, ["b"], "scan", "scan"], [2, ["c"], "mei", "scan"]]);
    expect(withIncluded(sel, "two", true).segments.every(s => s.included)).toBe(true);
    expect(sel.segments[1]!.included).toBe(false);
    expect(JSON.stringify(toSelectionInput(sel))).toBe(JSON.stringify(oldInput([box()], "Title", () => false)));
  });

  it('uses the existing piece and seasonal day defaults', () => {
    const make = (part: ExportSegment["part"], variant = ""): ExportSegment => ({ id: `${part}:${variant}`, label: part ?? "Mass", part, variant, pieceSlug: "proper", systems: 1, stems: ["a"] });
    const segments = [make("introit"), make("gradual"), make("alleluia"), make("tract"), make("alleluia", "paschal"), make("communion")];
    expect([...defaultIncluded(segments, "all")]).toEqual(segments.map(s => s.id));
    expect([...defaultIncluded(segments, "lent")]).toEqual(["introit:", "gradual:", "tract:", "communion:"]);
    expect([...defaultIncluded(segments, "easter")]).toEqual(["introit:", "alleluia:paschal", "communion:"]);
    expect([...defaultIncluded(segments, "other")]).toEqual(["introit:", "gradual:", "alleluia:", "communion:"]);
  });

  it('preselects OF alternatives by id despite identical labels', () => {
    const sel = selectionFromBoxes([box("a", { years: "A", seasons: "lent" }), box("b", { years: "B", seasons: "lent" })], "Title", () => false);
    expect(preselectOrdinaryForm(sel, "B", "lent").segments.map(s => [s.id, s.included])).toEqual([["a", false], ["b", true]]);
    expect(preselectOrdinaryForm(sel, "B", "easter").segments.every(s => !s.included)).toBe(true);
  });

  it('validates storage and handles blocked reads without throwing', () => {
    const blocked: StorageLike = { ...store({}), getItem() { throw new Error("blocked"); } };
    for (const storage of [null, blocked, store({ "export-paper": "garbage", "typeset-view": "scan", "export-layout-v2": "garbage" }), ...["[]", "null", "42", '\"text\"'].map(raw => store({ "export-layout-v2": raw }))]) {
      expect(readQuickPaper(storage)).toBe("letter");
      expect(readTypesetView(storage)).toBeNull();
      expect(readPreferences(storage).preferences.settings.page).toBe("letter");
    }
    expect(readPreferences(store({ "export-layout-v2": JSON.stringify({ version: 2, settings: { page: "wrong", orientation: "wrong" } }) })).preferences.settings).toMatchObject({ page: "letter", orientation: "portrait" });
    expect(QUICK_PAPER_KEY).toBe(LEGACY_PAPER_KEY);
    expect(readQuickPaper(store({ "export-paper": "a4" }))).toBe("a4");
    for (const view of ["scans", "typeset"]) expect(readTypesetView(store({ "typeset-view": view }))).toBe(view);
    expect(readPreferences(store({ "export-paper": "a4" })).preferences.settings.page).toBe("a4");
  });

  it('changes only the switched run in a mixed MEI, scan and fixed segment', () => {
    const before = selectionFromBoxes([box()], "Title", () => false);
    const after = selectionFromBoxes([box()], "Title", key => key === mei.key);
    expect(after.segments[0]!.runs[0]).toEqual({ ...before.segments[0]!.runs[0], representation: "scan" });
    expect(after.segments[0]!.runs.slice(1)).toEqual(before.segments[0]!.runs.slice(1));
    expect(toSelectionInput(after).segments[0]!.runs.slice(1)).toEqual(toSelectionInput(before).segments[0]!.runs.slice(1));
    const oldParts = snapshotSelection(toSelectionInput(before), lookup);
    const newParts = snapshotSelection(toSelectionInput(after), lookup);
    expect(oldParts.map(p => p.kind)).toEqual(["mei", "scan", "fixed"]);
    expect(newParts.map(p => p.kind)).toEqual(["scan", "fixed"]);
    expect(newParts[1]).toEqual(oldParts[2]);
    expect(newParts[0]).toMatchObject({ stems: ["a", "b"], customizableAvailable: true });
  });

  it('keeps repeated lender sources in separate borrower segments', () => {
    const sel = selectionFromBoxes([box("borrower:a"), box("borrower:b")], "Title", () => false);
    expect(sel.segments.map(s => s.runs[0]!.sourceKey)).toEqual([mei.key, mei.key]);
    const parts = snapshotSelection(toSelectionInput(sel), lookup);
    expect(parts.map(p => p.id)).toEqual(["borrower:a:0", "borrower:a:1", "borrower:a:2", "borrower:b:0", "borrower:b:1", "borrower:b:2"]);
  });

  it('falls back to one scan run for malformed or mismatched runs', () => {
    for (const runs of ["garbage", "[]", JSON.stringify([mei])]) {
      const sel = selectionFromBoxes([box("bad", { runs })], "Title", () => false);
      expect(sel.segments[0]!.runs).toHaveLength(1);
      expect(sel.segments[0]!.runs[0]).toMatchObject({ count: 3, stems: ["a", "b", "c"], capability: "scan", representation: "scan" });
      expect(snapshotSelection(toSelectionInput(sel), lookup)).toMatchObject([{ kind: "scan", stems: ["a", "b", "c"] }]);
    }
  });

  it('preserves the legacy SelectionInput bytes even when the model normalizes a fallback', () => {
    for (const runs of ["garbage", "[]", JSON.stringify([mei])]) {
      const input = toSelectionInput(selectionFromBoxes([box("bad", { runs })], "Title", () => true));
      expect(JSON.stringify(input)).toBe(JSON.stringify(oldInput([box("bad", { runs })], "Title", () => true)));
    }
  });

  it('describes legacy PDF-only runs without changing export eligibility', () => {
    const sel = selectionFromBoxes([box("old", { stems: "a", runs: JSON.stringify([{ ...mei, target: null, hash: null }]) })], "Title", () => false);
    expect(sel.segments[0]!.runs[0]!.capability).toBe("fixed");
    expect(quickRequest(sel, "letter").typeset).toHaveLength(1);
    expect(snapshotSelection(toSelectionInput(sel), lookup)[0]!.kind).toBe("scan");
  });

  it('matches the old Quick builder for mixed runs, rubrics and multiple segments', () => {
    for (const boxes of [[box()], [box("rubric", { rubric: "Rubric", rubricTranslation: "Translation" })], [box(), box("two")], [box(), { ...box("off"), checked: false }], [box("bad", { runs: "garbage" })], [box("mismatch", { runs: JSON.stringify([mei]) })], [box("paper", { stems: "a", runs: JSON.stringify([{ ...mei, target: null, hash: null, a4: null }]) })]]) {
      for (const paper of ["letter", "a4"] as const) {
        for (const scans of [false, true]) {
          expect(quickRequest(selectionFromBoxes(boxes, "Title", () => scans), paper)).toEqual(oldQuick(boxes, paper, () => scans));
        }
      }
    }
  });
});
