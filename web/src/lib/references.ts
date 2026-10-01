/** Resolve the book's whole-score rubrics by printed page, including entries
 * without calendar keys. Part-specific rubrics are handled by reviewed sections.
 */
import { allPieces } from "./catalog";
import type { Piece } from "./catalog";

const romanVolumes: Record<string, string> = { I: "noh1", II: "noh2", III: "noh3", IV: "noh4", V: "noh5", VII: "noh7", VIII: "noh8" };

export function massSources(piece: Piece, pieces: readonly Piece[] = allPieces(), seen = new Set<string>()): readonly Piece[] {
  if (seen.has(piece.slug)) return [];
  const reference = piece.reference ?? "";
  if (!/(?:^Missa\b|\b(?:dicitur|resumitur)\s+Missa\b|^Dicitur Missa\b|^Omnia\b)/i.test(reference)) return [];
  const next = new Set(seen).add(piece.slug);
  const citations = piece.referenceSources?.length ? piece.referenceSources : [];
  if (citations.length === 0) {
    let volume = piece.volume;
    for (const match of reference.matchAll(/(?:Pars\s+([IVX1l]+)\s*,?\s*)?\bp\.?\s*(\d{1,3})\b/gi)) {
      if (match[1]) volume = romanVolumes[match[1].replace(/[1l]/g, "I").toUpperCase()] ?? volume;
      citations.push({ volume, page: Number(match[2]), label: "" });
    }
    if (citations.length === 0 && /(?:ad\s+calcem|at\s+calcem)/i.test(reference)) {
      const last = pieces.filter((p) => p.volume === "noh4" && p.systems.length > 0 && !p.pagination)
        .sort((a, b) => b.printedPages[0] - a.printedPages[0])[0];
      if (last) citations.push({ volume: "noh4", page: last.printedPages[0], label: "" });
    }
  }
  const out: Piece[] = [];
  for (const citation of citations) {
    const candidates = pieces.filter((p) => p.volume === citation.volume && !p.pagination
      && p.printedPages[0] <= citation.page && p.printedPages[1] >= citation.page && !next.has(p.slug))
      .sort((a, b) => Number(b.printedPages[0] === citation.page) - Number(a.printedPages[0] === citation.page));
    const source = candidates.find((p) => p.systems.length > 0) ?? candidates[0];
    if (!source) continue;
    const sources = source.systems.length > 0 || source.parts.length > 0 ? [source] : massSources(source, pieces, next);
    for (const p of sources) if (!out.some((q) => q.slug === p.slug)) {
      out.push({ ...p, ...(citation.label ? { title: `${p.title} — ${citation.label}` } : {}),
        ...(citation.omit?.length ? { excludedParts: citation.omit } : {}) });
    }
  }
  return out;
}
