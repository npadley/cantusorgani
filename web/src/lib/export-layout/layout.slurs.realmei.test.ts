import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import type { BreakOverride, LayoutSettings, SafeBoundary } from './types';

/**
 * A8: LilyPond breaks lines inside slurs in much of the catalogue. The converter now keeps such a source
 * break placeable, so the slur is a control element that spans the break. Verovio must draw it as a piece
 * on each system, and on each page when the break is a page break.
 */
const DIR = join(__dirname, '__fixtures__');
const load = (piece: string): { mei: string; boundaries: SafeBoundary[] } => ({
  mei: readFileSync(join(DIR, `${piece}.mei`), 'utf8'),
  boundaries: JSON.parse(readFileSync(join(DIR, `${piece}.boundaries.json`), 'utf8')) as SafeBoundary[],
});
const attr = (tag: string, name: string): string => new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag)?.[1] ?? '';
const classes = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/\s+/);
const kids = (el: Element): Element[] => { const o: Element[] = []; for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n as Element); return o; };

interface Drawn { readonly noteSystem: Map<string, number>; readonly slurPieces: number }
function drawn(svg: string): Drawn {
  const root = new DOMParser({ onError: () => undefined }).parseFromString(svg, 'text/xml').documentElement!;
  const noteSystem = new Map<string, number>();
  let slurPieces = 0;
  let system = -1;
  const walk = (el: Element): void => {
    const cls = classes(el);
    if ((el.localName ?? el.nodeName) === 'g') {
      if (cls.includes('system') && !cls.includes('bounding-box')) system += 1;
      if (cls.includes('note') && !cls.includes('bounding-box') && el.getAttribute('id')) noteSystem.set(el.getAttribute('id')!, system);
      if (cls.includes('slur') && !cls.includes('bounding-box')) slurPieces += 1;
    }
    for (const c of kids(el)) walk(c);
  };
  walk(root);
  return { noteSystem, slurPieces };
}

describe('slurs across a source line break (A8)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  const render = async (piece: string, overrides: readonly BreakOverride[] = []): Promise<string[]> => {
    const { mei, boundaries } = load(piece);
    const base = settingsOf({ page: 'ipad-13', orientation: 'portrait', staff: 'medium', linePolicy: 'original', maxSystems: null });
    const s: LayoutSettings = { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
    const layout = await renderMei(partOf(mei, boundaries), s, overrides, ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    return layout.pages.map((p) => p.svg);
  };

  it.each(['co-ab-occultis', 'al-dominus-exsultet'])('%s: every slur is drawn, once per system it touches', async (piece) => {
    const { mei } = load(piece);
    const slurs = [...mei.matchAll(/<slur\b[^>]*>/g)].map((m) => ({ start: attr(m[0], 'startid').slice(1), end: attr(m[0], 'endid').slice(1) }));
    const rendered = await render(piece);
    // Hidden continuation heads draw nothing: no augmentation dot (ellipse) inside one.
    expect(rendered.join('\n')).not.toMatch(/class="note split-continuation"[^>]*>\s*<g[^>]*class="dots">\s*<ellipse/);
    const pages = rendered.map(drawn);
    const system = new Map(pages.flatMap((p, i) => [...p.noteSystem].map(([id, s]) => [id, i * 1000 + s] as const)));
    let expected = 0;
    for (const s of slurs) expected += system.get(s.start) === system.get(s.end) ? 1 : 2;
    const crossing = slurs.filter((s) => system.get(s.start) !== system.get(s.end));
    expect(crossing.length).toBeGreaterThan(0); // the fixture really has slurs across a source break
    expect(pages.reduce((n, p) => n + p.slurPieces, 0)).toBeGreaterThanOrEqual(expected);
  });

  it('draws a slur that crosses a forced page break on both pages', async () => {
    const { mei, boundaries } = load('co-ab-occultis');
    const slurs = [...mei.matchAll(/<slur\b[^>]*>/g)].map((m) => ({ start: attr(m[0], 'startid').slice(1), end: attr(m[0], 'endid').slice(1) }));
    const measureOf = (id: string): string => {
      const i = mei.indexOf(`xml:id="${id}"`);
      const before = mei.slice(0, i);
      return /<measure\b[^>]*xml:id="([^"]+)"/g[Symbol.matchAll](before) && [...before.matchAll(/<measure\b[^>]*?xml:id="([^"]+)"/g)].pop()![1]!;
    };
    const target = boundaries.find((b) => b.sourceBreak && slurs.some((s) => measureOf(s.start) === b.measureId && measureOf(s.end) !== b.measureId));
    expect(target).toBeDefined();
    const pages = (await render('co-ab-occultis', [{ boundaryId: target!.id, sourceRevision: 'rev1', kind: 'page' }])).map(drawn);
    expect(pages.length).toBeGreaterThan(1);
    const slur = slurs.find((s) => measureOf(s.start) === target!.measureId && measureOf(s.end) !== target!.measureId)!;
    expect(pages.findIndex((p) => p.noteSystem.has(slur.start))).not.toBe(pages.findIndex((p) => p.noteSystem.has(slur.end)));
    expect(pages.map((p) => p.slurPieces).every((n) => n > 0)).toBe(true);
    // The slur is drawn on both pages: its own element on page one, a copy for the end note on page two.
    const slurId = [...mei.matchAll(/<slur\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'startid') === `#${slur.start}`)!;
    const id = attr(slurId, 'xml:id');
    const svgs = await render('co-ab-occultis', [{ boundaryId: target!.id, sourceRevision: 'rev1', kind: 'page' }]);
    const ids = svgs.map((x) => [...x.matchAll(/<g id="([^"]*)" class="slur"/g)].map((m) => m[1]!));
    expect(ids[0]).toContain(id);
    expect(ids[1]!.some((i) => i.startsWith(id))).toBe(true);
  });
});
