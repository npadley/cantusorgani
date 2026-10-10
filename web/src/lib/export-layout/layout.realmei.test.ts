import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
import {
  WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio,
} from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { LayoutSettings, SafeBoundary } from './types';

/** Layout smoke test on the converter's real output for Kyrie IX (card A3e), with real Verovio WASM. */
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const BOUNDARIES = manifest.parts[0]!.boundaries as unknown as SafeBoundary[];
const PART = partOf(MEI, BOUNDARIES);
const ORIGINAL_NOTES = [...MEI.matchAll(/<note\b[^>]*?\sxml:id="(ev[^"c]+)"/g)].map((m) => m[1]!);

function settingsFor(page: 'letter' | 'ipad-11', linePolicy: 'original' | 'automatic'): LayoutSettings {
  const base = settingsOf({ page, orientation: 'portrait', staff: 'medium', linePolicy, maxSystems: null });
  return { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
}

describe('real converter output lays out (Kyrie IX)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();

  it('has the 358 original notes and the five source-break boundaries', () => {
    expect(ORIGINAL_NOTES).toHaveLength(358);
    expect(BOUNDARIES.filter((b) => b.sourceBreak)).toHaveLength(5);
  });

  it.each([
    ['letter-p-orig', 'letter', 'original'],
    ['ipad11-p-auto', 'ipad-11', 'automatic'],
  ] as const)('%s', async (_id, page, linePolicy) => {
    const s = settingsFor(page, linePolicy);
    const layout = await renderMei(PART, s, [], ctxOf(newToolkit()), rectsOf(s));

    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(0);

    const svg = layout.pages.map((p) => p.svg).join('\n');
    const present = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    expect(ORIGINAL_NOTES.filter((id) => !present.has(id))).toEqual([]);

    // Continuation fragments draw nothing: no glyph, no stem, no tie.
    const groups = [...svg.matchAll(/<g\b[^>]*class="note split-continuation"[^>]*?(?:\/>|>[\s\S]*?<\/g>)/g)];
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.filter((g) => /<use|<path|<text/.test(g[0]))).toEqual([]);
    expect(svg).not.toContain('split-tie');

    expect(Math.abs(layout.staffHeightMm - 7.2)).toBeLessThanOrEqual(0.1);

    if (linePolicy === 'original') {
      const starts = layout.pages.flatMap((p) => p.systems).map((sys) => sys.firstBoundaryId).filter((id) => id !== null);
      expect([...starts].sort()).toEqual(BOUNDARIES.filter((b) => b.sourceBreak).map((b) => b.id).sort());
    }
  });
});
