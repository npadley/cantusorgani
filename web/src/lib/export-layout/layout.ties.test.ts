import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMei } from './layout';
import { paperDimensions } from './settings';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { LayoutSettings, SafeBoundary } from './types';

/** Ties that cross a PAGE break must be drawn on the page that holds their end note. */
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const PART = partOf(MEI, manifest.parts[0]!.boundaries as unknown as SafeBoundary[]);
const TIES = [...MEI.matchAll(/<tie\b[^>]*>/g)].map((m) => ({
  id: /xml:id="([^"]+)"/.exec(m[0])?.[1] ?? '',
  start: /startid="#([^"]+)"/.exec(m[0])?.[1] ?? '',
  end: /endid="#([^"]+)"/.exec(m[0])?.[1] ?? '',
})).filter((t) => t.id && t.start && t.end);

const CASES: readonly [string, Partial<LayoutSettings>][] = [
  ['custom-160x230-auto', { page: 'custom', customSize: { widthMm: 160, heightMm: 230 } }],
  ['ipad11-l-large-auto', { page: 'ipad-11', orientation: 'landscape', staff: 'large' }],
  ['ipad11-p-auto', { page: 'ipad-11' }],
  ['letter-p-large-auto', { page: 'letter', staff: 'large' }],
];

describe('ties across page breaks (real Kyrie IX)', { timeout: WASM_TIMEOUT_MS * 2 }, () => {
  const { newToolkit } = useRealVerovio();
  it.each(CASES)('%s: every tie is drawn on the page of its end note', async (_name, patch) => {
    const base = settingsOf({ orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', maxSystems: null, ...patch });
    const s: LayoutSettings = { ...base, marginMm: paperDimensions(base).kind === 'print' ? 12 : 4 };
    const layout = await renderMei(PART, s, [], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(1);

    const pageOf = (id: string): number => layout.pages.findIndex((p) => p.svg.includes(`id="${id}"`));
    const drawn = layout.pages.map((p) => new Set([...p.svg.matchAll(/<g\b[^>]*class="tie[^"]*"[^>]*>/g)].flatMap((m) => {
      const id = /\sid="([^"]+)"/.exec(m[0])?.[1];
      const span = /class="[^"]*\bid-([^\s"]+)/.exec(m[0])?.[1];
      return [id, span].filter((x): x is string => !!x);
    })));
    const missing = TIES.filter((t) => {
      const e = pageOf(t.end);
      return e >= 0 && !drawn[e]!.has(t.id);
    });
    // A tie whose start was revealed on the next page is drawn there; no tie may be left undrawn.
    expect(missing.map((t) => t.id)).toEqual([]);
  });
});
