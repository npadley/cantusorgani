// K6: chant pages in the vector PDF. The Gradual fixture goes through K1's normalizer, the sanitizer, compose
// and the unchanged walker; the PDF must hold only Liberation subsets, no images, real text, and syllables
// where the SVG puts them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { composeExport } from './compose';
import type { ComposeDeps } from './compose';
import { buildChantLines } from './chantLines';
import { exportCanonicalPdf } from './exportPdf';
import { loadFontProfile } from './fonts';
import { DEFAULT_SETTINGS } from './types';
import type { AssetLoader, FontProfile, LayoutResult, ScanExportPart } from './types';

const FONT_DIR = join(__dirname, '..', '..', '..', 'public', 'fonts', 'export');
const MM = 72 / 25.4;
const LETTER = { ...DEFAULT_SETTINGS, page: 'letter' as const, chant: 'before' as const };

const gradual = (): ScanExportPart => ({
  id: 's:0', kind: 'scan', label: 'Gradual', sourceSystemCount: 1, sourceRevision: 'a/s1', stems: ['a/s1'], customizableAvailable: false,
  heading: { label: 'Gradual', rubric: null, rubricTranslation: null, credit: 'Source: Graduale Romanum' },
  chants: [{ id: 277, incipit: 'Exaltabo te', annotation: 'Grad.', mode: '3' }],
});
const fixtureSvg = (file: string): string => (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', file), 'utf8')) as { svg: string }).svg;

describe('exportCanonicalPdf with chant', () => {
  let fonts: FontProfile;
  let result: LayoutResult;
  let bytes: Uint8Array;
  const assets: AssetLoader = { async bytes() { throw new Error('ASSET_MISSING: no scans in this test'); } };
  const composeDeps = (): ComposeDeps => ({
    fonts, assets: { async bytes(url) { if (url.endsWith('@2x.png')) return new Uint8Array([1]); throw new Error(`ASSET_MISSING: ${url}`); } },
    pngSize: () => ({ width: 1200, height: 400 }),
    async pdfPageSize() { return { width: 612, height: 792, count: 1 }; },
  });

  beforeAll(async () => {
    fonts = await loadFontProfile(async (url) => new Uint8Array(readFileSync(join(FONT_DIR, url.split('/').pop()!))));
    const part = gradual();
    const chantLines = buildChantLines([part], LETTER, new Map([[277, fixtureSvg('gr-277-852.json')]]));
    result = await composeExport([part], new Map(), LETTER, composeDeps(), 1, chantLines);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // The scan itself is not under test: draw the chant pages only.
    const chantOnly: LayoutResult = { ...result, pages: result.pages.map((p) => (p.kind === 'scan' ? { ...p, images: [] } : p)) };
    result = chantOnly;
    bytes = (await exportCanonicalPdf(result, { assets, fonts })).bytes;
  }, 60_000);

  const dictOf = (o: PDFObject | undefined, doc: PDFDocument): PDFDict | undefined => {
    const r = o instanceof PDFRef ? doc.context.lookup(o) : o;
    return r instanceof PDFDict ? r : r instanceof PDFRawStream ? r.dict : undefined;
  };

  it('embeds only Liberation Serif subsets and no images', async () => {
    const doc = await PDFDocument.load(bytes);
    const baseFonts: string[] = [];
    let images = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const d = dictOf(obj, doc);
      if (!d) continue;
      if (d.get(PDFName.of('Type')) === PDFName.of('Font') && d.get(PDFName.of('Subtype')) !== PDFName.of('CIDFontType2')) {
        baseFonts.push(String(d.get(PDFName.of('BaseFont'))));
      }
      if (d.get(PDFName.of('Subtype')) === PDFName.of('Image')) images++;
    }
    expect(images).toBe(0);
    expect(baseFonts.length).toBeGreaterThan(0);
    for (const f of baseFonts) expect(f).toMatch(/Liberation/);
    expect(PDFArray).toBeDefined();
  });

  it('keeps the lyrics as real text', async () => {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
    const text = (await (await doc.getPage(1)).getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join('');
    expect(text).toContain('tá');
    expect(text).toContain('Dó');
    expect(text).toContain('Chant: GregoBase');
  });

  it('is byte-identical for identical input', async () => {
    const again = (await exportCanonicalPdf(result, { assets, fonts })).bytes;
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });

  it('puts a syllable where the SVG puts it, within 0.3 mm', async () => {
    const page = result.pages[0]!;
    const line = page.chant.find((c) => c.svg.svg.includes('>tá<'))!;
    expect(line).toBeDefined();
    const vb = /viewBox="([^"]+)"/.exec(line.svg.svg)![1]!.split(/\s+/).map(Number);
    const scale = line.rect.widthMm / vb[2]!;
    // The syllable sits in a <g transform="translate(gx,0)"> and has its own x.
    const m = /<g[^>]*transform="translate\(([-\d.]+),[-\d.]+\)"[^>]*><text\b[^>]*\bx="([-\d.]+)"[^>]*><tspan[^>]*>tá</.exec(line.svg.svg);
    expect(m).not.toBeNull();
    const expectedMm = line.rect.xMm + (Number(m![1]) + Number(m![2]) - vb[0]!) * scale;
    const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items.filter((it) => 'str' in it && it.str.includes('tá'));
    expect(items.length).toBeGreaterThan(0);
    const xs = items.map((it) => ('transform' in it ? it.transform[4]! / MM : NaN));
    expect(Math.min(...xs.map((x) => Math.abs(x - expectedMm)))).toBeLessThan(0.3);
  });
});
