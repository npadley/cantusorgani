import { allPieces, inPrintedOrder, partOrder, sectionName, systemUrlStem } from "./catalog";
import type { BorrowedPart, Piece, PrintedPart, ProperPartName } from "./catalog";
import type { Season } from "./liturgy";

/**
 * What the export can build, part by part. A Proper splits at its parts
 * (Introit, Gradual …); anything else -- an Ordinary, an undivided Proper --
 * is one segment. The organist ticks the parts sung today; defaults follow the
 * season of the date a day page shows.
 */
export interface ExportSegment {
  /** Unique within one export bar: "<slug>:<index>". */
  readonly id: string;
  readonly label: string;
  readonly part: ProperPartName | null;
  readonly variant: string;
  readonly pieceSlug: string;
  readonly systems: number;
  /** Full URL stems of the segment's systems, in order. */
  readonly stems: readonly string[];
  /** Where those systems are: a piece and a range of its systems (for typeset music). */
  readonly source?: { readonly slug: string; readonly start: number; readonly end: number };
}

/** The confident parts of a piece, each with the systems it runs over. */
function partRanges(piece: Piece): { x: PrintedPart; start: number; end: number }[] {
  const printed = piece.parts
    .filter((x): x is PrintedPart => x.kind === "printed" && x.placed !== "order"
                                    && piece.systems.includes(x.ref))
    .map((x) => ({ x, start: piece.systems.indexOf(x.ref) }))
    .sort((a, b) => a.start - b.start);
  return printed.map((p, k) => ({ ...p, end: printed[k + 1]?.start ?? piece.systems.length }));
}

export function exportSegments(pieces: readonly Piece[],
                               lenders: readonly Piece[] = allPieces()): readonly ExportSegment[] {
  const out: ExportSegment[] = [];
  for (const piece of pieces) {
    const stems = piece.systems.map((_, i) => systemUrlStem(piece, i));
    const ranges = partRanges(piece);
    const title = piece.incipit ?? piece.title;
    // Parts printed elsewhere: the lender's systems for that part.
    const borrowed: (ExportSegment & { order: number })[] = [];
    for (const b of piece.parts.filter((x): x is BorrowedPart => x.kind === "borrowed")) {
      const lender = lenders.find((p) => p.slug === b.borrowedFrom);
      const range = lender ? partRanges(lender).find((r) => r.x.ref === b.borrowedRef) : undefined;
      if (!lender || !range) continue;
      const lenderStems = lender.systems.map((_, i) => systemUrlStem(lender, i)).slice(range.start, range.end);
      borrowed.push({
        id: `${piece.slug}:from:${lender.slug}:${range.start}`,
        label: `${sectionName(b)} (from ${lender.incipit ?? lender.title})`,
        part: b.part, variant: b.variant, pieceSlug: piece.slug,
        systems: lenderStems.length, stems: lenderStems, order: partOrder(b.part, b.variant),
        source: { slug: lender.slug, start: range.start, end: range.end },
      });
    }
    if (ranges.length === 0 && borrowed.length === 0) {
      if (stems.length > 0) {
        out.push({ id: `${piece.slug}:0`, label: title, part: null, variant: "", pieceSlug: piece.slug,
                   systems: stems.length, stems, source: { slug: piece.slug, start: 0, end: stems.length } });
      }
      continue;
    }
    const first = ranges[0]?.start ?? stems.length;
    if (first > 0) {
      const lead = ranges[0] ? sectionName(ranges[0].x) : "music";
      out.push({ id: `${piece.slug}:before`, label: `${title} (before the ${lead})`,
                 part: null, variant: "", pieceSlug: piece.slug, systems: first, stems: stems.slice(0, first),
                 source: { slug: piece.slug, start: 0, end: first } });
    }
    const own = ranges.map(({ x, start, end }) => ({
      id: `${piece.slug}:${start}`, label: sectionName(x), part: x.part, variant: x.variant,
      pieceSlug: piece.slug, systems: end - start, stems: stems.slice(start, end), order: partOrder(x.part, x.variant),
      source: { slug: piece.slug, start, end },
    }));
    for (const { order: _order, ...segment } of inPrintedOrder(own, borrowed)) {
      out.push(segment);
    }
  }
  return out;
}

/** The seasons that change which parts are sung; "all" on a piece page. */
export type SeasonGroup = "lent" | "easter" | "other" | "all";

export function seasonGroup(season: Season | null): SeasonGroup {
  if (season === null) return "all";
  if (season === "septuagesima" || season === "lent" || season === "passiontide") return "lent";
  return season === "easter" ? "easter" : "other";
}

export function defaultTicked(segment: ExportSegment, all: readonly ExportSegment[], group: SeasonGroup): boolean {
  if (group === "all" || segment.part === null) return true;
  const mine = all.filter((s) => s.pieceSlug === segment.pieceSlug);
  const has = (part: ProperPartName, variant?: string) =>
    mine.some((s) => s.part === part && (variant === undefined || s.variant === variant));
  const hasAlleluia = has("alleluia");
  const paschal = segment.part === "alleluia" && segment.variant === "paschal";
  if (segment.part === "tract") return group === "lent" || !hasAlleluia;
  if (paschal) return group === "easter";
  if (segment.part === "alleluia") {
    if (!has("tract")) return !(group === "easter" && has("alleluia", "paschal"));
    return group === "other" || (group === "easter" && !has("alleluia", "paschal"));
  }
  if (segment.part === "gradual") return !(group === "easter" && has("alleluia", "paschal"));
  return true;
}

/** "Defaults for Saturday, 3 October 2026 (Tract and Paschal Alleluia unticked)." */
export function defaultsNote(all: readonly ExportSegment[], group: SeasonGroup, dateLabel: string | null): string | null {
  if (group === "all" || dateLabel === null) return null;
  const off = [...new Set(all.filter((s) => !defaultTicked(s, all, group)).map((s) => s.label))];
  if (off.length === 0) return null;
  const list = off.length === 1 ? off[0] : `${off.slice(0, -1).join(", ")} and ${off.at(-1)}`;
  return `Defaults for ${dateLabel} (${list} unticked).`;
}
