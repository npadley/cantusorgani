/**
 * The Review page's items, built with the site: the pipeline's review queue
 * (data/review-queue.json) and the "Parts to check" (suspects.ts), less what
 * still stands reviewed (data/reviewed.json). Each item carries what the editor
 * needs to judge it -- the scans, in words what to look at -- and its
 * fingerprint, which a review sends back so `noh correct-batch` can refuse one
 * of something that has since changed.
 *
 * Also the index the admin API checks a review against (/admin/review.json).
 */
import queueJson from "../../../../data/review-queue.json";
import reviewedJson from "../../../../data/reviewed.json";
import { allPieces, pieceBySlug, partLabel } from "../catalog";
import { musicView } from "../music";
import { exportSegments } from "../exportParts";
import { massSources } from "../references";
import type { BorrowedPart, Piece, PrintedPart, ProperPartName } from "../catalog";
import { type QueueItem, type ReviewGroup, reviewKind } from "./reviewKinds";
import { type Scans, type Shown, pieceSystems, shown } from "./scans";
import { type Reviewed, suspectParts } from "./suspects";
import { buildScans } from "./targetIndex";
import { MOVEMENT_LABELS, pairingMovements } from "./targets";
import { TYPESET } from "./typesetData";
import { type TypesetEntry, typesetEntries } from "./typesetQueues";
import type { Bucket } from "./summary";

export const QUEUE = queueJson as unknown as readonly QueueItem[];
export const REVIEWED = (reviewedJson as { reviewed: Reviewed }).reviewed;

/** At most this many scans per item. */
const MAX_SCANS = 4;

export interface ReviewEntry {
  readonly target: string;
  readonly fingerprint: string;
  readonly kind: string;
  readonly group: ReviewGroup;
  readonly label: string;
  /** What it is about: the piece, part or page. */
  readonly about: string;
  readonly look: string;
  /** The pipeline's own words, when it gave any. */
  readonly detail: string | null;
  readonly volume: string;
  /** The piece page, when there is one. */
  readonly href: string | null;
  /** What the edit form opens with **Correct**; null when a correction cannot fix it. */
  readonly correct: string | null;
  /** The piece's Sections screen, for an item about where a part or movement starts. */
  readonly sections: string | null;
  /** The confirming button's words ("Starts here: right", "No chant to link"). */
  readonly confirm: string;
  readonly scans: readonly Shown[];
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** Kinds about where a part or movement starts: their piece's Sections screen can fix them. */
const SECTION_KINDS = new Set(["part_to_check", "part_by_order", "part_missing", "part_mismatch", "uncertain_movement"]);
const sectionsOf = (kind: string, piece: Piece | undefined): string | null =>
  piece && SECTION_KINDS.has(kind) ? `/admin/sections/?piece=${encodeURIComponent(piece.slug)}` : null;

function partTargetOf(item: QueueItem): string {
  return `part:${item.piece}/${item.part}${item.variant ? `:${item.variant}` : ""}`;
}

/** What **Correct** opens, or null. Only targets the edit form can change. */
function correctTarget(item: QueueItem, piece: Piece | undefined): string | null {
  if (!piece) return null;
  switch (item.kind) {
    case "part_by_order":
      return piece.parts.some((p) => p.kind === "printed" && p.part === item.part && p.variant === (item.variant ?? ""))
        ? partTargetOf(item) : null;
    case "unverified_pairing":
      return item.movement ? `pairing:${piece.slug}/${item.movement}` : null;
    case "unpaired": {
      const movement = pairingMovements(piece.genre)[0];
      return movement ? `pairing:${piece.slug}/${movement}` : null;
    }
    case "starts_mid_page": case "no_systems": case "index_unverified": case "range_extended":
      return `piece:${piece.slug}`;
    case "uncertain_movement":
      // Its edit page links to the Sections screen, where a row named for the
      // movement (its own name: gloria) says where it really starts.
      return `piece:${piece.slug}`;
    default:
      return null;
  }
}

function scansOf(item: QueueItem, piece: Piece | undefined, scans: Scans): readonly Shown[] {
  if (item.ref) return [shown(scans, item.ref, "The system named")];
  if (item.kind === "hymn_at_page_top" && piece) {
    const hymn = piece.hymns.find((h) => h.title === item.title);
    if (hymn) return [shown(scans, hymn.ref, "Where the hymn is linked")];
  }
  if (!item.piece && typeof item.pdf_page === "number") {
    const prefix = `${item.volume}/${pad(item.pdf_page, 4)}/`;
    const refs = scans.order.filter((r) => r.startsWith(prefix));
    return refs.slice(0, MAX_SCANS).map((r, i) => shown(scans, r, `System ${i + 1} of ${refs.length} on the page`));
  }
  if (piece) {
    const systems = pieceSystems(scans, piece.slug);
    const first = systems[0];
    return first ? [shown(scans, first, "The piece's first system")] : [];
  }
  return [];
}

/** A piece's name, with its page where several pieces share a label (three Asperges in NOH5). */
function nameOf(piece: Piece, pieces: readonly Piece[]): string {
  const shared = pieces.filter((p) => p.label === piece.label && p.volume === piece.volume).length > 1;
  const opening = piece.incipit && piece.incipit !== piece.label ? ` · ${piece.incipit}` : "";
  return shared ? `${piece.label} (${piece.volume}, p. ${piece.printedPages[0]})${opening}` : `${piece.label} (${piece.volume})`;
}

function aboutOf(item: QueueItem, piece: Piece | undefined, pieces: readonly Piece[]): string {
  const name = piece ? nameOf(piece, pieces) : item.piece ?? `${item.volume}`;
  if (item.part) return `${name} · ${partLabel(item.part as ProperPartName, item.variant ?? "")}`;
  if (item.movement) return `${name} · ${MOVEMENT_LABELS[item.movement] ?? item.movement}`;
  if (item.title && item.kind === "hymn_at_page_top") return `${name} · ${item.title}`;
  if (!item.piece && typeof item.pdf_page === "number") return `${item.volume}, scan page ${item.pdf_page}`;
  if (!item.piece && item.pdf_pages) return `${item.volume}, scan pages ${item.pdf_pages.join("-")}`;
  return name;
}

function detailOf(item: QueueItem): string | null {
  const bits = [item.why ?? "", item.chant_incipit ? `linked to ${item.chant_incipit}` : "",
                typeof item.first_system === "number" ? `starts on the page's system ${item.first_system + 1}` : "",
                item.printed_page ? `printed page ${item.printed_page}` : ""].filter(Boolean);
  return bits.length ? bits.join("; ") : null;
}

/** A resolved citation has the same nonempty source range the page and PDF show. */
function borrowedRange(part: BorrowedPart, pieces: readonly Piece[]): boolean {
  const lender = pieces.find((p) => p.slug === part.borrowedFrom);
  if (!lender || !part.borrowedRef) return false;
  return exportSegments([lender], pieces).some((segment) => segment.systems > 0 && segment.part === part.part
    && segment.source?.slug === lender.slug && lender.systems[segment.source.start] === part.borrowedRef);
}

const confidentlyPrinted = (part: PrintedPart, piece: Piece): boolean =>
  part.placed !== "order" && piece.systems.includes(part.ref);

/**
 * Whether what an item asks has been answered since the queue was written: the
 * queue comes from the catalogue build, before the reviewed section lists
 * (data/sections) and the printed references are applied.
 * - A part not found, or whose words did not match, now placed by a person,
 *   by its label or by its words, or recorded as printed elsewhere.
 * - A borrowed section now resolving to music, or an undivided piece now
 *   carrying confident sections, or a chant link now verified.
 * - A piece with no music of its own whose page shows the music it cites (and
 *   so has no first system to check either).
 */
export function settled(item: QueueItem, piece: Piece | undefined,
                        pieces: readonly Piece[] = allPieces()): boolean {
  if (!piece) return false;
  if (item.kind === "part_missing" || item.kind === "part_mismatch") {
    return piece.parts.some((p) => p.part === item.part && p.variant === (item.variant ?? "")
      && (p.kind === "borrowed" || p.placed !== "order"));
  }
  if (item.kind === "part_borrowed_unresolved" || item.kind === "part_by_order") {
    return piece.parts.some((p) => p.part === item.part && p.variant === (item.variant ?? "")
      && (p.kind === "borrowed" ? borrowedRange(p, pieces)
        : item.kind === "part_by_order" && confidentlyPrinted(p, piece)));
  }
  if (item.kind === "part_unsupported") {
    return piece.parts.some((p) => p.kind === "printed" ? confidentlyPrinted(p, piece) : borrowedRange(p, pieces));
  }
  if (item.kind === "unpaired") {
    return piece.chant.some((c) => c.status === "verified" && (!item.movement || c.movement === item.movement));
  }
  if (item.kind === "unverified_pairing") {
    return piece.chant.some((c) => c.status === "verified" && c.movement === (item.movement ?? null));
  }
  // A piece that is only a reference starts nowhere on the page: its music is the music it cites.
  if (item.kind === "starts_mid_page" && piece.systems.length === 0) {
    return musicView(piece).systems.length > 0 || massSources(piece).length > 0;
  }
  if (item.kind === "no_systems") {
    return piece.systems.length > 0 || musicView(piece).systems.length > 0 || massSources(piece).length > 0;
  }
  return false;
}

let cached: readonly ReviewEntry[] | null = null;

/** Everything left to review, in group order, then the queue's own order. */
export function reviewEntries(queue: readonly QueueItem[] = QUEUE, reviewed: Reviewed = REVIEWED,
                              pieces: readonly Piece[] = allPieces(), scans: Scans = buildScans()): readonly ReviewEntry[] {
  if (cached && queue === QUEUE && reviewed === REVIEWED) return cached;
  const find = (slug: string | null | undefined): Piece | undefined =>
    slug ? pieces.find((p) => p.slug === slug) ?? pieceBySlug(slug) : undefined;
  const out: ReviewEntry[] = [];
  for (const suspect of suspectParts(pieces, reviewed)) {
    const piece = find(suspect.slug);
    for (const p of suspect.parts) {
      const systems = piece ? pieceSystems(scans, piece.slug) : [];
      const start = systems[p.start - 1];
      out.push({
        target: p.target, fingerprint: p.fingerprint, kind: "part_to_check", group: "fix",
        label: "Part to check", about: `${suspect.label} (${suspect.volume}) · ${p.name}`, confirm: "Starts here: right",
        look: p.reasons.map((r) => `${r[0]?.toUpperCase()}${r.slice(1)}.`).join(" "),
        detail: `starts on system ${p.start}, runs for ${p.length}`, volume: suspect.volume,
        href: piece ? `/piece/${piece.slug}/` : null, correct: p.target, sections: sectionsOf("part_to_check", piece),
        scans: start ? [shown(scans, start, `Starts now: system ${p.start}`)] : [],
      });
    }
  }
  for (const item of queue) {
    if (reviewed[item.key]?.was === item.fingerprint) continue;
    // A Proper's chants are linked on its parts: "no chant for the Proper as a whole" asks nothing.
    if (item.kind === "unpaired" && item.genre === "proper") continue;
    const piece = find(item.piece);
    if (settled(item, piece, pieces)) continue;
    const kind = reviewKind(item);
    out.push({
      target: item.key, fingerprint: item.fingerprint, kind: item.kind, group: kind.group, label: kind.label,
      about: aboutOf(item, piece, pieces), look: kind.look, detail: detailOf(item), volume: item.volume,
      confirm: kind.confirm ?? "Looks right",
      href: piece ? `/piece/${piece.slug}/` : null, correct: correctTarget(item, piece), sections: sectionsOf(item.kind, piece),
      scans: scansOf(item, piece, scans).slice(0, MAX_SCANS),
    });
  }
  const order: Record<ReviewGroup, number> = { fix: 0, check: 1, info: 2 };
  const sorted = out.map((e, i) => [e, i] as const).sort((a, b) => order[a[0].group] - order[b[0].group] || a[1] - b[1])
    .map(([e]) => e);
  if (queue === QUEUE && reviewed === REVIEWED) cached = sorted;
  return sorted;
}

/** What the admin API checks a review against: each reviewable target's
 * fingerprint and words, and the piece it belongs to. `review: false`: it can
 * be skipped with a note, but not marked as right (a typeset file still to be
 * matched or fixed). */
export interface ReviewIndexItem {
  readonly fingerprint: string;
  readonly label: string;
  readonly piece: string | null;
  readonly review?: false;
  /** Which list it is on: a Review group or a Typeset queue (for the counts). */
  readonly bucket?: Bucket;
}
export interface ReviewIndex {
  readonly items: Readonly<Record<string, ReviewIndexItem>>;
  /** How many parts are shown typeset in all, proofread or not. */
  readonly totals?: { readonly proofreading: number };
}

const QUEUE_WORDS = { matches: "Typeset match", errors: "Typeset error", proofreading: "Proofreading" } as const;

export function reviewIndex(entries: readonly ReviewEntry[] = reviewEntries(),
                            typeset: readonly TypesetEntry[] = typesetEntries(),
                            typesetParts: number = TYPESET.parts.length): ReviewIndex {
  const items: Record<string, ReviewIndexItem> = {};
  const pieceOf = (href: string | null): string | null => (href ? href.split("/")[2] ?? null : null);
  for (const e of entries) {
    items[e.target] = { fingerprint: e.fingerprint, label: `${e.label}: ${e.about}`, piece: pieceOf(e.href), bucket: e.group };
  }
  for (const e of typeset) {
    items[e.target] = { fingerprint: e.fingerprint, label: `${QUEUE_WORDS[e.queue]}: ${e.title} (${e.file})`,
                        piece: pieceOf(e.href), bucket: e.queue,
                        ...(e.queue === "proofreading" ? {} : { review: false as const }) };
  }
  return { items, totals: { proofreading: typesetParts } };
}
