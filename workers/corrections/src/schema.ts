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
import schema from "../../../data/schema/corrections.json";

export type CorrectableField =
  | "title" | "incipit" | "mode" | "genre" | "printedPages" | "chant"
  | "startSystem" | "gregobaseId" | "tone" | "sections" | "issue";

/** Editors can recategorize a reader report to these canonical fields. They
 * are publishable stored values, never unauthenticated intake fields. */
export type StoredField = CorrectableField | "system_range" | "refs" | "note";

export const CORRECTABLE_FIELDS: readonly CorrectableField[] = [
  "title", "incipit", "mode", "genre", "printedPages", "chant", "startSystem", "gregobaseId", "tone", "sections", "issue",
];

/** The tones NOH8 prints: the `tones` of data/schema/corrections.json (a test
 * keeps the two lists equal). */
export const MUSIC_ISSUES = schema.music_issues;
export function isTypesetFile(file: string): boolean {
  return new RegExp(schema.typeset_file.pattern).test(file) && !file.split("/").some((p) => p === ".." || p === ".");
}
export const TONES = [
  "I.D", "I.D2", "I.f", "I.g", "I.g2", "I.g3", "I.a", "I.a2", "I.a3", "II.D", "II.A",
  "III.a", "III.a2", "III.b", "III.g", "IV.E", "IV.A", "IV.A*", "IV.g", "V.a",
  "VI.F", "VI.C", "VII.a", "VII.b", "VII.c", "VII.c2", "VII.d", "VII.e", "VII.e2",
  "VIII.G", "VIII.G*", "VIII.c", "peregrinus",
] as const;

/** What a report names: a piece (by its pieceId alone), one of a Proper's
 * parts, a chant paired with a movement, or a Vespers item; and the fields
 * each kind can correct. */
export const TARGET = /^(piece:[a-z0-9-]{1,80}|part:[a-z0-9-]{1,80}\/[a-z]{3,12}(:[a-z0-9-]{1,30})?|pairing:[a-z0-9-]{1,80}\/[a-z]{3,8}|vespers:[A-Za-z0-9:.-]{1,60}\/[a-z0-9-]{1,20})$/;
export const FIELDS_BY_KIND: Readonly<Record<"piece" | "part" | "pairing" | "vespers", readonly CorrectableField[]>> = {
  // sections: "a part is missing or mislabelled", fixed on the admin's Sections screen.
  piece: ["title", "incipit", "mode", "genre", "printedPages", "chant", "sections"],
  part: ["startSystem", "gregobaseId", "sections"],
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
  "sanctus", "agnus", "requiem", "absolutio", "exsequiis", "proper",
  "hymn", "sequence", "antiphon", "responsory", "litany", "psalm", "canticle", "versicle",
] as const;

/** \p{L} keeps Latin diacritics (Kýrie, æternam) without opening the field up. */
export const PATTERNS: Readonly<Record<CorrectableField, RegExp>> = {
  // At least two letters: a title or incipit of "1" is never right.
  issue: new RegExp(`^(${MUSIC_ISSUES.join("|")})$`),
  title: /^(?=(?:[^\p{L}]*\p{L}){2})[\p{L}\p{N}\s.,'«»():-]{1,120}$/u,
  incipit: /^(?=(?:[^\p{L}]*\p{L}){2})[\p{L}\p{N}\s.,'-]{1,120}$/u,
  mode: /^(I|II|III|IV|V|VI|VII|VIII)$/,
  genre: new RegExp(`^(${GENRES.join("|")})$`),
  printedPages: /^\d{1,3}-\d{1,3}$/,
  chant: /^[\p{L}\p{N}\s.,'()/-]{1,160}$/u,
  startSystem: /^\d{1,3}$/,
  gregobaseId: /^(\d{1,6}|none)$/,
  tone: new RegExp(`^(${TONES.map(literal).join("|")})$`),
  // Words naming a system: at least one digit and two letters.
  sections: /^(?=.*\d)(?=(?:[^\p{L}]*\p{L}){2})[\p{L}\p{N}\s.,'«»():;-]{3,200}$/u,
};

/** What each field expects, in words, for the reader. */
export const HINTS: Readonly<Record<CorrectableField, string>> = {
  issue: "notation, lyrics, layout or other; explain the problem in the private note",
  title: "at least two letters; letters, digits and . , ' « » ( ) : - only",
  incipit: "at least two letters; letters, digits and . , ' - only",
  mode: "I to VIII (1 to 8 is read as I to VIII)",
  genre: `one of ${GENRES.join(", ")}`,
  printedPages: "first-last, e.g. 5-10",
  chant: "letters, digits and . , ' ( ) / - only",
  startSystem: "the system of the piece the part starts on, counting from 1",
  gregobaseId: "a GregoBase chant id (the number in chant.php?id=…), or none",
  tone: "a tone as NOH8 prints it, e.g. VIII.G, IV.A* or peregrinus",
  sections: "the system, and what the book prints there, e.g. system 12: the Gradual starts here (Grad. II)",
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

/** A value as it will be stored: a mode typed as 1-8 becomes I-VIII. */
export function normaliseValue(field: StoredField, value: string): string {
  const trimmed = (field === "title" || field === "incipit" ? value.replace(/[ \t\r\n]+/g, " ") : value).trim();
  if (field === "mode" && /^[1-8]$/.test(trimmed)) return ROMAN[Number(trimmed) - 1] as string;
  return trimmed;
}

export const MAX_NOTE = 2000;
export const MAX_PIECE_ID = 80;

export interface Correction<Field extends StoredField = CorrectableField> {
  readonly pieceId: string;
  readonly field: Field;
  readonly proposedValue: string;
  readonly note: string;
  /** A part or Vespers item; null for a report on the piece itself. */
  readonly target: string | null;
  readonly seen?: string | null;
}

export type ParseResult<Field extends StoredField = CorrectableField> =
  | { readonly ok: true; readonly value: Correction<Field> }
  | { readonly ok: false; readonly error: string };

function isCorrectableField(value: string): value is CorrectableField {
  return (CORRECTABLE_FIELDS as readonly string[]).includes(value);
}

function isStoredField(value: string): value is StoredField {
  return isCorrectableField(value) || value === "system_range" || value === "refs" || value === "note";
}

export function parseCorrection(input: unknown): ParseResult {
  return parse(input, false);
}

/** Stored text may have been corrected by an editor using the canonical
 * plain-text rules. This never changes the unauthenticated intake boundary. */
export function parseStoredCorrection(input: unknown): ParseResult<StoredField> {
  return parse(input, true);
}

function parse(input: unknown, stored: false): ParseResult;
function parse(input: unknown, stored: true): ParseResult<StoredField>;
function parse(input: unknown, stored: boolean): ParseResult<StoredField> {
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

  if (raw["field"] === "issue") {
    const target = raw["target"];
    const seen = raw["seen"];
    const issue = raw["proposedValue"];
    const note = raw["note"] ?? "";
    if (pieceId !== "typeset" || typeof target !== "string" || !target.startsWith("typeset:") ||
        !isTypesetFile(target.slice(8)) || typeof seen !== "string" || !/^[0-9a-f]{32}$/.test(seen) ||
        typeof issue !== "string" || !MUSIC_ISSUES.includes(issue) || typeof note !== "string" || note.length > MAX_NOTE) {
      return { ok: false, error: "A music report needs a checked file, drawing hash and issue category; details belong in the private note." };
    }
    return { ok: true, value: { pieceId, target, field: "issue", proposedValue: issue, seen, note } };
  }
  const field = raw["field"];
  if (typeof field !== "string" || !isStoredField(field) || (!stored && !isCorrectableField(field))) {
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
  const unsafeText = (field === "title" || field === "incipit") && /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(rawValue);
  const rule: { readonly pattern: string; readonly min_letters?: number } | null = !stored ? null
    : field === "title" || field === "incipit" ? schema.targets.piece[field]
    : field === "system_range" ? schema.targets.piece.system_range
    : field === "refs" || field === "note" ? schema.targets.vespers[field] : null;
  const valid = rule
    ? new RegExp(rule.pattern, "u").test(proposedValue) && (proposedValue.match(/\p{L}/gu)?.length ?? 0) >= (rule.min_letters ?? 0)
    : isCorrectableField(field) && PATTERNS[field].test(proposedValue);
  if (unsafeText || !valid) {
    const hint = isCorrectableField(field) ? HINTS[field] : "a canonical value for this editor field";
    return { ok: false, error: `“${proposedValue}” is not a valid ${field}: expected ${hint}.` };
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
  const editorField = stored && (kind === "piece" && field === "system_range" || kind === "vespers" && (field === "refs" || field === "note"));
  if (!editorField && !(isCorrectableField(field) && FIELDS_BY_KIND[kind].includes(field))) {
    return { ok: false, error: `A ${kind} report can correct ${FIELDS_BY_KIND[kind].join(", ")}, not ${field}.` };
  }
  if ((kind === "part" || kind === "pairing") && target?.split(":", 2)[1]?.split("/")[0] !== pieceId) {
    return { ok: false, error: `A ${kind}'s target must name the same piece as pieceId.` };
  }

  return { ok: true, value: { pieceId, field, proposedValue, note, target } };
}
