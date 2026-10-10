import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { measureSvgPage } from './svgGeometry';
import { paperDimensions, usableRect, verovioOptions } from './settings';
import { DEFAULT_SETTINGS } from './types';
import type { SystemGeometry } from './types';

const FIXTURES = join(__dirname, '__fixtures__');
const pass1Fixture = JSON.parse(readFileSync(join(FIXTURES, 's2-pass1-letter-medium.json'), 'utf8')) as SystemGeometry[];
const MEI = readFileSync(join(FIXTURES, 'kyrie-ix-experiment.mei'), 'utf8');

/** Hand-made Verovio-shaped page: outer viewBox in 0.1 mm, inner in 0.01 mm. Units below are inner units. */
function page(body: string, opts: { widthMm?: number; heightMm?: number; translate?: string } = {}): string {
  const w = (opts.widthMm ?? 100) * 10;
  const h = (opts.heightMm ?? 200) * 10;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 ${w} ${h}">
<svg class="definition-scale" color="#000" viewBox="0 0 ${w * 10} ${h * 10}">
<g class="page-margin" transform="${opts.translate ?? 'translate(0, 0)'}">${body}</g></svg></svg>`;
}
const staff = (top: number, step = 180): string =>
  `<g class="staff">${[0, 1, 2, 3, 4].map((i) => `<path d="M0 ${top + i * step} L9000 ${top + i * step}" stroke-width="13"/>`).join('')}</g>`;
const bbox = (cls: string, x: number, y: number, w: number, h: number): string =>
  `<g id="bbox-${cls}${x}${y}" class="${cls} bounding-box"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></g>`;
const system = (id: string, measureId: string, top: number, extra = ''): string =>
  `<g id="${id}" class="system">${bbox('system', 0, top - 100, 9000, 1000)}<g id="${measureId}" class="measure">${staff(top)}<g id="n-${measureId}" class="note"/>${extra}</g></g>`;

describe('measureSvgPage (hand-made SVG)', () => {
  it('converts inner units to mm (0.01 mm per unit at scale 100) and reads systems, notes and staff heights', () => {
    const svg = page(system('s1', 'm001', 1000) + system('s2', 'm005', 5000));
    const m = measureSvgPage(svg);
    expect(m.mmPerUnit).toBeCloseTo(0.01, 6);
    expect(m.widthMm).toBe(100);
    expect(m.heightMm).toBe(200);
    expect(m.systems.map((s) => s.firstMeasureId)).toEqual(['m001', 'm005']);
    expect(m.systems[0]).toMatchObject({ staffTopMm: 10, staffBottomMm: 17.2, topMm: 9, heightMm: 10 });
    expect(m.staffHeightsMm).toEqual([7.2, 7.2].map((x) => expect.closeTo(x, 6)));
    expect([...m.noteIds].sort()).toEqual(['n-m001', 'n-m005']);
  });

  it('adds the page-margin translate to horizontal positions only', () => {
    const svg = page(system('s1', 'm001', 1000), { translate: 'translate(270, 0)' });
    const s = measureSvgPage(svg).systems[0]!;
    expect(s.minXMm).toBeCloseTo(2.7, 6);
    expect(s.maxXMm).toBeCloseTo(92.7, 6);
  });

  it('falls back to the staff band when there are no bounding boxes', () => {
    const svg = page(`<g id="s1" class="system"><g id="m001" class="measure">${staff(2000)}</g></g>`);
    const s = measureSvgPage(svg).systems[0]!;
    expect(s.topMm).toBeCloseTo(20, 6);
    expect(s.heightMm).toBeCloseTo(7.2, 6);
  });

  it('ignores milestone bounding boxes', () => {
    const svg = page(
      `<g id="a" class="mdiv pageMilestone">${bbox('mdiv', 0, 0, 9000, 19000)}</g>` +
        `<g id="s1" class="system"><g id="m001" class="measure">${staff(2000)}</g></g>`,
    );
    expect(measureSvgPage(svg).systems[0]!.heightMm).toBeCloseTo(7.2, 6);
  });

  it('assigns a spanner box that spills into the next system to the nearest staff band (R3)', () => {
    // A tie starting in system 1 whose continuation rect (centre y = 5400) lies in system 2's band.
    const tie = bbox('tie', 100, 4800, 800, 1200);
    const svg = page(system('s1', 'm001', 1000, tie) + system('s2', 'm005', 5000));
    const m = measureSvgPage(svg);
    expect(m.systems[0]!.heightMm).toBeLessThan(12);
    expect(m.systems[1]!.topMm + m.systems[1]!.heightMm).toBeGreaterThanOrEqual(60);
  });

  it('rejects malformed or foreign SVG', () => {
    expect(() => measureSvgPage('<svg><g></svg>')).toThrow(/SVG_PARSE_ERROR/);
    expect(() => measureSvgPage('<html/>')).toThrow(/SVG_PARSE_ERROR/);
    expect(() => measureSvgPage('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(/SVG_PARSE_ERROR/);
  });
});

describe('measureSvgPage (Verovio 6.3.0, WASM)', () => {
  it('reproduces the checked-in S2 pass-1 fixture for Letter portrait, medium, original lines', async () => {
    const tk = new VerovioToolkit(await createVerovioModule());
    try {
      const content = usableRect(paperDimensions(DEFAULT_SETTINGS), DEFAULT_SETTINGS.marginMm);
      tk.setOptions({
        ...verovioOptions(DEFAULT_SETTINGS, content),
        pageHeight: 60000,
        justifyVertically: false,
        svgBoundingBoxes: true,
        breaks: 'line',
      });
      expect(tk.loadData(MEI)).toBeTruthy();
      expect(tk.getPageCount()).toBe(1);
      const m = measureSvgPage(tk.renderToSVG(1));
      expect(m.systems).toHaveLength(pass1Fixture.length);
      m.systems.forEach((s, i) => {
        const want = pass1Fixture[i]!;
        expect(s.topMm).toBeCloseTo(want.topMm, 1);
        expect(s.heightMm).toBeCloseTo(want.heightMm, 1);
        // Fixture ids are synthetic: the boundary after measure mNNN is bNNN.
        const n = Number(s.firstMeasureId.slice(1));
        expect(n <= 1 ? null : `b${String(n - 1).padStart(3, '0')}`).toBe(want.firstBoundaryId);
      });
      expect(m.systems.every((s) => s.maxXMm - content.widthMm < 0.5 && s.minXMm >= 0)).toBe(true);
      m.staffHeightsMm.forEach((h) => expect(h).toBeCloseTo(7.2, 1));
      expect(m.noteIds.size).toBe([...MEI.matchAll(/<note\b[^>]*?\sxml:id="/g)].length);
    } finally {
      tk.destroy();
    }
  });

  it('reads the checked-in Verovio page-1 SVG without bounding boxes', () => {
    const m = measureSvgPage(readFileSync(join(FIXTURES, 'kyrie-ix-verovio-page1.svg'), 'utf8'));
    expect(m.systems.length).toBeGreaterThan(0);
    expect(m.systems[0]!.measureIds.length).toBeGreaterThan(0);
    expect(m.noteIds.size).toBeGreaterThan(0);
    expect(m.staffHeightsMm.length).toBeGreaterThan(0);
  });
});
