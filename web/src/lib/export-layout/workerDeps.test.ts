import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { composeExport } from './compose';
import { loadFontProfile, sha256Hex } from './fonts';
import { DEFAULT_SETTINGS, PROVISIONAL_LIMITS } from './types';
import type { FontProfile, LayoutSettings, MeiExportPart, PartHeading, SafeBoundary } from './types';
import { composeDepsFor, createAssetLoader, createRenderPart, pageRectsFor, readPdfPageSize, readPngSize } from './workerDeps';

const FONT_DIR = join(__dirname, '..', '..', '..', 'public', 'fonts', 'export');
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix-experiment.mei'));
const pad = (n: number): string => String(n).padStart(3, '0');

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('readPngSize', () => {
  it('reads width and height from IHDR', () => {
    expect(readPngSize(pngHeader(1200, 400))).toEqual({ width: 1200, height: 400 });
  });
  it('reads a view that does not start at its buffer origin', () => {
    const padded = new Uint8Array(40);
    padded.set(pngHeader(7, 9), 5);
    expect(readPngSize(padded.subarray(5))).toEqual({ width: 7, height: 9 });
  });
  it('rejects a bad signature, a missing IHDR, truncation and zero sizes', () => {
    const bad = pngHeader(10, 10);
    bad[1] = 0;
    expect(() => readPngSize(bad)).toThrow(/not a PNG/);
    const noIhdr = pngHeader(10, 10);
    noIhdr[12] = 0;
    expect(() => readPngSize(noIhdr)).toThrow(/not a PNG/);
    expect(() => readPngSize(pngHeader(10, 10).subarray(0, 20))).toThrow(/not a PNG/);
    expect(() => readPngSize(pngHeader(0, 10))).toThrow(/zero dimension/);
  });
});

describe('readPdfPageSize', () => {
  it('returns the count and the size of the requested page, clamping the index', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([595, 842]);
    const bytes = await doc.save();
    expect(await readPdfPageSize(bytes, 0)).toEqual({ width: 612, height: 792, count: 2 });
    expect(await readPdfPageSize(bytes, 1)).toEqual({ width: 595, height: 842, count: 2 });
    expect(await readPdfPageSize(bytes, 9)).toMatchObject({ width: 595, count: 2 });
  });
  it('rejects bytes that are not a PDF', async () => {
    await expect(readPdfPageSize(new Uint8Array([1, 2, 3]), 0)).rejects.toThrow();
  });
});

describe('createAssetLoader', () => {
  const respond = (body: Uint8Array, ok = true): typeof fetch =>
    (async () => ({ ok, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) })) as unknown as typeof fetch;

  it('returns the bytes when no digest is required', async () => {
    const bytes = await createAssetLoader(respond(new Uint8Array([1, 2, 3]))).bytes('/a', null);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
  it('accepts a matching sha256 and rejects a mismatch with ASSET_HASH_MISMATCH', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const good = await sha256Hex(body);
    await expect(createAssetLoader(respond(body)).bytes('/a', good)).resolves.toBeInstanceOf(Uint8Array);
    await expect(createAssetLoader(respond(body)).bytes('/a', 'f'.repeat(64))).rejects.toThrow('ASSET_HASH_MISMATCH: /a');
  });
  it('maps a bad status and a network failure to ASSET_MISSING', async () => {
    await expect(createAssetLoader(respond(new Uint8Array(), false)).bytes('/gone', null)).rejects.toThrow('ASSET_MISSING: /gone');
    const failing = (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch;
    await expect(createAssetLoader(failing).bytes('/x', null)).rejects.toThrow('ASSET_MISSING: /x');
  });
});

describe('heading reservation agrees with composeExport', () => {
  let fonts: FontProfile;
  let wasm: Awaited<ReturnType<typeof createVerovioModule>>;
  beforeAll(async () => {
    wasm = await createVerovioModule();
    fonts = await loadFontProfile(async (url) => new Uint8Array(readFileSync(join(FONT_DIR, url.split('/').pop()!))));
  });

  const boundaries = (): SafeBoundary[] => Array.from({ length: 60 }, (_, i) => ({
    id: `c${pad(i + 1)}`, onset: `${i + 1}/1`, sourceBreak: false, division: null, measureId: `m${pad(i + 1)}`, afterText: null,
  }));
  const heading: PartHeading = { label: 'Kyrie', rubric: 'A rubric', rubricTranslation: 'A translation', credit: 'Credit line' };
  const partOf = async (): Promise<MeiExportPart> => ({
    id: 'k:0', kind: 'mei', label: 'Kyrie', heading, sourceSystemCount: 3, sourceRevision: 'rev1', target: 'movement:test',
    renderHash: 'h'.repeat(32),
    conversion: {
      digest: 'd'.repeat(64), meiUrl: '/mei', meiSha256: await sha256Hex(new Uint8Array(MEI)), sourceRevision: 'rev1',
      profile: 'accompaniment-v1', verovio: '6.3.0-425dd7b', boundaries: boundaries(), capabilities: { manualBreaks: true },
    },
  });

  it('gives renderMei the rects compose reports, so compose raises no INVALID_PAGE', async () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, page: 'ipad-11', marginMm: 4, linePolicy: 'automatic', maxSystems: 2 };
    const part = await partOf();
    const rects = pageRectsFor(settings, part, fonts);
    expect(rects.firstPageContent.heightMm).toBeLessThan(rects.content.heightMm);
    expect(rects.firstPageContent.yMm).toBeGreaterThan(rects.content.yMm);

    const renderPart = createRenderPart(async () => new Uint8Array(MEI));
    const layout = await renderPart(part, settings, [], {
      token: 1, fonts, limits: PROVISIONAL_LIMITS, isCancelled: () => false, toolkit: new VerovioToolkit(wasm),
    });
    expect(layout.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(1);

    const assets = { bytes: async (): Promise<Uint8Array> => { throw new Error('unused'); } };
    const result = await composeExport([part], new Map([[part.id, layout]]), settings, composeDepsFor(assets, fonts), 1);
    expect(result.diagnostics.filter((d) => d.code === 'INVALID_PAGE')).toEqual([]);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const pages = result.pages.filter((p) => p.kind === 'mei');
    expect(pages[0]!.content).toEqual(rects.firstPageContent);
    expect(pages[1]!.content).toEqual(rects.content);
  });

  it('reserves nothing for a part without a heading', async () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, page: 'letter' };
    const part = { ...(await partOf()), heading: null };
    const rects = pageRectsFor(settings, part, fonts);
    expect(rects.firstPageContent).toEqual(rects.content);
  });
});
