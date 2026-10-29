import { formatDefaultsNote } from "./dayService";
import type { DayDefaults, DayTable } from "./dayService";
import { defaultIncluded, defaultTicked } from "./selection";
import { allPieces, inPrintedOrder, jumpTargets, movementStarts, partOrder, sectionName, systemUrlStem } from "./catalog";
import type { BorrowedPart, Piece, PrintedPart, ProperPartName, SectionRubric } from "./catalog";
import type { Season } from "./liturgy";

/**
 * What the export can build, part by part. A Proper splits at its parts
 * (Introit, Gradual …). A Mass of the Kyriale that lists sections of its own
 * (a second Kyrie, each dismissal) splits at every heading on its page, so one
 * dismissal can be taken without the other. Anything else -- an Ordinary as
 * the book runs it, an undivided Proper -- is one segment. The organist ticks the parts sung today; defaults follow the
 * season of the date a day page shows.
 */
export interface ExportSegment extends SectionRubric {
  readonly ordinaryOption?: string;
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
  readonly source?: { readonly slug: string; readonly start: number; readonly end: number;
    readonly part?: ProperPartName; readonly variant?: string };
  readonly years?: readonly ("A" | "B" | "C")[];
  readonly seasons?: readonly string[];
}
type OrderedExportSegment = Omit<ExportSegment, "part" | "source"> & {
  readonly part: ProperPartName;
  readonly source: NonNullable<ExportSegment["source"]>;
  readonly order: number;
};

/** The confident parts of a piece, each with the systems it runs over. */
function partRanges(piece: Piece): { x: PrintedPart; start: number; end: number }[] {
  const printed = piece.parts
    .filter((x): x is PrintedPart => x.kind === "printed" && x.placed !== "order"
                                    && piece.systems.includes(x.ref))
    .map((x) => ({ x, start: piece.systems.indexOf(x.ref) }))
    .sort((a, b) => a.start - b.start);
  const boundaries = [...new Set(printed.map(({ start }) => start))].sort((a, b) => a - b);
  return printed.map((p) => ({ ...p, end: boundaries.find(start => start > p.start) ?? piece.systems.length }));
}

/** The same lender range governs both exportability and missing-music notices. */
function borrowedRange(part: BorrowedPart, lenders: readonly Piece[]) {
  const lender = lenders.find(p => p.slug === part.borrowedFrom);
  const range = lender ? partRanges(lender).find(r => r.x.ref === part.borrowedRef &&
    (!part.borrowedPart || r.x.part === part.borrowedPart) &&
    (part.borrowedVariant === undefined || r.x.variant === part.borrowedVariant)) : undefined;
  return lender && range ? { lender, range } : null;
}

export function unavailableMusic(pieces: readonly Piece[], lenders: readonly Piece[] = allPieces()): string[] {
  return pieces.flatMap(piece => [
    ...(piece.systems.length === 0 && !exportSegments([piece], lenders).some(s => s.systems > 0)
      ? [`${piece.incipit ?? piece.title}: no music on this site`] : []),
    ...piece.parts.filter((part): part is BorrowedPart => part.kind === "borrowed")
      .filter(part => !borrowedRange(part, lenders))
      .map(part => `${sectionName(part)}: no music on this site`),
  ]);
}

/** A Mass with sections of its own: a segment for each heading on its page
 * (movements and sections alike), and one for any music before the first. */
function massSegments(piece: Piece, stems: readonly string[], title: string): ExportSegment[] {
  const heads = jumpTargets(piece).filter((t) => t.kind === "movement" || t.kind === "part")
    .filter((t, i, all) => all.findIndex((o) => o.index === t.index) === i);
  const out: ExportSegment[] = [];
  const first = heads[0]?.index ?? stems.length;
  if (first > 0) {
    out.push({ id: `${piece.slug}:before`, label: `${title} (before the ${heads[0]?.label ?? "music"})`, part: null,
               variant: "", pieceSlug: piece.slug, systems: first, stems: stems.slice(0, first),
               source: { slug: piece.slug, start: 0, end: first } });
  }
  heads.forEach((h, k) => {
    const end = heads[k + 1]?.index ?? stems.length;
    out.push({ id: `${piece.slug}:${h.index}`, label: h.label, part: null, variant: "", pieceSlug: piece.slug,
               systems: end - h.index, stems: stems.slice(h.index, end),
               source: { slug: piece.slug, start: h.index, end },
               ...(h.rubric ? { rubric: h.rubric } : {}),
               ...(h.rubricTranslation ? { rubricTranslation: h.rubricTranslation } : {}) });
  });
  return out;
}

export function exportSegments(pieces: readonly Piece[],
                               lenders: readonly Piece[] = allPieces()): readonly ExportSegment[] {
  const out: ExportSegment[] = [];
  for (const piece of pieces) {
    const stems = piece.systems.map((_, i) => systemUrlStem(piece, i));
    const title = piece.incipit ?? piece.title;
    if (movementStarts(piece).length > 0 && partRanges(piece).length > 0) {
      out.push(...massSegments(piece, stems, title));
      continue;
    }
    const ranges = partRanges(piece);
    // Parts printed elsewhere: the lender's systems for that part.
    const borrowed: OrderedExportSegment[] = [];
    for (const b of piece.parts.filter((x): x is BorrowedPart => x.kind === "borrowed")) {
      const resolved = borrowedRange(b, lenders);
      if (!resolved) continue;
      const { lender, range } = resolved;
      const lenderStems = lender.systems.map((_, i) => systemUrlStem(lender, i)).slice(range.start, range.end);
      borrowed.push({
        // Include borrower identity so year variants that reuse one source
        // range still have separate export checkboxes.
        id: `${piece.slug}:from:${lender.slug}:${range.start}:${piece.parts.indexOf(b)}`,
        label: `${sectionName(b)} (from ${lender.incipit ?? lender.title})`,
        part: b.part, variant: b.variant, pieceSlug: piece.slug,
        ...(b.rubric ? { rubric: b.rubric } : {}),
        ...(b.rubricTranslation ? { rubricTranslation: b.rubricTranslation } : {}),
        ...(b.years ? { years: b.years } : {}), ...(b.seasons ? { seasons: b.seasons } : {}),
        systems: lenderStems.length, stems: lenderStems, order: piece.division === "vesperale" ? piece.parts.indexOf(b) : partOrder(b.part, b.variant),
        source: { slug: lender.slug, start: range.start, end: range.end, part: range.x.part, variant: range.x.variant },
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
    const own: OrderedExportSegment[] = ranges.map(({ x, start, end }) => ({
      id: `${piece.slug}:${start}`, label: sectionName(x), part: x.part, variant: x.variant,
      pieceSlug: piece.slug, systems: end - start, stems: stems.slice(start, end), order: piece.division === "vesperale" ? piece.parts.indexOf(x) : partOrder(x.part, x.variant),
      source: { slug: piece.slug, start, end },
      ...(x.rubric ? { rubric: x.rubric } : {}),
      ...(x.rubricTranslation ? { rubricTranslation: x.rubricTranslation } : {}),
    }));
    for (const { order: _order, ...segment } of inPrintedOrder(own, borrowed)) {
      if (segment.part && piece.excludedParts?.includes(segment.part)) continue;
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

export { defaultTicked } from "./selection";

/** "Defaults for Saturday, 3 October 2026 (Tract and Paschal Alleluia unticked)." */
export function defaultsNote(all: readonly ExportSegment[], group: SeasonGroup, dateLabel: string | null): string | null {
  if (group === "all" || dateLabel === null) return null;
  const off = [...new Set(all.filter((s) => !defaultTicked(s, all, group)).map((s) => s.label))];
  return formatDefaultsNote(off, dateLabel);
}

export { formatDefaultsNote } from "./dayService";

/** Precompute every date group's defaults using the real, complete export segments. */
export function buildDayDefaults(table: DayTable, segments: readonly ExportSegment[]): DayDefaults[] {
  return table.groups.map(({ option, group }) => {
    const active = segments.filter(s => !s.ordinaryOption || s.ordinaryOption === option);
    const included = defaultIncluded(active, group);
    return { option, group, included: [...included],
      unticked: [...new Set(active.filter(s => !included.has(s.id)).map(s => s.label))] };
  });
}
