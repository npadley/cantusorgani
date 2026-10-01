/** Compose the same source ranges the PDF export uses into an inline score.
 * Catalog ownership stays unchanged: source refs, correction targets, and
 * typeset switches still address the piece that actually prints each section.
 */
import { allPieces, partAnchor, volumeLabel, pagesLabel } from "./catalog";
import type { Piece, PrintedPart, ProperPart } from "./catalog";
import { exportSegments } from "./exportParts";

export function musicView(piece: Piece, lenders: readonly Piece[] = allPieces()): Piece {
  if (!piece.excludedParts?.length && !piece.parts.some((p) => p.kind === "borrowed")) return piece;
  const systems: string[] = [], systemAssets: string[] = [];
  const systemAspect: (readonly [number, number])[] = [];
  const systemSources: { slug: string; index: number }[] = [];
  const parts: ProperPart[] = [];
  const resolved = new Set<string>();
  for (const segment of exportSegments([piece], lenders)) {
    const source = segment.source && lenders.find((p) => p.slug === segment.source!.slug);
    if (!source || !segment.source) continue;
    const { start, end } = segment.source;
    const at = systems.length;
    for (let i = start; i < end; i++) {
      systems.push(source.systems[i]!);
      systemAssets.push(source.systemAssets[i] ?? "");
      systemAspect.push(source.systemAspect[i] ?? [1600, 400]);
      systemSources.push({ slug: source.slug, index: i });
    }
    if (!segment.part) continue;
    const printed = source.parts.find((p): p is PrintedPart => p.kind === "printed" && p.ref === source.systems[start]);
    if (!printed) continue;
    const borrower = piece.parts.find((p) => p.part === segment.part && p.variant === segment.variant);
    const borrowed = borrower?.kind === "borrowed" ? borrower : null;
    if (borrowed) resolved.add(partAnchor(borrowed.part, borrowed.variant));
    parts.push({ ...printed, part: segment.part, variant: segment.variant, system: at,
      gregobaseId: borrower?.gregobaseId ?? printed.gregobaseId,
      sourceTarget: `part:${source.slug}/${printed.part}${printed.variant ? `:${printed.variant}` : ""}`,
      ...(borrowed ? { source: `${source.incipit ?? source.title}, ${volumeLabel(source)}, ${pagesLabel(source)} (rubric cites ${volumeLabel({ ...source, volume: borrowed.borrowedVolume ?? source.volume })}, p. ${borrowed.borrowedPage})` } : {}),
    });
  }
  // Keep unresolved citations available to the page's explicit missing-music notice.
  parts.push(...piece.parts.filter((p) => p.kind === "borrowed" && !resolved.has(partAnchor(p.part, p.variant))));
  return { ...piece, systems, systemAssets, systemAspect, systemSources, parts };
}
