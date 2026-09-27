import { partLabel, systemUrlStem } from "./catalog";
import type { Piece, PrintedPart, ProperPartName } from "./catalog";
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
}

export function exportSegments(pieces: readonly Piece[]): readonly ExportSegment[] {
  const out: ExportSegment[] = [];
  for (const piece of pieces) {
    const stems = piece.systems.map((_, i) => systemUrlStem(piece, i));
    if (stems.length === 0) continue;
    const printed = piece.parts
      .filter((x): x is PrintedPart => x.kind === "printed" && x.placed !== "order"
                                      && piece.systems.includes(x.ref))
      .map((x) => ({ x, start: piece.systems.indexOf(x.ref) }))
      .sort((a, b) => a.start - b.start);
    const title = piece.incipit ?? piece.title;
    if (printed.length === 0) {
      out.push({ id: `${piece.slug}:0`, label: title, part: null, variant: "", pieceSlug: piece.slug,
                 systems: stems.length, stems });
      continue;
    }
    const first = printed[0]!.start;
    if (first > 0) {
      out.push({ id: `${piece.slug}:before`, label: `${title} (before the ${partLabel(printed[0]!.x.part)})`,
                 part: null, variant: "", pieceSlug: piece.slug, systems: first, stems: stems.slice(0, first) });
    }
    printed.forEach(({ x, start }, k) => {
      const end = printed[k + 1]?.start ?? stems.length;
      out.push({ id: `${piece.slug}:${start}`, label: partLabel(x.part, x.variant), part: x.part,
                 variant: x.variant, pieceSlug: piece.slug, systems: end - start, stems: stems.slice(start, end) });
    });
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
  const hasAlleluia = has("alleluia", "") || has("alleluia", "paschal");
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
