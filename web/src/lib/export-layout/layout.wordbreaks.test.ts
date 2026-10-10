import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMei, wordFinalMeasures } from './layout';
import { paperDimensions } from './settings';
import { WASM_TIMEOUT_MS, ctxOf as baseCtxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { LayoutSettings, SafeBoundary } from './types';

import type { FontAsset, FontProfile, RenderContext, VerovioLike } from './types';

const LIBERATION = new Uint8Array(readFileSync(join(__dirname, '..', '..', '..', 'public', 'fonts', 'export', 'LiberationSerif-Regular.ttf')));
/** The harness context plus the real lyric face, so layout can check syllable gaps. */
const ctxOf = (tk: VerovioLike): RenderContext => {
  const ctx = baseCtxOf(tk);
  const lyricFont = { family: 'Liberation Serif', url: '', sha256: '', license: 'OFL', bytes: LIBERATION } as FontAsset;
  return { ...ctx, fonts: { lyricFont } as unknown as FontProfile };
};

const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const BOUNDARIES = manifest.parts[0]!.boundaries as unknown as SafeBoundary[];
const PART = partOf(MEI, BOUNDARIES);
const WORD_FINAL = wordFinalMeasures(MEI);
const measureOf = new Map(BOUNDARIES.map((b) => [b.id, b.measureId]));

const CASES: readonly [string, Partial<LayoutSettings>][] = [
  ['letter-p-auto', { page: 'letter' }],
  ['a4-l-auto', { page: 'a4', orientation: 'landscape' }],
  ['a5-p-auto', { page: 'a5' }],
  ['ipad11-p-auto', { page: 'ipad-11' }],
  ['ipad11-p-cap2', { page: 'ipad-11', maxSystems: 2 }],
  ['ipad11-p-large-auto', { page: 'ipad-11', staff: 'large' }],
  ['ipad11-l-medium-auto', { page: 'ipad-11', orientation: 'landscape' }],
  ['ipadmini-p-auto', { page: 'ipad-mini' }],
  ['ipadmini-p-large-auto', { page: 'ipad-mini', staff: 'large' }],
  ['custom-160x230-auto', { page: 'custom', customSize: { widthMm: 160, heightMm: 230 } }],
];

describe('wordFinalMeasures', () => {
  it('marks measures that end a lyric word, from wordpos', () => {
    const mei = '<mei><measure xml:id="a"><syl wordpos="i">Ky</syl></measure><measure xml:id="b"><syl wordpos="m">ri</syl></measure>' +
      '<measure xml:id="c"></measure><measure xml:id="d"><syl wordpos="t">e</syl></measure><measure xml:id="e"><syl>son</syl></measure></mei>';
    expect([...wordFinalMeasures(mei)]).toEqual(['d', 'e']);
  });
});

describe('automatic line breaks prefer word boundaries (real Kyrie IX)', { timeout: WASM_TIMEOUT_MS * 2 }, () => {
  const { newToolkit } = useRealVerovio();
  it.each(CASES)('%s: no system starts inside a word', async (name, patch) => {
    const base = settingsOf({ orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', maxSystems: null, ...patch });
    const s: LayoutSettings = { ...base, marginMm: paperDimensions(base).kind === 'print' ? 12 : 4 };
    const layout = await renderMei(PART, s, [], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    const starts = layout.pages.flatMap((p) => p.systems).flatMap((sys) => (sys.firstBoundaryId ? [sys.firstBoundaryId] : []));
    const midWord = starts.filter((id) => !WORD_FINAL.has(measureOf.get(id)!));
    console.info(`[wordbreaks] ${name}: ${starts.length + 1} systems, ${midWord.length} mid-word starts`);
    // Large staves on narrow pages cannot move a break back without squeezing the lyrics; they
    // move it forward to a later word boundary instead.
    expect(midWord).toEqual([]);
  });

  it('leaves original lines alone', async () => {
    const s: LayoutSettings = { ...settingsOf({ page: 'letter' }), marginMm: 12 };
    const layout = await renderMei(PART, s, [], ctxOf(newToolkit()), rectsOf(s));
    const starts = layout.pages.flatMap((p) => p.systems).flatMap((sys) => (sys.firstBoundaryId ? [sys.firstBoundaryId] : []));
    expect(starts.sort()).toEqual(BOUNDARIES.filter((b) => b.sourceBreak).map((b) => b.id).sort());
  });
});
