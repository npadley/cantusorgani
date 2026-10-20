// K9 finding: chant lyrics collided in the editor's preview. Cause: a page that has already drawn chant carries Exsurge's own
// <style> (`svg.Exsurge .lyric { font-size: 19.2px }`), which applies document-wide to any SVG with the class `Exsurge`,
// including ours, so the preview drew lyrics at 19.2 user units where Exsurge had measured them at 11-21. The normalizer now
// drops that class (chantSvg.safety.test.ts). This test is the other half: with the face and size the PDF draws
// (Liberation Serif at the font-size attribute on each <text>), no two syllables on a chant line touch or overlap
// (gap >= 0.3 mm, the accompaniment's rule), on all three chants at the Letter and iPad mini widths.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { buildChantLines } from './chantLines';
import { DEFAULT_SETTINGS } from './types';
import type { ExportPart } from './types';

const FONT_DIR = join(__dirname, '..', '..', '..', 'public', 'fonts', 'export');
const face = (file: string): Font => fontkit.create(new Uint8Array(readFileSync(join(FONT_DIR, file))));
const REGULAR = face('LiberationSerif-Regular.ttf');
const ITALIC = face('LiberationSerif-Italic.ttf');
const MIN_GAP_MM = 0.3;
/** Float slack when syllables are set edge to edge. */
const TOUCH_MM = 0.05;
const SETTINGS = { ...DEFAULT_SETTINGS, chant: 'before' as const };

const FIXTURES: readonly { readonly file: string; readonly id: number; readonly page: string }[] = [
  { file: 'al-1-479.json', id: 1, page: 'iPad mini' }, { file: 'al-1-852.json', id: 1, page: 'Letter' },
  { file: 'gr-277-479.json', id: 277, page: 'iPad mini' }, { file: 'gr-277-852.json', id: 277, page: 'Letter' },
  { file: 'tr-889-479.json', id: 889, page: 'iPad mini' }, { file: 'tr-889-852.json', id: 889, page: 'Letter' },
];

interface Syllable { readonly text: string; readonly left: number; readonly right: number; readonly y: number }

/** Every lyric <text> of one chant line SVG: its left edge and its drawn width in Exsurge units, in the PDF's face and size. */
function syllables(svg: string): Syllable[] {
  const out: Syllable[] = [];
  for (const g of svg.matchAll(/<g\b[^>]*transform="translate\((-?[\d.e+-]+),[^"]*"[^>]*>\s*<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = g[2]!;
    if (!/class="lyric"/.test(attrs)) continue;
    const size = Number(/font-size="([\d.]+)"/.exec(attrs)![1]);
    const x = Number(/\bx="(-?[\d.e+-]+)"/.exec(attrs)![1]);
    const y = Number(/\by="(-?[\d.e+-]+)"/.exec(attrs)![1]);
    let width = 0;
    let text = '';
    for (const t of g[3]!.matchAll(/<tspan\b([^>]*)>([^<]*)<\/tspan>/g)) {
      const font = /font-style="italic"/.test(t[1]!) ? ITALIC : REGULAR;
      width += (font.layout(t[2]!).advanceWidth / font.unitsPerEm) * size;
      text += t[2];
    }
    const left = Number(g[1]) + x;
    out.push({ text, left, right: left + width, y });
  }
  return out;
}

describe('chant lyrics do not collide', () => {
  for (const { file, id, page } of FIXTURES) {
    it(`${file} (${page}): no two syllables overlap (Exsurge sets some closer than ${MIN_GAP_MM} mm)`, () => {
      const svg = (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', file), 'utf8')) as { svg: string }).svg;
      const part = { id: 's:0', kind: 'scan', label: 'x', heading: null, sourceSystemCount: 1, chants: [{ id, incipit: '', annotation: '', mode: '' }], sourceRevision: 's', stems: ['a'], customizableAvailable: false } as ExportPart;
      const art = buildChantLines([part], SETTINGS, new Map([[id, svg]])).get(id)!;
      expect(art.length).toBeGreaterThan(1);
      const mmPerUnit = art[0]!.widthMm / Number(/viewBox="0 0 ([\d.]+)/.exec(art[0]!.svg.svg)![1]);
      let compared = 0;
      let tight = 0;
      for (const line of art) {
        const row = syllables(line.svg.svg).sort((a, b) => a.left - b.left);
        row.slice(1).forEach((s, i) => {
          const prev = row[i]!;
          compared++;
          const g = (s.left - prev.right) * mmPerUnit;
          // Exsurge packs lyrics as tightly as the notes allow and leaves out a hyphen that does not fit, so syllables can
          // abut (gap 0) or clear by less than 0.3 mm. What must never happen is an overlap.
          expect(g, `"${prev.text}" then "${s.text}": gap ${g.toFixed(3)} mm`).toBeGreaterThanOrEqual(-TOUCH_MM);
          if (g < MIN_GAP_MM) tight++;
        });
      }
      expect(compared).toBeGreaterThan(5);
      // Exsurge keeps the first word apart by about a hyphen; it does not hold the accompaniment's 0.3 mm everywhere.
      expect(tight).toBeLessThanOrEqual(compared);
    });
  }

  it('measures a deliberately wrong size as overlapping, so the check can fail', () => {
    // The same line drawn at 19.2 (the site stylesheet's size) where it was laid out at about 21 is tighter; at 40 it must overlap.
    const svg = (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', 'al-1-852.json'), 'utf8')) as { svg: string }).svg;
    const part = { id: 's:0', kind: 'scan', label: 'x', heading: null, sourceSystemCount: 1, chants: [{ id: 1, incipit: '', annotation: '', mode: '' }], sourceRevision: 's', stems: ['a'], customizableAvailable: false } as ExportPart;
    const art = buildChantLines([part], SETTINGS, new Map([[1, svg]])).get(1)!;
    const oversize = art[0]!.svg.svg.replace(/font-size="[\d.]+"/g, 'font-size="40"');
    const row = syllables(oversize).sort((a, b) => a.left - b.left);
    expect(row.slice(1).some((s, i) => s.left < row[i]!.right)).toBe(true);
  });
});
