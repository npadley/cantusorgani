import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
import { measure, tickProblems } from './__fixtures__/tickChecks';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { BreakOverride, LayoutSettings, SafeBoundary } from './types';

/**
 * A5f: each divisio minima is a short tick crossing the TOP line of every staff, as LilyPond draws it.
 * The encoder emits it as a text "|" (<dir type="divisio-minima">) because Verovio cannot place the SMuFL
 * tick on the line. The tick's ink extent is rebuilt from the Liberation Serif glyph box.
 */
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const BOUNDARIES = manifest.parts[0]!.boundaries as unknown as SafeBoundary[];

describe('divisio minima ticks on the real Kyrie IX conversion (A5f)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  const settingsFor = (page: 'ipad-13' | 'letter'): LayoutSettings => {
    const base = settingsOf({ page, orientation: 'portrait', staff: 'medium', linePolicy: 'original', maxSystems: null });
    return { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
  };
  const render = async (xml: string, page: 'ipad-13' | 'letter', overrides: readonly BreakOverride[] = []): Promise<string[]> => {
    const s = settingsFor(page);
    const layout = await renderMei(partOf(xml, BOUNDARIES), s, overrides, ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    return layout.pages.map((p) => p.svg);
  };
  const ids = ['cb146', 'cb146s2', 'cb161', 'cb161s2'];

  it('encodes both divisio minima on both staves', () => {
    expect([...MEI.matchAll(/<dir\b[^>]*type="divisio-minima"[^>]*>/g)]).toHaveLength(4);
    expect(MEI).not.toContain('U+E8F3');
  });

  it.each(['ipad-13', 'letter'] as const)('draws a tick across the top line of each staff at both divisions (%s)', async (page) => {
    expect(tickProblems(await render(MEI, page), ids)).toEqual([]);
  });

  it('keeps the ticks when the layout breaks exactly at the divisio', async () => {
    const forced: BreakOverride[] = [{ boundaryId: 'b161', sourceRevision: 'rev1', kind: 'system' }];
    const pages = await render(MEI, 'ipad-13', forced);
    expect(tickProblems(pages, ids)).toEqual([]);
    // The forced break makes the divisio the end of its system, so the tick sits at the right end.
    const page = measure(pages[0]!);
    const tick = page.ticks.find((t) => t.id === 'cb161')!;
    expect(tick.x).toBeGreaterThan(12000); // mid-line it sits near x = 6800
  });

  it('flags a tick that floats above the line or is missing (mutation)', async () => {
    const floated = MEI.replace(/vo="4\.5"/g, 'vo="-1.5"');
    expect(floated).not.toBe(MEI);
    expect(tickProblems(await render(floated, 'ipad-13'), ids).length).toBeGreaterThan(0);
    const dropped = MEI.replace(/<dir\b[^>]*xml:id="cb161s2"[\s\S]*?<\/dir>/, '');
    expect(tickProblems(await render(dropped, 'ipad-13'), ids)).toContain('cb161s2: not drawn');
  });
});
