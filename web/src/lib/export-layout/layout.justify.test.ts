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

    // The same systems without justification: sb at every final system start, breaks encoded.
    const byBoundary = new Map(PART.part.conversion.boundaries.map((x) => [x.id, x.measureId] as const));
    const order = [...MEI.matchAll(/<measure\b[^>]*?\sxml:id="([^"]+)"/g)].map((m) => m[1]!);
    const startMeasures = justified.pages.flatMap((p) => p.systems).flatMap((sys) =>
      (sys.firstBoundaryId ? [order[order.indexOf(byBoundary.get(sys.firstBoundaryId)!) + 1]!] : []));
    let mei = MEI.replace(/<sb\s*\/>/g, '');
    for (const m of startMeasures) mei = mei.replace(new RegExp(`(<measure\\b[^>]*?\\sxml:id="${m}")`), '<sb/>$1');
    const tk = newToolkit();
    tk.setOptions({ ...verovioOptions(s, rects.content), justifyVertically: false, pageHeight: 60000, breaks: 'encoded' });
    expect(tk.loadData(mei)).toBeTruthy();
    const naturalSystems = measureSvgPage(tk.renderToSVG(1)).systems;
    expect(naturalSystems).toHaveLength(startMeasures.length + 1);
    const natural = naturalSystems[0]!;
    const naturalGaps = naturalSystems.map((x) => x.staffTopsMm[1]! - x.staffTopsMm[0]!);
    expect(Math.min(...naturalGaps)).toBeGreaterThan(10);

    let k = 0;
    for (const page of after) {
      for (const sys of page.systems) {
        expect(sys.staffTopsMm).toHaveLength(2);
        const gap = sys.staffTopsMm[1]! - sys.staffTopsMm[0]!;
        // The very last system of the part gets 0.33 mm extra from Verovio's last-page justification.
        const last = k === naturalGaps.length - 1;
        expect(Math.abs(gap - naturalGaps[k++]!)).toBeLessThanOrEqual(last ? 0.5 : 0.2);
      }
    }
    // Systems still spread: with two systems on a page the second starts far below its natural place.
    const first = after[0]!.systems;
    expect(first).toHaveLength(2);
    const naturalPitch = natural.heightMm + 11; // a system plus a typical inter-system gap
    expect(first[1]!.staffTopsMm[0]! - first[0]!.staffTopsMm[0]!).toBeGreaterThan(naturalPitch + 10);
  });
});
