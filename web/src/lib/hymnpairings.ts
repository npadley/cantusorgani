import raw from "../../../data/hymn-pairings.json";

export interface HymnPairing {
  readonly slug: string;
  readonly title: string;
  readonly id: number | null;
  readonly status: "verified" | "unverified" | "unresolved";
  readonly incipit: string | null;
  readonly mode: string | null;
  readonly evidence: string;
  readonly sources: readonly string[];
  readonly copyrighted: boolean | null;
  readonly notation_available?: boolean;
}

/** Review decisions belong to a printed setting, rather than an incipit alone. */
export function parseHymnPairings(value: unknown): ReadonlyMap<string, HymnPairing> {
  const rows = (value as { pairings?: Record<string, HymnPairing> })?.pairings;
  if (!rows || typeof rows !== "object") throw new Error("Missing hymn pairings");
  const out = new Map<string, HymnPairing>();
  for (const [ref, row] of Object.entries(rows)) {
    if (!/^noh\d+\/\d{4}\/\d{3}$/.test(ref) || !row.slug || !row.title || !row.evidence
      || !Array.isArray(row.sources) || !row.sources.length
      || !row.sources.every((s) => typeof s === "string" && /^https:\/\//.test(s))
      || !["verified", "unverified", "unresolved"].includes(row.status)
      || (row.id !== null && (!Number.isInteger(row.id) || row.id <= 0))
      || (row.status === "unresolved" ? row.id !== null : row.id === null)
      || (row.status === "verified" && row.copyrighted)) {
      throw new Error(`Invalid hymn pairing: ${ref}`);
    }
    out.set(ref, row);
  }
  return out;
}

const pairings = parseHymnPairings(raw);
export const hymnPairing = (ref: string): HymnPairing | undefined => pairings.get(ref);
export const hymnPairingsFor = (slug: string): readonly HymnPairing[] =>
  [...pairings.values()].filter((p) => p.slug === slug);
export const hymnChantId = (ref: string): number | null => {
  const p = hymnPairing(ref);
  return p?.status === "verified" ? p.id : null;
};
