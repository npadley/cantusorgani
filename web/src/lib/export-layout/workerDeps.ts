// B7c/B7d: the real dependencies of the export workers.
//
// `createCompose` wires B6a's composeExport with a fetch-based AssetLoader, a PNG header reader
// and a pdf-lib page-size reader. `createExportPdf` wires B6b's exportCanonicalPdf with the same
// AssetLoader and a lazily loaded font profile. The workers import only from this module.
//
// `createRenderPart` fetches and verifies a part's MEI, builds the page rectangles from compose's
// own reservationFor (so compose never sees a size mismatch) and calls renderMei.
import { PDFDocument } from 'pdf-lib';
import { composeExport as composeParts, reservationFor } from './compose';
import type { ComposeDeps } from './compose';
import { exportCanonicalPdf } from './exportPdf';
import { renderMei } from './layout';
import type { PageRects } from './layout';
import { loadFontProfile, sha256Hex } from './fonts';
import { sha256Bytes, toHex } from './sha256';
import { paperDimensions, usableRect } from './settings';
import type {
  AssetLoader,
  BreakOverride,
  ExportPart,
  FontProfile,
  LayoutResult,
  LayoutSettings,
  MeiExportPart,
  MeiLayout,
  PdfResult,
  RenderContext,
} from './types';

export type FetchBytes = (url: string) => Promise<Uint8Array>;

/**
 * The rectangles renderMei lays out into, identical to the content rects composeExport uses:
 * the usable rect minus the footer on every page, and also minus the heading (with the y offset
 * moved down by it) on the part's first page.
 */
export function pageRectsFor(settings: LayoutSettings, part: MeiExportPart, fonts: FontProfile): PageRects {
  const reservation = reservationFor(part, settings, fonts);
  const full = usableRect(paperDimensions(settings), settings.marginMm);
  const content = { ...full, heightMm: full.heightMm - reservation.footerMm };
  return {
    content,
    firstPageContent: {
      ...content,
      yMm: content.yMm + reservation.headingMm,
      heightMm: content.heightMm - reservation.headingMm,
    },
  };
}

/** Fetch the part's MEI, check it against the manifest digest, and lay it out. */
export function createRenderPart(fetchBytes: FetchBytes) {
  return async (
    part: MeiExportPart,
    settings: LayoutSettings,
    overrides: readonly BreakOverride[],
    ctx: RenderContext,
  ): Promise<MeiLayout> => {
    const { meiUrl, meiSha256 } = part.conversion;
    const bytes = await fetchBytes(meiUrl);
    if (bytes.byteLength > ctx.limits.maxMeiBytes) throw new Error(`SOURCE_CEILING: ${meiUrl}`);
    if ((await sha256Hex(bytes)) !== meiSha256) throw new Error(`ASSET_HASH_MISMATCH: ${meiUrl}`);
    const meiXml = new TextDecoder().decode(bytes);
    return renderMei({ part, meiXml }, settings, overrides, ctx, pageRectsFor(settings, part, ctx.fonts));
  };
}

// ------------------------------------------------------------ compose deps ---

/** Fetch with optional sha256 verification. Errors follow the contracts' AssetLoader convention. */
export function createAssetLoader(fetchFn: typeof fetch = fetch): AssetLoader {
  return {
    async bytes(url: string, sha256: string | null): Promise<Uint8Array> {
      let data: Uint8Array;
      try {
        const response = await fetchFn(url);
        if (!response.ok) throw new Error('not ok');
        data = new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new Error(`ASSET_MISSING: ${url}`);
      }
      if (sha256 !== null) {
        const digest = toHex(await sha256Bytes(data));
        if (digest !== sha256.toLowerCase()) throw new Error(`ASSET_HASH_MISMATCH: ${url}`);
      }
      return data;
    },
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from a PNG's IHDR chunk. Throws on anything that is not a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const isIhdr = bytes.length >= 24 && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (!isIhdr || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('INVALID_PAGE: not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) throw new Error('INVALID_PAGE: PNG has a zero dimension');
  return { width, height };
}

/** Page count and the size (PDF points) of page `index` (clamped to the last page). */
export async function readPdfPageSize(bytes: Uint8Array, index: number): Promise<{ width: number; height: number; count: number }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const count = doc.getPageCount();
  if (count === 0) throw new Error('INVALID_PAGE: PDF has no pages');
  const { width, height } = doc.getPage(Math.min(Math.max(0, index), count - 1)).getSize();
  return { width, height, count };
}

export function composeDepsFor(assets: AssetLoader, fonts: FontProfile): ComposeDeps {
  return { assets, fonts, pngSize: readPngSize, pdfPageSize: readPdfPageSize };
}

/** The worker's `compose` dependency: composeExport with real asset, PNG and PDF readers. */
export function createCompose(assets: AssetLoader) {
  return (
    parts: readonly ExportPart[],
    layouts: readonly MeiLayout[],
    settings: LayoutSettings,
    token: number,
    fonts: FontProfile,
  ): Promise<LayoutResult> =>
    composeParts(parts, new Map(layouts.map((l) => [l.partId, l] as const)), settings, composeDepsFor(assets, fonts), token);
}

/** The PDF worker's `exportPdf` dependency. Fonts load on first use; a failed load is retried. */
export function createExportPdf(assets: AssetLoader) {
  let fonts: Promise<FontProfile> | null = null;
  const loadFonts = (): Promise<FontProfile> => {
    if (fonts === null) {
      const attempt = loadFontProfile((url) => assets.bytes(url, null));
      fonts = attempt;
      attempt.catch(() => { if (fonts === attempt) fonts = null; });
    }
    return fonts;
  };
  return async (result: LayoutResult): Promise<PdfResult> =>
    exportCanonicalPdf(result, { assets, fonts: await loadFonts() });
}
