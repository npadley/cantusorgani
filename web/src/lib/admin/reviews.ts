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
import type { Piece, ProperPartName } from "../catalog";
import { type QueueItem, type ReviewGroup, reviewKind } from "./reviewKinds";
import { type Scans, type Shown, pieceSystems, shown } from "./scans";
import { type Reviewed, suspectParts } from "./suspects";
import { buildScans } from "./targetIndex";
import { MOVEMENT_LABELS, pairingMovements } from "./targets";
import { type TypesetEntry, typesetEntries } from "./typesetQueues";

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
  readonly scans: readonly Shown[];
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

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

function aboutOf(item: QueueItem, piece: Piece | undefined): string {
  const name = piece ? `${piece.label} (${piece.volume})` : item.piece ?? `${item.volume}`;
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
        label: "Part to check", about: `${suspect.label} (${suspect.volume}) · ${p.name}`,
        look: p.reasons.map((r) => `${r[0]?.toUpperCase()}${r.slice(1)}.`).join(" "),
        detail: `starts on system ${p.start}, runs for ${p.length}`, volume: suspect.volume,
        href: piece ? `/piece/${piece.slug}/` : null, correct: p.target,
        scans: start ? [shown(scans, start, `Starts now: system ${p.start}`)] : [],
      });
    }
  }
  for (const item of queue) {
    if (reviewed[item.key]?.was === item.fingerprint) continue;
    const piece = find(item.piece);
    const kind = reviewKind(item);
    out.push({
      target: item.key, fingerprint: item.fingerprint, kind: item.kind, group: kind.group, label: kind.label,
      about: aboutOf(item, piece), look: kind.look, detail: detailOf(item), volume: item.volume,
      href: piece ? `/piece/${piece.slug}/` : null, correct: correctTarget(item, piece),
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
}
export interface ReviewIndex {
  readonly items: Readonly<Record<string, ReviewIndexItem>>;
}

const QUEUE_WORDS = { matches: "Typeset match", errors: "Typeset error", proofreading: "Proofreading" } as const;

export function reviewIndex(entries: readonly ReviewEntry[] = reviewEntries(),
                            typeset: readonly TypesetEntry[] = typesetEntries()): ReviewIndex {
  const items: Record<string, ReviewIndexItem> = {};
  const pieceOf = (href: string | null): string | null => (href ? href.split("/")[2] ?? null : null);
  for (const e of entries) {
    items[e.target] = { fingerprint: e.fingerprint, label: `${e.label}: ${e.about}`, piece: pieceOf(e.href) };
  }
  for (const e of typeset) {
    items[e.target] = { fingerprint: e.fingerprint, label: `${QUEUE_WORDS[e.queue]}: ${e.title} (${e.file})`,
                        piece: pieceOf(e.href), ...(e.queue === "proofreading" ? {} : { review: false as const }) };
  }
  return { items };
}
