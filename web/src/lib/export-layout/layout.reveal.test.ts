import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { LayoutSettings, SafeBoundary } from './types';

/** D17: every final system start shows the continuation of a sustain that crosses it, tied; nothing else is shown. */
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const BOUNDARIES = manifest.parts[0]!.boundaries as unknown as SafeBoundary[];
const PART = partOf(MEI, BOUNDARIES);

function continuations(): { id: string; prevMeasure: string }[] {
  const measureOf = new Map<string, string>();
  const tags: { id: string; measure: string; prev: string | null }[] = [];
  for (const block of MEI.split(/<measure\b/).slice(1)) {
    const measure = /\sxml:id="([^"]+)"/.exec(block)![1]!;
    for (const tag of block.matchAll(/<(note|space|rest)\b[^>]*>/g)) {
      const id = /\sxml:id="([^"]+)"/.exec(tag[0])?.[1];
      if (!id) continue;
      measureOf.set(id, measure);
      if (tag[1] === 'note' && /\stype="split-continuation"/.test(tag[0])) {
        tags.push({ id, measure, prev: /\sprev="#([^"]+)"/.exec(tag[0])?.[1] ?? null });
      }
    }
  }
  return tags.filter((t) => t.prev && measureOf.get(t.prev) !== t.measure).map((t) => ({ id: t.id, prevMeasure: measureOf.get(t.prev!)! }));
}
const CONT = continuations();

const make = (page: 'letter' | 'ipad-11', linePolicy: 'original' | 'automatic', orientation: 'portrait' | 'landscape', maxSystems: number | null, staff: 'medium' | 'large' = 'medium'): LayoutSettings => {
  const base = settingsOf({ page, orientation, staff, linePolicy, maxSystems });
  return { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
};
const CASES: [string, LayoutSettings][] = [
  ['letter-p-auto', make('letter', 'automatic', 'portrait', null)],
  ['ipad11-p-auto', make('ipad-11', 'automatic', 'portrait', null)],
  ['letter-p-orig', make('letter', 'original', 'portrait', null)],
  ['ipad11-l-auto-large', make('ipad-11', 'automatic', 'landscape', null, 'large')],
  ['letter-p-auto-large', make('letter', 'automatic', 'portrait', null, 'large')],
  ['ipad11-p-auto-cap2', make('ipad-11', 'automatic', 'portrait', 2)],
];

describe('split sustains are revealed at every final system start', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  it('has continuations to test', () => expect(CONT.length).toBeGreaterThan(0));

  it.each(CASES)('%s', async (name, s) => {
    const layout = await renderMei(PART, s, [], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]); // includes no-convergence
    const measureOfBoundary = new Map(BOUNDARIES.map((b) => [b.id, b.measureId]));
    const starts = layout.pages.flatMap((p) => p.systems).flatMap((sys) => (sys.firstBoundaryId ? [measureOfBoundary.get(sys.firstBoundaryId)!] : []));
    const expected = CONT.filter((c) => starts.includes(c.prevMeasure)).map((c) => c.id).sort();

    const svg = layout.pages.map((p) => p.svg).join('\n');
    const groups = [...svg.matchAll(/<g\b[^>]*?\sid="([^"]+)"[^>]*class="note split-continuation"[^>]*?(?:\/>|>[\s\S]*?<\/g>)/g)]
      .map((m) => ({ id: m[1]!, visible: /<use|<path|<text/.test(m[0]) }));
    const visible = groups.filter((g) => g.visible).map((g) => g.id).sort();
    expect(visible).toEqual(expected);
    expect(svg.match(/class="tie split-tie/g)?.length ?? 0).toBe(expected.length);
    console.info(`[reveal] ${name}: ${starts.length} system starts, ${expected.length} continuations revealed`);
  });
});
