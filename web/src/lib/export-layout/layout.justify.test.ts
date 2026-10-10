import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMei } from './layout';
import { measureSvgPage } from './svgGeometry';
import { verovioOptions } from './settings';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { LayoutSettings, SafeBoundary } from './types';

const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const PART = partOf(MEI, manifest.parts[0]!.boundaries as unknown as SafeBoundary[]);

describe('vertical justification keeps the grand staff together', { timeout: WASM_TIMEOUT_MS * 2 }, () => {
  const { newToolkit } = useRealVerovio();
  const s: LayoutSettings = { ...settingsOf({ page: 'ipad-11', linePolicy: 'automatic', maxSystems: 2 }), marginMm: 4 };

  it('spreads systems but leaves the treble-to-bass gap unchanged (within 0.2 mm)', async () => {
    const rects = rectsOf(s);
    const justified = await renderMei(PART, s, [], ctxOf(newToolkit()), rects);
    expect(errors(justified.diagnostics)).toEqual([]);
    const after = justified.pages.map((p) => measureSvgPage(p.svg));

    // The same page without justification, straight from the toolkit.
    const tk = newToolkit();
    tk.setOptions({ ...verovioOptions(s, rects.content), justifyVertically: false, breaks: 'auto' });
    expect(tk.loadData(MEI)).toBeTruthy();
    const natural = measureSvgPage(tk.renderToSVG(1)).systems[0]!;
    const naturalGap = natural.staffTopsMm[1]! - natural.staffTopsMm[0]!;
    expect(naturalGap).toBeGreaterThan(10);

    for (const page of after) {
      for (const sys of page.systems) {
        expect(sys.staffTopsMm).toHaveLength(2);
        expect(Math.abs(sys.staffTopsMm[1]! - sys.staffTopsMm[0]! - naturalGap)).toBeLessThanOrEqual(0.2);
      }
    }
    // Systems still spread: with two systems on a page the second starts far below its natural place.
    const first = after[0]!.systems;
    expect(first).toHaveLength(2);
    const naturalPitch = natural.heightMm + 11; // a system plus a typical inter-system gap
    expect(first[1]!.staffTopsMm[0]! - first[0]!.staffTopsMm[0]!).toBeGreaterThan(naturalPitch + 10);
  });
});
