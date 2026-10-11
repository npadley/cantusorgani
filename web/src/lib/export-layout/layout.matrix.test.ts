import { afterAll, describe, expect, it } from 'vitest';
import { renderMei, validateLayout } from './layout';
import { defaultMarginFor, paperDimensions } from './settings';
import {
  EXPERIMENT, EXPERIMENT_NOTES, errors, rectsOf, settingsOf, ctxOf, useRealVerovio, WASM_TIMEOUT_MS,
} from './__fixtures__/layoutHarness';
import type { LayoutSettings, LinePolicy, Orientation, PagePresetId, StaffSizeId } from './types';

/** Contracts §3 REQUIRED_MATRIX, run against the experiment MEI with real Verovio WASM. */
interface MatrixCase {
  readonly id: string;
  readonly page: PagePresetId;
  readonly customSize?: { readonly widthMm: number; readonly heightMm: number };
  readonly orientation: Orientation;
  readonly staff: StaffSizeId;
  readonly linePolicy: LinePolicy;
  readonly cap: number | null;
}

const CASES: readonly MatrixCase[] = [
  { id: 'letter-p-orig', page: 'letter', orientation: 'portrait', staff: 'medium', linePolicy: 'original', cap: null },
  { id: 'letter-p-auto', page: 'letter', orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', cap: null },
  { id: 'letter-l-orig', page: 'letter', orientation: 'landscape', staff: 'medium', linePolicy: 'original', cap: null },
  { id: 'a4-p-orig', page: 'a4', orientation: 'portrait', staff: 'medium', linePolicy: 'original', cap: null },
  { id: 'a4-l-auto', page: 'a4', orientation: 'landscape', staff: 'medium', linePolicy: 'automatic', cap: null },
  { id: 'a5-p-auto', page: 'a5', orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', cap: null },
  { id: 'a5-l-orig', page: 'a5', orientation: 'landscape', staff: 'medium', linePolicy: 'original', cap: null },
  { id: 'letter-p-large-auto', page: 'letter', orientation: 'portrait', staff: 'large', linePolicy: 'automatic', cap: null },
  { id: 'letter-p-small-cap2', page: 'letter', orientation: 'portrait', staff: 'small', linePolicy: 'automatic', cap: 2 },
  { id: 'ipad11-p-auto', page: 'ipad-11', orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', cap: null },
  { id: 'ipad11-l-large-auto', page: 'ipad-11', orientation: 'landscape', staff: 'large', linePolicy: 'automatic', cap: null },
  { id: 'ipadmini-p-auto', page: 'ipad-mini', orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', cap: null },
  {
    id: 'custom-160x230-auto', page: 'custom', customSize: { widthMm: 160, heightMm: 230 },
    orientation: 'portrait', staff: 'medium', linePolicy: 'automatic', cap: null,
  },
];

const STAFF_MM: Readonly<Record<StaffSizeId, number>> = { small: 5.6, medium: 7.2, large: 9.6 };
const FORBIDDEN = ['CAP_EXCEEDED', 'CONTENT_CLIPPED', 'EVENT_MISSING'];

function settingsFor(c: MatrixCase): LayoutSettings {
  const base = settingsOf({
    page: c.page, customSize: c.customSize ?? null, orientation: c.orientation,
    staff: c.staff, linePolicy: c.linePolicy, maxSystems: c.cap,
  });
  return { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
}

describe('layout matrix regression (Contracts section 3, real Verovio WASM)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  const summary: { case: string; pages: number; systems: number; staffMm: number; ms: number }[] = [];

  afterAll(() => {
    console.table(summary);
  });

  it('covers exactly the 13 required cases', () => {
    expect(CASES).toHaveLength(13);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(13);
    expect(EXPERIMENT_NOTES.size).toBe(358);
  });

  it.each(CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const s = settingsFor(c);
    const rects = rectsOf(s);
    const t0 = performance.now();
    const layout = await renderMei(EXPERIMENT, s, [], ctxOf(newToolkit()), rects);
    const ms = Math.round(performance.now() - t0);
    const allSystems = layout.pages.flatMap((p) => p.systems);
    summary.push({ case: c.id, pages: layout.pages.length, systems: allSystems.length, staffMm: Number(layout.staffHeightMm.toFixed(3)), ms });

    // No error diagnostics, and in particular none of the three clip/cap/missing codes.
    expect(errors(layout.diagnostics), c.id).toEqual([]);
    expect(layout.diagnostics.map((d) => d.code).filter((code) => FORBIDDEN.includes(code)), c.id).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(0);

    // All 358 note ids are present across the pages' SVGs.
    const svgText = layout.pages.map((p) => p.svg).join('\n');
    const present = new Set([...svgText.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    const missing = [...EXPERIMENT_NOTES].filter((id) => !present.has(id));
    expect(missing, `${c.id} missing note ids`).toEqual([]);
    expect(EXPERIMENT_NOTES.size).toBe(358);

    // Cap honoured on every page.
    if (c.cap !== null) for (const p of layout.pages) expect(p.systems.length).toBeLessThanOrEqual(c.cap);

    // Staff height matches the staff size.
    expect(Math.abs(layout.staffHeightMm - STAFF_MM[c.staff]), c.id).toBeLessThanOrEqual(0.1);

    // Independent re-validation of the finished layout.
    expect(validateLayout(layout, {
      page: paperDimensions(s), usable: rects.content, maxSystems: s.maxSystems, staffHeightMm: STAFF_MM[c.staff],
      requiredBreaks: layout.effectiveBreaks.breaks, expectedEventIds: EXPERIMENT_NOTES,
    }), c.id).toEqual([]);

    // Pages are separate: one distinct complete SVG each, no bounding boxes, systems inside the content rect.
    expect(new Set(layout.pages.map((p) => p.svg)).size).toBe(layout.pages.length);
    const widthDm = Math.floor(rects.content.widthMm * 10);
    for (const p of layout.pages) {
      expect(p.svg).toContain(`viewBox="0 0 ${widthDm} `);
      expect(p.svg).not.toContain('bounding-box');
      expect(p.systems.length).toBeGreaterThan(0);
      for (const sys of p.systems) expect(sys.topMm + sys.heightMm).toBeLessThanOrEqual(rects.content.heightMm + 0.05);
    }
  });
});
