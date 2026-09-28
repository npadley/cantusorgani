import { allPieces, systemUrlStem } from "../catalog";
import { pieceHref } from "../indexes";
import { allLineups, itemSystems, lineupHref, lineupTitle } from "../vespers";
import type { TargetPiece, TargetVespers, Targets } from "./targets";

/**
 * Everything a correction can name, with its current values and a picture,
 * built from the catalogue and the Vespers lineup at build time: served as
 * /corrections/targets.json, and used for the names on /corrections/log/.
 */
let cached: Targets | null = null;
export function buildTargets(): Targets {
  if (cached) return cached;
  const pieces: Record<string, TargetPiece> = {};
  for (const p of allPieces()) {
    const aspect = p.systemAspect[0];
    pieces[p.slug] = {
      id: p.id, slug: p.slug, volume: p.volume, label: p.label, href: pieceHref(p),
      title: p.title, incipit: p.incipit, mode: p.mode, genre: p.genre, printed_pages: p.printedPages,
      stem: p.systems.length > 0 ? systemUrlStem(p, 0) : null,
      aspect: aspect ? [aspect[0], aspect[1]] : null,
      systems: p.systems.length,
      parts: p.parts.map((part) => part.kind === "printed"
        ? { part: part.part, variant: part.variant, system: part.system + 1, borrowed: null, chant: part.gregobaseId }
        : { part: part.part, variant: part.variant, system: null, chant: part.gregobaseId,
            borrowed: `${part.borrowedFrom ?? "another volume"}, p. ${part.borrowedPage}` }),
    };
  }
  // Each Vespers item that can be corrected, once, at the first date it is sung.
  const vespers: Record<string, TargetVespers> = {};
  for (const day of allLineups()) {
    for (const item of day.items) {
      if (!item.target || item.repeat || vespers[item.target]) continue;
      const first = itemSystems(item)[0];
      vespers[item.target] = {
        label: item.label, when: `${lineupTitle(day)}, ${day.vespers} Vespers`, href: lineupHref(day),
        tone: item.tone, chant: item.chant, refs: item.source.type === "printed" ? item.source.refs : [],
        stem: first?.stem ?? null, aspect: first ? first.aspect : null,
      };
    }
  }
  const genres = [...new Set(allPieces().map((p) => p.genre))].sort();
  cached = { pieces, vespers, genres };
  return cached;
}
