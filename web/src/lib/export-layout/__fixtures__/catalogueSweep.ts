import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderMei, wordFinalMeasures } from '../layout';
import { paperDimensions } from '../settings';
import { ctxOf, partOf, rectsOf, settingsOf } from './layoutHarness';
import { lyricCollisions } from './lyricCollisions';
import type { LayoutSettings, MeiLayout, SafeBoundary, VerovioLike } from '../types';

/** Contracts section 3: the 13 required layouts. */
export const MATRIX: readonly (readonly [string, Partial<LayoutSettings>])[] = [
  ['letter-p-orig', { page: 'letter', linePolicy: 'original' }],
  ['letter-p-auto', { page: 'letter', linePolicy: 'automatic' }],
  ['letter-l-orig', { page: 'letter', orientation: 'landscape', linePolicy: 'original' }],
  ['a4-p-orig', { page: 'a4', linePolicy: 'original' }],
  ['a4-l-auto', { page: 'a4', orientation: 'landscape', linePolicy: 'automatic' }],
  ['a5-p-auto', { page: 'a5', linePolicy: 'automatic' }],
  ['a5-l-orig', { page: 'a5', orientation: 'landscape', linePolicy: 'original' }],
  ['letter-p-large-auto', { page: 'letter', staff: 'large', linePolicy: 'automatic' }],
  ['letter-p-small-cap2', { page: 'letter', staff: 'small', linePolicy: 'automatic', maxSystems: 2 }],
  ['ipad11-p-auto', { page: 'ipad-11', linePolicy: 'automatic' }],
  ['ipad11-l-large-auto', { page: 'ipad-11', orientation: 'landscape', staff: 'large', linePolicy: 'automatic' }],
  ['ipadmini-p-auto', { page: 'ipad-mini', linePolicy: 'automatic' }],
  ['custom-160x230-auto', { page: 'custom', customSize: { widthMm: 160, heightMm: 230 }, linePolicy: 'automatic' }],
];

const DIR = join(import.meta.dirname, 'catalogue');
export const catalogueSlugs = (): string[] => readdirSync(DIR).filter((f) => f.endsWith('.mei')).map((f) => f.slice(0, -4)).sort();
export function loadPiece(slug: string) {
  const mei = readFileSync(join(DIR, `${slug}.mei`), 'utf8');
  const boundaries = JSON.parse(readFileSync(join(DIR, `${slug}.boundaries.json`), 'utf8')) as SafeBoundary[];
  return { slug, mei, boundaries, part: partOf(mei, boundaries) };
}
export function settingsFor(patch: Partial<LayoutSettings>): LayoutSettings {
  const base = settingsOf({ orientation: 'portrait', staff: 'medium', linePolicy: 'original', maxSystems: null, ...patch });
  return { ...base, marginMm: paperDimensions(base).kind === 'print' ? 12 : 4 };
}

export interface CaseResult {
  readonly id: string;
  readonly errors: string[];
  readonly midWord: number; // avoidable ones (not recorded as MIDWORD_UNAVOIDABLE)
  readonly unavoidable: number;
  readonly collisions: number;
  readonly syllables: string; // "drawn/encoded"
  readonly syllablesOk: boolean;
  readonly deadTies: string[];
  readonly pages: number;
}
export async function runCase(piece: ReturnType<typeof loadPiece>, id: string, patch: Partial<LayoutSettings>, toolkit: VerovioLike): Promise<{ result: CaseResult; layout: MeiLayout }> {
  const s = settingsFor(patch);
  const layout = await renderMei(piece.part, s, [], ctxOf(toolkit), rectsOf(s));
  const errors = layout.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code}${d.reason ? ':' + d.reason : ''} ${d.detail.slice(0, 80)}`);
  const wordFinal = wordFinalMeasures(piece.mei);
  const measureOf = new Map(piece.boundaries.map((b) => [b.id, b.measureId]));
  const starts = layout.pages.flatMap((p) => p.systems).flatMap((x) => (x.firstBoundaryId ? [x.firstBoundaryId] : []));
  // D24: a mid-word start the layout recorded as MIDWORD_UNAVOIDABLE is allowed; any other one is a defect.
  const flagged = new Set(layout.diagnostics.filter((d) => d.code === 'MIDWORD_UNAVOIDABLE').flatMap((d) => d.boundaryIds));
  const midStarts = s.linePolicy === 'automatic' ? starts.filter((b) => !wordFinal.has(measureOf.get(b)!)) : [];
  const midWord = midStarts.filter((b) => !flagged.has(b)).length;
  const unavoidable = midStarts.length - midWord;
  const encoded = (piece.mei.match(/<syl\b/g) ?? []).length;
  const drawn = layout.pages.reduce((n, p) => n + (p.svg.match(/class="[^"]*syl[^"]*"/g) ?? []).length, 0);
  const collisions = layout.pages.flatMap((p) => lyricCollisions(p.svg, 0.3)).length;
  const ties = [...piece.mei.matchAll(/<tie\b[^>]*>/g)].map((m) => ({
    id: /xml:id="([^"]+)"/.exec(m[0])?.[1] ?? '', end: /endid="#([^"]+)"/.exec(m[0])?.[1] ?? '',
  })).filter((t) => t.id && t.end);
  const drawnTies = layout.pages.map((p) => new Set([...p.svg.matchAll(/<g\b[^>]*class="tie[^"]*"[^>]*>/g)].flatMap((m) => {
    const i = /\sid="([^"]+)"/.exec(m[0])?.[1]; const sp = /class="[^"]*\bid-([^\s"]+)/.exec(m[0])?.[1];
    return [i, sp].filter((x): x is string => !!x);
  })));
  const deadTies = layout.pages.length === 0 ? [] : ties.filter((t) => {
    const e = layout.pages.findIndex((p) => p.svg.includes(`id="${t.end}"`));
    return e >= 0 && !drawnTies[e]!.has(t.id);
  }).map((t) => t.id);
  return { layout, result: { id, errors, midWord, unavoidable, collisions, syllables: `${drawn}/${encoded}`, syllablesOk: layout.pages.length === 0 || drawn === encoded, deadTies, pages: layout.pages.length } };
}
