import { annotationFor, chantEntry } from "./chants";
import { jumpTargets } from "./catalog";
import type { Piece } from "./catalog";
import type { ChantRef } from "./export-layout/types";

/**
 * The chants a run of systems starts, in page order: the GregoBase chants the page shows above those
 * systems (SystemStack), as the export editor needs them. Starts whose chant has no published notation
 * are left out, like the page leaves out their "Show chant" box.
 */
export function segmentChants(piece: Piece, start: number, end: number): ChantRef[] {
  const out: ChantRef[] = [];
  const seen = new Set<number>();
  for (const t of jumpTargets(piece)) {
    if (t.index < start || t.index >= end) continue;
    const entry = chantEntry(t.chantId);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const [annotation, mode] = annotationFor(entry.part, entry.mode);
    out.push({ id: entry.id, incipit: entry.incipit, annotation, mode });
  }
  return out;
}
