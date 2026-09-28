/**
 * Proper parts whose start looks wrong, for an editor to check against the
 * scan (/admin/parts/). Two signs, both cheap and both seen in real errors:
 *
 * - the start was only guessed from the order of the parts ("order"), which the
 *   site does not show;
 * - the part is much shorter than that kind of part ever is. A short part is as
 *   often a sign that the NEXT part starts too early: Dominica I Adventus's
 *   Introit had three systems because its Gradual was placed on system 4, not 9.
 *
 * Neither proves an error; each entry names what to look at.
 */
import { partLabel } from "../catalog";
import type { Piece, PrintedPart, ProperPartName } from "../catalog";

/** Fewer systems than this is rare for each kind of part (about the 5th
 * percentile across the catalogue); a part printed that short is worth a look. */
export const FEWEST: Readonly<Record<ProperPartName, number>> = {
  introit: 5, gradual: 5, tract: 5, alleluia: 3, offertory: 3, sequence: 2, communion: 2,
};

export interface SuspectPart {
  readonly target: string;
  readonly name: string;
  /** The system it starts on, counting from 1, and how many it runs for. */
  readonly start: number;
  readonly length: number;
  readonly reasons: readonly string[];
}

export interface SuspectPiece {
  readonly slug: string;
  readonly label: string;
  readonly volume: string;
  readonly parts: readonly SuspectPart[];
}

const targetOf = (slug: string, p: PrintedPart): string => `part:${slug}/${p.part}${p.variant ? `:${p.variant}` : ""}`;

/** Every piece with a part to check, in catalogue order. Parts corrected by
 * hand ("hand") are taken as checked. */
export function suspectParts(pieces: readonly Piece[]): readonly SuspectPiece[] {
  const out: SuspectPiece[] = [];
  for (const piece of pieces) {
    const placed = piece.parts.filter((p): p is PrintedPart => p.kind === "printed");
    const parts: SuspectPart[] = [];
    placed.forEach((p, i) => {
      if (p.placed === "hand") return;
      const next = placed[i + 1];
      const length = (next?.system ?? piece.systems.length) - p.system;
      const name = partLabel(p.part, p.variant);
      const reasons: string[] = [];
      if (p.placed === "order") reasons.push("its start was guessed from the order of the parts, so the site hides it");
      if (length < FEWEST[p.part]) {
        reasons.push(`it runs for only ${length} system${length === 1 ? "" : "s"}` +
          (next ? `: check where it starts, and where the ${partLabel(next.part, next.variant)} starts` : ""));
      }
      if (reasons.length) parts.push({ target: targetOf(piece.slug, p), name, start: p.system + 1, length, reasons });
    });
    if (parts.length) out.push({ slug: piece.slug, label: piece.label, volume: piece.volume, parts });
  }
  return out;
}
