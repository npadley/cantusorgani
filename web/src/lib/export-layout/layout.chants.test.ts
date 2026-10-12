import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMei, wordFinalMeasures } from './layout';
import { paperDimensions } from './settings';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import type { LayoutSettings, SafeBoundary } from './types';

/** Other converted chants (first batch): Agnus Dei IX and Sanctus IX, real Verovio. */
const load = (name: string) => {
  const mei = readFileSync(join(__dirname, '__fixtures__', `${name}.mei`), 'utf8');
  const boundaries = JSON.parse(readFileSync(join(__dirname, '__fixtures__', `${name}.boundaries.json`), 'utf8')) as SafeBoundary[];
  return { mei, boundaries, part: partOf(mei, boundaries) };
};
const settingsFor = (patch: Partial<LayoutSettings>): LayoutSettings => {
  const base = settingsOf({ orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', maxSystems: null, ...patch });
  return { ...base, marginMm: paperDimensions(base).kind === 'print' ? 12 : 4 };
};
const drawnSyllables = (svg: string): number => (svg.match(/class="[^"]*syl[^"]*"/g) ?? []).length;

describe('Agnus Dei IX and Sanctus IX lay out inside the page', { timeout: WASM_TIMEOUT_MS * 2 }, () => {
  const { newToolkit } = useRealVerovio();

  it('Agnus ipad11-p-auto: no system wider than the content', async () => {
    const { part } = load('agnus-ix');
    const s = settingsFor({ page: 'ipad-11' });
    const layout = await renderMei(part, s, [], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(0);
  });

  it.each([
    ['sanctus-ix', 'ipadmini-p-auto', { page: 'ipad-mini' }],
    ['sanctus-ix', 'ipad11-p-auto', { page: 'ipad-11' }],
    ['agnus-ix', 'ipadmini-p-auto', { page: 'ipad-mini' }],
  ] as const)('%s %s: every syllable drawn exactly once, no system starts inside a word', async (name, _id, patch) => {
    const { mei, boundaries, part } = load(name);
    const s = settingsFor(patch);
    const layout = await renderMei(part, s, [], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    const encoded = (mei.match(/<syl\b/g) ?? []).length;
    expect(layout.pages.reduce((n, p) => n + drawnSyllables(p.svg), 0)).toBe(encoded);

    const wordFinal = wordFinalMeasures(mei);
    const measureOf = new Map(boundaries.map((b) => [b.id, b.measureId]));
    const starts = layout.pages.flatMap((p) => p.systems).flatMap((sys) => (sys.firstBoundaryId ? [sys.firstBoundaryId] : []));
    expect(starts.filter((id) => !wordFinal.has(measureOf.get(id)!))).toEqual([]);
  });
});
