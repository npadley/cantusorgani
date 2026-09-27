import doc from "../../../data/chants.json";

/**
 * The chant notation the site publishes: GregoBase transcriptions (CC0) for
 * the chants catalogued parts name, from data/chants.json (`noh chants`).
 * Transcriptions GregoBase flags copyrighted are not in it; those parts link
 * to GregoBase only.
 */
export interface ChantEntry {
  readonly id: number;
  /** GregoBase office part: in, gr, al, tr, of, co, se… */
  readonly part: string | null;
  readonly mode: string | null;
  readonly incipit: string;
  readonly gabc: string;
}

interface RawChants {
  readonly chants: Readonly<Record<string, {
    readonly part: string | null; readonly mode: string | null;
    readonly incipit: string; readonly gabc: string;
  }>>;
}

const entries: ReadonlyMap<number, ChantEntry> = new Map(
  Object.entries((doc as RawChants).chants).map(([id, c]) => [Number(id), { id: Number(id), ...c }]));

export function chantEntry(id: number | null | undefined): ChantEntry | undefined {
  return id === null || id === undefined ? undefined : entries.get(id);
}

export function hasNotation(id: number | null | undefined): boolean {
  return chantEntry(id) !== undefined;
}

export function chantIds(): readonly number[] {
  return [...entries.keys()];
}

const PART_ABBREVIATIONS: Readonly<Record<string, string>> = {
  in: "Intr.", gr: "Grad.", al: "Allel.", tr: "Tract.", of: "Offert.", co: "Comm.", se: "Seq.", sq: "Seq.",
};

/** The two-line annotation Exsurge prints over the initial: "Intr." / "3". */
export function annotationFor(part: string | null, mode: string | null): readonly [string, string] {
  return [PART_ABBREVIATIONS[part ?? ""] ?? "", mode ?? ""];
}
