import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { measureSvgBounds, sanitizePageSvg } from './svg';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function wrap(inner: string, rootAttrs = ''): string {
  return `<svg viewBox="0 0 840 1188" version="1.1" xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" id="root1" ${rootAttrs}>${inner}</svg>`;
}

const SAFE = wrap(
  '<defs><g id="E050-root1"><path d="M0 0 L10 10" /></g></defs>' +
    '<g id="a" class="note"><use xlink:href="#E050-root1" transform="translate(1, 2)" /></g>' +
    '<path d="M0 0 L5 5" fill="url(#a)" />',
);

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml') as unknown as Document;
}

function allElements(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagName('*'));
}

/** Independent reference checker: parses output, collects ids and checks every reference. */
function allReferencesResolve(svg: string): boolean {
  const doc = parse(svg);
  const els = allElements(doc);
  const ids = new Set<string>();
  for (const el of els) {
    const id = el.getAttribute('id');
    if (id !== null) {
      if (ids.has(id)) return false;
      ids.add(id);
    }
  }
  for (const el of els) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'href' || attr.name === 'xlink:href') {
        if (!attr.value.startsWith('#') || !ids.has(attr.value.slice(1))) return false;
      }
      for (const m of attr.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) {
        if (!ids.has(m[1] ?? '')) return false;
      }
    }
  }
  return true;
}

function idsOf(svg: string): string[] {
  return allElements(parse(svg))
    .map((e) => e.getAttribute('id'))
    .filter((v): v is string => v !== null);
}

function dStrings(svg: string): string[] {
  return Array.from(parse(svg).getElementsByTagName('path')).map((p) => p.getAttribute('d') ?? '');
}

const FIXTURE_DIR = join(__dirname, '__fixtures__');
const KYRIE = readFileSync(join(FIXTURE_DIR, 'kyrie-ix-verovio-page1.svg'), 'utf8');
const S2_DIR = join(__dirname, '..', '..', '..', '..', 'docs', 'superpowers', 'experiments', 's2-assets');

describe('sanitizePageSvg: namespacing', () => {
  it('shares no id between two pages sanitised with different namespaces', () => {
    const p1 = sanitizePageSvg(SAFE, 'p1');
    const p2 = sanitizePageSvg(SAFE, 'p2');
    expect(p1.ids.length).toBeGreaterThan(0);
    expect(p1.ids.some((id) => p2.ids.includes(id))).toBe(false);
    expect(p1.namespace).toBe('p1');
    expect(p1.ids).toEqual(idsOf(p1.svg));
    expect(p1.ids.every((id) => id.startsWith('p1-'))).toBe(true);
  });

  it('resolves every href and url() reference after rewriting', () => {
    const out = sanitizePageSvg(SAFE, 'p1');
    expect(allReferencesResolve(out.svg)).toBe(true);
    expect(out.svg).toContain('xlink:href="#p1-E050-root1"');
    expect(out.svg).toContain('url(#p1-a)');
  });

  it('rewrites plain href as well as xlink:href', () => {
    const out = sanitizePageSvg(wrap('<g id="a"/><use href="#a"/>'), 'q');
    expect(out.svg).toContain('href="#q-a"');
    expect(allReferencesResolve(out.svg)).toBe(true);
  });

  it('throws UNSAFE_SVG for a reference to a missing id', () => {
    expect(() => sanitizePageSvg(wrap('<use xlink:href="#nope"/>'), 'p1')).toThrow(/UNSAFE_SVG: .*missing id/);
    expect(() => sanitizePageSvg(wrap('<path d="M0 0" fill="url(#nope)"/>'), 'p1')).toThrow(
      /UNSAFE_SVG: .*missing id/,
    );
  });

  it('throws UNSAFE_SVG for duplicate ids', () => {
    expect(() => sanitizePageSvg(wrap('<g id="a"/><g id="a"/>'), 'p1')).toThrow(/UNSAFE_SVG: duplicate id/);
  });

  it('rejects an unsafe namespace', () => {
    expect(() => sanitizePageSvg(SAFE, 'p 1"')).toThrow(/UNSAFE_SVG: invalid namespace/);
  });

  it('rewrites id- class tokens so continuation groups stay linked (R7)', () => {
    const out = sanitizePageSvg(
      wrap('<g id="tie1" class="tie"/><g class="tie id-tie1 spanning"/>'),
      'p3',
    );
    expect(out.svg).toContain('class="tie id-p3-tie1 spanning"');
    const doc = parse(out.svg);
    const spanning = allElements(doc).find((e) => (e.getAttribute('class') ?? '').includes('spanning'));
    const token = (spanning?.getAttribute('class') ?? '').split(/\s+/).find((t) => t.startsWith('id-'));
    expect(out.ids).toContain((token ?? '').slice('id-'.length));
  });

  it('rewrites root-id selectors in Verovio style rules', () => {
    const style = '<style type="text/css">#root1 g.dir {font-style:italic;}#root1 path {stroke:currentColor}</style>';
    const out = sanitizePageSvg(wrap(style), 'p1');
    expect(out.svg).toContain('#p1-root1 g.dir');
    expect(out.svg).toContain('#p1-root1 path');
  });
});

describe('sanitizePageSvg: preservation', () => {
  it('keeps accented text unchanged', () => {
    const text = 'Kýrie eléison, Christe eléison — ælfric ǽ ö';
    const out = sanitizePageSvg(wrap(`<text x="1" y="2" font-size="9px">${text}</text>`), 'p1');
    const t = parse(out.svg).getElementsByTagName('text')[0];
    expect(t?.textContent).toBe(text);
  });

  it('preserves visibility and display attributes', () => {
    const out = sanitizePageSvg(
      wrap('<g id="a"/><use xlink:href="#a" visibility="hidden"/><g display="none"/>'),
      'p1',
    );
    expect(out.svg).toContain('visibility="hidden"');
    expect(out.svg).toContain('display="none"');
  });

  it('sanitises the real Kyrie fixture with unchanged geometry', () => {
    const out = sanitizePageSvg(KYRIE, 'p1');
    expect(allReferencesResolve(out.svg)).toBe(true);
    const before = dStrings(KYRIE);
    const after = dStrings(out.svg);
    expect(before.length).toBeGreaterThan(500);
    expect(after.length).toBe(before.length);
    expect(after).toEqual(before);
    expect(out.ids.length).toBe(idsOf(KYRIE).length);
    // transforms and use counts are unchanged too
    const tr = (s: string) => allElements(parse(s)).map((e) => e.getAttribute('transform') ?? '');
    expect(tr(out.svg)).toEqual(tr(KYRIE));
    expect(parse(out.svg).getElementsByTagName('use').length).toBe(parse(KYRIE).getElementsByTagName('use').length);
    // accented lyric text is untouched
    const texts = (s: string) => Array.from(parse(s).getElementsByTagName('text')).map((t) => t.textContent);
    expect(texts(out.svg)).toEqual(texts(KYRIE));
    // continuation groups remain linked
    expect(out.svg).toMatch(/class="tie id-p1-[^ "]+ spanning"/);
  });

  it('sanitises the S2 experiment page (hidden notes, spanning groups) and keeps references resolvable', () => {
    const src = readFileSync(join(S2_DIR, 'kyrie-ix-gliss-letter-medium.svg'), 'utf8');
    const out = sanitizePageSvg(src, 'px');
    expect(allReferencesResolve(out.svg)).toBe(true);
    expect(dStrings(out.svg)).toEqual(dStrings(src));
    const hidden = (s: string) => (s.match(/visibility="hidden"/g) ?? []).length;
    expect(hidden(src)).toBeGreaterThan(0);
    expect(hidden(out.svg)).toBe(hidden(src));
    expect(out.svg).toMatch(/class="gliss id-px-vl2 spanning"/);
  });

  it('rejects the S2 feature-mappings page: it embeds a Leipzig @font-face data: URI (R8)', () => {
    const src = readFileSync(join(S2_DIR, 'feature-mappings.svg'), 'utf8');
    expect(() => sanitizePageSvg(src, 'px')).toThrow(/UNSAFE_SVG: at-rule in style/);
  });
});

describe('sanitizePageSvg: rejects forbidden constructs', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['script', wrap('<script>alert(1)</script>'), /UNSAFE_SVG: forbidden element <script>/],
    ['onload', wrap('<g onload="alert(1)"/>'), /UNSAFE_SVG: event handler attribute onload/],
    ['onclick on root', wrap('', 'onclick="x()"'), /UNSAFE_SVG: event handler attribute onclick/],
    ['foreignObject', wrap('<foreignObject><div/></foreignObject>'), /UNSAFE_SVG: forbidden element <foreignObject>/],
    ['image', wrap('<image xlink:href="#a"/>'), /UNSAFE_SVG: forbidden element <image>/],
    ['iframe', wrap('<iframe/>'), /UNSAFE_SVG: forbidden element <iframe>/],
    ['animate', wrap('<animate attributeName="x"/>'), /UNSAFE_SVG: forbidden element <animate>/],
    ['animateTransform', wrap('<animateTransform/>'), /UNSAFE_SVG: forbidden element <animateTransform>/],
    ['set', wrap('<set attributeName="x"/>'), /UNSAFE_SVG: forbidden element <set>/],
    ['unlisted element', wrap('<filter/>'), /UNSAFE_SVG: element <filter> not allowed/],
    ['external href', wrap('<use xlink:href="https://evil.example/x.svg#a"/>'), /UNSAFE_SVG: external href/],
    ['relative file href', wrap('<use href="other.svg#a"/>'), /UNSAFE_SVG: external href/],
    ['javascript href', wrap('<use xlink:href="javascript:alert(1)"/>'), /UNSAFE_SVG: javascript: href/],
    ['data href', wrap('<use href="data:image/svg+xml,x"/>'), /UNSAFE_SVG: external href/],
    ['href on non-use', wrap('<g id="a"/><path href="#a" d="M0 0"/>'), /UNSAFE_SVG: href on <path>/],
    ['url() attribute external', wrap('<path d="M0 0" fill="url(http://evil.example/x)"/>'), /UNSAFE_SVG: external url\(\)/],
    ['url() in style', wrap('<style>#root1 path {fill:url(http://evil.example/x)}</style>'), /UNSAFE_SVG: external url\(\) in style/],
    ['@import', wrap('<style>@import url(#x);</style>'), /UNSAFE_SVG: @import in style/],
    ['@import bare', wrap('<style>@import "http://evil.example/a.css";</style>'), /UNSAFE_SVG: @import in style/],
    ['style non-allowlisted property', wrap('<style>#root1 path {behavior:foo}</style>'), /UNSAFE_SVG: style property "behavior"/],
    ['style escape', wrap('<style>#root1 path {fill:\\75rl(x)}</style>'), /UNSAFE_SVG: .*style/],
    ['style selector attribute', wrap('<style>path[d] {fill:red}</style>'), /UNSAFE_SVG: style selector/],
    ['style at-rule', wrap('<style>@font-face {fill:red}</style>'), /UNSAFE_SVG: .*style/],
    ['style attribute', wrap('<g style="fill:red"/>'), /UNSAFE_SVG: attribute style/],
    ['unknown attribute', wrap('<g data-x="1"/>'), /UNSAFE_SVG: attribute data-x/],
    ['foreign namespace element', wrap('<x:g xmlns:x="http://example.com/"/>'), /UNSAFE_SVG: .*namespace/],
    ['DOCTYPE', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' + SAFE, /UNSAFE_SVG: DOCTYPE/],
    ['entity', '<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap('<text>&x;</text>'), /UNSAFE_SVG: (DOCTYPE|entity)/],
    ['ENTITY declaration without doctype', wrap('<!ENTITY x "y">'), /UNSAFE_SVG: entity declaration/],
    ['named entity reference', wrap('<text>&nbsp;</text>'), /UNSAFE_SVG: entity reference/],
    ['processing instruction', wrap('<?xml-stylesheet href="a.css"?><g/>'), /UNSAFE_SVG: processing instruction/],
    ['PI after declaration', '<?xml version="1.0"?><?php echo 1 ?>' + SAFE, /UNSAFE_SVG: processing instruction/],
    ['CDATA outside style', wrap('<text><![CDATA[x]]></text>'), /UNSAFE_SVG: CDATA/],
  ];
  it.each(cases)('rejects %s', (_name, svg, re) => {
    expect(() => sanitizePageSvg(svg, 'p1')).toThrow(re);
  });

  it('accepts the XML declaration', () => {
    expect(() => sanitizePageSvg('<?xml version="1.0" encoding="UTF-8"?>\n' + SAFE, 'p1')).not.toThrow();
  });

  it('allows Verovio-style CDATA inside <style>', () => {
    const out = sanitizePageSvg(wrap('<style type="text/css"><![CDATA[#root1 path {stroke:currentColor}]]></style>'), 'p1');
    expect(out.svg).toContain('#p1-root1 path');
  });
});

describe('sanitizePageSvg: malformed input', () => {
  it.each([
    ['unclosed tag', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'],
    ['not xml', 'hello world'],
    ['empty', ''],
    ['mismatched', wrap('<g></path>')],
    ['duplicate attribute', wrap('<g a="1" a="2"/>')],
    ['wrong root', '<html xmlns="http://www.w3.org/1999/xhtml"></html>'],
  ])('gives INVALID_PAGE for %s', (_n, svg) => {
    expect(() => sanitizePageSvg(svg, 'p1')).toThrow(/^INVALID_PAGE: /);
  });
});

describe('measureSvgBounds', () => {
  it('reads physical size from the Verovio definition-scale viewBox (0.01 mm units)', () => {
    const b = measureSvgBounds(sanitizePageSvg(KYRIE, 'p1'));
    expect(b.widthMm).toBeCloseTo(210, 6);
    expect(b.heightMm).toBeCloseTo(297, 6);
    expect(b.contentBBox.xMm).toBeGreaterThanOrEqual(0);
    expect(b.contentBBox.xMm + b.contentBBox.widthMm).toBeLessThanOrEqual(210 + 1e-9);
    expect(b.contentBBox.yMm + b.contentBBox.heightMm).toBeLessThanOrEqual(297 + 1e-9);
  });

  it('uses the 0.1 mm outer viewBox when there is no inner svg', () => {
    const b = measureSvgBounds(sanitizePageSvg(wrap('', '').replace('0 0 840 1188', '0 0 2100 2970'), 'p1'));
    expect(b.widthMm).toBeCloseTo(210, 6);
    expect(b.heightMm).toBeCloseTo(297, 6);
  });

  it('prefers explicit mm width and height on the root', () => {
    const svg = wrap('', '').replace('<svg ', '<svg width="215.9mm" height="279.4mm" ');
    const b = measureSvgBounds(sanitizePageSvg(svg, 'p1'));
    expect(b.widthMm).toBeCloseTo(215.9, 6);
    expect(b.heightMm).toBeCloseTo(279.4, 6);
  });

  it('measures the S2 experiment page', () => {
    const src = readFileSync(join(S2_DIR, 'kyrie-ix-gliss-letter-medium.svg'), 'utf8');
    const b = measureSvgBounds(sanitizePageSvg(src, 'p1'));
    expect(b.widthMm).toBeCloseTo(191.9, 6);
    expect(b.heightMm).toBeCloseTo(255.4, 6);
  });
});
