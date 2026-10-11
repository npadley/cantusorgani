import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, degrees } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import createVerovioModule from 'verovio/wasm';
import type { VerovioModule } from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { composeExport, reservationFor } from './compose';
import type { ComposeDeps } from './compose';
import { exportCanonicalPdf, mmRectToPdfPt } from './exportPdf';
import { loadFontProfile } from './fonts';
import { renderMei } from './layout';
import type { PageRects } from './layout';
import { paperDimensions, usableRect } from './settings';
import { DEFAULT_SETTINGS, PROVISIONAL_LIMITS } from './types';
import type {
  AssetLoader, ExportPart, FixedExportPart, FontProfile, LayoutResult, LayoutSettings, MeiExportPart, MeiLayout, MeiPart,
  PartHeading, SafeBoundary, ScanExportPart,
} from './types';
import { EXPERIMENT_MEI, experimentBoundaries, WASM_TIMEOUT_MS } from './__fixtures__/layoutHarness';

const FONT_DIR = join(__dirname, '..', '..', '..', 'public', 'fonts', 'export');
const MM = 72 / 25.4;
const settingsOf = (patch: Partial<LayoutSettings> = {}): LayoutSettings => ({ ...DEFAULT_SETTINGS, ...patch });
const IPAD = settingsOf({ page: 'ipad-11', marginMm: 4, linePolicy: 'automatic' });
const LETTER = settingsOf({ page: 'letter' });

const heading = (label: string, extra: Partial<PartHeading> = {}): PartHeading => ({
  label, rubric: null, rubricTranslation: null, credit: null, ...extra,
});
const meiPart = (id: string, h: PartHeading | null): MeiExportPart => ({
  id, kind: 'mei', label: 'Kyrie', heading: h, sourceSystemCount: 3, sourceRevision: 'rev1', target: 'movement:test', renderHash: 'h'.repeat(32),
  conversion: {
    digest: 'd'.repeat(64), meiUrl: '', meiSha256: '', sourceRevision: 'rev1', profile: 'accompaniment-v1',
    verovio: '6.3.0-425dd7b', boundaries: [], capabilities: { manualBreaks: true },
  },
});
const scanPart = (id: string, stems: readonly string[]): ScanExportPart => ({
  id, kind: 'scan', label: 'Gradual', heading: heading('Gradual', { credit: 'Source: Graduale Romanum' }), sourceSystemCount: 3,
  sourceRevision: stems[0] ?? '', stems, customizableAvailable: false,
});
const fixedPart = (id: string): FixedExportPart => ({
  id, kind: 'fixed', label: 'Credo', heading: heading('Credo'), sourceSystemCount: 3, sourceRevision: 'fx',
  target: 'movement:credo', renderHash: 'f'.repeat(32), letterPdf: 'letter.pdf', a4Pdf: 'a4.pdf',
});

// ---- real tiny assets -------------------------------------------------------
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** A valid 8-bit grayscale PNG. */
function makePng(w: number, h: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 0xcc);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}
async function makeSourcePdf(sizes: readonly (readonly [number, number])[], text = 'Credo in unum'): Promise<Uint8Array> {
  const d = await PDFDocument.create({ updateMetadata: false });
  for (const [w, h] of sizes) d.addPage([w, h]).drawText(text, { x: 40, y: h - 60, size: 14 });
  return d.save({ useObjectStreams: false });
}
const pngSize = (bytes: Uint8Array): { width: number; height: number } => {
  const b = Buffer.from(bytes);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

const PNG_PX = { w: 1200, h: 400 };
const PDF_SIZES = { 'letter.pdf': [[612, 792], [612, 792]], 'a4.pdf': [[595.28, 841.89]] } as const;

describe('exportCanonicalPdf', () => {
  let wasm: VerovioModule;
  let fonts: FontProfile;
  let png: Uint8Array;
  let pdfBytes: Record<string, Uint8Array>;
  const toolkits: VerovioToolkit[] = [];
  const calls: string[] = [];

  beforeAll(async () => {
    wasm = await createVerovioModule();
    fonts = await loadFontProfile(async (url) => new Uint8Array(readFileSync(join(FONT_DIR, url.split('/').pop()!))));
    png = makePng(PNG_PX.w, PNG_PX.h);
    pdfBytes = {
      'letter.pdf': await makeSourcePdf(PDF_SIZES['letter.pdf']),
      'a4.pdf': await makeSourcePdf(PDF_SIZES['a4.pdf']),
    };
  }, WASM_TIMEOUT_MS);

  const assets: AssetLoader = {
    async bytes(url) {
      calls.push(url);
      if (url.endsWith('@2x.png') && url.startsWith('a/')) return png;
      const p = pdfBytes[url];
      if (p) return p;
      throw new Error(`ASSET_MISSING: ${url}`);
    },
  };
  const composeDeps = (): ComposeDeps => ({
    fonts, assets, pngSize,
    async pdfPageSize(bytes, index) {
      const d = await PDFDocument.load(bytes);
      const p = d.getPage(Math.min(index, d.getPageCount() - 1));
      return { width: p.getWidth(), height: p.getHeight(), count: d.getPageCount() };
    },
  });

  async function meiLayout(part: MeiExportPart, s: LayoutSettings): Promise<MeiLayout> {
    const withB: MeiExportPart = { ...part, conversion: { ...part.conversion, boundaries: experimentBoundaries() as SafeBoundary[] } };
    const input: MeiPart = { part: withB, meiXml: EXPERIMENT_MEI };
    const res = reservationFor(part, s, fonts);
    const full = usableRect(paperDimensions(s), s.marginMm);
    const content = { ...full, heightMm: full.heightMm - res.footerMm };
    const rects: PageRects = { content, firstPageContent: { ...content, heightMm: content.heightMm - res.headingMm } };
    const tk = new VerovioToolkit(wasm);
    toolkits.push(tk);
    return renderMei(input, s, [], { token: 1, fonts, limits: PROVISIONAL_LIMITS, isCancelled: () => false, toolkit: tk }, rects);
  }

  async function compose(s: LayoutSettings, withMei = true, h: PartHeading | null = heading('Kýrie eléison', { rubric: 'cœli: á é í ó ú', credit: 'Crédit' })): Promise<LayoutResult> {
    const parts: ExportPart[] = [];
    const layouts = new Map<string, MeiLayout>();
    if (withMei) {
      const m = meiPart('m:0', h);
      layouts.set(m.id, await meiLayout(m, s));
      parts.push(m);
    }
    parts.push(scanPart('s:0', ['a/s1', 'a/s2']), fixedPart('f:0'));
    return composeExport(parts, layouts, s, composeDeps(), 3);
  }

  const dictOf = (o: PDFObject | undefined, doc: PDFDocument): PDFDict | undefined => {
    const r = o instanceof PDFRef ? doc.context.lookup(o) : o;
    return r instanceof PDFDict ? r : r instanceof PDFRawStream ? r.dict : undefined;
  };
  /** All (Subtype, Width, Height) image XObjects and form XObjects in the doc. */
  function xobjects(doc: PDFDocument): { images: { w: number; h: number }[]; forms: number } {
    const images: { w: number; h: number }[] = [];
    let forms = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const d = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
      if (!d) continue;
      const sub = d.get(PDFName.of('Subtype'));
      if (sub === PDFName.of('Image')) {
        images.push({ w: (d.get(PDFName.of('Width')) as PDFNumber).asNumber(), h: (d.get(PDFName.of('Height')) as PDFNumber).asNumber() });
      } else if (sub === PDFName.of('Form') && d.get(PDFName.of('Type')) !== PDFName.of('Annot')) forms++;
    }
    return { images, forms };
  }
  const pageXObjectNames = (doc: PDFDocument, i: number): { images: number; forms: number } => {
    const res = dictOf(doc.getPage(i).node.get(PDFName.of('Resources')), doc);
    const xo = dictOf(res?.get(PDFName.of('XObject')), doc);
    let images = 0, forms = 0;
    if (xo) for (const [, v] of xo.entries()) {
      const d = dictOf(v, doc);
      if (d?.get(PDFName.of('Subtype')) === PDFName.of('Image')) images++; else forms++;
    }
    return { images, forms };
  };

  async function pageText(bytes: Uint8Array, i: number): Promise<string> {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
    const tc = await (await doc.getPage(i + 1)).getTextContent();
    return tc.items.map((it) => ('str' in it ? it.str : '')).join('');
  }


  type Mat = readonly [number, number, number, number, number, number];
  const mul = (m: Mat, n: Mat): Mat => [
    n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3],
    n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5],
  ];
  interface Drawn { readonly bbox: { x0: number; y0: number; x1: number; y1: number }; readonly staffYs: number[] }
  /** What was actually drawn on a page: path bounds in top-left mm after the CTM, plus horizontal-line path y's. */
  async function measureDrawn(bytes: Uint8Array, pageIndex: number, pageHeightMm: number): Promise<Drawn> {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
    const ops = await (await doc.getPage(pageIndex + 1)).getOperatorList();
    let ctm: Mat = [1, 0, 0, 1, 0, 0];
    const stack: Mat[] = [];
    const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const ys = new Set<number>();
    ops.fnArray.forEach((fn, i) => {
      const a = ops.argsArray[i] as unknown[];
      if (fn === pdfjs.OPS.save) stack.push(ctm);
      else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, a as unknown as Mat);
      else if (fn === pdfjs.OPS.constructPath) {
        const mm = a[2] as ArrayLike<number>;
        const pts: [number, number][] = [[mm[0]!, mm[1]!], [mm[2]!, mm[3]!]];
        const dev = pts.map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]] as const);
        for (const [x, y] of dev) {
          bbox.x0 = Math.min(bbox.x0, x / MM); bbox.x1 = Math.max(bbox.x1, x / MM);
          const ymm = pageHeightMm - y / MM;
          bbox.y0 = Math.min(bbox.y0, ymm); bbox.y1 = Math.max(bbox.y1, ymm);
        }
        // A horizontal staff-line candidate: wide and (almost) flat.
        if (Math.abs(dev[1]![1] - dev[0]![1]) < 0.01 && Math.abs(dev[1]![0] - dev[0]![0]) / MM > 20) ys.add(Math.round((pageHeightMm - dev[0]![1] / MM) * 1000) / 1000);
      }
    });
    return { bbox, staffYs: [...ys].sort((p, q) => p - q) };
  }

  it('draws MEI content inside the content rect at the true staff size', async () => {
    const result = await compose(LETTER, true);
    const out = await exportCanonicalPdf(result, { assets, fonts });
    const idx = result.pages.findIndex((p) => p.kind === 'mei');
    const page = result.pages[idx]!;
    const d = await measureDrawn(out.bytes, idx, page.heightMm);
    console.log('DRAWN', JSON.stringify(d.bbox), 'CONTENT', JSON.stringify(page.content), 'STAFF', JSON.stringify(d.staffYs.slice(0, 6)));
    const c = page.content;
    const tol = 0.5;
    expect(d.bbox.x0).toBeGreaterThanOrEqual(c.xMm - tol);
    expect(d.bbox.y0).toBeGreaterThanOrEqual(c.yMm - tol);
    expect(d.bbox.x1).toBeLessThanOrEqual(c.xMm + c.widthMm + tol);
    expect(d.bbox.y1).toBeLessThanOrEqual(c.yMm + c.heightMm + tol);
    expect(d.staffYs.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < 5; i++) expect(Math.abs(d.staffYs[i]! - d.staffYs[i - 1]! - 1.8)).toBeLessThan(0.05);
  }, WASM_TIMEOUT_MS);

  it('converts top-left mm rects to bottom-left pt', () => {
    const r = mmRectToPdfPt({ xMm: 10, yMm: 20, widthMm: 30, heightMm: 40 }, 200);
    expect(r.x).toBeCloseTo(10 * MM, 9);
    expect(r.width).toBeCloseTo(30 * MM, 9);
    expect(r.height).toBeCloseTo(40 * MM, 9);
    expect(r.y).toBeCloseTo((200 - 20 - 40) * MM, 9);
  });

  it('writes one page per canonical page with exact MediaBoxes (letter and ipad-11 landscape)', async () => {
    for (const s of [LETTER, settingsOf({ page: 'ipad-11', orientation: 'landscape', marginMm: 4, linePolicy: 'automatic' }), IPAD]) {
      const result = await compose(s);
      expect(result.complete).toBe(true);
      const out = await exportCanonicalPdf(result, { assets, fonts });
      expect(out.pageCount).toBe(result.pages.length);
      expect(out.byteSize).toBe(out.bytes.length);
      const doc = await PDFDocument.load(out.bytes);
      expect(doc.getPageCount()).toBe(result.pages.length);
      result.pages.forEach((p, i) => {
        const mb = doc.getPage(i).getMediaBox();
        expect(Math.abs(mb.width - p.widthMm * MM)).toBeLessThan(0.01);
        expect(Math.abs(mb.height - p.heightMm * MM)).toBeLessThan(0.01);
      });
    }
  }, WASM_TIMEOUT_MS);

  it('embeds scans at pixel size, fixed pages as forms, and MEI pages with no images', async () => {
    const result = await compose(IPAD);
    const out = await exportCanonicalPdf(result, { assets, fonts });
    const doc = await PDFDocument.load(out.bytes);
    const x = xobjects(doc);
    const scanImages = result.pages.flatMap((p) => (p.kind === 'scan' ? p.images : []));
    expect(scanImages.length).toBeGreaterThan(0);
    expect(x.images).toHaveLength(scanImages.length);
    for (const im of x.images) expect(im).toEqual({ w: PNG_PX.w, h: PNG_PX.h });
    expect(x.forms).toBeGreaterThanOrEqual(1);
    result.pages.forEach((p, i) => {
      const n = pageXObjectNames(doc, i);
      if (p.kind === 'mei') expect(n).toEqual({ images: 0, forms: 0 });
      if (p.kind === 'fixed') expect(n).toEqual({ images: 0, forms: 1 });
      if (p.kind === 'scan') expect(n.images).toBe(p.images.length);
    });
    // The embedded page's real size matches what compose recorded.
    const fx = result.pages.find((q) => q.kind === 'fixed')!;
    if (fx.kind === 'fixed') {
      const src = await PDFDocument.load(pdfBytes[fx.sourceUrl]!);
      const sz = src.getPage(fx.sourcePageIndex).getSize();
      expect(Math.abs(sz.width - fx.sourceSizePt.width)).toBeLessThan(0.5);
      expect(Math.abs(sz.height - fx.sourceSizePt.height)).toBeLessThan(0.5);
    }
    // Fixed source text stays real text (vector, not rasterised).
    const fixedIdx = result.pages.findIndex((p) => p.kind === 'fixed');
    expect(await pageText(out.bytes, fixedIdx)).toContain('Credo in unum');
  }, WASM_TIMEOUT_MS);

  it('draws Unicode headings and footers through the embedded fonts', async () => {
    const result = await compose(IPAD);
    const out = await exportCanonicalPdf(result, { assets, fonts });
    const firstMei = result.pages.findIndex((p) => p.kind === 'mei');
    const text = await pageText(out.bytes, firstMei);
    expect(text).toContain('Kýrie');
    expect(text).toContain('eléison');
    expect(text).toContain('cœli');
    const lastMei = result.pages.map((p) => p.kind).lastIndexOf('mei');
    expect(await pageText(out.bytes, lastMei)).toContain('Crédit');
  }, WASM_TIMEOUT_MS);

  it('is deterministic and reports the Kyrie Letter size', async () => {
    const result = await compose(LETTER);
    const a = await exportCanonicalPdf(result, { assets, fonts });
    const b = await exportCanonicalPdf(result, { assets, fonts });
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    const kyrieOnly = await compose(LETTER, true).then((r) => ({ ...r, pages: r.pages.filter((p) => p.partId === 'm:0') }));
    const k = await exportCanonicalPdf(kyrieOnly, { assets, fonts });
    console.log(`KYRIE_LETTER_PDF_BYTES=${k.byteSize} pages=${k.pageCount} full=${a.byteSize}`);
    expect(k.byteSize).toBeGreaterThan(0);
  }, WASM_TIMEOUT_MS);

  it('fetches each asset once and the scan with the @2x URL and no hash', async () => {
    const result = await compose(LETTER, false);
    calls.length = 0;
    await exportCanonicalPdf(result, { assets, fonts });
    expect(calls.filter((u) => u === 'a/s1@2x.png')).toHaveLength(1);
    expect(calls.filter((u) => u === 'letter.pdf' || u === 'a4.pdf').length).toBeGreaterThan(0);
  }, WASM_TIMEOUT_MS);

  it('rejects ASSET_MISSING for a missing asset and propagates ASSET_HASH_MISMATCH', async () => {
    const result = await compose(LETTER, false);
    const missing: AssetLoader = { async bytes(url) { if (url.endsWith('@2x.png')) throw new Error(`ASSET_MISSING: ${url}`); return assets.bytes(url, null); } };
    await expect(exportCanonicalPdf(result, { assets: missing, fonts })).rejects.toThrow(/^ASSET_MISSING/);
    const bad: AssetLoader = { async bytes(url) { if (url.endsWith('.pdf')) throw new Error(`ASSET_HASH_MISMATCH: ${url}`); return assets.bytes(url, null); } };
    await expect(exportCanonicalPdf(result, { assets: bad, fonts })).rejects.toThrow(/^ASSET_HASH_MISMATCH/);
    const odd: AssetLoader = { async bytes() { throw new TypeError('network down'); } };
    await expect(exportCanonicalPdf(result, { assets: odd, fonts })).rejects.toThrow(/^ASSET_MISSING/);
  }, WASM_TIMEOUT_MS);

  it('rejects FIXED_PAGE_COUNT_MISMATCH when the source has too few pages', async () => {
    const result = await compose(LETTER, false);
    const fixed = result.pages.find((p) => p.kind === 'fixed')!;
    if (fixed.kind !== 'fixed') throw new Error('unreachable');
    const shorter: AssetLoader = { async bytes(url) { return url.endsWith('.pdf') ? makeSourcePdf([[612, 792]]) : assets.bytes(url, null); } };
    const pages = result.pages.map((p) => (p === fixed ? { ...fixed, sourcePageIndex: 1 } : p));
    await expect(exportCanonicalPdf({ ...result, pages }, { assets: shorter, fonts })).rejects.toThrow(/^FIXED_PAGE_COUNT_MISMATCH/);
  }, WASM_TIMEOUT_MS);

  it('rejects a rotated fixed source', async () => {
    const result = await compose(LETTER, false);
    const rotated: AssetLoader = {
      async bytes(url) {
        if (!url.endsWith('.pdf')) return assets.bytes(url, null);
        const d = await PDFDocument.load(pdfBytes[url]!);
        d.getPage(0).setRotation(degrees(90));
        return d.save();
      },
    };
    await expect(exportCanonicalPdf(result, { assets: rotated, fonts })).rejects.toThrow(/^FIXED_PAGE_COUNT_MISMATCH: rotated-source/);
  }, WASM_TIMEOUT_MS);

  it('refuses an incomplete layout', async () => {
    const result = await compose(LETTER, false);
    await expect(exportCanonicalPdf({ ...result, complete: false }, { assets, fonts })).rejects.toThrow('PDF_FAILED: incomplete layout');
  }, WASM_TIMEOUT_MS);
});
