/**
 * Boundary validation for the corrections endpoint.
 *
 * This is a public, unauthenticated write. Everything crossing it is untrusted:
 * validated on the way in, and revalidated on the way out (see status.ts) so a
 * row written before a schema tightening cannot be published later.
 *
 * Per-field patterns rather than a blanket string check, because the public
 * status page renders `proposedValue` — so its shape is a security property, not
 * a convenience.
 */

export type CorrectableField =
  | "title" | "incipit" | "mode" | "genre" | "printedPages" | "chant";

export const CORRECTABLE_FIELDS: readonly CorrectableField[] = [
  "title", "incipit", "mode", "genre", "printedPages", "chant",
];

const GENRES = [
  "asperges", "mass_ordinary", "credo", "tonus", "kyrie", "gloria",
  "sanctus", "agnus", "requiem", "absolutio", "exsequiis",
] as const;

/** \p{L} keeps Latin diacritics (Kýrie, æternam) without opening the field up. */
export const PATTERNS: Readonly<Record<CorrectableField, RegExp>> = {
  title: /^[\p{L}\p{N}\s.,'«»():-]{1,120}$/u,
  incipit: /^[\p{L}\p{N}\s.,'-]{1,120}$/u,
  mode: /^(I|II|III|IV|V|VI|VII|VIII)$/,
  genre: new RegExp(`^(${GENRES.join("|")})$`),
  printedPages: /^\d{1,3}-\d{1,3}$/,
  chant: /^[\p{L}\p{N}\s.,'()/-]{1,160}$/u,
};

export const MAX_NOTE = 2000;
export const MAX_PIECE_ID = 80;

export interface Correction {
  readonly pieceId: string;
  readonly field: CorrectableField;
  readonly proposedValue: string;
  readonly note: string;
}

export type ParseResult =
  | { readonly ok: true; readonly value: Correction }
  | { readonly ok: false; readonly error: string };

function isCorrectableField(value: string): value is CorrectableField {
  return (CORRECTABLE_FIELDS as readonly string[]).includes(value);
}

export function parseCorrection(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Expected a JSON object." };
  }
  const raw = input as Record<string, unknown>;

  const pieceId = raw["pieceId"];
  if (typeof pieceId !== "string" || !new RegExp(`^[a-z0-9-]{1,${MAX_PIECE_ID}}$`).test(pieceId)) {
    return {
      ok: false,
      error: "pieceId must be a lowercase slug of letters, digits and hyphens.",
    };
  }

  const field = raw["field"];
  if (typeof field !== "string" || !isCorrectableField(field)) {
    return {
      ok: false,
      error: `Unknown field ${JSON.stringify(field)}. Correctable fields are: ${CORRECTABLE_FIELDS.join(", ")}.`,
    };
  }

  const proposedValue = raw["proposedValue"];
  if (typeof proposedValue !== "string") {
    return { ok: false, error: "proposedValue must be a string." };
  }
  if (!PATTERNS[field].test(proposedValue)) {
    return {
      ok: false,
      error: `proposedValue is not valid for field "${field}". Expected pattern: ${PATTERNS[field].source}`,
    };
  }

  const note = raw["note"] ?? "";
  if (typeof note !== "string" || note.length > MAX_NOTE) {
    return { ok: false, error: `note must be a string of at most ${MAX_NOTE} characters.` };
  }

  return { ok: true, value: { pieceId, field, proposedValue, note } };
}
