import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  __setCanvasFactoryForTests, __setPdfjsLoaderForTests, previewFixedPage, previewGeometry,
  type PdfjsDocument, type PdfjsModule, type PdfjsPage, type PreviewCanvas,
} from './fixedPreview';
import { paperDimensions } from './settings';
import { DEFAULT_SETTINGS, type AssetLoader, type FixedCanonicalPage, type LayoutSettings } from './types';

const PT_MM = 25.4 / 72;
const ipad: LayoutSettings = { ...DEFAULT_SETTINGS, page: 'ipad-11', marginMm: 4 };

/** A Letter source fitted onto an ipad-11 portrait page, using compose.ts's formula. */
function letterOnIpad(sourcePageIndex = 0): FixedCanonicalPage {
  const phys = paperDimensions(ipad);
  const m = 4;
  const content = { xMm: m, yMm: m, widthMm: phys.widthMm - 2 * m, heightMm: phys.heightMm - 2 * m };
  const size = { width: 612, height: 792 };
  const srcW = size.width * PT_MM;
  const srcH = size.height * PT_MM;
  const scale = Math.min(content.widthMm / srcW, content.heightMm / srcH);
  return {
    index: 0, kind: 'fixed', widthMm: phys.widthMm, heightMm: phys.heightMm, partId: 'f:0',
    printable: content, content, heading: null, footer: null, unusedFraction: 0,
    sourceUrl: 'letter.pdf', sourcePaper: 'letter', sourcePageIndex, sourceSizePt: size,
    transform: {
      scaleX: scale, scaleY: scale,
      translateXMm: content.xMm + (content.widthMm - srcW * scale) / 2,
      translateYMm: content.yMm + (content.heightMm - srcH * scale) / 2,
    },
    systemCount: null,
  };
}

interface Calls { scale: number[]; transform: number[][]; canvas: [number, number][]; filled: number; destroyed: number }
function fakes(numPages = 2, onRender?: () => void): { mod: PdfjsModule; calls: Calls; loader: ReturnType<typeof vi.fn> } {
  const calls: Calls = { scale: [], transform: [], canvas: [], filled: 0, destroyed: 0 };
  const page: PdfjsPage = {
    getViewport: ({ scale }) => { calls.scale.push(scale); return { width: 0, height: 0 }; },
    render: (p) => { if (p.transform) calls.transform.push(p.transform); onRender?.(); return { promise: Promise.resolve() }; },
  };
  const doc: PdfjsDocument = {
    numPages, getPage: async () => page,
    destroy: async () => { calls.destroyed++; },
  };
  const mod: PdfjsModule = { GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({ promise: Promise.resolve(doc) }) };
  const loader = vi.fn(async () => mod);
  __setPdfjsLoaderForTests(loader);
  __setCanvasFactoryForTests((w, h): PreviewCanvas => {
    calls.canvas.push([w, h]);
    return { canvas: {}, context: {}, fillWhite: () => { calls.filled++; }, toPngBlob: async () => new Blob(['png'], { type: 'image/png' }) };
  });
  return { mod, calls, loader };
}
const okAssets: AssetLoader = { bytes: async () => new Uint8Array([1, 2, 3]) };

afterEach(() => { __setPdfjsLoaderForTests(null); __setCanvasFactoryForTests(null); });

describe('previewGeometry', () => {
  it('sizes the canvas as canonical page x pixelsPerMm with a uniform scale', () => {
    const p = letterOnIpad();
    const g = previewGeometry(p, 2);
    expect(g.widthPx).toBe(Math.round(p.widthMm * 2));
    expect(g.heightPx).toBe(Math.round(p.heightMm * 2));
    expect(g.viewportScale).toBeCloseTo(p.transform.scaleX * PT_MM * 2, 9);
    expect(g.translateXPx).toBeCloseTo(p.transform.translateXMm * 2, 9);
    expect(g.translateYPx).toBeCloseTo(p.transform.translateYMm * 2, 9);
    // the drawn page fits the canvas
    expect(612 * g.viewportScale + g.translateXPx).toBeLessThanOrEqual(g.widthPx + 1e-6);
    expect(792 * g.viewportScale + g.translateYPx).toBeLessThanOrEqual(g.heightPx + 1e-6);
  });
  it('clamps pixelsPerMm to 8', () => {
    const p = { ...letterOnIpad(), widthMm: 100, heightMm: 120 };
    expect(previewGeometry(p, 50).pixelsPerMm).toBe(8);
    expect(previewGeometry(p, 50).widthPx).toBe(800);
  });
  it('reduces scale proportionally when a side would exceed 4096 px', () => {
    const p = { ...letterOnIpad(), widthMm: 300, heightMm: 600 };
    const g = previewGeometry(p, 8); // 4800 px tall unclamped
    expect(g.heightPx).toBe(4096);
    expect(g.widthPx).toBeLessThanOrEqual(4096);
    expect(g.widthPx / g.heightPx).toBeCloseTo(0.5, 2);
    expect(g.pixelsPerMm).toBeCloseTo(4096 / 600, 9);
  });
  it('rejects non-positive scales', () => {
    expect(() => previewGeometry(letterOnIpad(), 0)).toThrow('INVALID_PREVIEW_SCALE');
  });
});

describe('previewFixedPage', () => {
  it('does not load pdf.js until called', async () => {
    const { loader } = fakes();
    expect(loader).not.toHaveBeenCalled();
    await previewFixedPage(letterOnIpad(), okAssets, { pixelsPerMm: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it('renders with the export transform on a white canvas and returns a PNG', async () => {
    const { calls } = fakes();
    const p = letterOnIpad(1);
    const r = await previewFixedPage(p, okAssets, { pixelsPerMm: 2 });
    const g = previewGeometry(p, 2);
    expect(r.width).toBe(g.widthPx);
    expect(r.height).toBe(g.heightPx);
    expect(r.blob.type).toBe('image/png');
    expect(calls.canvas).toEqual([[g.widthPx, g.heightPx]]);
    expect(calls.filled).toBe(1);
    expect(calls.scale[0]).toBeCloseTo(g.viewportScale, 9);
    expect(calls.transform[0]).toEqual([1, 0, 0, 1, g.translateXPx, g.translateYPx]);
    expect(calls.destroyed).toBe(1);
  });
  it('throws CANCELLED for an already-aborted signal, before loading anything', async () => {
    const { loader } = fakes();
    const ac = new AbortController(); ac.abort();
    await expect(previewFixedPage(letterOnIpad(), okAssets, { pixelsPerMm: 2, signal: ac.signal })).rejects.toThrow('CANCELLED');
    expect(loader).not.toHaveBeenCalled();
  });
  it('throws CANCELLED when aborted mid-render', async () => {
    const ac = new AbortController();
    fakes(2, () => ac.abort());
    await expect(previewFixedPage(letterOnIpad(), okAssets, { pixelsPerMm: 2, signal: ac.signal })).rejects.toThrow('CANCELLED');
  });
  it('maps a fetch failure to ASSET_MISSING', async () => {
    fakes();
    const bad: AssetLoader = { bytes: async () => { throw new Error('boom'); } };
    await expect(previewFixedPage(letterOnIpad(), bad, { pixelsPerMm: 2 })).rejects.toThrow(/^ASSET_MISSING/);
  });
  it('maps an out-of-range page index to FIXED_PAGE_COUNT_MISMATCH and still destroys the doc', async () => {
    const { calls } = fakes(2);
    await expect(previewFixedPage(letterOnIpad(2), okAssets, { pixelsPerMm: 2 })).rejects.toThrow(/^FIXED_PAGE_COUNT_MISMATCH/);
    expect(calls.destroyed).toBe(1);
  });
});

describe('import graph', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  it('keeps fixedPreview and pdfjs-dist out of the export path', () => {
    for (const f of ['exportPdf.ts', 'compose.ts', 'vectorPdf.ts', 'workerDeps.ts']) {
      const path = join(dir, f);
      if (!existsSync(path)) continue;
      const src = readFileSync(path, 'utf8');
      expect(src, f).not.toMatch(/fixedPreview/);
      expect(src, f).not.toMatch(/pdfjs-dist/);
    }
    expect(existsSync(join(dir, 'compose.ts'))).toBe(true);
  });
});
