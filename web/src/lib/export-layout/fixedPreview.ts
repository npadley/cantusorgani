// Screen preview of a fixed (pre-typeset PDF) canonical page.
//
// pdf.js is imported dynamically inside previewFixedPage, so merely importing
// this module never loads it. The export path (compose / vectorPdf / workers)
// must never import this file; fixedPreview.test.ts enforces that.

import type { AssetLoader, FixedCanonicalPage, PreviewBitmap } from './types';

const PT_MM = 25.4 / 72;
export const MAX_PIXELS_PER_MM = 8;
export const MAX_CANVAS_PX = 4096;

export interface PreviewOptions {
  readonly pixelsPerMm: number;
  readonly signal?: AbortSignal;
}

export interface PreviewGeometry {
  readonly pixelsPerMm: number;
  readonly widthPx: number;
  readonly heightPx: number;
  /** pdf.js viewport scale: canvas pixels per PDF point (uniform). */
  readonly viewportScale: number;
  readonly translateXPx: number;
  readonly translateYPx: number;
}

/** Pure size/transform math: canonical page size x pixelsPerMm, clamped to the hard limits. */
export function previewGeometry(page: FixedCanonicalPage, requestedPixelsPerMm: number): PreviewGeometry {
  if (!Number.isFinite(requestedPixelsPerMm) || requestedPixelsPerMm <= 0) {
    throw new Error(`INVALID_PREVIEW_SCALE: ${requestedPixelsPerMm}`);
  }
  let ppm = Math.min(requestedPixelsPerMm, MAX_PIXELS_PER_MM);
  const longest = Math.max(page.widthMm, page.heightMm) * ppm;
  if (longest > MAX_CANVAS_PX) ppm *= MAX_CANVAS_PX / longest;
  const widthPx = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(page.widthMm * ppm)));
  const heightPx = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(page.heightMm * ppm)));
  return {
    pixelsPerMm: ppm,
    widthPx,
    heightPx,
    // Same uniform transform the PDF export uses (scaleX === scaleY).
    viewportScale: page.transform.scaleX * PT_MM * ppm,
    translateXPx: page.transform.translateXMm * ppm,
    translateYPx: page.transform.translateYMm * ppm,
  };
}

// ---- minimal structural views of the bits of pdf.js and OffscreenCanvas we use ----
export interface PdfjsViewport { readonly width: number; readonly height: number }
export interface PdfjsPage {
  getViewport(p: { scale: number }): PdfjsViewport;
  render(p: {
    canvasContext: unknown;
    canvas: unknown;
    viewport: PdfjsViewport;
    transform?: number[];
    background?: string;
  }): { promise: Promise<void>; cancel?: () => void };
  cleanup?: () => void;
}
export interface PdfjsDocument {
  readonly numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  /** pdf.js 6 removed this from the document proxy (it lives on the loading task); older builds and test doubles still have it. */
  destroy?(): Promise<void>;
}
export interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfjsDocument>; destroy?: () => Promise<void> };
}
export interface PreviewCanvas {
  readonly canvas: unknown;
  readonly context: unknown;
  fillWhite(): void;
  toPngBlob(): Promise<Blob>;
}

export type PdfjsLoader = () => Promise<PdfjsModule>;
export type CanvasFactory = (widthPx: number, heightPx: number) => PreviewCanvas;

const defaultLoader: PdfjsLoader = async () => {
  const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
  mod.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  return mod;
};

const defaultCanvasFactory: CanvasFactory = (widthPx, heightPx) => {
  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('PREVIEW_UNSUPPORTED: no 2d context');
  return {
    canvas,
    context,
    fillWhite() {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, widthPx, heightPx);
    },
    toPngBlob: () => canvas.convertToBlob({ type: 'image/png' }),
  };
};

let loader: PdfjsLoader = defaultLoader;
let canvasFactory: CanvasFactory = defaultCanvasFactory;

/** Test seam: pass null to restore defaults. */
export function __setPdfjsLoaderForTests(l: PdfjsLoader | null): void {
  loader = l ?? defaultLoader;
}
/** Test seam: pass null to restore defaults. */
export function __setCanvasFactoryForTests(f: CanvasFactory | null): void {
  canvasFactory = f ?? defaultCanvasFactory;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('CANCELLED');
}

export async function previewFixedPage(page: FixedCanonicalPage, assets: AssetLoader, opts: PreviewOptions): Promise<PreviewBitmap> {
  throwIfAborted(opts.signal);
  const geo = previewGeometry(page, opts.pixelsPerMm);

  let bytes: Uint8Array;
  try {
    bytes = await assets.bytes(page.sourceUrl, null);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.startsWith('ASSET_MISSING') || m.startsWith('ASSET_HASH_MISMATCH')) throw e;
    throw new Error(`ASSET_MISSING: ${page.sourceUrl}`);
  }
  throwIfAborted(opts.signal);

  const pdfjs = await loader();
  throwIfAborted(opts.signal);

  // pdf.js transfers the buffer to its worker; give it a copy so the loader's cache stays intact.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  let doc: PdfjsDocument;
  try {
    doc = await task.promise;
  } catch {
    throw new Error(`ASSET_MISSING: ${page.sourceUrl} is not a readable PDF`);
  }
  try {
    throwIfAborted(opts.signal);
    if (!Number.isInteger(page.sourcePageIndex) || page.sourcePageIndex < 0 || page.sourcePageIndex >= doc.numPages) {
      throw new Error(`FIXED_PAGE_COUNT_MISMATCH: ${page.sourceUrl} has ${doc.numPages} pages, wanted index ${page.sourcePageIndex}`);
    }
    const src = await doc.getPage(page.sourcePageIndex + 1);
    throwIfAborted(opts.signal);

    const target = canvasFactory(geo.widthPx, geo.heightPx);
    target.fillWhite();
    const viewport = src.getViewport({ scale: geo.viewportScale });
    const render = src.render({
      canvasContext: target.context,
      canvas: target.canvas,
      viewport,
      transform: [1, 0, 0, 1, geo.translateXPx, geo.translateYPx],
      background: 'rgb(255,255,255)',
    });
    const onAbort = (): void => render.cancel?.();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await render.promise;
    } catch (e) {
      if (opts.signal?.aborted) throw new Error('CANCELLED');
      throw e;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
    throwIfAborted(opts.signal);
    const blob = await target.toPngBlob();
    throwIfAborted(opts.signal);
    return { width: geo.widthPx, height: geo.heightPx, blob };
  } finally {
    // pdf.js 6: PDFDocumentProxy has no destroy(); the loading task owns the worker-side document.
    await (doc.destroy !== undefined ? doc.destroy() : task.destroy?.())?.catch(() => undefined);
  }
}
