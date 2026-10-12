import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import fontkit from '@pdf-lib/fontkit';

/** Geometry of the divisio minima ticks on rendered pages (A5f/A5g), shared by the per-piece render tests. */
export const SPACE = 180; // one staff space at unit 9, in 0.01 mm
const FONT = fontkit.create(readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'public', 'fonts', 'export', 'LiberationSerif-Regular.ttf')));
const BAR = FONT.layout('|').glyphs[0]!.bbox;
const UPM = FONT.unitsPerEm;

const classes = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/);
function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}

export interface Tick { readonly id: string; readonly x: number; readonly inkTop: number; readonly inkBottom: number }
export interface Staff { readonly system: number; readonly top: number; readonly bottom: number }
export interface Page { readonly ticks: Tick[]; readonly staves: Staff[] }

export function measure(svg: string): Page {
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
export function tickProblems(pages: readonly string[], expectedIds: readonly string[]): string[] {
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

