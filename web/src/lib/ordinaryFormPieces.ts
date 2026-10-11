import raw from "../../../data/ordinary-form-propers.json";
import { allPieces, partLabel } from "./catalog";
import type { BorrowedPart, Piece, PrintedPart, ProperPartName } from "./catalog";

export type OfCycle = "A" | "B" | "C";
export type OfSeason = "advent" | "christmas" | "lent" | "triduum" | "easter" | "ordinary";
export interface OfResolvedPart {
  readonly slot: ProperPartName;
  readonly kind?: ProperPartName;
  readonly sourceSlot: ProperPartName;
  readonly variant: string;
  readonly years: readonly OfCycle[];
  readonly seasons?: readonly OfSeason[];
  readonly gregobaseId: number;
  readonly incipit: string;
  readonly label: string;
  readonly lender: null | {
    readonly slug: string;
    readonly ref: string;
    readonly part: ProperPartName;
    readonly variant: string;
    readonly piece: Piece;
    readonly section: PrintedPart;
  };
}

interface RawLender { slug: string; ref: string; part: string; variant: string }
interface RawPart { slot: string; kind?: string; variant: string; years: string[]; seasons?: string[]; gregobase_id: number; incipit: string; lender: RawLender | null }
interface RawOccasion { key: string; title_en: string; title_la: string; rank: string; color: string;
  assignment_status: "mapped" | "unmapped"; parts: RawPart[] }
const SLOTS: Readonly<Record<string, ProperPartName>> = {
  introitus: "introit", graduale: "gradual", alleluia: "alleluia", tractus: "tract",
  sequentia: "sequence", offertorium: "offertory", communio: "communion",
};
const CYCLES = new Set<OfCycle>(["A", "B", "C"]);
const SEASONS = new Set<OfSeason>(["advent", "christmas", "lent", "triduum", "easter", "ordinary"]);
const SEMANTIC_PARTS = new Set<ProperPartName>(Object.values(SLOTS));
const CATALOG = allPieces();

function semanticPart(part: RawPart): ProperPartName {
  return part.kind ? part.kind as ProperPartName : SLOTS[part.slot]!;
}

/** Require the generated lender identity to match one exportable catalogue
 * section exactly, including the catalogue-normalized variant. */
function resolveLenderSection(lender: RawLender): { piece: Piece; section: PrintedPart } | null {
  const piece = CATALOG.find(candidate => candidate.slug === lender.slug);
  if (!piece) return null;
  const section = piece.parts.find((candidate): candidate is PrintedPart => candidate.kind === "printed" &&
    candidate.ref === lender.ref && candidate.part === lender.part && candidate.variant === lender.variant);
  return section ? { piece, section } : null;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDocument(input: unknown): RawOccasion[] {
  if (!object(input) || input.schema_version !== 1 || !Array.isArray(input.occasions))
    throw new Error("Ordinary Form propers: unsupported generated schema");
  const keys = new Set<string>();
  return input.occasions.map((unknownRow, index) => {
    if (!object(unknownRow)) throw new Error(`Ordinary Form occasion row ${index + 1} is invalid`);
    const row = unknownRow as unknown as RawOccasion;
    const key = typeof row.key === "string" ? row.key : `row ${index + 1}`;
    if (!row.key || keys.has(row.key)) throw new Error(`${key}: missing or duplicate Ordinary Form key`);
    keys.add(row.key);
    if (!["mapped", "unmapped"].includes(row.assignment_status) || !Array.isArray(row.parts))
      throw new Error(`${key}: invalid assignment status or parts`);
    const parts = row.parts as RawPart[];
    for (const part of parts) {
      if (!object(part) || !SLOTS[part.slot] || typeof part.variant !== "string" ||
          (part.kind !== undefined && (typeof part.kind !== "string" || !SEMANTIC_PARTS.has(part.kind as ProperPartName))) ||
          !Array.isArray(part.years) || part.years.length === 0 ||
          !part.years.every(y => CYCLES.has(y as OfCycle)) ||
          new Set(part.years).size !== part.years.length ||
          (part.seasons !== undefined && (!Array.isArray(part.seasons) || part.seasons.length === 0 ||
            !part.seasons.every(s => SEASONS.has(s as OfSeason)))) ||
          !Number.isSafeInteger(part.gregobase_id) || part.gregobase_id <= 0 || typeof part.incipit !== "string")
        throw new Error(`${key}: invalid assignment row`);
      if (part.lender === null) continue;
      if (!object(part.lender)) throw new Error(`${key}: invalid lender for GregoBase ${part.gregobase_id}`);
      const found = resolveLenderSection(part.lender);
      const lenderPiece = found?.piece;
      const lenderSection = found?.section;
      const at = lenderPiece?.systems.indexOf(part.lender.ref) ?? -1;
      if (!lenderPiece || !lenderSection || at < 0 || lenderSection.placed === "order")
        throw new Error(`${key}: lender ${part.lender.slug}/${part.lender.ref} for GregoBase ${part.gregobase_id} is not an exportable printed section`);
    }
    return row;
  });
}

const ROWS = validateDocument(raw);
const BY_KEY = new Map(ROWS.map(row => [row.key, row]));

function optionNumber(variant: string): number | null {
  const match = /(?:^|-)(\d+)$/.exec(variant);
  return match ? Number(match[1]) : null;
}

function displayLabel(part: RawPart, cycle?: OfCycle, ordinal?: number): string {
  const slot = semanticPart(part);
  const base = partLabel(slot);
  const years = part.years as OfCycle[];
  const applicable = cycle ? years.includes(cycle) ? [cycle] : [] : years;
  const yearText = applicable.length === 0 || (applicable.length === 3 && !cycle) ? ""
    : applicable.length === 1 ? `Year ${applicable[0]}`
      : `Years ${applicable.slice(0, -1).join(", ")} and ${applicable.at(-1)}`;
  const option = optionNumber(part.variant);
  const qualifiers = [yearText, ...(part.seasons ?? []).map(s => s[0]!.toUpperCase() + s.slice(1)),
    ...(option ? [`option ${option}`] : [])].filter(Boolean);
  const label = `${base}${qualifiers.length ? ` (${qualifiers.join(", ")})` : ""}`;
  return ordinal ? `${label} ${ordinal === 1 ? "I" : ordinal === 2 ? "II" : ordinal === 3 ? "III" : ordinal}` : label;
}

function resolvedParts(key: string, cycle?: OfCycle, season?: OfSeason): readonly OfResolvedPart[] {
  const row = BY_KEY.get(key);
  if (!row) return [];
  const selected = row.parts.filter(part => (!cycle || part.years.includes(cycle)) &&
      (!season || !part.seasons || part.seasons.includes(season)));
  const counts = new Map<ProperPartName, number>();
  for (const part of selected) {
    const slot = semanticPart(part);
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  const seen = new Map<ProperPartName, number>();
  return selected.map(part => {
    const slot = semanticPart(part);
    const ordinal = (seen.get(slot) ?? 0) + 1;
    seen.set(slot, ordinal);
    const found = part.lender ? resolveLenderSection(part.lender) : null;
    const lenderPiece = found?.piece ?? null;
    const lenderSection = found?.section ?? null;
    return {
      slot, sourceSlot: SLOTS[part.slot]!,
      ...(part.kind ? { kind: SLOTS[part.kind]! } : {}), variant: part.variant, years: part.years as OfCycle[],
      ...(part.seasons ? { seasons: part.seasons as OfSeason[] } : {}),
      gregobaseId: part.gregobase_id, incipit: part.incipit,
      label: displayLabel(part, cycle, counts.get(slot)! > 1 ? ordinal : undefined),
      lender: lenderPiece && lenderSection && part.lender ? { ...part.lender, part: lenderSection.part,
        variant: lenderSection.variant, piece: lenderPiece, section: lenderSection } : null,
    };
  });
}

function makePiece(row: RawOccasion): Piece {
  const semanticCounts = new Map<string, number>();
  for (const part of row.parts) {
    const sem = semanticPart(part);
    semanticCounts.set(sem, (semanticCounts.get(sem) ?? 0) + 1);
  }
  const semanticSeen = new Map<string, number>();
  const parts: BorrowedPart[] = row.parts.map(part => {
    const slot = semanticPart(part);
    const ordinal = (semanticSeen.get(slot) ?? 0) + 1;
    semanticSeen.set(slot, ordinal);
    const anchorVariant = semanticCounts.get(slot)! > 1
      ? (part.variant ? `${part.variant}-assignment-${part.slot}` : `assignment-${part.slot}`)
      : part.variant;
    return {
    kind: "borrowed", part: slot, variant: anchorVariant,
    label: displayLabel(part, undefined, semanticCounts.get(slot)! > 1 ? ordinal : undefined), title: part.incipit,
    borrowedFrom: part.lender?.slug ?? null, borrowedRef: part.lender?.ref ?? null,
      ...(part.lender && resolveLenderSection(part.lender) ? {
        borrowedPart: resolveLenderSection(part.lender)!.section.part,
        borrowedVariant: resolveLenderSection(part.lender)!.section.variant,
      } : {}),
    borrowedVolume: part.lender ? resolveLenderSection(part.lender)?.piece.volume ?? null : null,
    borrowedPage: part.lender ? resolveLenderSection(part.lender)?.piece.printedPages[0] ?? 0 : 0,
    gregobaseId: part.gregobase_id,
    years: part.years as OfCycle[], ...(part.seasons ? { seasons: part.seasons } : {}),
  };
  });
  const noMap = row.assignment_status === "unmapped";
  return {
    id: `ordinary-form-${row.key}`, volume: "ordinary-form", slug: `of-${row.key}`,
    section: row.title_en, division: "ordinary-form", days: [], label: row.key,
    title: row.title_en, incipit: null, reference: null, linkedDays: [], hymns: [], genre: "proper",
    mode: null, mass: null, printedPages: [1, 1], pagination: null, pdfPages: [1, 1],
    systems: [], systemAssets: [], systemAspect: [], movements: [], parts, jgabcUrl: null,
    chant: [], status: "verified",
    sourceNote: noMap ? "chants not yet mapped" : "Assembled from NOH sources for the Graduale Romanum (1974).",
  };
}

const PIECES = ROWS.map(makePiece);
const PIECE_BY_KEY = new Map(PIECES.map(piece => [piece.slug.slice(3), piece]));

/** Synthetic borrowers stay outside catalog.json and allPieces(). */
export function ordinaryFormPieces(): readonly Piece[] { return PIECES; }
export function ordinaryFormPiece(key: string): Piece | undefined { return PIECE_BY_KEY.get(key); }
export function ordinaryFormParts(key: string, cycle: OfCycle, season?: OfSeason): readonly OfResolvedPart[] { return resolvedParts(key, cycle, season); }
export function allOrdinaryFormParts(key: string, cycle?: OfCycle, season?: OfSeason): readonly OfResolvedPart[] { return resolvedParts(key, cycle, season); }
export function ordinaryFormOccasions(): readonly Readonly<RawOccasion>[] { return ROWS; }

export function ordinaryFormHref(key: string, cycle?: OfCycle, season?: OfSeason): string {
  const query = new URLSearchParams();
  if (cycle && CYCLES.has(cycle)) query.set("cycle", cycle);
  if (season && SEASONS.has(season)) query.set("season", season);
  return `/ordinary-form/${encodeURIComponent(key)}/${query.size ? `?${query}` : ""}`;
}
