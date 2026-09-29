/**
 * Typeset music: where a volunteer transcription has been matched to a part of
 * a piece, the page shows it drawn by LilyPond instead of the scan (with a
 * switch back to the scans). data/typeset/manifest.json names each matched
 * part's render; docs/TYPESETTING.md says how it gets there.
 *
 * A piece's systems are split into segments at its headings (movements, Proper
 * parts, a single-chant piece's one chant). Each segment is either typeset or
 * scans. A part whose start is still on "Parts to check" shows its scans until
 * it is checked: the typeset music would follow the same wrong boundary.
 */
import manifestJson from "../../../data/typeset/manifest.json";
import reviewedJson from "../../../data/reviewed.json";
import { allPieces, assetBase, jumpTargets, movementStarts } from "./catalog";
import type { Piece } from "./catalog";
import { suspectParts } from "./admin/suspects";
import type { Reviewed } from "./admin/suspects";

interface ManifestPart { readonly target: string; readonly file: string; readonly hash: string }
interface Manifest {
  readonly prefix: string;
  readonly credit: string;
  readonly source: string;
  readonly parts: readonly ManifestPart[];
}

export const MANIFEST = manifestJson as Manifest;
const REVIEWED = (reviewedJson as { reviewed: Reviewed }).reviewed;

export interface Render {
  /** Phone width, lines broken to fit. */
  readonly narrow: string;
  /** Tablet and desktop: the book's own line breaks. */
  readonly wide: string;
  /** A4 pages, for the export. */
  readonly pdf: string;
  /** An editor has proofread it against the scan (a `reviewed` correction on typeset:<file>). */
  readonly proofread: boolean;
  readonly file: string;
}

export interface Segment {
  /** Systems start (inclusive) and end (exclusive), in piece.systems. */
  readonly start: number;
  readonly end: number;
  readonly target: string | null;
  readonly render: Render | null;
}

let byTarget: Map<string, ManifestPart> | null = null;
let unchecked: Set<string> | null = null;

function render(part: ManifestPart, prefix: string, reviewed: Reviewed, base: string = assetBase()): Render {
  const at = `${base}/${prefix}/${part.hash}`;
  const review = reviewed[`typeset:${part.file}`];
  return { narrow: `${at}/narrow.svg`, wide: `${at}/wide.svg`, pdf: `${at}/score.pdf`,
           proofread: review?.was === part.hash, file: part.file };
}

/** The render for a target, or null: none matched, or its start is still to be checked. */
export function renderFor(target: string, manifest: Manifest = MANIFEST, reviewed: Reviewed = REVIEWED,
                          pieces: readonly Piece[] = allPieces()): Render | null {
  if (manifest === MANIFEST && reviewed === REVIEWED) {
    byTarget ??= new Map(manifest.parts.map((p) => [p.target, p]));
    unchecked ??= new Set(suspectParts(pieces, reviewed).flatMap((s) => s.parts.map((p) => p.target)));
  }
  const map = manifest === MANIFEST && reviewed === REVIEWED && byTarget ? byTarget
    : new Map(manifest.parts.map((p) => [p.target, p]));
  const toCheck = manifest === MANIFEST && reviewed === REVIEWED && unchecked ? unchecked
    : new Set(suspectParts(pieces, reviewed).flatMap((s) => s.parts.map((p) => p.target)));
  const part = map.get(target);
  if (!part || toCheck.has(target)) return null;
  return render(part, manifest.prefix, reviewed);
}

/** Where each heading's music begins, with what a transcription would be matched to. */
function starts(piece: Piece): { index: number; target: string | null }[] {
  const movements = new Map(movementStarts(piece).map((m) => [m.index, m.movement]));
  return jumpTargets(piece).map((t) => ({
    index: t.index,
    target: t.kind === "part" ? t.target ?? null
      : t.kind === "movement" ? `movement:${piece.slug}/${movements.get(t.index) ?? ""}`
      : t.kind === "chant" ? `piece:${piece.slug}` : null,
  }));
}

/** The piece's systems as segments, each typeset or scans, in order. */
export function segments(piece: Piece, find: (target: string) => Render | null = renderFor): readonly Segment[] {
  const n = piece.systems.length;
  if (n === 0) return [];
  const heads = starts(piece).filter((s) => s.index >= 0 && s.index < n).sort((a, b) => a.index - b.index);
  // A single-chant piece with no heading at all is one segment: the piece.
  if (heads.length === 0) {
    const whole = find(`piece:${piece.slug}`);
    return [{ start: 0, end: n, target: whole ? `piece:${piece.slug}` : null, render: whole }];
  }
  const out: Segment[] = [];
  if (heads[0]!.index > 0) out.push({ start: 0, end: heads[0]!.index, target: null, render: null });
  heads.forEach((h, i) => {
    const end = heads[i + 1]?.index ?? n;
    if (end <= h.index) return;                  // two headings on one system: the later one speaks
    const found = h.target ? find(h.target) : null;
    out.push({ start: h.index, end, target: h.target, render: found });
  });
  return out;
}

/** Whether the piece shows any typeset music (for the page-wide switch). */
export function hasTypeset(piece: Piece): boolean {
  return segments(piece).some((s) => s.render);
}

export const CREDIT = MANIFEST.credit;
export const SOURCE = MANIFEST.source;
