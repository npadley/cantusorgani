import type { ExportRun } from "./typeset";
import type { ChantRef, SelectionInput, StorageLike } from "./export-layout/types";
import type { ExportSegment, SeasonGroup } from "./exportParts";
import type { ProperPartName } from "./catalog";
import type { OfCycle, OfSeason } from "./ordinaryFormPieces";
import type { Paper, PdfHeading, TypesetInsert } from "./pdf";
import { initialPartSelection } from "./ordinaryFormPageClient";

export type Setting = { readonly id: "noh" };
export const NOH_SETTING: Setting = { id: "noh" };
export interface SelectionRun {
  readonly index: number;
  readonly count: number;
  readonly stems: string[];
  readonly sourceKey: string | null;
  readonly label: string | null;
  readonly revision: string | null;
  readonly target: string | null;
  readonly letter: string | null;
  readonly a4: string | null;
  /** What the run could be: "mei" when it names a conversion target and render hash (whether that
   * conversion is approved is the manifest lookup's decision, at snapshot), "fixed" when it has typeset
   * PDFs only, else "scan". Descriptive: Quick and the snapshot keep their own eligibility rules. */
  readonly capability: "mei" | "fixed" | "scan";
  /** What the reader sees for this run's source key. */
  readonly representation: "scan" | "typeset";
  /** Every run can fall back to its scans. */
  readonly fallback: "scan";
}
export interface SelectionSegment {
  readonly id: string;
  readonly included: boolean;
  readonly label: string;
  readonly rubric: string | null;
  readonly rubricTranslation: string | null;
  readonly stems: string[];
  readonly chants: ChantRef[];
  readonly years: string[];
  readonly seasons: string[];
  readonly setting: Setting;
  readonly runs: SelectionRun[];
  /** Only for a normalized scan fallback: preserve the legacy adapter's exact
   * input, including invalid coverage, so snapshotSelection keeps its fallback. */
  readonly fallbackInputRuns?: SelectionInput["segments"][number]["runs"];
}
export interface Selection {
  readonly title: string;
  readonly segments: SelectionSegment[];
}

/** What the export reads from one of ExportBar's part checkboxes. An
 * HTMLInputElement is one; tests pass plain objects. */
export interface PartBox {
  readonly disabled?: boolean;
  readonly checked: boolean;
  readonly value: string;
  readonly dataset: Readonly<Record<string, string | undefined>>;
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A part's runs, from its data-runs JSON. Anything malformed reads as no
 * runs, which sends the whole part as scans. */
export function parseRuns(json: string | undefined): ExportRun[] {
  let runs: unknown;
  try {
    runs = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(runs)) return [];
  const out: ExportRun[] = [];
  for (const r of runs as unknown[]) {
    if (typeof r !== "object" || r === null) return [];
    const o = r as Record<string, unknown>;
    if (typeof o["count"] !== "number" || !Number.isInteger(o["count"]) || o["count"] < 0) return [];
    out.push({ count: o["count"], key: text(o["key"]), label: text(o["label"]), letter: text(o["letter"]),
               a4: text(o["a4"]), target: text(o["target"]), hash: text(o["hash"]) });
  }
  return out;
}

/** A part's chants, from its data-chants JSON: [{id, incipit, annotation, mode}]. Anything malformed
 * reads as no chants (the part prints without chant). */
export function parseChants(json: string | undefined): ChantRef[] {
  let list: unknown;
  try {
    list = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: ChantRef[] = [];
  for (const c of list as unknown[]) {
    if (typeof c !== "object" || c === null) return [];
    const o = c as Record<string, unknown>;
    if (typeof o["id"] !== "number" || !Number.isInteger(o["id"]) || o["id"] <= 0) return [];
    out.push({ id: o["id"], incipit: text(o["incipit"]) ?? "", annotation: text(o["annotation"]) ?? "", mode: text(o["mode"]) ?? "" });
  }
  return out;
}


const list = (value: string | undefined): string[] => (value ?? "").split(",").filter(Boolean);

/** All page segments, including unticked alternatives; no DOM or storage reads. */
export function selectionFromBoxes(boxes: readonly PartBox[], title: string,
                                   showsScans: (key: string) => boolean): Selection {
  return { title, segments: boxes.filter(box => !box.disabled).map(box => {
    const stems = list(box.dataset["stems"]);
    let runs = parseRuns(box.dataset["runs"]);
    const fallback = runs.length === 0 || runs.reduce((n, r) => n + r.count, 0) !== stems.length;
    const fallbackInputRuns = fallback ? runs.map(run => ({ ...run,
      showsScans: run.key !== null && showsScans(run.key),
    })) : undefined;
    if (fallback) {
      runs = [{ count: stems.length, key: null, label: null, target: null, hash: null, letter: null, a4: null }];
    }
    let offset = 0;
    return {
      id: box.value, included: box.checked, label: box.dataset["label"] ?? "",
      rubric: box.dataset["rubric"] || null, rubricTranslation: box.dataset["rubricTranslation"] || null,
      stems, chants: parseChants(box.dataset["chants"]), years: list(box.dataset["years"]),
      seasons: list(box.dataset["seasons"]), setting: NOH_SETTING,
      ...(fallbackInputRuns ? { fallbackInputRuns } : {}),
      runs: runs.map((run, index): SelectionRun => {
        const slice = stems.slice(offset, offset + run.count);
        offset += run.count;
        return { index, count: run.count, stems: slice, sourceKey: run.key, label: run.label,
          revision: run.hash, target: run.target, letter: run.letter, a4: run.a4,
          capability: run.key !== null && run.target !== null && run.hash !== null ? "mei"
            : run.key !== null && run.letter !== null && run.a4 !== null ? "fixed" : "scan",
          representation: run.key === null || showsScans(run.key) ? "scan" : "typeset", fallback: "scan" };
      }),
    };
  }) };
}

/** The included selection in the existing Customize snapshot format. */
export function toSelectionInput(sel: Selection): SelectionInput {
  return { title: sel.title, segments: sel.segments.filter(s => s.included).map(s => ({
    segmentId: s.id, label: s.label, rubric: s.rubric, rubricTranslation: s.rubricTranslation,
    credit: null, stems: s.stems, chants: s.chants,
    runs: s.fallbackInputRuns ?? s.runs.map(r => ({ count: r.count, key: r.sourceKey, label: r.label,
      letter: r.letter, a4: r.a4, target: r.target, hash: r.revision,
      showsScans: r.sourceKey !== null && r.representation === "scan" })),
  })) };
}

/** Quick keeps its paper-specific PDF eligibility, independently of MEI capability. */
export function quickRequest(sel: Selection, paper: Paper): {
  refs: string[]; headings: PdfHeading[]; parts: { label: string; systems: number }[];
  typeset: TypesetInsert[]; ticked: number;
} {
  const refs: string[] = [];
  const headings: PdfHeading[] = [];
  const parts: { label: string; systems: number }[] = [];
  const typeset: TypesetInsert[] = [];
  const ticked = sel.segments.filter(s => s.included);
  for (const { stems, label, rubric, rubricTranslation, runs } of ticked) {
    const start = refs.length;
    if (ticked.length > 1 || rubric || rubricTranslation) headings.push({ index: start, label,
      ...(rubric ? { rubric } : {}), ...(rubricTranslation ? { rubricTranslation } : {}) });
    if (runs.reduce((n, r) => n + r.count, 0) === stems.length) {
      let at = start;
      for (const run of runs) {
        const pdf = run[paper];
        if (runs.length > 1 && run.label && at !== start) headings.push({ index: at, label: run.label });
        if (pdf && run.sourceKey && run.representation === "typeset") {
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

export function withIncluded(sel: Selection, id: string, included: boolean): Selection {
  return { ...sel, segments: sel.segments.map(s => s.id === id ? { ...s, included } : s) };
}

export function preselectOrdinaryForm(sel: Selection, cycle: OfCycle | null, season: OfSeason | null): Selection {
  const included = initialPartSelection(sel.segments.map(s => ({
    years: s.years.join(","), seasons: s.seasons.join(","), checked: s.included,
  })), cycle, season);
  const byId = new Map(sel.segments.map((s, i) => [s.id, included[i] ?? s.included]));
  return { ...sel, segments: sel.segments.map(s => ({ ...s, included: byId.get(s.id) ?? s.included })) };
}

export function defaultTicked(segment: ExportSegment, all: readonly ExportSegment[], group: SeasonGroup): boolean {
  if (group === "all" || segment.part === null) return true;
  if (segment.variant === "extra-paschal") return group !== "easter";
  if (segment.variant === "shared" && segment.part === "alleluia") return group !== "lent";
  const mine = all.filter((s) => s.pieceSlug === segment.pieceSlug);
  const has = (part: ProperPartName, variant?: string) =>
    mine.some((s) => s.part === part && (variant === undefined || s.variant === variant
      || (variant === "paschal" && /^paschal-\d+$/.test(s.variant))));
  const hasAlleluia = has("alleluia");
  const paschal = segment.part === "alleluia" && /^paschal(?:-\d+)?$/.test(segment.variant);
  if (segment.part === "tract") return group === "lent" || !hasAlleluia;
  if (paschal) return group === "easter";
  if (segment.part === "alleluia") {
    if (!has("tract")) return !(group === "easter" && has("alleluia", "paschal"));
    return group === "other" || (group === "easter" && !has("alleluia", "paschal"));
  }
  if (segment.part === "gradual") return !(group === "easter" && has("alleluia", "paschal"));
  return true;
}


export function defaultIncluded(segments: readonly ExportSegment[], group: SeasonGroup): Set<string> {
  return new Set(segments.filter(s => defaultTicked(s, segments, group)).map(s => s.id));
}

/** Quick's paper ("export-paper", LEGACY_PAPER_KEY in export-layout/types). Spelled out here so the bar's
 * script imports nothing from the editor: export-layout-v2 is validated by export-layout/preferences. */
export const QUICK_PAPER_KEY = "export-paper";

export function readQuickPaper(storage: StorageLike | null): Paper {
  try { return storage?.getItem(QUICK_PAPER_KEY) === "a4" ? "a4" : "letter"; }
  catch { return "letter"; }
}

export function readTypesetView(storage: StorageLike | null): "scans" | "typeset" | null {
  try {
    const value = storage?.getItem("typeset-view");
    return value === "scans" || value === "typeset" ? value : null;
  } catch { return null; }
}

