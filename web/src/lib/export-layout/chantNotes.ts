// Words the editor says about chant (CS §2, §7): the "In this PDF" lines and the status announcement.
// Pure, so the copy is tested without a DOM.
import type { CanonicalPage, ChantMode, ExportPart, LayoutDiagnostic } from './types';

/** A segment can export as several parts ("<segment>:<run>"); chant belongs to the first, so count segments. */
export const segmentKey = (partId: string): string => partId.replace(/:\d+$/, '');

export interface ChantCounts { readonly withChant: number; readonly without: number }

export function chantCounts(parts: readonly ExportPart[]): ChantCounts {
  const withChant = new Set<string>();
  const all = new Set<string>();
  for (const p of parts) {
    const key = segmentKey(p.id);
    all.add(key);
    if (p.chants.length > 0) withChant.add(key);
  }
  return { withChant: withChant.size, without: all.size - withChant.size };
}

const parts = (n: number): string => `${n} part${n === 1 ? '' : 's'}`;

/** The polite announcement when Chant changes: "Chant added before 3 parts. 1 part has no chant." */
export function chantAnnouncement(mode: ChantMode, list: readonly ExportPart[]): string {
  if (mode === 'off') return 'Chant removed.';
  const { withChant, without } = chantCounts(list);
  if (withChant === 0) return 'No part in this PDF has a chant.';
  const added = mode === 'only' ? `Chant only: ${parts(withChant)}.` : `Chant added before ${parts(withChant)}.`;
  if (without === 0) return added;
  return `${added} ${without === 1 ? '1 part has' : `${without} parts have`} no chant.`;
}

export interface ChantNote { readonly text: string; readonly incipits: readonly string[] }

/**
 * The extra "In this PDF" line for a part, or null when it has none to show (Chant off, or a later run of a
 * segment whose chant sits on its first run).
 */
export function chantNote(
  part: ExportPart,
  list: readonly ExportPart[],
  mode: ChantMode,
  diagnostics: readonly LayoutDiagnostic[],
): ChantNote | null {
  if (mode === 'off') return null;
  const key = segmentKey(part.id);
  const segmentHasChant = list.some((p) => segmentKey(p.id) === key && p.chants.length > 0);
  if (part.chants.length === 0) {
    const firstOfSegment = list.find((p) => segmentKey(p.id) === key)?.id === part.id;
    if (segmentHasChant || !firstOfSegment) return null;
    return { text: mode === 'only' ? 'No chant for this part, so it is left out.' : 'No chant for this part.', incipits: [] };
  }
  if (diagnostics.some((d) => d.code === 'CHANT_UNAVAILABLE' && d.partId === part.id)) {
    return { text: 'The chant could not be drawn; this part prints without it.', incipits: [] };
  }
  return { text: 'With its chant', incipits: part.chants.map((c) => c.incipit) };
}

/** Parts that printed chant in this result (segments, not runs). */
export function chantPartsPrinted(pages: readonly CanonicalPage[]): number {
  return new Set(pages.filter((p) => p.chant.length > 0).map((p) => segmentKey(p.partId))).size;
}
