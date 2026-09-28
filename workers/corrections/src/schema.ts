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
  | "title" | "incipit" | "mode" | "genre" | "printedPages" | "chant"
  | "startSystem" | "gregobaseId" | "tone";

export const CORRECTABLE_FIELDS: readonly CorrectableField[] = [
  "title", "incipit", "mode", "genre", "printedPages", "chant", "startSystem", "gregobaseId", "tone",
];

/** The tones NOH8 prints: the `tones` of data/schema/corrections.json (a test
 * keeps the two lists equal). */
export const TONES = [
  "I.D", "I.D2", "I.f", "I.g", "I.g2", "I.g3", "I.a", "I.a2", "I.a3", "II.D", "II.A",
  "III.a", "III.a2", "III.b", "III.g", "IV.E", "IV.A", "IV.A*", "IV.g", "V.a",
  "VI.F", "VI.C", "VII.a", "VII.b", "VII.c", "VII.c2", "VII.d", "VII.e", "VII.e2",
  "VIII.G", "VIII.G*", "VIII.c", "peregrinus",
] as const;

/** What a report names: a piece (by its pieceId alone), one of a Proper's
 * parts, a chant paired with a movement, or a Vespers item; and the fields
 * each kind can correct. */
export const TARGET = /^(piece:[a-z0-9-]{1,80}|part:[a-z0-9-]{1,80}\/[a-z]{3,12}(:[a-z0-9-]{1,12})?|pairing:[a-z0-9-]{1,80}\/[a-z]{3,8}|vespers:[A-Za-z0-9:.-]{1,60}\/[a-z0-9-]{1,20})$/;
export const FIELDS_BY_KIND: Readonly<Record<"piece" | "part" | "pairing" | "vespers", readonly CorrectableField[]>> = {
  piece: ["title", "incipit", "mode", "genre", "printedPages", "chant"],
  part: ["startSystem", "gregobaseId"],
  pairing: ["gregobaseId"],
  vespers: ["tone", "gregobaseId"],
};

/** A literal as a regular expression: every metacharacter escaped, the
 * backslash included (a tone is "IV.A*"). */
function literal(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

const GENRES = [
  "asperges", "mass_ordinary", "credo", "tonus", "kyrie", "gloria",
  "sanctus", "agnus", "requiem", "absolutio", "exsequiis",
] as const;

/** \p{L} keeps Latin diacritics (Kýrie, æternam) without opening the field up. */
export const PATTERNS: Readonly<Record<CorrectableField, RegExp>> = {
  // At least two letters: a title or incipit of "1" is never right.
  title: /^(?=(?:[^\p{L}]*\p{L}){2})[\p{L}\p{N}\s.,'«»():-]{1,120}$/u,
  incipit: /^(?=(?:[^\p{L}]*\p{L}){2})[\p{L}\p{N}\s.,'-]{1,120}$/u,
  mode: /^(I|II|III|IV|V|VI|VII|VIII)$/,
  genre: new RegExp(`^(${GENRES.join("|")})$`),
  printedPages: /^\d{1,3}-\d{1,3}$/,
  chant: /^[\p{L}\p{N}\s.,'()/-]{1,160}$/u,
  startSystem: /^\d{1,3}$/,
  gregobaseId: /^(\d{1,6}|none)$/,
  tone: new RegExp(`^(${TONES.map(literal).join("|")})$`),
};

/** What each field expects, in words, for the reader. */
export const HINTS: Readonly<Record<CorrectableField, string>> = {
  title: "at least two letters; letters, digits and . , ' « » ( ) : - only",
  incipit: "at least two letters; letters, digits and . , ' - only",
  mode: "I to VIII (1 to 8 is read as I to VIII)",
  genre: `one of ${GENRES.join(", ")}`,
  printedPages: "first-last, e.g. 5-10",
  chant: "letters, digits and . , ' ( ) / - only",
  startSystem: "the system of the piece the part starts on, counting from 1",
  gregobaseId: "a GregoBase chant id (the number in chant.php?id=…), or none",
  tone: "a tone as NOH8 prints it, e.g. VIII.G, IV.A* or peregrinus",
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

/** A value as it will be stored: a mode typed as 1-8 becomes I-VIII. */
export function normaliseValue(field: CorrectableField, value: string): string {
  const trimmed = value.trim();
  if (field === "mode" && /^[1-8]$/.test(trimmed)) return ROMAN[Number(trimmed) - 1] as string;
  return trimmed;
}

export const MAX_NOTE = 2000;
export const MAX_PIECE_ID = 80;

export interface Correction {
  readonly pieceId: string;
  readonly field: CorrectableField;
  readonly proposedValue: string;
  readonly note: string;
  /** A part or Vespers item; null for a report on the piece itself. */
  readonly target: string | null;
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

  const rawValue = raw["proposedValue"];
  if (typeof rawValue !== "string") {
    return { ok: false, error: "proposedValue must be a string." };
  }
  const proposedValue = normaliseValue(field, rawValue);
  if (!PATTERNS[field].test(proposedValue)) {
    return { ok: false, error: `“${proposedValue}” is not a valid ${field}: expected ${HINTS[field]}.` };
  }

  const note = raw["note"] ?? "";
  if (typeof note !== "string" || note.length > MAX_NOTE) {
    return { ok: false, error: `note must be a string of at most ${MAX_NOTE} characters.` };
  }

  const rawTarget = raw["target"] ?? null;
  if (rawTarget !== null && (typeof rawTarget !== "string" || !TARGET.test(rawTarget))) {
    return { ok: false, error: "target must name a piece, one of its parts, or a Vespers item." };
  }
  const target = rawTarget === null || rawTarget.startsWith("piece:") ? null : rawTarget;
  const kind = target === null ? "piece" : (target.split(":", 1)[0] as "part" | "pairing" | "vespers");
  if (!FIELDS_BY_KIND[kind].includes(field)) {
    return { ok: false, error: `A ${kind} report can correct ${FIELDS_BY_KIND[kind].join(", ")}, not ${field}.` };
  }
  if ((kind === "part" || kind === "pairing") && target?.split(":", 2)[1]?.split("/")[0] !== pieceId) {
    return { ok: false, error: `A ${kind}'s target must name the same piece as pieceId.` };
  }

  return { ok: true, value: { pieceId, field, proposedValue, note, target } };
}
