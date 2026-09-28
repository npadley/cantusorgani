/**
 * What a correction can name, and what it may say.
 *
 * A target is a piece (piece:<slug>), one of a Proper's parts
 * (part:<slug>/<part>[:<variant>]) or a Vespers item (vespers:<office>/antiphon-<n>,
 * vespers:<office>/magnificat, vespers:sunday:<key>/magnificat). The field
 * rules come from data/schema/corrections.json, the file pipeline/corrections.py
 * reads, so the admin screen, the Corrections form and `noh correct` accept the
 * same values. The GitHub workflow checks every entry again with
 * `noh correct-batch`; this is the early answer, while the editor is looking.
 */
import schema from "../../../../data/schema/corrections.json";

export type Kind = "piece" | "part" | "vespers";
export type PieceField = "title" | "incipit" | "mode" | "genre" | "printed_pages";

interface FieldRule {
  readonly pattern: string;
  readonly hint: string;
  /** At least this many letters: a title of "1" is never right. */
  readonly min_letters?: number;
  /** 1-8 is saved as I-VIII. */
  readonly arabic_to_roman?: boolean;
  /** Genres whose pieces have no such value, each with the reason. */
  readonly not_for_genres?: Readonly<Record<string, string>>;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;
const RULES = schema.targets as unknown as Readonly<Record<Kind, Readonly<Record<string, FieldRule>>>>;
const READER_FIELDS = schema.reader_fields as Readonly<Record<string, string>>;

/** The fields each kind of target can correct, in the order offered. */
export const FIELDS_OF: Readonly<Record<Kind, readonly string[]>> = {
  piece: Object.keys(RULES.piece), part: Object.keys(RULES.part), vespers: Object.keys(RULES.vespers),
};
export const PIECE_FIELDS = FIELDS_OF.piece as readonly PieceField[];

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "Title", incipit: "Incipit", mode: "Mode", genre: "Genre", printed_pages: "Printed pages",
  start_system: "Starts on system", chant: "Chant (GregoBase id)", tone: "Tone", refs: "Printed systems",
};

export const PART_LABELS: Readonly<Record<string, string>> = {
  introit: "Introit", gradual: "Gradual", alleluia: "Alleluia", tract: "Tract", sequence: "Sequence",
  offertory: "Offertory", communion: "Communion",
};

export interface TargetPart {
  readonly part: string;
  readonly variant: string;
  /** The system it starts on, counting from 1; null when printed elsewhere. */
  readonly system: number | null;
  readonly borrowed: string | null;
  readonly chant: number | null;
}

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
  readonly systems?: number;
  readonly parts?: readonly TargetPart[];
}

export interface TargetVespers {
  readonly label: string;
  /** e.g. "Advent I, II Vespers" */
  readonly when: string;
  readonly href: string;
  readonly tone: string | null;
  readonly chant: number | null;
  /** The systems it is printed on ("noh8/0077/000"). */
  readonly refs?: readonly string[];
  readonly stem: string | null;
  readonly aspect: readonly [number, number] | null;
}

export interface Targets {
  readonly pieces: Readonly<Record<string, TargetPiece>>;
  readonly vespers?: Readonly<Record<string, TargetVespers>>;
  readonly genres: readonly string[];
}

/** Everything the screens need to show and check one target. */
export interface TargetInfo {
  readonly target: string;
  readonly kind: Kind;
  readonly label: string;
  readonly href: string;
  readonly stem: string | null;
  readonly aspect: readonly [number, number] | null;
  /** Current values as text: "" for none. */
  readonly values: Readonly<Record<string, string>>;
  readonly genre: string | null;
  /** The piece a part or piece target belongs to (a reader row's piece_id). */
  readonly slug: string | null;
  /** Why start_system cannot be corrected here (a part printed elsewhere). */
  readonly fixed: string | null;
  /** start_system must lie strictly between these. */
  readonly bounds: { readonly after: number; readonly before: number } | null;
}

export function kindOf(target: string): Kind | null {
  const kind = target.split(":", 1)[0];
  return kind === "piece" || kind === "part" || kind === "vespers" ? kind : null;
}

export function isPieceField(name: string): name is PieceField {
  return (PIECE_FIELDS as readonly string[]).includes(name);
}

export function isField(kind: Kind, name: string): boolean {
  return FIELDS_OF[kind].includes(name);
}

/** A Corrections-form field (printedPages, startSystem, gregobaseId) as the
 * data's own name; null for what is not corrected this way. */
export function readerField(name: string): string | null {
  return READER_FIELDS[name] ?? null;
}

export function partTarget(slug: string, part: TargetPart): string {
  return `part:${slug}/${part.part}${part.variant ? `:${part.variant}` : ""}`;
}

function pieceValues(p: TargetPiece): Record<string, string> {
  return { title: p.title, incipit: p.incipit ?? "", mode: p.mode ?? "", genre: p.genre,
           printed_pages: `${p.printed_pages[0]}-${p.printed_pages[1]}` };
}

const chantText = (id: number | null): string => (id === null ? "none" : String(id));

/** Resolves a target, or a reader's piece id or slug, to what the screens need. */
export function describeTarget(targets: Targets, name: string): TargetInfo | null {
  const kind = kindOf(name) ?? "piece";
  if (kind === "vespers") {
    const v = targets.vespers?.[name];
    if (!v) return null;
    return { target: name, kind, label: `${v.label} (${v.when})`, href: v.href, stem: v.stem, aspect: v.aspect,
             values: { tone: v.tone ?? "", chant: chantText(v.chant), refs: (v.refs ?? []).join(" ") },
             genre: null, slug: null, fixed: null, bounds: null };
  }
  const rest = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
  const [slugOrId, partName] = rest.split("/") as [string, string | undefined];
  const piece = targets.pieces[slugOrId] ?? Object.values(targets.pieces).find((p) => p.id === slugOrId);
  if (!piece) return null;
  if (kind === "piece") {
    return { target: `piece:${piece.slug}`, kind, label: `${piece.label} (${piece.volume})`, href: piece.href,
             stem: piece.stem, aspect: piece.aspect, values: pieceValues(piece), genre: piece.genre, slug: piece.slug,
             fixed: null, bounds: null };
  }
  const [part, variant = ""] = (partName ?? "").split(":") as [string, string | undefined];
  const parts = piece.parts ?? [];
  const found = parts.find((p) => p.part === part && p.variant === variant);
  if (!found) return null;
  const placed = parts.filter((p) => p.system !== null);
  const at = placed.indexOf(found);
  const bounds = found.system === null ? null : {
    after: at > 0 ? (placed[at - 1]?.system ?? 0) : 0,
    before: at + 1 < placed.length ? (placed[at + 1]?.system ?? 0) : (piece.systems ?? 0) + 1,
  };
  const label = `${piece.label} (${piece.volume}) · ${PART_LABELS[found.part] ?? found.part}${variant ? ` ${variant}` : ""}`;
  return { target: partTarget(piece.slug, found), kind, label, href: piece.href, stem: piece.stem, aspect: piece.aspect,
           values: { start_system: found.system === null ? "" : String(found.system), chant: chantText(found.chant) },
           genre: piece.genre, slug: piece.slug,
           fixed: found.system === null ? `This part is printed in another volume (${found.borrowed ?? "elsewhere"}); correct it where it is printed.` : null,
           bounds };
}

export type Checked = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly error: string };

/** Why a field does not apply to a piece of this genre, or null when it does
 * (a Proper has no single mode). */
export function notFor(field: string, genre: string | null, kind: Kind = "piece"): string | null {
  return genre ? RULES[kind][field]?.not_for_genres?.[genre] ?? null : null;
}

/** A value as it will be saved: trimmed, 1-8 as I-VIII for a mode, "none" for
 * no chant. */
export function normalise(field: string, raw: string, kind: Kind = "piece"): string {
  const value = raw.trim();
  const n = Number(value);
  if (RULES[kind][field]?.arabic_to_roman && /^\d+$/.test(value) && n >= 1 && n <= ROMAN.length) return ROMAN[n - 1] as string;
  if (field === "chant" && value === "") return "none";
  if (field === "refs") return value.split(/\s+/).filter(Boolean).join(" ");
  return value;
}

/** Checks a proposed value for a target's field, with the reason in words. */
export function checkValue(targets: Targets, info: TargetInfo, field: string, raw: string): Checked {
  const rule = RULES[info.kind][field];
  const words = FIELD_LABELS[field]?.toLowerCase() ?? field.replace("_", " ");
  if (!rule) return { ok: false, error: `“${field}” is not a field this screen can correct for a ${info.kind}.` };
  const reason = notFor(field, info.genre, info.kind);
  if (reason) return { ok: false, error: reason };
  if (field === "start_system" && info.fixed) return { ok: false, error: info.fixed };
  const value = normalise(field, raw, info.kind);
  const letters = [...value].filter((c) => /\p{L}/u.test(c)).length;
  if (!new RegExp(rule.pattern, "u").test(value) || letters < (rule.min_letters ?? 0)) {
    return { ok: false, error: `“${value}” is not a valid ${words}: expected ${rule.hint}.` };
  }
  if (field === "printed_pages") {
    const [first, last] = value.split("-").map(Number);
    if ((first ?? 0) > (last ?? 0)) return { ok: false, error: `The page range ${value} runs backwards.` };
  }
  if (field === "genre" && !targets.genres.includes(value)) {
    return { ok: false, error: `“${value}” is not a genre the catalogue uses (${targets.genres.join(", ")}).` };
  }
  if (field === "start_system" && info.bounds) {
    const n = Number(value);
    if (!(info.bounds.after < n && n < info.bounds.before)) {
      return { ok: false, error: `System ${n} would put this part out of order: it must come after system ` +
        `${info.bounds.after} and before system ${info.bounds.before}.` };
    }
  }
  if (value === (info.values[field] ?? "")) {
    return { ok: false, error: `The ${words} is already “${value}”; nothing to correct.` };
  }
  return { ok: true, value };
}
