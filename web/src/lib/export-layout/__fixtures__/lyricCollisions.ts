import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { create as createFont } from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';

/**
 * Measures adjacent lyric syllables on a laid-out Verovio page with REAL text widths
 * (fontkit + Liberation Serif Regular), instead of the 0.45 em estimate in evidence.py.
 * Verovio gives lyric text no bounding box, so boxes are rebuilt from each <text>.
 */
let font: Font | undefined;
const liberation = (): Font => {
  font ??= createFont(readFileSync(join(__dirname, '..', '..', '..', '..', 'public', 'fonts', 'export', 'LiberationSerif-Regular.ttf')));
  return font;
};

export interface LyricBox { readonly text: string; readonly system: number; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
export interface LyricCollision { readonly a: string; readonly b: string; readonly gapMm: number }

const classes = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/);
const kids = (el: Element): Element[] => { const o: Element[] = []; for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n as Element); return o; };

/** Boxes in mm (page-relative), one per lyric <text>. */
export function lyricBoxes(svg: string): LyricBox[] {
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(svg, 'text/xml');
  const root = doc.documentElement!;
  const inner = kids(root).find((c) => classes(c).includes('definition-scale'))!;
  const vb = (inner.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const mm = Number(root.getAttribute('viewBox')!.split(/\s+/)[2]) / 10 / vb[2]!;
  const out: LyricBox[] = [];
  let systems = -1;
  const walk = (el: Element, dx: number, dy: number, system: number): void => {
    const name = el.localName ?? el.nodeName;
    const cls = classes(el);
    if (name === 'g') {
      const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?/.exec(el.getAttribute('transform') ?? '');
      if (t) { dx += Number(t[1]); dy += Number(t[2] ?? 0); }
      if (cls.includes('system') && !cls.includes('bounding-box')) system = ++systems;
    }
    if (name === 'text' && el.parentNode && classes(el.parentNode as Element).includes('syl')) {
      const sizes = [...Array.from(el.getElementsByTagName('tspan'))].map((t) => /^([\d.]+)px$/.exec(t.getAttribute('font-size') ?? '')).filter((m) => m && Number(m[1]) > 0).map((m) => Number(m![1]));
      const content = (el.textContent ?? '').trim();
      if (content && sizes.length) {
        const size = Math.max(...sizes);
        const f = liberation();
        const width = (f.layout(content).glyphs.reduce((a, g) => a + g.advanceWidth, 0) / f.unitsPerEm) * size;
        const x = Number(el.getAttribute('x')) + dx;
        const y = Number(el.getAttribute('y')) + dy;
        const anchor = el.getAttribute('text-anchor');
        const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
        out.push({ text: content, system, left: left * mm, right: (left + width) * mm, top: (y - 0.8 * size) * mm, bottom: (y + 0.2 * size) * mm });
      }
    }
    for (const c of kids(el)) walk(c, dx, dy, system);
  };
  walk(root, 0, 0, -1);
  return out;
}

/** Pairs on one system whose boxes overlap vertically and sit closer than `minGapMm` horizontally. */
export function lyricCollisions(svg: string, minGapMm = 0.3): LyricCollision[] {
  const bySystem = new Map<number, LyricBox[]>();
  for (const b of lyricBoxes(svg)) bySystem.set(b.system, [...(bySystem.get(b.system) ?? []), b]);
  const found: LyricCollision[] = [];
  for (const boxes of bySystem.values()) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!; const b = boxes[j]!;
        if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 0) continue;
        const gap = Math.max(a.left, b.left) - Math.min(a.right, b.right);
        if (gap < minGapMm) found.push({ a: a.text, b: b.text, gapMm: Math.round(gap * 1000) / 1000 });
      }
    }
  }
  return found;
}
