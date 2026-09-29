/**
 * The typeset review queues, built with the site from data/typeset/review.json
 * and manifest.json (both with the editors' earlier choices applied) and
 * data/reviewed.json:
 *
 * - **Matches**: files the matcher could not place with confidence (proposed,
 *   or whose melody differs from the part it names). The editor says which
 *   part it is, or that it is none, or another setting: a `match` correction
 *   on typeset:<file>.
 * - **Errors**: files LilyPond cannot draw, with the line it stopped at.
 * - **Proofreading**: each part shown typeset, beside the scan of the same
 *   systems. **Proofread** is a `reviewed` correction whose `was` is the
 *   render hash, so an edit to the file reopens it.
 *
 * Also what the admin screen's validation needs: each file's current answer
 * (typesetTargets, in /corrections/targets.json) and the review index entries.
 */
import { allPieces, assetBase, jumpTargets, partLabel, verifiedChant } from "../catalog";
import type { Movement, Piece, ProperPartName } from "../catalog";
import { segments } from "../typeset";
import { type Scans, type Shown, pieceSystems, shown } from "./scans";
import type { Reviewed } from "./suspects";
import { buildScans } from "./targetIndex";
import { MOVEMENT_LABELS } from "./targets";
import { REVIEWED, TYPESET, type TypesetData } from "./typesetData";

export type TypesetQueue = "matches" | "errors" | "proofreading";
export const QUEUE_ORDER: readonly TypesetQueue[] = ["matches", "errors", "proofreading"];
export const QUEUE_LABELS: Readonly<Record<TypesetQueue, string>> = {
  matches: "Matches", errors: "Errors", proofreading: "Proofreading",
};
/** At most this many scans beside a part being proofread. */
const MAX_SCANS = 8;

export interface Candidate {
  readonly target: string;
  readonly label: string;
  /** How much of the file's melody the part's chant has, in order (0-1); null: no chant to compare. */
  readonly melody: number | null;
  /** The part's first system as printed. */
  readonly scan: Shown | null;
  /** Its chant on GregoBase, for the notation. */
  readonly chant: number | null;
  readonly href: string | null;
}

export interface TypesetEntry {
  /** typeset:<file> */
  readonly target: string;
  readonly file: string;
  readonly queue: TypesetQueue;
  /** Its render hash: what a proofreading confirms; "" when it has none. */
  readonly fingerprint: string;
  readonly status: string;
  readonly title: string;
  readonly look: string;
  readonly detail: string | null;
  readonly volume: string;
  /** The drawing, when LilyPond can draw it. */
  readonly render: { readonly wide: string; readonly narrow: string } | null;
  readonly error: { readonly message: string; readonly line: number | null; readonly column: number | null } | null;
  /** The source around the error, numbered: [line number, text]. */
  readonly excerpt: readonly (readonly [number, string])[];
  readonly candidates: readonly Candidate[];
  /** Proofreading: the systems the part is printed on. */
  readonly scans: readonly Shown[];
  /** The part it is shown as (proofreading). */
  readonly shownAs: Candidate | null;
  readonly href: string | null;
}

const VOLUMES: Readonly<Record<string, string>> = { "vol-1": "noh1", "vol-2": "noh2", "vol-3": "noh3", "vol-5": "noh5" };

export function volumeOf(file: string): string {
  const head = file.split("/", 1)[0] ?? "";
  return VOLUMES[head] ?? head;
}

function pieceOf(target: string, pieces: ReadonlyMap<string, Piece>): Piece | undefined {
  const slug = /^(?:part|movement|piece):([a-z0-9-]+)/.exec(target)?.[1];
  return slug ? pieces.get(slug) : undefined;
}

/** What a target is, in words: "Dominica I Adventus (noh1) · Gradual". */
export function targetLabel(target: string, piece: Piece | undefined): string {
  if (!piece) return `${target} (not in the catalogue)`;
  const name = `${piece.label} (${piece.volume})`;
  const part = /^part:[a-z0-9-]+\/([a-z]+)(?::([a-z0-9-]+))?$/.exec(target);
  if (part) return `${name} · ${partLabel(part[1] as ProperPartName, part[2] ?? "")}`;
  const movement = /^movement:[a-z0-9-]+\/([a-z]+)$/.exec(target);
  if (movement) return `${name} · ${MOVEMENT_LABELS[movement[1] ?? ""] ?? movement[1]}`;
  return name;
}

/** Where a target's music is in its piece: systems [start, end). */
export function targetSpan(piece: Piece, target: string): readonly [number, number] | null {
  const seg = segments(piece, () => null).find((s) => s.target === target);
  if (seg) return [seg.start, seg.end];
  // A part placed by order alone has no heading on the page: from its start
  // to the next part's.
  const placed = piece.parts.filter((p) => p.kind === "printed");
  const at = placed.findIndex((p) => `part:${piece.slug}/${p.part}${p.variant ? `:${p.variant}` : ""}` === target);
  const part = placed[at];
  if (!part) return target === `piece:${piece.slug}` && piece.systems.length > 0 ? [0, piece.systems.length] : null;
  const next = placed.slice(at + 1).map((p) => p.system).find((n) => n > part.system);
  return [part.system, next ?? piece.systems.length];
}

function chantOf(piece: Piece, target: string): number | null {
  const movement = /^movement:[a-z0-9-]+\/([a-z]+)$/.exec(target)?.[1];
  if (movement) return verifiedChant(piece, movement as Movement)?.id ?? null;
  if (target.startsWith("piece:")) return piece.chant[0]?.id ?? null;
  return jumpTargets(piece).find((t) => t.target === target)?.chantId
    ?? piece.parts.find((p) => `part:${piece.slug}/${p.part}${p.variant ? `:${p.variant}` : ""}` === target)?.gregobaseId
    ?? null;
}

function candidate(target: string, melody: number | null, pieces: ReadonlyMap<string, Piece>, scans: Scans): Candidate {
  const piece = pieceOf(target, pieces);
  const span = piece ? targetSpan(piece, target) : null;
  const first = piece && span ? pieceSystems(scans, piece.slug)[span[0]] : undefined;
  return {
    target, melody, label: targetLabel(target, piece),
    scan: first ? shown(scans, first, "Where it starts") : null,
    chant: piece ? chantOf(piece, target) : null,
    href: piece ? `/piece/${piece.slug}/` : null,
  };
}

function renderOf(hash: string | undefined, prefix: string, base: string): TypesetEntry["render"] {
  if (!hash) return null;
  const at = `${base}/${prefix}/${hash}`;
  return { wide: `${at}/wide.svg`, narrow: `${at}/narrow.svg` };
}

/** LilyPond's first error: "line 86:34: error: not a note name: d’". */
export function parseError(text: string): NonNullable<TypesetEntry["error"]> {
  const m = /^line (\d+)(?::(\d+))?:\s*(?:error:\s*)?(.*)$/s.exec(text.trim());
  return m ? { line: Number(m[1]), column: m[2] ? Number(m[2]) : null, message: m[3] ?? text }
    : { line: null, column: null, message: text };
}

const pct = (x: number | null | undefined): string => (typeof x === "number" ? `${Math.round(x * 100)}%` : "no chant to compare");

let cached: readonly TypesetEntry[] | null = null;

/** Everything in the three queues, in queue order, then by file. */
export function typesetEntries(data: TypesetData = TYPESET, reviewed: Reviewed = REVIEWED,
                               pieces: readonly Piece[] = allPieces(), scans?: Scans,
                               base: string = assetBase()): readonly TypesetEntry[] {
  const standard = data === TYPESET && reviewed === REVIEWED && scans === undefined;
  if (standard && cached) return cached;
  const index = new Map(pieces.map((p) => [p.slug, p]));
  const sc = scans ?? buildScans();
  const out: TypesetEntry[] = [];
  for (const item of data.items) {
    if (item.status !== "proposed" && item.status !== "melody-differs" && item.status !== "broken") continue;
    const named = [...(item.candidates ?? [])];
    if (item.target && !named.some((c) => c.target === item.target)) named.unshift({ target: item.target, melody: item.melody ?? null });
    const candidates = named.map((c) => candidate(c.target, c.melody, index, sc));
    const broken = item.status === "broken";
    const title = item.incipit ? `${item.incipit}` : item.file;
    out.push({
      target: `typeset:${item.file}`, file: item.file, queue: broken ? "errors" : "matches",
      fingerprint: item.hash ?? "", status: item.status, title, volume: volumeOf(item.file),
      look: broken ? "LilyPond cannot draw this file. The line it stopped at is marked; the source editor arrives later."
        : item.status === "melody-differs"
          ? "The file names this part, but its melody does not agree with the part's chant. Is it this part, another, or none?"
          : "Which part is this? Compare the drawing with the scans and the chant.",
      detail: [item.file, item.page ? `page reference ${item.page}` : "", item.note ?? "",
               typeof item.melody === "number" ? `best melody match ${pct(item.melody)}` : ""].filter(Boolean).join(" · "),
      render: renderOf(item.hash, data.prefix, base),
      error: broken && item.error ? parseError(item.error) : null,
      excerpt: item.excerpt ? item.excerpt.lines.map((text, i) => [item.excerpt!.first + i, text] as const) : [],
      candidates, scans: [], shownAs: null,
      href: candidates[0]?.href ?? null,
    });
  }
  for (const part of data.parts) {
    const target = `typeset:${part.file}`;
    if (reviewed[target]?.was === part.hash) continue;
    const piece = pieceOf(part.target, index);
    const span = piece ? targetSpan(piece, part.target) : null;
    const systems = piece && span ? pieceSystems(sc, piece.slug).slice(span[0], span[1]) : [];
    const as = candidate(part.target, null, index, sc);
    out.push({
      target, file: part.file, queue: "proofreading", fingerprint: part.hash, status: "matched",
      title: as.label, volume: piece?.volume ?? volumeOf(part.file),
      look: "Read the typeset music against the scan, note by note and word by word.",
      detail: part.file, render: renderOf(part.hash, data.prefix, base), error: null, excerpt: [], candidates: [],
      scans: systems.slice(0, MAX_SCANS).map((ref, i) => shown(sc, ref, `System ${i + 1} of ${systems.length}`)),
      shownAs: as, href: as.href,
    });
  }
  if (standard) cached = out;
  return out;
}
