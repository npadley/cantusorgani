import { selectionFromBoxes, toSelectionInput } from "./selection";
import type { PartBox } from "./selection";
import type { SelectionInput } from "./export-layout/types";
export { parseRuns, parseChants } from "./selection";
export type { PartBox } from "./selection";

/** Compatibility adapter for callers reading the export checkboxes. */
export function readSelectionInput(boxes: readonly PartBox[], title: string,
                                   showsScans: (key: string) => boolean): SelectionInput {
  return toSelectionInput(selectionFromBoxes(boxes, title, showsScans));
}
