// B7c: the real dependencies of the export workers that are not written yet.
//
// PLACEHOLDERS. `composeExport` (B6a) and `exportCanonicalPdf` (B6b) throw until those cards
// land. B6a replaces the `composeExport` export below with `export { composeExport } from
// './compose'`; B6b replaces `exportCanonicalPdf` with `export { exportCanonicalPdf } from
// './exportPdf'`. The workers import only from this module, so they need no other edit.
//
// `renderMeiPart` is real: it fetches and verifies a part's MEI, works out the page rectangles
// and calls renderMei. The heading reservation on page 1 is provisional (B6a owns the real
// heading height and may replace this function with its own).
import { renderMei } from './layout';
import type { PageRects } from './layout';
import { sha256Hex } from './fonts';
import { paperDimensions, usableRect } from './settings';
import type {
  BreakOverride,
  ExportPart,
  LayoutResult,
  LayoutSettings,
  MeiExportPart,
  MeiLayout,
  PdfResult,
  RenderContext,
} from './types';

/** Space reserved above the first system of a part that has a heading (provisional). */
const HEADING_RESERVE_MM = 18;

export function composeExport(
  parts: readonly ExportPart[],
  layouts: readonly MeiLayout[],
  settings: LayoutSettings,
  token: number,
): Promise<LayoutResult> {
  void parts; void layouts; void settings; void token;
  return Promise.reject(new Error('NOT_WIRED: compose'));
}

export function exportCanonicalPdf(result: LayoutResult): Promise<PdfResult> {
  void result;
  return Promise.reject(new Error('NOT_WIRED: exportPdf'));
}

export type FetchBytes = (url: string) => Promise<Uint8Array>;

export function pageRectsFor(settings: LayoutSettings, part: MeiExportPart): PageRects {
  const content = usableRect(paperDimensions(settings), settings.marginMm);
  const reserve = part.heading === null ? 0 : HEADING_RESERVE_MM;
  return { content, firstPageContent: { ...content, heightMm: Math.max(0, content.heightMm - reserve) } };
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
    return renderMei({ part, meiXml }, settings, overrides, ctx, pageRectsFor(settings, part));
  };
}
