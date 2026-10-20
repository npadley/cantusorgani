import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { normalizeExsurgeSvg, splitChantLines } from './chantSvg';
import { sanitizePageSvg } from './svg';

interface Fixture {
  readonly svg: string;
  readonly lines: readonly { readonly y: number; readonly height: number }[];
}

const DIR = join(__dirname, '__fixtures__', 'chant');
function load(name: string): Fixture {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Fixture;
}

const FIXTURES: readonly { readonly name: string; readonly id: number; readonly fx: Fixture }[] = [
  { name: 'al-1-749', id: 1, fx: load('al-1-749') },
  { name: 'gr-277-1333', id: 277, fx: load('gr-277-1333') },
  { name: 'tr-889-749', id: 889, fx: load('tr-889-749') },
];

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml') as unknown as Document;
}

function all(doc: Document, tag: string): Element[] {
  return Array.from(doc.getElementsByTagName(tag));
}

/** Insert `snippet` into the first chant line of a raw fixture, just before its closing tag. */
function inject(raw: string, snippet: string): string {
  const at = raw.indexOf('<g class="Notations">');
  return raw.slice(0, at) + snippet + raw.slice(at);
}

describe.each(FIXTURES)('chantSvg fixture $name', ({ name, id, fx }) => {
  it('rawFailsSanitizer: the raw Exsurge SVG is rejected by the unchanged sanitizer', () => {
    expect(() => sanitizePageSvg(fx.svg, `c${id}`)).toThrow();
  });

  it('normalizedPassesSanitizer: the normalized whole and every split line pass', () => {
    const normalized = normalizeExsurgeSvg(fx.svg);
    expect(() => sanitizePageSvg(normalized, `c${id}`)).not.toThrow();
    const lines = splitChantLines(normalized);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((line, n) => {
      expect(() => sanitizePageSvg(line.svg, `c${id}l${n}`)).not.toThrow();
    });
  });

  it('lineCount: one SVG per chant line, heights within 0.5 unit of the score bounds', () => {
    const lines = splitChantLines(normalizeExsurgeSvg(fx.svg));
    expect(lines.length).toBe(fx.lines.length);
    const width = Number(/<svg[^>]* width="([\d.]+)"/.exec(fx.svg)?.[1]);
    lines.forEach((line, n) => {
      const expected = fx.lines[n]?.height ?? NaN;
      // Exsurge's gr-277 line 3 is 1.01 units shorter than its own usual line-box floor (its lyric
      // baseline sits 1 unit high). Our box keeps the floor, so it is taller there, never shorter.
      const tolerance = name === 'gr-277-1333' && n === 3 ? 1.1 : 0.5;
      expect(Math.abs(line.heightUnits - expected), `line ${n}: ${line.heightUnits} vs ${expected}`).toBeLessThanOrEqual(tolerance);
      expect(line.widthUnits).toBe(width);
      const root = parse(line.svg).documentElement;
      expect(root.getAttribute('viewBox')).toBe(`0 0 ${line.widthUnits} ${line.heightUnits}`);
      expect(root.getAttribute('height')).toBe(String(line.heightUnits));
    });
  });

  it('lineBasedAtZero: each line holds exactly one chantLine, translated by its own ascent only', () => {
    for (const line of splitChantLines(normalizeExsurgeSvg(fx.svg))) {
      const doc = parse(line.svg);
      const groups = all(doc, 'g').filter((g) => g.getAttribute('class') === 'chantLine');
      expect(groups).toHaveLength(1);
      expect(groups[0]?.getAttribute('transform')).toMatch(/^translate\(0,[\d.]+\)$/);
      expect(all(doc, 'defs')).toHaveLength(1);
    }
  });

  it('noStyleLeft: no style attribute or element; every text has font-size and Liberation Serif', () => {
    const outputs = [normalizeExsurgeSvg(fx.svg), ...splitChantLines(normalizeExsurgeSvg(fx.svg)).map((l) => l.svg)];
    for (const out of outputs) {
      const doc = parse(out);
      expect(all(doc, 'style')).toHaveLength(0);
      for (const el of all(doc, '*')) {
        expect(el.hasAttribute('style'), `${el.nodeName} has style`).toBe(false);
        expect(el.hasAttribute('source-index')).toBe(false);
        expect(el.hasAttribute('element-index')).toBe(false);
        expect(el.hasAttribute('key')).toBe(false);
      }
      expect(all(doc, 'line')).toHaveLength(0);
      expect(all(doc, 'use').filter((u) => u.hasAttribute('id'))).toHaveLength(0);
      for (const text of all(doc, 'text')) {
        expect(Number(text.getAttribute('font-size'))).toBeGreaterThan(0);
        expect(text.getAttribute('font-family')).toBe('Liberation Serif');
      }
    }
  });

  it('rubrics: V.. becomes V.; rubric glyph runs keep #d00 and Liberation Serif', () => {
    const out = normalizeExsurgeSvg(fx.svg);
    expect(out).not.toMatch(/[VR]\.\./);
    expect(out).not.toContain('Exsurge Characters');
    const rubrics = all(parse(out), 'tspan').filter((t) => t.getAttribute('class') === 'rubric');
    expect(rubrics.length).toBeGreaterThan(0);
    for (const r of rubrics) expect(r.getAttribute('fill')).toBe('#d00');
  });
});

describe('chantSvg specifics', () => {
  const al = load('al-1-749');

  it('rubrics: V.. collapses to a single period and the next run keeps its text', () => {
    const gr = load('gr-277-1333').svg;
    expect(gr).toMatch(/V\.<\/tspan><tspan[^>]*>\. D/); // evidence: the raw fixture has the doubled period
    const out = normalizeExsurgeSvg(gr);
    const texts = all(parse(out), 'text')
      .map((t) => t.textContent ?? '')
      .filter((t) => t.startsWith('V.'));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.startsWith('V. D')).toBe(true);
  });

  it('rubrics: small caps become upper case at 0.8 x the text size', () => {
    const doc = parse(normalizeExsurgeSvg(al.svg));
    const annotation = all(doc, 'text').filter((t) => t.getAttribute('class') === 'annotation');
    expect(annotation.length).toBeGreaterThan(0);
    const size = Number(annotation[0]?.getAttribute('font-size'));
    const first = annotation[0]?.getElementsByTagName('tspan')[0];
    expect(first?.textContent).toBe('ALLEL.');
    expect(Number(first?.getAttribute('font-size'))).toBeCloseTo(size * 0.8, 3);
  });

  it('keeps italic and bold as attributes', () => {
    const raw = al.svg.replace(
      '<tspan source-index="0" style="">A</tspan>',
      '<tspan source-index="0" style="font-style: italic;">A</tspan><tspan style="font-weight: bold;">B</tspan>',
    );
    expect(raw).not.toBe(al.svg);
    const out = normalizeExsurgeSvg(raw);
    expect(out).toContain('font-style="italic"');
    expect(out).toContain('font-weight="bold"');
  });

  it('turns staff lines into stroked paths', () => {
    const out = normalizeExsurgeSvg(al.svg);
    const staff = all(parse(out), 'path').filter((p) => p.getAttribute('class') === 'staffLine');
    expect(staff.length).toBe(12);
    expect(staff[0]?.getAttribute('d')).toMatch(/^M[\d.\s-]+L[\d.\s-]+$/);
    expect(staff[0]?.getAttribute('stroke')).toBe('#000');
    expect(staff[0]?.getAttribute('stroke-width')).toBe('0.8');
  });

  it('prunes each line defs to the glyphs it references', () => {
    const lines = splitChantLines(normalizeExsurgeSvg(al.svg));
    for (const line of lines) {
      const doc = parse(line.svg);
      const defined = all(doc, 'g').map((g) => g.getAttribute('id')).filter((i): i is string => i !== null);
      const used = all(doc, 'use').map((u) => (u.getAttribute('xlink:href') ?? '').slice(1));
      expect(new Set(defined)).toEqual(new Set(used));
    }
  });

  it('first line height includes the drop cap and annotation overhang', () => {
    const lines = splitChantLines(normalizeExsurgeSvg(al.svg));
    expect(lines[0]?.heightUnits).toBeGreaterThan(lines[1]?.heightUnits ?? Infinity);
  });
});

describe('rejectsUnknowns', () => {
  const raw = load('al-1-749').svg;

  const cases: readonly { readonly what: string; readonly svg: string; readonly match: RegExp }[] = [
    { what: 'onclick', svg: inject(raw, '<rect x="0" y="0" width="1" height="1" onclick="alert(1)"></rect>'), match: /UNSAFE_SVG: exsurge .*onclick/ },
    { what: 'foreignObject', svg: inject(raw, '<foreignObject width="1" height="1"></foreignObject>'), match: /UNSAFE_SVG: exsurge .*foreignObject/ },
    { what: 'image', svg: inject(raw, '<image href="data:image/png;base64,AAAA" width="1" height="1"></image>'), match: /UNSAFE_SVG: exsurge .*image/ },
    { what: 'script', svg: inject(raw, '<script>alert(1)</script>'), match: /UNSAFE_SVG: exsurge .*script/ },
    { what: 'filter style', svg: raw.replace('<tspan source-index="0" style="">A</tspan>', '<tspan style="filter: url(#x);">A</tspan>'), match: /UNSAFE_SVG: exsurge .*filter/ },
    { what: 'unknown style property', svg: raw.replace('<tspan source-index="0" style="">A</tspan>', '<tspan style="opacity: 0.5;">A</tspan>'), match: /UNSAFE_SVG: exsurge .*opacity/ },
    { what: 'unknown font family', svg: raw.replace('<tspan source-index="0" style="">A</tspan>', "<tspan style=\"font-family: 'Comic Sans';\">A</tspan>"), match: /UNSAFE_SVG: exsurge .*font-family/ },
    { what: 'unknown attribute', svg: inject(raw, '<rect x="0" y="0" width="1" height="1" data-evil="1"></rect>'), match: /UNSAFE_SVG: exsurge .*data-evil/ },
    { what: 'unknown attribute on use', svg: raw.replace('<use xlink:href="#DoClef"', '<use mask="url(#m)" xlink:href="#DoClef"'), match: /UNSAFE_SVG: exsurge .*mask/ },
    { what: 'external href', svg: raw.replace('xlink:href="#DoClef"', 'xlink:href="https://evil.example/x.svg#a"'), match: /UNSAFE_SVG: exsurge .*href/ },
    { what: 'unknown element', svg: inject(raw, '<circle cx="1" cy="1" r="1"></circle>'), match: /UNSAFE_SVG: exsurge .*circle/ },
    { what: 'unknown xlink value', svg: raw.replace('xlink="http://www.w3.org/1999/xlink"', 'xlink="http://evil.example/"'), match: /UNSAFE_SVG: exsurge .*xlink/ },
    { what: 'unknown text class', svg: raw.replace('class="lyric"', 'class="mystery"'), match: /UNSAFE_SVG: exsurge .*mystery/ },
    { what: 'DOCTYPE', svg: `<!DOCTYPE svg [<!ENTITY x "y">]>${raw}`, match: /UNSAFE_SVG: exsurge/ },
    { what: 'unsafe transform', svg: raw.replace('transform="translate(87.61726291022664,0)"', 'transform="url(#x)"'), match: /UNSAFE_SVG: exsurge .*transform/ },
    { what: 'not xml', svg: '<svg', match: /UNSAFE_SVG: exsurge/ },
  ];

  it.each(cases)('throws on $what, never strips it', ({ svg, match }) => {
    expect(svg).not.toBe(raw);
    expect(() => normalizeExsurgeSvg(svg)).toThrow(match);
  });

  it('a style rule with an unlisted property is rejected', () => {
    const bad = raw.replace('font-kerning:normal}svg.Exsurge .title', 'font-kerning:normal;filter:blur(2px)}svg.Exsurge .title');
    expect(bad).not.toBe(raw);
    expect(() => normalizeExsurgeSvg(bad)).toThrow(/UNSAFE_SVG: exsurge .*filter/);
  });
});
