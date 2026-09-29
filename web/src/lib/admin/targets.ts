/**
 * What a correction can name, and what it may say.
 *
 * A target is a piece (piece:<slug>), one of a Proper's parts
 * (part:<slug>/<part>[:<variant>]) or a Vespers item (vespers:<office>/antiphon-<n>,
 * vespers:<office>/magnificat, vespers:sunday:<key>/magnificat), or a typeset
 * transcription (typeset:<file>: which part it is). The field
 * rules come from data/schema/corrections.json, the file pipeline/corrections.py
 * reads, so the admin screen, the Corrections form and `noh correct` accept the
 * same values. The GitHub workflow checks every entry again with
 * `noh correct-batch`; this is the early answer, while the editor is looking.
 */
import schema from "../../../../data/schema/corrections.json";

export type Kind = "piece" | "part" | "vespers" | "pairing" | "typeset";
export type PieceField = "title" | "incipit" | "mode" | "genre" | "printed_pages" | "system_range";

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
  pairing: Object.keys(RULES.pairing), typeset: Object.keys(RULES.typeset),
};

const MOVEMENTS = schema.pairing_movements as unknown as Readonly<Record<string, readonly string[]>>;

/** The chant movements a piece of this genre has ("chant": the one chant of a
 * single-chant piece); none for a Proper, whose chants are on its parts. For an
 * Ordinary, give `present` (movements found in its pages, or already paired):
 * only those count -- Missa XVII, for Advent and Lent, has no Gloria. The same
 * rule as pipeline/corrections.py piece_movements. */
export function pairingMovements(genre: string, present?: Iterable<string>): readonly string[] {
  const allowed = genre === "$comment" ? [] : MOVEMENTS[genre] ?? [];
  if (genre !== "mass_ordinary" || present === undefined) return allowed;
  const have = new Set(present);
  return allowed.filter((m) => have.has(m));
}

export const MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  kyrie: "Kyrie", gloria: "Gloria", credo: "Credo", sanctus: "Sanctus", agnus: "Agnus Dei", ite: "Ite missa est",
  chant: "Chant",
};
export const PIECE_FIELDS = FIELDS_OF.piece as readonly PieceField[];

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "Title", incipit: "Incipit", mode: "Mode", genre: "Genre", printed_pages: "Printed pages",
  system_range: "Systems (first-last)", start_system: "Starts on system", chant: "Chant (GregoBase id)", tone: "Tone",
  refs: "Printed systems", note: "A note instead of the music", reviewed: "Looks right", match: "Which part it is",
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
  /** Its start was only guessed from the order of the parts, so the piece page
   * does not show it (no heading, no Report link); the edit page does. */
  readonly guessed?: boolean;
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
  /** Its first and last system ("noh1/0044/002"). */
  readonly range?: readonly [string, string] | null;
  readonly parts?: readonly TargetPart[];
  /** Chants paired with the piece's movements (movement "chant": a single-chant piece). */
  readonly pairings?: readonly { readonly movement: string; readonly id: number }[];
  /** The movements found in its pages (an Ordinary's Kyrie, Gloria ...). */
  readonly movements?: readonly string[];
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
  /** The note an editor put in place of its music, if any. */
  readonly note?: string | null;
  readonly stem: string | null;
  readonly aspect: readonly [number, number] | null;
}

/** A typeset transcription, by its file under data/typeset/src/. */
export interface TargetTypeset {
  /** Its opening words, or its file when it has none. */
  readonly label: string;
  /** What it is now: a target when shown, none, other-setting, or "" while undecided. */
  readonly match: string;
  /** Why it cannot be shown as a part (LilyPond cannot draw it), or null. */
  readonly broken: string | null;
}

export interface Targets {
  readonly pieces: Readonly<Record<string, TargetPiece>>;
  readonly vespers?: Readonly<Record<string, TargetVespers>>;
  readonly typeset?: Readonly<Record<string, TargetTypeset>>;
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
  /** Where the parts before and after start now (a part runs until the next
   * one starts); `before` is one past the piece's last system for the last part. */
  readonly bounds: { readonly after: number; readonly before: number;
                     readonly previous: string | null; readonly next: string | null;
                     /** The next part is not shown on the piece page: its start was guessed. */
                     readonly nextHidden?: boolean; readonly nextTarget?: string | null } | null;
  /** How many systems the piece has (for a part's start). */
  readonly systems: number | null;
}

export function kindOf(target: string): Kind | null {
  const kind = target.split(":", 1)[0];
  return kind === "piece" || kind === "part" || kind === "vespers" || kind === "pairing" || kind === "typeset"
    ? kind : null;
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

function nameOfPart(part: TargetPart): string {
  return `${PART_LABELS[part.part] ?? part.part}${part.variant ? ` ${part.variant}` : ""}`;
}

export function partTarget(slug: string, part: TargetPart): string {
  return `part:${slug}/${part.part}${part.variant ? `:${part.variant}` : ""}`;
}

function pieceValues(p: TargetPiece): Record<string, string> {
  return { title: p.title, incipit: p.incipit ?? "", mode: p.mode ?? "", genre: p.genre,
           printed_pages: `${p.printed_pages[0]}-${p.printed_pages[1]}`,
           system_range: p.range ? `${p.range[0]}-${p.range[1]}` : "" };
}

const chantText = (id: number | null): string => (id === null ? "none" : String(id));

/** Resolves a target, or a reader's piece id or slug, to what the screens need. */
export function describeTarget(targets: Targets, name: string): TargetInfo | null {
  const kind = kindOf(name) ?? "piece";
  if (kind === "vespers") {
    const v = targets.vespers?.[name];
    if (!v) return null;
    return { target: name, kind, label: `${v.label} (${v.when})`, href: v.href, stem: v.stem, aspect: v.aspect,
             values: { tone: v.tone ?? "", chant: chantText(v.chant), refs: (v.refs ?? []).join(" "), note: v.note ?? "" },
             genre: null, slug: null, fixed: null, bounds: null, systems: null };
  }
  const rest = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
  if (kind === "typeset") {
    const t = Object.hasOwn(targets.typeset ?? {}, rest) ? targets.typeset?.[rest] : undefined;
    if (!t) return null;
    return { target: `typeset:${rest}`, kind, label: `Typeset ${rest} (${t.label})`, href: "/admin/typeset/",
             stem: null, aspect: null, values: { match: t.match }, genre: null, slug: null, fixed: t.broken,
             bounds: null, systems: null };
  }
  const [slugOrId, partName] = rest.split("/") as [string, string | undefined];
  const piece = targets.pieces[slugOrId] ?? Object.values(targets.pieces).find((p) => p.id === slugOrId);
  if (!piece) return null;
  if (kind === "piece") {
    return { target: `piece:${piece.slug}`, kind, label: `${piece.label} (${piece.volume})`, href: piece.href,
             stem: piece.stem, aspect: piece.aspect, values: pieceValues(piece), genre: piece.genre, slug: piece.slug,
             fixed: null, bounds: null, systems: piece.systems ?? null };
  }
  if (kind === "pairing") {
    const movement = partName ?? "";
    const present = [...(piece.movements ?? []), ...(piece.pairings ?? []).map((c) => c.movement)];
    if (!pairingMovements(piece.genre, present).includes(movement)) return null;
    const paired = (piece.pairings ?? []).find((c) => c.movement === movement);
    return { target: `pairing:${piece.slug}/${movement}`, kind,
             label: `${piece.label} (${piece.volume}) · ${MOVEMENT_LABELS[movement] ?? movement} chant`,
             href: piece.href, stem: piece.stem, aspect: piece.aspect,
             values: { chant: chantText(paired?.id ?? null) }, genre: piece.genre, slug: piece.slug, fixed: null, bounds: null,
             systems: piece.systems ?? null };
  }
  const [part, variant = ""] = (partName ?? "").split(":") as [string, string | undefined];
  const parts = piece.parts ?? [];
  const found = parts.find((p) => p.part === part && p.variant === variant);
  if (!found) return null;
  const placed = parts.filter((p) => p.system !== null);
  const at = placed.indexOf(found);
  const prev = at > 0 ? placed[at - 1] : undefined;
  const next = at + 1 < placed.length ? placed[at + 1] : undefined;
  const bounds = found.system === null ? null : {
    after: prev?.system ?? 0, before: next?.system ?? (piece.systems ?? 0) + 1,
    previous: prev ? nameOfPart(prev) : null, next: next ? nameOfPart(next) : null,
    nextHidden: next?.guessed === true, nextTarget: next ? partTarget(piece.slug, next) : null,
  };
  const label = `${piece.label} (${piece.volume}) · ${PART_LABELS[found.part] ?? found.part}${variant ? ` ${variant}` : ""}`;
  return { target: partTarget(piece.slug, found), kind, label, href: piece.href, stem: piece.stem, aspect: piece.aspect,
           values: { start_system: found.system === null ? "" : String(found.system), chant: chantText(found.chant) },
           genre: piece.genre, slug: piece.slug, systems: piece.systems ?? null,
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
  if ((field === "chant" || field === "note") && value === "") return "none";
  if (field === "refs") return value.split(/\s+/).filter(Boolean).join(" ");
  if (field === "system_range") return value.replace(/\s*(?:\bto\b|-|\s)\s*/g, "-");
  if (field === "note") return value.replace(/\s+/g, " ");
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
  if (field === "match" && info.fixed && raw.includes(":")) {
    return { ok: false, error: `${info.fixed} Fix the file first, or choose “not in the catalogue” or “a different setting”.` };
  }
  const value = normalise(field, raw, info.kind);
  const letters = [...value].filter((c) => /\p{L}/u.test(c)).length;
  if (!new RegExp(rule.pattern, "u").test(value) || letters < (rule.min_letters ?? 0)) {
    return { ok: false, error: `“${value}” is not a valid ${words}: expected ${rule.hint}.` };
  }
  if (field === "printed_pages") {
    const [first, last] = value.split("-").map(Number);
    if ((first ?? 0) > (last ?? 0)) return { ok: false, error: `The page range ${value} runs backwards.` };
  }
  if (field === "system_range") {
    const [first = "", last = ""] = value.split("-");
    const volume = (info.values["system_range"] ?? "").split("/", 1)[0];
    if (volume && (first.split("/", 1)[0] !== volume || last.split("/", 1)[0] !== volume)) {
      return { ok: false, error: `The systems must be in ${volume}, the volume the piece is printed in.` };
    }
    if (first > last) return { ok: false, error: `The system range ${value} runs backwards.` };
  }
  if (field === "note" && value === "none" && !info.values["note"]) {
    return { ok: false, error: "There is no note to remove; the music is shown." };
  }
  if (field === "match" && value.includes(":") && !typesetTargetExists(targets, value)) {
    return { ok: false, error: `${value} is not a part, Mass movement or single-chant piece the catalogue has.` };
  }
  if (field === "genre" && !targets.genres.includes(value)) {
    return { ok: false, error: `“${value}” is not a genre the catalogue uses (${targets.genres.join(", ")}).` };
  }
  // Only the range here: the order against the other parts is checked on the
  // result (plannedOrder), so two parts can be moved past each other.
  if (field === "start_system" && info.systems !== null) {
    const n = Number(value);
    if (n < 1 || n > info.systems) {
      return { ok: false, error: `System ${n} is outside the piece, which has ${info.systems} systems.` };
    }
  }
  if (value === (info.values[field] ?? "")) {
    return { ok: false, error: `The ${words} is already “${value}”; nothing to correct.` };
  }
  return { ok: true, value };
}

/**
 * Whether a typeset file can be shown as this target: a Proper's part printed
 * in the piece, a movement found in a Mass, or a whole single-chant piece. The
 * same rule as `targets` in pipeline/typeset/match.py.
 */
export function typesetTargetExists(targets: Targets, target: string): boolean {
  const m = /^(part|movement|piece):([a-z0-9-]+)(?:\/([a-z]+)(?::([a-z0-9-]+))?)?$/.exec(target);
  if (!m) return false;
  const [, kind, slug = "", name = "", variant = ""] = m;
  const piece = Object.hasOwn(targets.pieces, slug) ? targets.pieces[slug] : undefined;
  if (!piece) return false;
  if (kind === "part") return (piece.parts ?? []).some((p) => p.part === name && p.variant === variant && p.system !== null);
  if (kind === "movement") return !variant && piece.genre === "mass_ordinary" && (piece.movements ?? []).includes(name);
  return !name && (piece.parts ?? []).length === 0 && (piece.systems ?? 0) > 0 && piece.genre !== "mass_ordinary";
}

/** What a part's start means, in words, for the form: a part runs until the
 * next one starts, so moving it past a neighbour means moving that one too. */
export function startNote(info: TargetInfo): string {
  const b = info.bounds;
  if (info.kind !== "part" || !b) return "";
  const around = [b.previous ? `after the ${b.previous} (system ${b.after})` : "",
                  b.next ? `before the ${b.next} (system ${b.before})` : ""].filter(Boolean).join(" and ");
  return "A part runs from the system it starts on until the next part starts" +
    (around ? `: this one starts ${around}` : "") + "." +
    (b.next ? ` To move it past the ${b.next}, move the ${b.next} too, in either order, before publishing.` : "") +
    (b.nextHidden ? ` The ${b.next} isn't shown on the piece page, because its start was only guessed; ` +
      `choose it under “Which part?”.` : "");
}

/** A start_system correction waiting to be published. */
export interface PlannedStart { readonly target: string; readonly value: string }

/** Parts out of order: what is wrong, and the part to move too. */
export interface OrderProblem {
  readonly message: string;
  /** The part still to move, for a link to its edit page. */
  readonly target: string;
  readonly name: string;
}

/**
 * Whether each piece's parts still start in printed order once these start
 * corrections are published; null when they do, or the first problem.
 * The same rule as `_part_order` in pipeline/corrections.py.
 */
export function plannedOrder(targets: Targets, planned: readonly PlannedStart[]): OrderProblem | null {
  const starts = new Map<string, number>();
  for (const p of planned) if (kindOf(p.target) === "part" && /^\d{1,3}$/.test(p.value)) starts.set(p.target, Number(p.value));
  const slugs = new Set([...starts.keys()].map((t) => t.slice(5).split("/")[0] ?? ""));
  for (const slug of slugs) {
    const placed = (targets.pieces[slug]?.parts ?? []).filter((p) => p.system !== null)
      .map((p) => ({ name: nameOfPart(p), target: partTarget(slug, p), guessed: p.guessed === true,
                     system: starts.get(partTarget(slug, p)) ?? p.system ?? 0 }));
    for (let i = 1; i < placed.length; i++) {
      const [a, b] = [placed[i - 1]!, placed[i]!];
      if (a.system >= b.system) {
        // Name the one not moved yet: that is the one to move too.
        const other = starts.has(b.target) && !starts.has(a.target) ? a : b;
        const message = `In ${targets.pieces[slug]?.label ?? slug}, the ${a.name} would start on system ${a.system} ` +
          `and the ${b.name} on system ${b.system}. A part runs until the next one starts: move the ${other.name} too.` +
          (other.guessed && !starts.has(other.target)
            ? ` (The piece page doesn't show the ${other.name}: its start was only guessed.)` : "");
        return { message, target: other.target, name: other.name };
      }
    }
  }
  return null;
}
