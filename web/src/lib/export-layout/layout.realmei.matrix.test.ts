import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMei } from './layout';
import { paperDimensions } from './settings';
import { lyricCollisions } from './__fixtures__/lyricCollisions';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { LayoutSettings, SafeBoundary } from './types';

/** Contracts section 3 matrix plus three large-iPad cases, on the converter's real Kyrie IX output. */
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const BOUNDARIES = manifest.parts[0]!.boundaries as unknown as SafeBoundary[];
const PART = partOf(MEI, BOUNDARIES);
const NOTES = [...MEI.matchAll(/<note\b[^>]*?\sxml:id="(ev[^"c]+)"/g)].map((m) => m[1]!);

const CASES: readonly [string, Partial<LayoutSettings>][] = [
  ['letter-p-orig', { page: 'letter' }],
  ['letter-p-auto', { page: 'letter', linePolicy: 'automatic' }],
  ['letter-l-orig', { page: 'letter', orientation: 'landscape' }],
  ['a4-p-orig', { page: 'a4' }],
  ['a4-l-auto', { page: 'a4', orientation: 'landscape', linePolicy: 'automatic' }],
  ['a5-p-auto', { page: 'a5', linePolicy: 'automatic' }],
  ['a5-l-orig', { page: 'a5', orientation: 'landscape' }],
  ['letter-p-large-auto', { page: 'letter', staff: 'large', linePolicy: 'automatic' }],
  ['letter-p-small-cap2', { page: 'letter', staff: 'small', linePolicy: 'automatic', maxSystems: 2 }],
  ['ipad11-p-auto', { page: 'ipad-11', linePolicy: 'automatic' }],
  ['ipad11-l-large-auto', { page: 'ipad-11', orientation: 'landscape', staff: 'large', linePolicy: 'automatic' }],
  ['ipadmini-p-auto', { page: 'ipad-mini', linePolicy: 'automatic' }],
  ['custom-160x230-auto', { page: 'custom', customSize: { widthMm: 160, heightMm: 230 }, linePolicy: 'automatic' }],
  ['ipad11-p-large-auto', { page: 'ipad-11', staff: 'large', linePolicy: 'automatic' }],
  ['ipad11-l-medium-auto', { page: 'ipad-11', orientation: 'landscape', linePolicy: 'automatic' }],
  ['ipadmini-p-large-auto', { page: 'ipad-mini', staff: 'large', linePolicy: 'automatic' }],
];

describe('real Kyrie IX over the layout matrix', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  it('has 358 original notes', () => expect(NOTES).toHaveLength(358));

  it.each(CASES)('%s', async (_id, patch) => {
    const base = settingsOf({ orientation: 'portrait', staff: 'medium', linePolicy: 'original', maxSystems: null, ...patch });
    const s: LayoutSettings = { ...base, marginMm: paperDimensions(base).kind === 'print' ? 12 : 4 };
    const layout = await renderMei(PART, s, [], ctxOf(newToolkit()), rectsOf(s));

    // No error diagnostics covers CAP_EXCEEDED, EVENT_MISSING, CONTENT_CLIPPED, no-convergence and
    // system-too-wide; a right-edge overhang above 0.5 mm shows up as one of those or as CROWDED.
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.diagnostics.filter((d) => d.code === 'CROWDED_ORIGINAL_LINES')).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(0);

    const svg = layout.pages.map((p) => p.svg).join('\n');
    const present = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    // Lyrics: real Liberation Serif widths, 0.3 mm minimum gap (evidence.py's 0.45 em estimate overstates).
    expect(layout.pages.flatMap((p) => lyricCollisions(p.svg, 0.3))).toEqual([]);
    // Word gaps stay readable (>= 1 mm), which the default lyricWordSpace did not give on A5.
    expect(layout.pages.flatMap((p) => lyricCollisions(p.svg, 1.0))).toEqual([]);
    expect(NOTES.filter((id) => !present.has(id))).toEqual([]);
    for (const p of layout.pages) expect(p.systems.length).toBeLessThanOrEqual(s.maxSystems ?? Infinity);
    expect(Math.abs(layout.staffHeightMm - (s.staff === 'small' ? 5.6 : s.staff === 'large' ? 9.6 : 7.2))).toBeLessThanOrEqual(0.1);
  });
});
