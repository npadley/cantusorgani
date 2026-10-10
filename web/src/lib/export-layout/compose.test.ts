import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { create as createFont } from '@pdf-lib/fontkit';
import createVerovioModule from 'verovio/wasm';
import type { VerovioModule } from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { composeExport, reservationFor } from './compose';
import type { ComposeDeps } from './compose';
import { loadFontProfile } from './fonts';
import { renderMei } from './layout';
import type { PageRects } from './layout';
import { paperDimensions, usableRect } from './settings';
import { DEFAULT_SETTINGS, PROVISIONAL_LIMITS } from './types';
import type {
  ExportPart,
  FixedExportPart,
  FontProfile,
  LayoutSettings,
  MeiExportPart,
  MeiLayout,
  MeiPart,
  PartHeading,
  SafeBoundary,
  ScanExportPart,
} from './types';

const FONT_DIR = join(__dirname, '..', '..', '..', 'public', 'fonts', 'export');
const pad = (n: number): string => String(n).padStart(3, '0');
const settingsOf = (patch: Partial<LayoutSettings> = {}): LayoutSettings => ({ ...DEFAULT_SETTINGS, ...patch });
const IPAD: LayoutSettings = settingsOf({ page: 'ipad-11', marginMm: 4, linePolicy: 'automatic' });
const LETTER = settingsOf({ page: 'letter' });
const MULTI: LayoutSettings = { ...IPAD, maxSystems: 2 };

const heading = (label: string, extra: Partial<PartHeading> = {}): PartHeading => ({
  label, rubric: null, rubricTranslation: null, credit: null, ...extra,
});

// ---- parts ----------------------------------------------------------------
const base = { sourceSystemCount: 3 };
const meiPart = (id: string, h: PartHeading | null): MeiExportPart => ({
  ...base, id, kind: 'mei', label: 'Kyrie', heading: h, sourceRevision: 'rev1', target: 'movement:test', renderHash: 'h'.repeat(32),
  conversion: {
    digest: 'd'.repeat(64), meiUrl: '', meiSha256: '', sourceRevision: 'rev1', profile: 'accompaniment-v1',
    verovio: '6.3.0-425dd7b', boundaries: [], capabilities: { manualBreaks: true },
  },
});
const scanPart = (id: string, stems: readonly string[], h: PartHeading | null = heading('Gradual', { credit: 'Source: Graduale Romanum' })): ScanExportPart => ({
  ...base, id, kind: 'scan', label: 'Gradual', heading: h, sourceRevision: stems[0] ?? '', stems, customizableAvailable: false,
});
const fixedPart = (id: string): FixedExportPart => ({
  ...base, id, kind: 'fixed', label: 'Credo', heading: heading('Credo', { credit: 'ignored' }), sourceRevision: 'fx',
  target: 'movement:credo', renderHash: 'f'.repeat(32), letterPdf: 'letter.pdf', a4Pdf: 'a4.pdf',
});

// ---- fakes ----------------------------------------------------------------
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
/** stem -> "WxH" px; pdf url -> list of [w,h] pt. */
function makeDeps(fonts: FontProfile, png: Record<string, string>, pdfs: Record<string, readonly (readonly [number, number])[]>): ComposeDeps {
  return {
    fonts,
    assets: {
      async bytes(url) {
        const stem = url.replace(/@2x\.png$/, '');
        if (url.endsWith('@2x.png') && png[stem] !== undefined) return enc(`png:${png[stem]}`);
        if (pdfs[url] !== undefined) return enc(`pdf:${url}`);
        throw new Error(`ASSET_MISSING: ${url}`);
      },
    },
    pngSize(bytes) {
      const m = /^png:(\d+)x(\d+)$/.exec(dec(bytes));
      if (!m) throw new Error('bad png');
      return { width: Number(m[1]), height: Number(m[2]) };
    },
    async pdfPageSize(bytes, index) {
      const url = dec(bytes).replace(/^pdf:/, '');
      const pages = pdfs[url]!;
      const p = pages[Math.min(index, Math.max(0, pages.length - 1))] ?? [0, 0];
      return { width: p[0], height: p[1], count: pages.length };
    },
  };
}

// ---- real MEI layout ------------------------------------------------------
const EXPERIMENT_MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix-experiment.mei'), 'utf8');
const SOURCE_BREAK_MEASURES = [8, 16, 26, 39, 50];
function experimentBoundaries(): SafeBoundary[] {
  const out: SafeBoundary[] = [];
  let other = 1;
  for (let k = 1; k <= 60; k++) {
    const si = SOURCE_BREAK_MEASURES.indexOf(k);
    out.push({
      id: si >= 0 ? `b${pad(si + 1)}` : `c${pad(other++)}`,
      onset: `${k}/1`, sourceBreak: si >= 0, division: null, measureId: `m${pad(k)}`, afterText: null,
    });
  }
  return out;
}

describe('composeExport', () => {
  let wasm: VerovioModule;
  let fonts: FontProfile;
  const toolkits: VerovioToolkit[] = [];
  beforeAll(async () => {
    wasm = await createVerovioModule();
    fonts = await loadFontProfile(async (url) => new Uint8Array(readFileSync(join(FONT_DIR, url.split('/').pop()!))));
  });

  async function meiLayout(part: MeiExportPart, s: LayoutSettings): Promise<MeiLayout> {
    const withB: MeiExportPart = { ...part, conversion: { ...part.conversion, boundaries: experimentBoundaries() } };
    const meiPartInput: MeiPart = { part: withB, meiXml: EXPERIMENT_MEI };
    const res = reservationFor(part, s, fonts);
    const full = usableRect(paperDimensions(s), s.marginMm);
    const content = { ...full, heightMm: full.heightMm - res.footerMm };
    const rects: PageRects = { content, firstPageContent: { ...content, heightMm: content.heightMm - res.headingMm } };
    const tk = new VerovioToolkit(wasm);
    toolkits.push(tk);
    return renderMei(meiPartInput, s, [], { token: 1, fonts, limits: PROVISIONAL_LIMITS, isCancelled: () => false, toolkit: tk }, rects);
  }

  const PNG = { 'a/s1': '1200x400', 'a/s2': '1200x400', 'a/s3': '1200x400', 'a/s4': '1200x400', 'a/s5': '1200x400', 'a/s6': '1200x400' };
  const PDFS = { 'letter.pdf': [[612, 792], [612, 792]], 'a4.pdf': [[595.28, 841.89]] } as const;
  const deps = (): ComposeDeps => makeDeps(fonts, PNG, PDFS);

  it('lays out mixed MEI, scan and fixed parts in order, each starting a page', async () => {
    const mei = meiPart('m:0', heading('Kyrie', { rubric: 'Kyrie rubric', credit: 'Credit line' }));
    const layouts = new Map([[mei.id, await meiLayout(mei, IPAD)]]);
    const parts: ExportPart[] = [mei, scanPart('s:0', ['a/s1', 'a/s2']), fixedPart('f:0')];
    const r = await composeExport(parts, layouts, IPAD, deps(), 7);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.token).toBe(7);
    expect(r.partIds).toEqual(['m:0', 's:0', 'f:0']);
    expect(r.pages.map((p) => p.index)).toEqual(r.pages.map((_, i) => i));
    const order = r.pages.map((p) => p.partId);
    expect(order).toEqual([...order].sort((a, b) => ['m:0', 's:0', 'f:0'].indexOf(a) - ['m:0', 's:0', 'f:0'].indexOf(b)));
    expect(new Set(order)).toEqual(new Set(['m:0', 's:0', 'f:0']));
    expect(r.pages.filter((p) => p.partId === 'm:0').every((p) => p.kind === 'mei')).toBe(true);
    expect(r.pages.find((p) => p.partId === 's:0')!.kind).toBe('scan');
    expect(r.pages.find((p) => p.partId === 'f:0')!.kind).toBe('fixed');
    expect(r.digests.renderer).toBe('6.3.0-425dd7b');
  });

  it('reserves the heading on the first page only and puts the credit in the last footer', async () => {
    const mei = meiPart('m:0', heading('Kyrie', { rubric: 'A rubric', rubricTranslation: 'Translation', credit: 'Credit line' }));
    const layouts = new Map([[mei.id, await meiLayout(mei, MULTI)]]);
    const r = await composeExport([mei], layouts, MULTI, deps(), 1);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const pages = r.pages.filter((p) => p.kind === 'mei');
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]!.heading).not.toBeNull();
    expect(pages[0]!.heading!.lines.map((l) => l.role)).toEqual(['heading', 'rubric', 'translation']);
    expect(pages[0]!.heading!.lines.map((l) => l.sizePt)).toEqual([14, 10, 9]);
    expect(pages.slice(1).every((p) => p.heading === null)).toBe(true);
    expect(pages.slice(0, -1).every((p) => p.footer === null)).toBe(true);
    const last = pages[pages.length - 1]!;
    expect(last.footer!.lines).toMatchObject([{ role: 'credit', text: 'Credit line', sizePt: 8 }]);
    // Page 1 content starts below the heading; later pages start at the printable top.
    expect(pages[0]!.content.yMm).toBeCloseTo(pages[0]!.printable.yMm + pages[0]!.heading!.rect.heightMm, 6);
    expect(pages[1]!.content.yMm).toBe(pages[1]!.printable.yMm);
    for (const p of pages) {
      expect(p.unusedFraction).toBeGreaterThanOrEqual(0);
      expect(p.unusedFraction).toBeLessThanOrEqual(1);
      if (p.kind === 'mei') {
        expect(p.svgPlacement).toMatchObject({ scaleX: 1, scaleY: 1, translateXMm: p.content.xMm, translateYMm: p.content.yMm });
        expect(p.systemCount).toBeGreaterThan(0);
        expect(p.svg.namespace).toMatch(/^s\d+_m_0_p\d+$/);
      }
    }
    const withBoundaries = pages.filter((p) => p.kind === 'mei' && p.boundaries.length > 0);
    expect(withBoundaries.length).toBeGreaterThan(0);
  });

  it('packs whole scan images, at most maxSystems per page', async () => {
    const stems = ['a/s1', 'a/s2', 'a/s3', 'a/s4', 'a/s5'];
    const s = settingsOf({ page: 'letter', maxSystems: 2 });
    const r = await composeExport([scanPart('s:0', stems)], new Map(), s, deps(), 1);
    expect(r.complete).toBe(true);
    const pages = r.pages.filter((p) => p.kind === 'scan');
    expect(pages.map((p) => p.systemCount)).toEqual([2, 2, 1]);
    expect(pages.flatMap((p) => p.images.map((i) => i.stem))).toEqual(stems);
    for (const p of pages) {
      for (const im of p.images) {
        expect(im.rect.yMm).toBeGreaterThanOrEqual(p.content.yMm - 1e-9);
        expect(im.rect.yMm + im.rect.heightMm).toBeLessThanOrEqual(p.content.yMm + p.content.heightMm + 1e-9);
        expect(im.rect.widthMm).toBeLessThanOrEqual(p.content.widthMm + 1e-9);
      }
    }
    expect(pages[2]!.footer!.lines[0]!.text).toContain('Graduale');
    expect(pages[0]!.footer).toBeNull();
    expect(pages[1]!.heading).toBeNull();
    // Uncapped, more images fit on a page.
    const free = await composeExport([scanPart('s:0', stems)], new Map(), LETTER, deps(), 1);
    expect(free.pages.length).toBeLessThan(3);
  });

  it('breaks pages when an image does not fit the remainder, never splitting it', async () => {
    const tall = makeDeps(fonts, { 'a/t1': '1000x600', 'a/t2': '1000x600', 'a/t3': '1000x600' }, {});
    const r = await composeExport([scanPart('s:0', ['a/t1', 'a/t2', 'a/t3'], null)], new Map(), LETTER, tall, 1);
    expect(r.complete).toBe(true);
    expect(r.pages.map((p) => (p.kind === 'scan' ? p.systemCount : -1))).toEqual([2, 1]);
  });

  it('reports SCAN_TOO_LARGE for an image taller than the content height', async () => {
    const d = makeDeps(fonts, { 'a/big': '1000x5000' }, {});
    const r = await composeExport([scanPart('s:0', ['a/big'])], new Map(), LETTER, d, 1);
    expect(r.complete).toBe(false);
    expect(r.pages).toEqual([]);
    expect(r.diagnostics).toMatchObject([{ code: 'SCAN_TOO_LARGE', severity: 'error', partId: 's:0' }]);
  });

  it('keeps going with later parts after a scan error', async () => {
    const d = makeDeps(fonts, { 'a/big': '1000x5000', 'a/s1': '1200x400' }, {});
    const r = await composeExport([scanPart('s:0', ['a/big']), scanPart('s:1', ['a/s1'])], new Map(), LETTER, d, 1);
    expect(r.complete).toBe(false);
    expect(r.pages.map((p) => p.partId)).toEqual(['s:1']);
    expect(r.pages[0]!.index).toBe(0);
  });

  it('fits fixed pages with one uniform scale, centred, choosing a4 for ipad-11 portrait', async () => {
    const ipad = settingsOf({ page: 'ipad-11', marginMm: 4 });
    expect(paperDimensions(ipad).heightMm / paperDimensions(ipad).widthMm).toBeGreaterThan(1.35);
    const r = await composeExport([fixedPart('f:0')], new Map(), ipad, deps(), 1);
    expect(r.complete).toBe(true);
    const p = r.pages[0]!;
    if (p.kind !== 'fixed') throw new Error('expected fixed');
    expect(p.sourcePaper).toBe('a4');
    expect(p.sourceUrl).toBe('a4.pdf');
    expect(p.heading).toBeNull();
    expect(p.footer).toBeNull();
    expect(p.content).toEqual(p.printable);
    expect(p.transform.scaleX).toBe(p.transform.scaleY);
    const w = p.sourceSizePt.width * (25.4 / 72) * p.transform.scaleX;
    const h = p.sourceSizePt.height * (25.4 / 72) * p.transform.scaleY;
    expect(w).toBeLessThanOrEqual(p.content.widthMm + 1e-6);
    expect(h).toBeLessThanOrEqual(p.content.heightMm + 1e-6);
    expect(p.transform.translateXMm - p.content.xMm).toBeCloseTo(p.content.xMm + p.content.widthMm - (p.transform.translateXMm + w), 6);
    expect(p.transform.translateYMm - p.content.yMm).toBeCloseTo(p.content.yMm + p.content.heightMm - (p.transform.translateYMm + h), 6);
  });

  it('chooses letter for letter portrait and letter landscape, one canonical page per source page', async () => {
    for (const s of [LETTER, settingsOf({ page: 'letter', orientation: 'landscape' })]) {
      const r = await composeExport([fixedPart('f:0')], new Map(), s, deps(), 1);
      expect(r.pages).toHaveLength(2);
      expect(r.pages.map((p) => (p.kind === 'fixed' ? [p.sourcePaper, p.sourcePageIndex] : null))).toEqual([['letter', 0], ['letter', 1]]);
    }
  });

  it('reports FIXED_PAGE_COUNT_MISMATCH for a source with 0 pages', async () => {
    const d = makeDeps(fonts, {}, { 'letter.pdf': [] });
    const r = await composeExport([fixedPart('f:0')], new Map(), LETTER, d, 1);
    expect(r.complete).toBe(false);
    expect(r.pages).toEqual([]);
    expect(r.diagnostics).toMatchObject([{ code: 'FIXED_PAGE_COUNT_MISMATCH', partId: 'f:0' }]);
  });

  it('fails a part with ASSET_MISSING when a fetch fails', async () => {
    const r = await composeExport([scanPart('s:0', ['nope'])], new Map(), LETTER, deps(), 1);
    expect(r.complete).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ code: 'ASSET_MISSING', partId: 's:0' });
  });

  it('reports a missing or failed MEI layout and carries its diagnostics', async () => {
    const mei = meiPart('m:0', null);
    const r = await composeExport([mei], new Map(), IPAD, deps(), 1);
    expect(r.complete).toBe(false);
    const failed: MeiLayout = {
      partId: 'm:0', pages: [], staffHeightMm: 0, verovioOptions: {},
      effectiveBreaks: { partId: 'm:0', breaks: [], droppedOverrides: [] },
      diagnostics: [{ code: 'RENDERER_FAILED', severity: 'error', partId: 'm:0', pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail: 'x' }],
    };
    const r2 = await composeExport([mei], new Map([['m:0', failed]]), IPAD, deps(), 1);
    expect(r2.complete).toBe(false);
    expect(r2.diagnostics).toEqual(failed.diagnostics);
  });

  it('rejects a MEI page whose SVG does not match the content size (INVALID_PAGE)', async () => {
    const mei = meiPart('m:0', null);
    const good = await meiLayout(mei, IPAD);
    const other = await meiLayout(mei, LETTER);
    const mismatched: MeiLayout = { ...good, pages: other.pages };
    const r = await composeExport([mei], new Map([['m:0', mismatched]]), IPAD, deps(), 1);
    expect(r.complete).toBe(false);
    expect(r.diagnostics.some((d) => d.code === 'INVALID_PAGE' && d.partId === 'm:0')).toBe(true);
    expect(r.pages).toEqual([]);
  });

  it('computes digests that are stable across runs and change with settings', async () => {
    const mei = meiPart('m:0', heading('Kyrie'));
    const layouts = new Map([[mei.id, await meiLayout(mei, IPAD)]]);
    const parts: ExportPart[] = [mei, scanPart('s:0', ['a/s1'])];
    const a = await composeExport(parts, layouts, IPAD, deps(), 1);
    const b = await composeExport(parts, layouts, IPAD, deps(), 2);
    expect(b.digests).toEqual(a.digests);
    for (const v of [a.digests.input, a.digests.settings, a.digests.result]) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(a.digests.fonts).toBe(fonts.digest);
    const c = await composeExport([scanPart('s:0', ['a/s1'])], new Map(), settingsOf({ ...LETTER, marginMm: 14 }), deps(), 1);
    const d = await composeExport([scanPart('s:0', ['a/s1'])], new Map(), LETTER, deps(), 1);
    expect(c.digests.settings).not.toBe(d.digests.settings);
    expect(c.digests.result).not.toBe(d.digests.result);
    expect(d.digests.renderer).toBe('none');
    const e = await composeExport([{ ...scanPart('s:0', ['a/s1']), sourceRevision: 'other' }], new Map(), LETTER, deps(), 1);
    expect(e.digests.input).not.toBe(d.digests.input);
  });

  it('measures an accented heading with Liberation Serif metrics, not Helvetica', async () => {
    const text = 'Kýrie eléison, cǽlum';
    const d = makeDeps(fonts, { 'a/s1': '1200x400' }, {});
    const r = await composeExport([scanPart('s:0', ['a/s1'], heading(text))], new Map(), LETTER, d, 1);
    const page = r.pages[0]!;
    expect(page.heading!.lines).toHaveLength(1);
    expect(page.heading!.lines[0]!.text).toBe(text);
    const font = createFont(fonts.headingBold.bytes);
    const expectedMm = (font.layout(text).advanceWidth * 14 * (25.4 / 72)) / font.unitsPerEm;
    // Wrap the same text at a width just under the expected: it must split; just over: it must not.
    const narrow = settingsOf({ page: 'custom', customSize: { widthMm: expectedMm + 2 * 12 - 0.5, heightMm: 200 }, marginMm: 12 });
    const wide = settingsOf({ page: 'custom', customSize: { widthMm: expectedMm + 2 * 12 + 0.5, heightMm: 200 }, marginMm: 12 });
    const rn = await composeExport([scanPart('s:0', ['a/s1'], heading(text))], new Map(), narrow, d, 1);
    const rw = await composeExport([scanPart('s:0', ['a/s1'], heading(text))], new Map(), wide, d, 1);
    expect(rn.pages[0]!.heading!.lines.length).toBeGreaterThan(1);
    expect(rw.pages[0]!.heading!.lines).toHaveLength(1);
  });

  it('wraps long rubrics within the printable width', async () => {
    const long = Array.from({ length: 60 }, () => 'alleluia').join(' ');
    const d = makeDeps(fonts, { 'a/s1': '1200x400' }, {});
    const r = await composeExport([scanPart('s:0', ['a/s1'], heading('T', { rubric: long }))], new Map(), LETTER, d, 1);
    const lines = r.pages[0]!.heading!.lines.filter((l) => l.role === 'rubric');
    expect(lines.length).toBeGreaterThan(2);
    const font = createFont(fonts.headingItalic.bytes);
    for (const l of lines) {
      const w = (font.layout(l.text).advanceWidth * 10 * (25.4 / 72)) / font.unitsPerEm;
      expect(w).toBeLessThanOrEqual(r.pages[0]!.printable.widthMm + 1e-6);
    }
  });
});
