import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
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
const SPACE = 180; // one staff space at unit 9, in 0.01 mm
const BAR = fontkit.create(readFileSync(join(__dirname, '..', '..', '..', 'public', 'fonts', 'export', 'LiberationSerif-Regular.ttf'))).layout('|').glyphs[0]!.bbox;
const UPM = fontkit.create(readFileSync(join(__dirname, '..', '..', '..', 'public', 'fonts', 'export', 'LiberationSerif-Regular.ttf'))).unitsPerEm;

const classes = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/);
function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

interface Tick { readonly id: string; readonly x: number; readonly inkTop: number; readonly inkBottom: number }
interface Staff { readonly system: number; readonly top: number; readonly bottom: number }
interface Page { readonly ticks: Tick[]; readonly staves: Staff[] }

function measure(svg: string): Page {
  const root = new DOMParser({ onError: () => undefined }).parseFromString(svg, 'text/xml').documentElement!;
  const ticks: Tick[] = [];
  const staves: Staff[] = [];
  let system = -1;
  const walk = (el: Element, dx: number, dy: number): void => {
    const name = el.localName ?? el.nodeName;
    const cls = classes(el);
    if (name === 'g') {
      const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?/.exec(el.getAttribute('transform') ?? '');
      if (t) { dx += Number(t[1]); dy += Number(t[2] ?? 0); }
      if (cls.includes('system') && !cls.includes('bounding-box')) system += 1;
      if (cls.includes('staff') && !cls.includes('bounding-box')) {
        const ys = children(el).filter((c) => (c.localName ?? c.nodeName) === 'path')
          .map((p) => /^M-?[\d.]+ (-?[\d.]+) L-?[\d.]+ (-?[\d.]+)$/.exec(p.getAttribute('d') ?? ''))
          .filter((m): m is RegExpExecArray => m !== null && m[1] === m[2]).map((m) => Number(m[1]) + dy);
        const top = Math.min(...ys);
        if (ys.length === 5 && !staves.some((s) => s.system === system && s.top === top)) staves.push({ system, top, bottom: Math.max(...ys) });
      }
      if (cls.includes('dir') && !cls.includes('bounding-box') && el.getAttribute('id')) {
        const text = children(el).find((c) => (c.localName ?? c.nodeName) === 'text');
        const sizes = Array.from(el.getElementsByTagName('tspan')).map((t) => /^([\d.]+)px$/.exec(t.getAttribute('font-size') ?? '')).filter((m) => m && Number(m[1]) > 0).map((m) => Number(m![1]));
        if (text && sizes.length && (text.textContent ?? '').trim() === '|') {
          const size = Math.max(...sizes);
          const y = Number(text.getAttribute('y')) + dy;
          ticks.push({
            id: el.getAttribute('id')!,
            x: Number(text.getAttribute('x')) + dx,
            inkTop: y - (BAR.maxY / UPM) * size,
            inkBottom: y - (BAR.minY / UPM) * size,
          });
        }
      }
    }
    for (const c of children(el)) walk(c, dx, dy);
  };
  walk(root, 0, 0);
  return { ticks, staves };
}

/** Problems: a tick must cross the top line of exactly one staff, be about a space tall, and be paired across staves. */
function tickProblems(pages: readonly string[], expectedIds: readonly string[]): string[] {
  const all = pages.map(measure);
  const ticks = all.flatMap((p) => p.ticks);
  const problems: string[] = [];
  for (const id of expectedIds) if (!ticks.some((t) => t.id === id)) problems.push(`${id}: not drawn`);
  for (const page of all) {
    for (const t of page.ticks) {
      const crossed = page.staves.filter((s) => t.inkTop < s.top && t.inkBottom > s.top);
      if (crossed.length !== 1) problems.push(`${t.id}: crosses the top line of ${crossed.length} staves (ink ${Math.round(t.inkTop)}..${Math.round(t.inkBottom)})`);
      if (t.inkBottom - t.inkTop > 1.4 * SPACE) problems.push(`${t.id}: ${Math.round(t.inkBottom - t.inkTop)} units tall`);
      const centre = (t.inkTop + t.inkBottom) / 2;
      const staff = crossed[0];
      if (staff && Math.abs(centre - staff.top) > 0.5 * SPACE) problems.push(`${t.id}: not centred on the top line`);
    }
    // Both staves of a system carry the tick at the same x.
    const byBase = new Map<string, Tick[]>();
    for (const t of page.ticks) byBase.set(t.id.replace(/s\d+$/, ''), [...(byBase.get(t.id.replace(/s\d+$/, '')) ?? []), t]);
    for (const [base, group] of byBase) {
      if (group.length !== 2) problems.push(`${base}: ${group.length} marks, want one per staff`);
      else if (Math.abs(group[0]!.x - group[1]!.x) > 5) problems.push(`${base}: marks not aligned`);
    }
  }
  return problems;
}

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
    const floated = MEI.replace(/vo="-1\.5"/g, 'vo="1.5"');
    expect(floated).not.toBe(MEI);
    expect(tickProblems(await render(floated, 'ipad-13'), ids).length).toBeGreaterThan(0);
    const dropped = MEI.replace(/<dir\b[^>]*xml:id="cb161s2"[\s\S]*?<\/dir>/, '');
    expect(tickProblems(await render(dropped, 'ipad-13'), ids)).toContain('cb161s2: not drawn');
  });
});
