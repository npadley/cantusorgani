/**
 * Proper parts whose start looks wrong, for an editor to check against the
 * scan (/admin/parts/). Two signs, both cheap and both seen in real errors:
 *
 * - no label or words placed it: its start was inferred, the one chant start
 *   the page allows between its neighbours ("inferred"), or (in a catalogue
 *   built before 2026-09-29) guessed from the order of the parts ("order");
 * - the part is much shorter than that kind of part ever is. A short part is as
 *   often a sign that the NEXT part starts too early: Dominica I Adventus's
 *   Introit had three systems because its Gradual was placed on system 4, not 9.
 *
 * Neither proves an error; each entry names what to look at. An editor who
 * finds a part right marks it reviewed (**Looks right**): the review records its
 * start and length, and the part stays off this list until either changes.
 */
import { partLabel } from "../catalog";
import type { Piece, PrintedPart, ProperPartName } from "../catalog";

/** Fewer systems than this is rare for each kind of part (about the 5th
 * percentile across the catalogue); a part printed that short is worth a look. */
export const FEWEST: Readonly<Record<ProperPartName, number>> = {
  introit: 5, gradual: 5, tract: 5, alleluia: 3, offertory: 3, sequence: 2, communion: 2,
  // A hymn within the Mass is long (the Ember Saturday's Benedictus es, 24
  // systems); a section outside it may be a single line.
  hymn: 3, other: 1,
};

export interface SuspectPart {
  readonly target: string;
  readonly name: string;
  /** The system it starts on, counting from 1, and how many it runs for. */
  readonly start: number;
  readonly length: number;
  readonly reasons: readonly string[];
  /** What a review of it confirms: the same text as pipeline/corrections.py part_fingerprint. */
  readonly fingerprint: string;
}

export interface SuspectPiece {
  readonly slug: string;
  readonly label: string;
  readonly volume: string;
  readonly parts: readonly SuspectPart[];
}

const targetOf = (slug: string, p: PrintedPart): string => `part:${slug}/${p.part}${p.variant ? `:${p.variant}` : ""}`;

/** What reviewing a part confirms: where it starts (counting from 1) and how
 * many systems it runs for. */
export function partFingerprint(start: number, length: number): string {
  return `start ${start}, ${length} systems`;
}

/** Reviews that still hold, by target, with what each confirmed (data/reviewed.json). */
export type Reviewed = Readonly<Record<string, { readonly was: string; readonly date: string }>>;

/** Every piece with a part to check, in catalogue order. Parts corrected by
 * hand ("hand") or in a reviewed section list ("reviewed") are taken as checked,
 * and so are parts reviewed as they are now. */
export function suspectParts(pieces: readonly Piece[], reviewed: Reviewed = {}): readonly SuspectPiece[] {
  const out: SuspectPiece[] = [];
  for (const piece of pieces) {
    const placed = piece.parts.filter((p): p is PrintedPart => p.kind === "printed");
    const parts: SuspectPart[] = [];
    placed.forEach((p, i) => {
      if (p.placed === "hand" || p.placed === "reviewed") return;
      const next = placed[i + 1];
      const length = (next?.system ?? piece.systems.length) - p.system;
      const name = partLabel(p.part, p.variant);
      const reasons: string[] = [];
      if (p.placed === "order") reasons.push("its start was guessed from the order of the parts, so the site hides it");
      if (p.placed === "inferred") {
        reasons.push("no label or words placed it: its start is the one chant start the page allows between its neighbours");
      }
      if (length < FEWEST[p.part]) {
        reasons.push(`it runs for only ${length} system${length === 1 ? "" : "s"}` +
          (next ? `: check where it starts, and where the ${partLabel(next.part, next.variant)} starts` : ""));
      }
      const target = targetOf(piece.slug, p);
      const fingerprint = partFingerprint(p.system + 1, length);
      if (reasons.length && reviewed[target]?.was !== fingerprint) {
        parts.push({ target, name, start: p.system + 1, length, reasons, fingerprint });
      }
    });
    if (parts.length) out.push({ slug: piece.slug, label: piece.label, volume: piece.volume, parts });
  }
  return out;
}
