import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
import { tickProblems } from './__fixtures__/tickChecks';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import type { LayoutSettings, SafeBoundary } from './types';

/**
 * A5g: the Missa IX batch pieces on real Verovio. Divisio ticks cross the top line of every staff even where
 * a tie arc sits above the bass staff; ordinary and voice-line glissandi are solid; a chord inside a voice
 * draws all its heads. Cases are the iPad 13-inch original lines and Letter automatic.
 */
const DIR = join(__dirname, '__fixtures__');
const load = (piece: string): { mei: string; boundaries: SafeBoundary[] } => ({
  mei: readFileSync(join(DIR, `${piece}-ix.mei`), 'utf8'),
  boundaries: JSON.parse(readFileSync(join(DIR, `${piece}-ix.boundaries.json`), 'utf8')) as SafeBoundary[],
});
const dirIds = (mei: string): string[] => [...mei.matchAll(/<dir\b[^>]*type="divisio-minima"[^>]*xml:id="([^"]+)"/g)].map((m) => m[1]!)
  .concat([...mei.matchAll(/<dir\b[^>]*xml:id="([^"]+)"[^>]*type="divisio-minima"/g)].map((m) => m[1]!));

describe('Missa IX pieces on the real renderer (A5g)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  const render = async (piece: string, page: 'ipad-13' | 'letter', linePolicy: 'original' | 'automatic'): Promise<string[]> => {
    const { mei, boundaries } = load(piece);
    const base = settingsOf({ page, orientation: 'portrait', staff: 'medium', linePolicy, maxSystems: null });
    const s: LayoutSettings = { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
    const layout = await renderMei(partOf(mei, boundaries), s, [], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    return layout.pages.map((p) => p.svg);
  };

  it.each([
    ['agnus', 'ipad-13', 'original'], ['agnus', 'letter', 'automatic'],
    ['sanctus', 'ipad-13', 'original'], ['sanctus', 'letter', 'automatic'],
    ['gloria', 'ipad-13', 'original'],
  ] as const)('%s on %s (%s): every divisio tick crosses the top line of its staff', async (piece, page, policy) => {
    const ids = [...new Set(dirIds(load(piece).mei))];
    expect(ids.length).toBeGreaterThan(0);
    expect(tickProblems(await render(piece, page, policy), ids)).toEqual([]);
  });

  it('flags the old place="above" tick that a tie arc pushes off the bass top line (mutation)', async () => {
    const { mei, boundaries } = load('agnus');
    const above = mei.replace(/place="within"/g, 'place="above"').replace(/vo="4\.5"/g, 'vo="-1.5"');
    expect(above).not.toBe(mei);
    const base = settingsOf({ page: 'ipad-13', orientation: 'portrait', staff: 'medium', linePolicy: 'original', maxSystems: null });
    const s: LayoutSettings = { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
    const layout = await renderMei(partOf(above, boundaries), s, [], ctxOf(newToolkit()), rectsOf(s));
    const problems = tickProblems(layout.pages.map((p) => p.svg), [...new Set(dirIds(mei))]);
    expect(problems.some((p) => p.startsWith('cb017s2'))).toBe(true);
  });

  it('draws Agnus glissandi as solid lines (ordinary and voice-line)', async () => {
    const svg = (await render('agnus', 'ipad-13', 'original')).join('\n');
    const glisses = [...svg.matchAll(/<g\b[^>]*class="gliss[^"]*"[^>]*>[\s\S]*?<\/g>/g)];
    expect(glisses.length).toBeGreaterThanOrEqual(8); // 4 ordinary + 4 voice lines (a crossing line may draw in two pieces)
    expect(glisses.filter((g) => /stroke-dasharray/.test(g[0]))).toEqual([]);
  });

  it('draws both heads of the chord in Gloria IX', async () => {
    const { mei } = load('gloria');
    const chord = /<chord\b[^>]*>[\s\S]*?<\/chord>/.exec(mei)!;
    const members = [...chord[0].matchAll(/<note\b[^>]*xml:id="([^"]+)"/g)].map((m) => m[1]!);
    expect(members).toHaveLength(2);
    const svg = (await render('gloria', 'ipad-13', 'original')).join('\n');
    for (const id of members) expect(new RegExp(`id="${id}" class="note"[\\s\\S]{0,800}?<use`).test(svg), id).toBe(true);
  });
});
