/**
 * What a correction can name, and what it may say.
 *
 * The field rules come from data/schema/corrections.json, the same file
 * pipeline/corrections.py reads, so the admin screen and `noh correct` accept
 * exactly the same values. The GitHub workflow checks every entry again with
 * `noh correct-batch`; this is the early answer, so an editor learns of a bad
 * value while still looking at it.
 */
import schema from "../../../../data/schema/corrections.json";

export type PieceField = "title" | "incipit" | "mode" | "genre" | "printed_pages";

interface FieldRule { readonly pattern: string; readonly hint: string }

const RULES = schema.targets.piece as Readonly<Record<PieceField, FieldRule>>;
const READER_FIELDS = schema.reader_fields as Readonly<Record<string, string>>;

export const PIECE_FIELDS = Object.keys(RULES) as readonly PieceField[];

/** One piece as the admin screen needs it: current values, and a picture. */
export interface TargetPiece {
  readonly id: string;
  readonly slug: string;
  readonly volume: string;
  readonly label: string;
  readonly href: string;
  readonly title: string;
  readonly incipit: string | null;
  readonly mode: string | null;
  readonly genre: string;
  readonly printed_pages: readonly [number, number];
  /** The first system's image, without its .webp suffix, and its size. */
  readonly stem: string | null;
  readonly aspect: readonly [number, number] | null;
}

export interface Targets {
  readonly pieces: Readonly<Record<string, TargetPiece>>;
  readonly genres: readonly string[];
}

export function isPieceField(name: string): name is PieceField {
  return (PIECE_FIELDS as readonly string[]).includes(name);
}

/** A Corrections-form field (printedPages) as a field of a piece (printed_pages);
 * null for what is not corrected this way (chant pairings). */
export function readerField(name: string): PieceField | null {
  const field = READER_FIELDS[name];
  return field !== undefined && isPieceField(field) ? field : null;
}

/** The piece a target or a reader's piece id names (id or slug). */
export function findPiece(targets: Targets, name: string): TargetPiece | null {
  const slug = name.startsWith("piece:") ? name.slice("piece:".length) : name;
  return targets.pieces[slug] ?? Object.values(targets.pieces).find((p) => p.id === slug) ?? null;
}

export function currentValue(piece: TargetPiece, field: PieceField): string {
  const value = piece[field];
  if (value === null) return "";
  return Array.isArray(value) ? `${value[0]}-${value[1]}` : String(value);
}

export type Checked = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string };

/** Checks a proposed value for a field of a piece, with the reason in words. */
export function checkValue(targets: Targets, piece: TargetPiece, field: PieceField, raw: string): Checked {
  const value = raw.trim();
  const rule = RULES[field];
  if (!new RegExp(rule.pattern, "u").test(value)) {
    return { ok: false, error: `“${value}” is not a valid ${field.replace("_", " ")}: expected ${rule.hint}.` };
  }
  if (field === "printed_pages") {
    const [first, last] = value.split("-").map(Number);
    if ((first ?? 0) > (last ?? 0)) return { ok: false, error: `The page range ${value} runs backwards.` };
  }
  if (field === "genre" && !targets.genres.includes(value)) {
    return { ok: false, error: `“${value}” is not a genre the catalogue uses (${targets.genres.join(", ")}).` };
  }
  if (value === currentValue(piece, field)) {
    return { ok: false, error: `The ${field.replace("_", " ")} is already “${value}”; nothing to correct.` };
  }
  return { ok: true, value };
}
