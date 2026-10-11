import { describe, expect, it } from 'vitest';
import { renderMei, validateLayout } from './layout';
import type { PageRects } from './layout';
import { paperDimensions } from './settings';
import {
  ctxOf, errors, EXPERIMENT, EXPERIMENT_MEI, EXPERIMENT_NOTES, experimentBoundaries, pad, partOf, rectsOf,
  settingsOf, useRealVerovio, WASM_TIMEOUT_MS,
} from './__fixtures__/layoutHarness';
import type {
  BreakOverride,
  LayoutConstraints,
  LayoutDiagnostic,
  LayoutSettings,
  MeiLayout,
  SafeBoundary,
  VerovioLike,
} from './types';

// ============================================================ fake toolkit ===

type Options = Record<string, string | number | boolean>;

interface FakeConfig {
  /** All measure ids in document order; every measure holds one note `n-<measure id>`. */
  readonly measures: readonly string[];
  /** System starts pass 1 chooses on its own. */
  readonly pass1Starts: readonly string[];
  readonly systemHeightMm?: number;
  readonly pass2SystemHeightMm?: number;
  readonly gapMm?: number;
  readonly staffHeightMm?: number;
  /** Extra mm the music overhangs the right edge. */
  readonly overhangMm?: number;
  readonly warning?: string;
  readonly dropNote?: string;
  /** Option name whose value setOptions silently refuses to keep. */
  readonly rejectOption?: string;
  readonly noGetOptions?: boolean;
  readonly failLoadOn?: number;
  readonly pass1Pages?: number;
  /** Rewrites the pass-2 pages (pages -> systems -> measure ids) to simulate a divergent renderer. */
  readonly mutatePass2?: (pages: string[][][]) => string[][][];
  readonly onLoad?: (count: number) => void;
}

interface Fake extends VerovioLike {
  readonly loads: string[];
  readonly optionLog: Options[];
  readonly calls: { setOptions: number; render: number };
  getOptions?: () => Readonly<Record<string, unknown>>;
}

const mm = (v: number): number => Math.round(v * 100);

function makeFake(cfg: FakeConfig): Fake {
  let options: Options = {};
  let pages: string[][][] = []; // pages -> systems -> measure ids
  const loads: string[] = [];
  const optionLog: Options[] = [];
  const calls = { setOptions: 0, render: 0 };

  const natural = (): string[][] => {
    const out: string[][] = [];
    for (const m of cfg.measures) {
      if (cfg.pass1Starts.includes(m) || out.length === 0) out.push([]);
      out[out.length - 1]!.push(m);
    }
    return out;
  };
  /** Systems as the markers in `data` describe them (what 'encoded' does). */
  const encoded = (data: string): string[][][] => {
    const out: string[][][] = [[[]]];
    for (const token of data.matchAll(/<pb\s*\/>|<sb\s*\/>|<measure\b[^>]*xml:id="([^"]+)"/g)) {
      if (token[0].startsWith('<pb')) out.push([[]]);
      else if (token[0].startsWith('<sb')) {
        const page = out[out.length - 1]!;
        if (page[page.length - 1]!.length > 0) page.push([]);
      } else out[out.length - 1]![out[out.length - 1]!.length - 1]!.push(token[1]!);
    }
    return out.filter((p) => p.some((s) => s.length > 0));
  };

  const svgFor = (n: number): string => {
    const widthDm = Number(options['pageWidth']);
    const heightDm = Number(options['pageHeight']);
    const marginLeft = Number(options['pageMarginLeft'] ?? 0);
    const pass1 = heightDm === 60000;
    const h = mm(pass1 ? (cfg.systemHeightMm ?? 30) : (cfg.pass2SystemHeightMm ?? cfg.systemHeightMm ?? 30));
    const gap = mm(cfg.gapMm ?? 8);
    const staffH = mm(cfg.staffHeightMm ?? 7.2);
    const overhang = mm(cfg.overhangMm ?? 0);
    const contentW = Math.round(widthDm * 10);
    let body = '';
    (pages[n - 1] ?? []).forEach((measures, i) => {
      const top = i * (h + gap);
      const staffTop = top + Math.round((h - staffH) / 2);
      const staffLines = [0, 1, 2, 3, 4]
        .map((k) => `<path d="M0 ${staffTop + Math.round((k * staffH) / 4)} L${contentW} ${staffTop + Math.round((k * staffH) / 4)}"/>`)
        .join('');
      const measureXml = measures
        .map((id, j) => {
          const staff = j === 0 ? `<g class="staff">${staffLines}</g>` : '';
          const note = id === cfg.dropNote ? '' : `<g id="n-${id}" class="note"/>`;
          return `<g id="${id}" class="measure">${staff}${note}</g>`;
        })
        .join('');
      body +=
        `<g id="sys${n}-${i}" class="system">` +
        `<g id="bbox-sys${n}-${i}" class="system bounding-box"><rect x="0" y="${top}" width="${contentW - marginLeft * 10 + overhang}" height="${h}"/></g>` +
        `${measureXml}</g>`;
    });
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthDm} ${heightDm}">` +
      `<svg class="definition-scale" viewBox="0 0 ${widthDm * 10} ${heightDm * 10}">` +
      `<g class="page-margin" transform="translate(${marginLeft * 10}, 0)">` +
      `<g id="bbox-ms" class="score bounding-box" />${body}</g></svg></svg>`
    );
  };

  const fake: Fake = {
    loads,
    optionLog,
    calls,
    setOptions(o) {
      calls.setOptions++;
      const copy: Options = { ...o };
      if (cfg.rejectOption && cfg.rejectOption in copy) delete copy[cfg.rejectOption];
      options = { ...options, ...copy };
      optionLog.push({ ...o });
    },
    loadData(data) {
      loads.push(data);
      cfg.onLoad?.(loads.length);
      if (cfg.failLoadOn === loads.length) return false;
      if (cfg.warning) console.warn(cfg.warning);
      if (options['pageHeight'] === 60000) {
        const sys = natural();
        pages = cfg.pass1Pages && cfg.pass1Pages > 1 ? sys.map((s) => [s]) : [sys];
      } else if (options['breaks'] === 'none') {
        pages = [[[...cfg.measures]]];
      } else {
        const enc = encoded(data);
        pages = cfg.mutatePass2 ? cfg.mutatePass2(enc) : enc;
      }
      return true;
    },
    getPageCount: () => pages.length,
    renderToSVG(n) {
      calls.render++;
      return svgFor(n);
    },
    getLog: () => '',
    getVersion: () => 'fake',
  };
  if (!cfg.noGetOptions) fake.getOptions = () => ({ ...options });
  return fake;
}

// ============================================================== fixtures ===

const MEASURES = Array.from({ length: 12 }, (_, i) => `m${pad(i + 1)}`);
const meiOf = (measures: readonly string[], extra = ''): string =>
  `<?xml version="1.0" encoding="utf-8"?>\n<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><music><body><mdiv><score><section>\n` +
  measures.map((m) => `<measure xml:id="${m}"><staff n="1"><layer n="1"><note xml:id="n-${m}" dur="4" pname="c" oct="4"/></layer></staff></measure>\n`).join('') +
  `${extra}</section></score></mdiv></body></music></mei>`;

const boundariesOf = (measures: readonly string[]): SafeBoundary[] =>
  measures.map((m, i) => ({
    id: `b${pad(i + 1)}`, onset: `${i + 1}/1`, sourceBreak: false, division: null, measureId: m, afterText: null,
  }));

const FAKE_PART = partOf(meiOf(MEASURES), boundariesOf(MEASURES));

/** Content height 100 mm: with 30 mm systems and 8 mm gaps, two fit per page. */
const SHORT: LayoutSettings = settingsOf({ page: 'custom', customSize: { widthMm: 150, heightMm: 124 }, marginMm: 12 });
const FOUR_SYSTEMS = { measures: MEASURES, pass1Starts: ['m001', 'm004', 'm007', 'm010'] } as const;

const codes = (d: readonly LayoutDiagnostic[]): string[] => d.map((x) => x.code);
const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

// ===================================================== renderMei (fake) ===

describe('renderMei with a fake toolkit', () => {
  it('runs pass 1 on one tall page, then pass 2 encoded with <pb/> and <sb/> at every start', async () => {
    const fake = makeFake(FOUR_SYSTEMS);
    const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));

    expect(layout.diagnostics).toEqual([]);
    expect(layout.pages.map((p) => p.systems.length)).toEqual([2, 2]);
    expect(layout.pages[1]!.systems[0]!.firstBoundaryId).toBe('b006');
    expect(layout.pages.flatMap((p) => p.systems.map((s) => s.index))).toEqual([0, 1, 2, 3]);
    expect(layout.staffHeightMm).toBeCloseTo(7.2, 2);

    const [pass1, pass2] = fake.optionLog;
    expect(pass1).toMatchObject({ pageHeight: 60000, justifyVertically: false, svgBoundingBoxes: true, breaks: 'line', scale: 100 });
    expect(pass2).toMatchObject({ breaks: 'encoded', svgBoundingBoxes: true, pageHeight: 1000 });
    expect(fake.loads).toHaveLength(2);
    expect(count(fake.loads[1]!, /<pb\s*\/>/g)).toBe(1);
    expect(count(fake.loads[1]!, /<sb\s*\/>/g)).toBe(3);
    expect(fake.loads[1]!).toMatch(/<pb\s*\/>\s*<sb\s*\/>\s*<measure xml:id="m007"/);
    expect(layout.verovioOptions).toMatchObject({ breaks: 'encoded' });
    expect(layout.pages[0]!.svg).not.toContain('bounding-box');
  });

  it('uses breaks:auto for automatic lines and strips source <sb/>', async () => {
    const mei = meiOf(MEASURES.slice(0, 6)).replace('<measure xml:id="m004"', '<sb/><measure xml:id="m004"');
    const part = partOf(mei, boundariesOf(MEASURES.slice(0, 6)));
    const s = settingsOf({ ...SHORT, linePolicy: 'automatic' });
    const fake = makeFake({ measures: MEASURES.slice(0, 6), pass1Starts: ['m001', 'm003', 'm005'] });
    const layout = await renderMei(part, s, [], ctxOf(fake), rectsOf(s));
    expect(fake.optionLog[0]).toMatchObject({ breaks: 'auto' });
    expect(fake.loads[0]!).not.toContain('<sb');
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.flatMap((p) => p.systems)).toHaveLength(3);
  });

  it('uses the maximum measured pass-1 gap as minGapMm (R1)', async () => {
    // 3 systems of 30 mm in 100 mm: gap 8 -> 30+8+30+8+30 = 106 > 100, so 2 + 1. A smaller gap would fit all three.
    const fake = makeFake({ measures: MEASURES, pass1Starts: ['m001', 'm005', 'm009'], gapMm: 8 });
    const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
    expect(layout.pages.map((p) => p.systems.length)).toEqual([2, 1]);
  });

  it('forces a page at a user page break that starts a pass-1 system', async () => {
    const fake = makeFake({ measures: MEASURES, pass1Starts: ['m001', 'm004', 'm007', 'm010'] });
    const tall = settingsOf({ page: 'custom', customSize: { widthMm: 150, heightMm: 300 }, marginMm: 12 });
    const o: BreakOverride = { boundaryId: 'b003', sourceRevision: 'rev1', kind: 'page' };
    const layout = await renderMei(FAKE_PART, tall, [o], ctxOf(fake), rectsOf(tall));
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.map((p) => p.systems.length)).toEqual([1, 3]);
    expect(layout.pages[1]!.systems[0]!.firstBoundaryId).toBe('b003');
    expect(fake.loads[1]!).toMatch(/<pb\s*\/>\s*<sb\s*\/>\s*<measure xml:id="m004"/);
  });

  it('adds an extra system start for a user break inside a pass-1 system (automatic lines)', async () => {
    const s = settingsOf({ ...SHORT, linePolicy: 'automatic' });
    const fake = makeFake({ measures: MEASURES, pass1Starts: ['m001', 'm007'] });
    const o: BreakOverride = { boundaryId: 'b003', sourceRevision: 'rev1', kind: 'system' };
    const layout = await renderMei(FAKE_PART, s, [o], ctxOf(fake), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.flatMap((p) => p.systems.map((x) => x.firstBoundaryId))).toEqual([null, 'b003', 'b006']);
  });

  it('handles a one-system part with no break element (R5) by asking for breaks:none', async () => {
    const fake = makeFake({ measures: MEASURES, pass1Starts: ['m001'] });
    const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.systems).toHaveLength(1);
    expect(fake.loads[1]!).not.toMatch(/<pb|<sb/);
    expect(fake.optionLog[1]).toMatchObject({ breaks: 'none' });
  });

  it('reports a pass 2 that does not reproduce pass 1 as no-convergence, without retrying', async () => {
    const fake = makeFake({ ...FOUR_SYSTEMS, mutatePass2: (pages) => [pages[0]!, [[...pages[1]![0]!, ...pages[1]![1]!]]] });
    const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
    expect(layout.pages).toEqual([]);
    const d = layout.diagnostics.find((x) => x.code === 'UNSATISFIABLE_LAYOUT')!;
    expect(d).toMatchObject({ severity: 'error', reason: 'no-convergence', partId: 'seg:0' });
    expect(d.pageIndex).toBe(1);
    expect(d.boundaryIds).toEqual(['b009']);
    expect(d.detail).toContain('planned');
    expect(fake.loads).toHaveLength(2); // pass 1 + pass 2 only
  });

  it('suggests removing a user break when it cannot converge', async () => {
    const fake = makeFake({ ...FOUR_SYSTEMS, mutatePass2: (pages) => pages.slice(1) });
    const o: BreakOverride = { boundaryId: 'b003', sourceRevision: 'rev1', kind: 'system' };
    const layout = await renderMei(FAKE_PART, SHORT, [o], ctxOf(fake), rectsOf(SHORT));
    expect(layout.diagnostics.find((x) => x.code === 'UNSATISFIABLE_LAYOUT')!.suggestions).toEqual(['remove-break']);
  });

  describe('system-too-tall', () => {
    it('offers smaller-music and larger-page in portrait', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, systemHeightMm: 120 });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      expect(layout.pages).toEqual([]);
      const d = layout.diagnostics[0]!;
      expect(d).toMatchObject({ code: 'UNSATISFIABLE_LAYOUT', severity: 'error', reason: 'system-too-tall', pageIndex: 0 });
      expect(d.suggestions).toEqual(['smaller-music', 'larger-page']);
      expect(fake.loads).toHaveLength(1);
    });

    it('adds portrait in landscape and drops smaller-music at the small staff', async () => {
      const s = settingsOf({ ...SHORT, orientation: 'landscape', staff: 'small' });
      const fake = makeFake({ ...FOUR_SYSTEMS, systemHeightMm: 200 });
      const layout = await renderMei(FAKE_PART, s, [], ctxOf(fake), rectsOf(s));
      expect(layout.diagnostics[0]!.suggestions).toEqual(['larger-page', 'portrait']);
    });

    it('names the page and boundary of a later system', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, systemHeightMm: 30 });
      const tiny = settingsOf({ page: 'custom', customSize: { widthMm: 150, heightMm: 124 }, marginMm: 12 });
      // Pass 1 heights are 30 mm; shrink the page for page 2+ by giving page 1 a big content rect only.
      const rects: PageRects = { content: { ...rectsOf(tiny).content, heightMm: 20 }, firstPageContent: rectsOf(tiny).content };
      const layout = await renderMei(FAKE_PART, tiny, [], ctxOf(fake), rects);
      const d = layout.diagnostics[0]!;
      expect(d.reason).toBe('system-too-tall');
      expect(d.pageIndex).toBe(1);
      expect(d.boundaryIds).toEqual(['b006']);
    });

    it('reports heading-too-tall when only the heading space is short', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT, 80));
      expect(layout.diagnostics[0]).toMatchObject({ code: 'UNSATISFIABLE_LAYOUT', reason: 'heading-too-tall', pageIndex: 0 });
    });
  });

  describe('crowded and over-wide lines', () => {
    it('warns CROWDED_ORIGINAL_LINES from a captured Verovio compression warning but still lays out', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, warning: '[Warning] Justification is highly compressed (ratio smaller than 0.8: 0.7)' });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      expect(layout.pages.length).toBe(2);
      expect(layout.diagnostics).toHaveLength(1);
      expect(layout.diagnostics[0]).toMatchObject({ code: 'CROWDED_ORIGINAL_LINES', severity: 'warning', reason: null });
      expect(layout.diagnostics[0]!.suggestions).toEqual(['smaller-music', 'landscape']);
      expect(layout.diagnostics[0]!.detail).toContain('compressed');
    });

    it('warns once when original lines overhang the right edge by more than 0.5 mm', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, overhangMm: 0.7 });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      expect(codes(layout.diagnostics)).toEqual(['CROWDED_ORIGINAL_LINES']);
      expect(layout.pages.length).toBe(2);
    });

    it('tolerates a 0.3 mm overhang', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, overhangMm: 0.3 });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      expect(layout.diagnostics).toEqual([]);
    });

    it('fails system-too-wide for automatic lines', async () => {
      const s = settingsOf({ ...SHORT, linePolicy: 'automatic' });
      const fake = makeFake({ ...FOUR_SYSTEMS, overhangMm: 2 });
      const layout = await renderMei(FAKE_PART, s, [], ctxOf(fake), rectsOf(s));
      expect(layout.pages).toEqual([]);
      expect(layout.diagnostics[0]).toMatchObject({ code: 'UNSATISFIABLE_LAYOUT', reason: 'system-too-wide', pageIndex: 0 });
      expect(layout.diagnostics[0]!.suggestions).toEqual(['fit-to-page', 'smaller-music', 'landscape']);
      expect(layout.diagnostics[0]!.boundaryIds.length).toBeLessThanOrEqual(1);
    });
  });

  describe('validation', () => {
    it('reports EVENT_MISSING when a note is not drawn', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, dropNote: 'm005' });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      expect(layout.pages).toEqual([]);
      expect(layout.diagnostics[0]).toMatchObject({ code: 'EVENT_MISSING', severity: 'error', reason: null });
      expect(layout.diagnostics[0]!.detail).toContain('n-m005');
    });

    it('reports STAFF_HEIGHT_MISMATCH outside +/-0.1 mm and accepts +0.05', async () => {
      const bad = await renderMei(FAKE_PART, SHORT, [], ctxOf(makeFake({ ...FOUR_SYSTEMS, staffHeightMm: 7.4 })), rectsOf(SHORT));
      expect(codes(bad.diagnostics)).toEqual(['STAFF_HEIGHT_MISMATCH']);
      const ok = await renderMei(FAKE_PART, SHORT, [], ctxOf(makeFake({ ...FOUR_SYSTEMS, staffHeightMm: 7.25 })), rectsOf(SHORT));
      expect(ok.diagnostics).toEqual([]);
    });

    it('reports CONTENT_CLIPPED when pass 2 draws below the content area', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, pass2SystemHeightMm: 48 });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      const d = layout.diagnostics.find((x) => x.code === 'CONTENT_CLIPPED')!;
      expect(d).toMatchObject({ severity: 'error', pageIndex: 0 });
      expect(d.suggestions).toEqual(['smaller-music', 'smaller-margins']);
    });

    it('lists dropped overrides as non-blocking warnings', async () => {
      const fake = makeFake(FOUR_SYSTEMS);
      const stale: BreakOverride = { boundaryId: 'b003', sourceRevision: 'old', kind: 'system' };
      const unsafe: BreakOverride = { boundaryId: 'zzz', sourceRevision: 'rev1', kind: 'system' };
      const layout = await renderMei(FAKE_PART, SHORT, [stale, unsafe], ctxOf(fake), rectsOf(SHORT));
      expect(layout.diagnostics.map((d) => [d.code, d.severity, d.boundaryIds])).toEqual([
        ['STALE_ANCHOR', 'warning', ['b003']],
        ['UNSAFE_ANCHOR', 'warning', ['zzz']],
      ]);
      expect(layout.pages.length).toBe(2);
    });
  });

  describe('renderer failures', () => {
    it('fails with RENDERER_FAILED when setOptions silently rejects a value (R2)', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, rejectOption: 'unit' });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      expect(layout.pages).toEqual([]);
      expect(layout.diagnostics[0]).toMatchObject({ code: 'RENDERER_FAILED', severity: 'error', reason: null });
      expect(layout.diagnostics[0]!.detail).toContain('unit');
      expect(fake.loads).toHaveLength(0);
    });

    it('fails when pass 2 options are rejected', async () => {
      const fake = makeFake({ ...FOUR_SYSTEMS, rejectOption: 'breaks' });
      // 'breaks' is part of pass 1 too, so the failure comes before any load.
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
      expect(layout.diagnostics[0]!.code).toBe('RENDERER_FAILED');
    });

    it('fails when the toolkit cannot read options back', async () => {
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(makeFake({ ...FOUR_SYSTEMS, noGetOptions: true })), rectsOf(SHORT));
      expect(layout.diagnostics[0]).toMatchObject({ code: 'RENDERER_FAILED' });
    });

    it('fails when loadData fails in pass 1, pass 2 or the first-page pass', async () => {
      for (const failLoadOn of [1, 2]) {
        const fake = makeFake({ ...FOUR_SYSTEMS, failLoadOn });
        const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake), rectsOf(SHORT));
        expect(layout.diagnostics[0]!.code).toBe('RENDERER_FAILED');
      }
      const s = settingsOf({ ...SHORT, page: 'ipad-11', marginMm: 4 });
      const heading = await renderMei(FAKE_PART, s, [], ctxOf(makeFake({ ...FOUR_SYSTEMS, failLoadOn: 3 })), rectsOf(s, 20));
      expect(heading.diagnostics[0]!.code).toBe('RENDERER_FAILED');
    });

    it('fails when pass 1 does not fit on one page', async () => {
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(makeFake({ ...FOUR_SYSTEMS, pass1Pages: 2 })), rectsOf(SHORT));
      expect(layout.diagnostics[0]!.code).toBe('RENDERER_FAILED');
      expect(layout.diagnostics[0]!.detail).toContain('4 pages');
    });

    it('fails on a pass 1 with no systems', async () => {
      const layout = await renderMei(partOf(meiOf([]), []), SHORT, [], ctxOf(makeFake({ measures: [], pass1Starts: [] })), rectsOf(SHORT));
      expect(layout.diagnostics[0]!.code).toBe('RENDERER_FAILED');
    });

    it('turns malformed MEI into RENDERER_FAILED', async () => {
      const part = partOf('<mei><measure xml:id="m001"></mei>', boundariesOf(['m001']));
      const layout = await renderMei(part, SHORT, [{ boundaryId: 'b001', sourceRevision: 'rev1', kind: 'system' }], ctxOf(makeFake(FOUR_SYSTEMS)), rectsOf(SHORT));
      expect(layout.diagnostics[0]!.code).toBe('RENDERER_FAILED');
    });

    it('turns an unknown measure anchor into UNSAFE_ANCHOR', async () => {
      // A measure id that only appears inside a comment is "known" to the boundary table but not to the document.
      const mei = meiOf(MEASURES).replace('<section>', '<section><!-- <measure xml:id="ghost"> -->');
      const bs = [...boundariesOf(MEASURES), { id: 'bGhost', onset: '99/1', sourceBreak: false, division: null, measureId: 'ghost', afterText: null }];
      const part = partOf(mei, bs);
      const o: BreakOverride = { boundaryId: 'bGhost', sourceRevision: 'rev1', kind: 'system' };
      const layout = await renderMei(part, SHORT, [o], ctxOf(makeFake(FOUR_SYSTEMS)), rectsOf(SHORT));
      expect(layout.diagnostics[0]).toMatchObject({ code: 'UNSAFE_ANCHOR', severity: 'error', suggestions: ['remove-break'] });
    });
  });

  describe('cancellation', () => {
    it('returns CANCELLED before touching the toolkit', async () => {
      const fake = makeFake(FOUR_SYSTEMS);
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake, () => true), rectsOf(SHORT));
      expect(layout.pages).toEqual([]);
      expect(layout.diagnostics[0]).toMatchObject({ code: 'CANCELLED', severity: 'error', reason: null });
      expect(fake.calls.setOptions).toBe(0);
    });

    it('stops after pass 1 when cancelled in between', async () => {
      let cancelled = false;
      const fake = makeFake({ ...FOUR_SYSTEMS, onLoad: () => { cancelled = true; } });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake, () => cancelled), rectsOf(SHORT));
      expect(codes(layout.diagnostics)).toEqual(['CANCELLED']);
      expect(fake.loads).toHaveLength(1);
    });

    it('stops between pass 2 pages', async () => {
      let cancelled = false;
      const fake = makeFake({ ...FOUR_SYSTEMS, onLoad: (n) => { if (n === 2) cancelled = true; } });
      const layout = await renderMei(FAKE_PART, SHORT, [], ctxOf(fake, () => cancelled), rectsOf(SHORT));
      expect(codes(layout.diagnostics)).toEqual(['CANCELLED']);
      expect(fake.calls.render).toBe(1); // pass 1 page only
    });

    it('stops after the first-page pass', async () => {
      const s = settingsOf({ ...SHORT, page: 'ipad-11', marginMm: 4 });
      let cancelled = false;
      const fake = makeFake({ measures: MEASURES, pass1Starts: ['m001', 'm007'], onLoad: (n) => { if (n === 3) cancelled = true; } });
      const layout = await renderMei(FAKE_PART, s, [], ctxOf(fake, () => cancelled), rectsOf(s, 20));
      expect(codes(layout.diagnostics)).toEqual(['CANCELLED']);
    });
  });

  it('renders page 1 alone at the heading height when vertical justification is on (R4)', async () => {
    const s = settingsOf({ page: 'ipad-11', marginMm: 4 });
    const rects = rectsOf(s, 30);
    const fake = makeFake({ measures: MEASURES, pass1Starts: ['m001', 'm007'] });
    const layout = await renderMei(FAKE_PART, s, [], ctxOf(fake), rects);
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(fake.loads).toHaveLength(3);
    const heights = fake.optionLog.map((o) => o['pageHeight']);
    expect(heights).toEqual([60000, Math.floor(rects.content.heightMm * 10), Math.floor(rects.firstPageContent.heightMm * 10)]);
    expect(layout.pages[0]!.svg).toContain(`viewBox="0 0 ${Math.floor(rects.content.widthMm * 10)} ${Math.floor(rects.firstPageContent.heightMm * 10)}"`);
  });
});

// ============================================== validateLayout (direct) ===

describe('validateLayout', () => {
  const sys = (index: number, firstBoundaryId: string | null, topMm = 0, heightMm = 30) => ({ index, firstBoundaryId, topMm, heightMm });
  const noteSvg = (ids: string[]): string => `<svg>${ids.map((id) => `<g id="${id}" class="note"/>`).join('')}</svg>`;
  const layoutOf = (pages: MeiLayout['pages'], staffHeightMm = 7.2): MeiLayout => ({
    partId: 'seg:0', pages, effectiveBreaks: { partId: 'seg:0', breaks: [], droppedOverrides: [] }, staffHeightMm, verovioOptions: {}, diagnostics: [],
  });
  const constraints = (patch: Partial<LayoutConstraints> = {}): LayoutConstraints => ({
    page: { widthMm: 150, heightMm: 124, kind: 'custom' },
    usable: { xMm: 12, yMm: 12, widthMm: 126, heightMm: 100 },
    maxSystems: null,
    staffHeightMm: 7.2,
    requiredBreaks: [],
    expectedEventIds: new Set(['a', 'b']),
    ...patch,
  });

  it('accepts a conforming layout', () => {
    const l = layoutOf([{ svg: noteSvg(['a', 'b']), systems: [sys(0, null), sys(1, 'b001', 38)] }]);
    expect(validateLayout(l, constraints())).toEqual([]);
  });

  it('flags CAP_EXCEEDED with the page and the boundaries beyond the cap', () => {
    const l = layoutOf([
      { svg: noteSvg(['a', 'b']), systems: [sys(0, null), sys(1, 'b001'), sys(2, 'b002')] },
    ]);
    const d = validateLayout(l, constraints({ maxSystems: 2 }));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ code: 'CAP_EXCEEDED', severity: 'error', pageIndex: 0, boundaryIds: ['b002'], reason: null, partId: 'seg:0' });
    expect(typeof d[0]!.detail).toBe('string');
  });

  it('flags EVENT_MISSING, including hidden notes that carry extra classes', () => {
    const svg = '<svg><g id="a" class="note"/><g id="x" class="notehead"/></svg>';
    const d = validateLayout(layoutOf([{ svg, systems: [sys(0, null)] }]), constraints());
    expect(d.map((x) => x.code)).toEqual(['EVENT_MISSING']);
    expect(d[0]!.detail).toContain('b');
    const hidden = '<svg><g id="a" class="note"/><g class="note x" id="b" visibility="hidden"/></svg>';
    expect(validateLayout(layoutOf([{ svg: hidden, systems: [sys(0, null)] }]), constraints())).toEqual([]);
  });

  it('flags STAFF_HEIGHT_MISMATCH, including NaN', () => {
    const p = [{ svg: noteSvg(['a', 'b']), systems: [sys(0, null)] }];
    expect(validateLayout(layoutOf(p, 7.31), constraints()).map((d) => d.code)).toEqual(['STAFF_HEIGHT_MISMATCH']);
    expect(validateLayout(layoutOf(p, 7.29), constraints())).toEqual([]);
    expect(validateLayout(layoutOf(p, NaN), constraints()).map((d) => d.code)).toEqual(['STAFF_HEIGHT_MISMATCH']);
  });

  it('flags CONTENT_CLIPPED below the usable height, with smaller-margins at the small staff', () => {
    const p = [{ svg: noteSvg(['a', 'b']), systems: [sys(0, null, 80, 30)] }];
    const d = validateLayout(layoutOf(p), constraints({ staffHeightMm: 5.6 }));
    expect(d.find((x) => x.code === 'CONTENT_CLIPPED')).toMatchObject({ pageIndex: 0, suggestions: ['smaller-margins'] });
  });

  it('checks required breaks: a page break must start a page, a system break a system', () => {
    const l = layoutOf([
      { svg: noteSvg(['a', 'b']), systems: [sys(0, null), sys(1, 'b001')] },
      { svg: noteSvg([]), systems: [sys(2, 'b002')] },
    ]);
    const need = (boundaryId: string, kind: 'system' | 'page', origin: 'user' | 'source' = 'user') => ({ boundaryId, kind, origin }) as const;
    expect(validateLayout(l, constraints({ requiredBreaks: [need('b002', 'page'), need('b001', 'system'), need('b002', 'system')] }))).toEqual([]);
    const bad = validateLayout(l, constraints({ requiredBreaks: [need('b001', 'page'), need('b009', 'system', 'source')] }));
    expect(bad.map((d) => [d.code, d.reason, d.boundaryIds, d.suggestions])).toEqual([
      ['UNSATISFIABLE_LAYOUT', 'no-convergence', ['b001'], ['remove-break']],
      ['UNSATISFIABLE_LAYOUT', 'no-convergence', ['b009'], []],
    ]);
  });

  it('gives every diagnostic the full contract shape', () => {
    const l = layoutOf([{ svg: noteSvg([]), systems: [sys(0, null), sys(1, 'b001'), sys(2, 'b002', 90)] }], 9);
    const d = validateLayout(l, constraints({ maxSystems: 1, requiredBreaks: [{ boundaryId: 'q', kind: 'page', origin: 'user' }] }));
    expect(d.length).toBeGreaterThanOrEqual(4);
    for (const x of d) {
      expect(Object.keys(x).sort()).toEqual(['boundaryIds', 'code', 'detail', 'pageIndex', 'partId', 'reason', 'severity', 'suggestions']);
      expect(x.partId).toBe('seg:0');
      expect(Array.isArray(x.boundaryIds)).toBe(true);
      expect(Array.isArray(x.suggestions)).toBe(true);
      expect(x.detail.length).toBeGreaterThan(0);
      expect(x.reason === null).toBe(x.code !== 'UNSATISFIABLE_LAYOUT');
    }
  });
});

// ====================================================== real Verovio WASM ===

const PAGE_BREAK_B002: BreakOverride = { boundaryId: 'b002', sourceRevision: 'rev1', kind: 'page' };

describe('renderMei with real Verovio 6.3.0 (WASM)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  const timings: string[] = [];

  async function run(label: string, s: LayoutSettings, overrides: readonly BreakOverride[] = [], headingMm = 0): Promise<{ layout: MeiLayout; rects: PageRects }> {
    const rects = rectsOf(s, headingMm);
    const t0 = performance.now();
    const layout = await renderMei(EXPERIMENT, s, overrides, ctxOf(newToolkit()), rects);
    timings.push(`${label}: ${Math.round(performance.now() - t0)} ms`);
    return { layout, rects };
  }
  const constraintsFor = (s: LayoutSettings, layout: MeiLayout, rects: PageRects): LayoutConstraints => ({
    page: paperDimensions(s), usable: rects.content, maxSystems: s.maxSystems, staffHeightMm: 7.2,
    requiredBreaks: layout.effectiveBreaks.breaks, expectedEventIds: EXPERIMENT_NOTES,
  });
  const LETTER_ORIG = settingsOf({ page: 'letter', staff: 'medium', linePolicy: 'original' });
  const IPAD_AUTO = settingsOf({ page: 'ipad-11', marginMm: 4, staff: 'medium', linePolicy: 'automatic' });

  function expectGood(label: string, s: LayoutSettings, layout: MeiLayout, rects: PageRects): void {
    expect(errors(layout.diagnostics), label).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(0);
    const cap = s.maxSystems ?? Infinity;
    for (const p of layout.pages) expect(p.systems.length).toBeLessThanOrEqual(cap);
    expect(layout.staffHeightMm).toBeGreaterThan(7.1);
    expect(layout.staffHeightMm).toBeLessThan(7.3);
    // Re-validating the finished layout from its SVG finds every event id and no violation.
    expect(validateLayout(layout, constraintsFor(s, layout, rects))).toEqual([]);
    // Page frames are separate: one complete, distinct SVG per page, each within the content rect.
    const frames = new Set(layout.pages.map((p) => p.svg));
    expect(frames.size).toBe(layout.pages.length);
    const widthDm = Math.floor(rects.content.widthMm * 10);
    for (const p of layout.pages) {
      expect(p.svg.startsWith('<?xml') || p.svg.startsWith('<svg')).toBe(true);
      expect(p.svg).toContain(`viewBox="0 0 ${widthDm} `);
      expect(p.svg).not.toContain('bounding-box');
      expect(p.systems.length).toBeGreaterThan(0);
      for (const sys of p.systems) expect(sys.topMm + sys.heightMm).toBeLessThanOrEqual(rects.content.heightMm + 0.05);
      expect(p.systems[0]!.topMm).toBeLessThan(2);
    }
    expect(layout.pages.flatMap((p) => p.systems.map((x) => x.index))).toEqual(layout.pages.flatMap((p) => p.systems).map((_, i) => i));
  }

  it('letter-p-orig: no cap violation, all events present, staff 7.2 +/- 0.1 mm, separate pages', async () => {
    const { layout, rects } = await run('letter-p-orig', LETTER_ORIG);
    expectGood('letter-p-orig', LETTER_ORIG, layout, rects);
    // Original lines: the six source systems, in order.
    expect(layout.pages.flatMap((p) => p.systems.map((x) => x.firstBoundaryId))).toEqual([null, 'b001', 'b002', 'b003', 'b004', 'b005']);
  });

  it('ipad11-p-auto: no cap violation, all events present, staff 7.2 +/- 0.1 mm, separate pages', async () => {
    const { layout, rects } = await run('ipad11-p-auto', IPAD_AUTO);
    expectGood('ipad11-p-auto', IPAD_AUTO, layout, rects);
    expect(layout.pages.flatMap((p) => p.systems).length).toBeGreaterThan(3);
  });

  it('honours a system cap of 2 in both policies', async () => {
    for (const base of [LETTER_ORIG, IPAD_AUTO]) {
      const s = settingsOf({ ...base, maxSystems: 2 });
      const { layout, rects } = await run(`cap2-${base.page}`, s);
      expectGood('cap 2', s, layout, rects);
      expect(layout.pages.every((p) => p.systems.length <= 2)).toBe(true);
    }
  });

  it('renders the same SVG twice (xmlIdChecksum)', async () => {
    const a = await run('repeat-a', IPAD_AUTO);
    const b = await run('repeat-b', IPAD_AUTO);
    expect(a.layout.pages.map((p) => p.svg)).toEqual(b.layout.pages.map((p) => p.svg));
  });

  it('a user page break at b002 (after m016) starts a page, and survives switching orientation', async () => {
    for (const base of [LETTER_ORIG, IPAD_AUTO]) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        const s = settingsOf({ ...base, orientation });
        const label = `pb-b002-${base.page}-${orientation}`;
        const { layout, rects } = await run(label, s, [PAGE_BREAK_B002]);
        expectGood(label, s, layout, rects);
        const pageStarts = layout.pages.map((p) => p.systems[0]!.firstBoundaryId);
        expect(pageStarts, label).toContain('b002');
        expect(pageStarts.indexOf('b002'), label).toBeGreaterThan(0);
      }
    }
  });

  it('keeps a user system break inside an automatic system', async () => {
    const o: BreakOverride = { boundaryId: 'c010', sourceRevision: 'rev1', kind: 'system' }; // after m012
    const { layout, rects } = await run('sb-auto', IPAD_AUTO, [o]);
    expectGood('sb-auto', IPAD_AUTO, layout, rects);
    expect(layout.pages.flatMap((p) => p.systems.map((x) => x.firstBoundaryId))).toContain('c010');
  });

  it('keeps page 1 clear of a heading when the page is vertically justified (R4)', async () => {
    const { layout, rects } = await run('ipad-heading', IPAD_AUTO, [], 25);
    expectGood('ipad-heading', IPAD_AUTO, layout, rects);
    const first = layout.pages[0]!.systems;
    expect(first[first.length - 1]!.topMm + first[first.length - 1]!.heightMm).toBeLessThanOrEqual(rects.firstPageContent.heightMm + 0.05);
  });

  it('reports a system that cannot fit as system-too-tall', async () => {
    const s = settingsOf({ page: 'custom', customSize: { widthMm: 150, heightMm: 60 }, marginMm: 12, staff: 'large' });
    const { layout } = await run('too-tall', s);
    expect(layout.pages).toEqual([]);
    expect(layout.diagnostics.find((d) => d.code === 'UNSATISFIABLE_LAYOUT')).toMatchObject({ reason: 'system-too-tall' });
  });

  it('lays out a one-system excerpt without any break element (R5)', async () => {
    const rich = EXPERIMENT_MEI.replace(/<measure xml:id="m003"[\s\S]*$/, '</section></score></mdiv></body></music></mei>');
    const part = partOf(rich, experimentBoundaries().slice(0, 2));
    const s = settingsOf({ page: 'ipad-13', marginMm: 4, linePolicy: 'automatic' });
    const t0 = performance.now();
    const layout = await renderMei(part, s, [], ctxOf(newToolkit()), rectsOf(s));
    timings.push(`one-system: ${Math.round(performance.now() - t0)} ms`);
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]!.systems).toHaveLength(1);
  });

  it('prints timings', () => {
    console.info(`[layout.test real-WASM timings]\n${timings.join('\n')}`);
    expect(timings.length).toBeGreaterThan(0);
  });
});
