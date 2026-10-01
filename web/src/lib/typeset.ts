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
  /** The export's pages, at each paper size. */
  readonly letter: string;
  readonly a4: string;
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
  return { narrow: `${at}/narrow.svg`, wide: `${at}/wide.svg`, letter: `${at}/letter.pdf`, a4: `${at}/a4.pdf`,
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
      : t.kind === "movement" ? (piece.genre === "credo" ? `piece:${piece.slug}`
        : `movement:${piece.slug}/${movements.get(t.index) ?? ""}`)
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

/** A run of an export's systems: typeset (when the whole of a typeset segment
 * lies inside the export) or scans. `key` names the segment on the page, whose
 * switches decide which the reader is looking at. */
export interface ExportRun {
  readonly count: number;
  readonly key: string | null;
  readonly label: string | null;
  readonly letter: string | null;
  readonly a4: string | null;
}

/** The runs of systems start..end (exclusive) of a piece, in order. */
export function exportRuns(piece: Piece, start: number, end: number,
                           find: (target: string) => Render | null = renderFor): readonly ExportRun[] {
  const labels = new Map(jumpTargets(piece).map((t) => [t.index, t.label]));
  const out: ExportRun[] = [];
  let scans = 0;
  const flush = (): void => {
    if (scans > 0) out.push({ count: scans, key: null, label: null, letter: null, a4: null });
    scans = 0;
  };
  const typeset = new Map(segments(piece, find).filter((s) => s.render).map((s) => [s.start, s]));
  for (let i = start; i < end;) {
    const seg = typeset.get(i);
    if (seg?.render && seg.end <= end) {
      flush();
      out.push({ count: seg.end - seg.start, key: segmentKey(piece, seg.start), label: labels.get(seg.start) ?? null,
                 letter: seg.render.letter, a4: seg.render.a4 });
      i = seg.end;
      continue;
    }
    scans += 1;
    i += 1;
  }
  flush();
  return out;
}

/** How the page and the export name one segment of one piece. */
export function segmentKey(piece: Piece, start: number): string {
  return `${piece.slug}:${start}`;
}
