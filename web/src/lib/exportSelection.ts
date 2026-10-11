import type { ExportRun } from "./typeset";
import type { SelectionInput } from "./export-layout/types";

/** What the export reads from one of ExportBar's part checkboxes. An
 * HTMLInputElement is one; tests pass plain objects. */
export interface PartBox {
  readonly checked: boolean;
  readonly value: string;
  readonly dataset: Readonly<Record<string, string | undefined>>;
}

type Run = SelectionInput["segments"][number]["runs"][number];

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

/** The ticked parts, in page order, with each run marked by whether the reader
 * is looking at its scans. Reads no DOM itself: `showsScans` does. */
export function readSelectionInput(boxes: readonly PartBox[], title: string,
                                   showsScans: (key: string) => boolean): SelectionInput {
  return {
    title,
    segments: boxes.filter((b) => b.checked).map((box) => ({
      segmentId: box.value,
      label: box.dataset["label"] ?? "",
      rubric: box.dataset["rubric"] || null,
      rubricTranslation: box.dataset["rubricTranslation"] || null,
      credit: null,
      stems: (box.dataset["stems"] ?? "").split(",").filter(Boolean),
      runs: parseRuns(box.dataset["runs"]).map((run): Run => ({
        ...run, showsScans: run.key !== null && showsScans(run.key),
      })),
    })),
  };
}
