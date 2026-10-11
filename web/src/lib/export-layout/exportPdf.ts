// B6b: canonical PDF assembly. Turns a complete LayoutResult into one vector
// PDF: MEI pages through the B2 SVG walker, scans as PNGs at their original
// resolution, fixed pages as embedded vector pages, and Unicode headings and
// footers through the fontkit-embedded faces. This file deliberately does not
// import `../pdf` (quick export) or its `pdfSafe`.
//
// Coordinates in the LayoutResult are page-absolute mm with a top-left origin;
// pdf-lib's origin is bottom-left in points, converted only by `mmRectToPdfPt`.
import { PDFDocument } from 'pdf-lib';
import type { PDFEmbeddedPage, PDFPage } from 'pdf-lib';
import type {
  AssetLoader,
  CanonicalPage,
  FixedCanonicalPage,
  FontProfile,
  HeadingBlock,
  LayoutResult,
  PdfResult,
  RectMm,
  ScanCanonicalPage,
} from './types';
import { measureSvgBounds } from './svg';
import { createEmbeddedFonts, drawSvgOnPage } from './vectorPdf';
import type { EmbeddedFonts, FaceName } from './vectorPdf';

const MM_TO_PT = 72 / 25.4;

export interface ExportPdfDeps {
  readonly assets: AssetLoader;
  readonly fonts: FontProfile;
}

export interface RectPt { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Top-left page-absolute mm rect to a bottom-left pt rect on a page `pageHeightMm` tall. */
export function mmRectToPdfPt(rect: RectMm, pageHeightMm: number): RectPt {
  return {
    x: rect.xMm * MM_TO_PT,
    y: (pageHeightMm - rect.yMm - rect.heightMm) * MM_TO_PT,
    width: rect.widthMm * MM_TO_PT,
    height: rect.heightMm * MM_TO_PT,
  };
}

/** Baseline `baselineMm` below the page top, as a pdf-lib y in pt. */
export function baselineToPdfPt(baselineMm: number, pageHeightMm: number): number {
  return (pageHeightMm - baselineMm) * MM_TO_PT;
}

const CODED = /^(ASSET_MISSING|ASSET_HASH_MISMATCH|FIXED_PAGE_COUNT_MISMATCH|PDF_FAILED)\b/;

function coded(e: unknown, fallbackCode: string, url: string): Error {
  if (e instanceof Error && CODED.test(e.message)) return e;
  const detail = e instanceof Error ? e.message : String(e);
  return new Error(`${fallbackCode}: ${url} (${detail})`);
}

const FACE: Readonly<Record<HeadingBlock['lines'][number]['role'], FaceName>> = {
  heading: 'bold',
  rubric: 'italic',
  translation: 'italic',
  credit: 'regular',
};

async function drawBlock(page: PDFPage, block: HeadingBlock, pageHeightMm: number, embedded: EmbeddedFonts): Promise<void> {
  for (const line of block.lines) {
    const font = await embedded.get(FACE[line.role]);
    page.drawText(line.text, {
      x: block.rect.xMm * MM_TO_PT,
      y: baselineToPdfPt(line.baselineMm, pageHeightMm),
      size: line.sizePt,
      font,
    });
  }
}

export async function exportCanonicalPdf(result: LayoutResult, deps: ExportPdfDeps): Promise<PdfResult> {
  if (!result.complete) throw new Error('PDF_FAILED: incomplete layout');

  // No timestamps/producer: identical input gives identical bytes.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const embedded = createEmbeddedFonts(doc, deps.fonts);

  const fetched = new Map<string, Promise<Uint8Array>>();
  const fetchOnce = (url: string): Promise<Uint8Array> => {
    let p = fetched.get(url);
    if (p === undefined) {
      p = deps.assets.bytes(url, null).catch((e: unknown) => { throw coded(e, 'ASSET_MISSING', url); });
      fetched.set(url, p);
    }
    return p;
  };
  const images = new Map<string, ReturnType<PDFDocument['embedPng']>>();
  const sources = new Map<string, Promise<PDFDocument>>();
  const embeddedSource = new Map<string, Promise<PDFEmbeddedPage>>();

  const drawScan = async (page: PDFPage, p: ScanCanonicalPage): Promise<void> => {
    for (const im of p.images) {
      const url = `${im.stem}@2x.png`;
      const bytes = await fetchOnce(url);
      let img = images.get(url);
      if (img === undefined) {
        img = doc.embedPng(bytes);
        images.set(url, img);
      }
      const r = mmRectToPdfPt(im.rect, p.heightMm);
      page.drawImage(await img, r);
    }
  };

  const drawFixed = async (page: PDFPage, p: FixedCanonicalPage): Promise<void> => {
    const bytes = await fetchOnce(p.sourceUrl);
    let src = sources.get(p.sourceUrl);
    if (src === undefined) {
      src = PDFDocument.load(bytes, { updateMetadata: false });
      sources.set(p.sourceUrl, src);
    }
    let srcDoc: PDFDocument;
    try {
      srcDoc = await src;
    } catch (e) {
      throw coded(e, 'ASSET_MISSING', p.sourceUrl);
    }
    if (srcDoc.getPageCount() <= p.sourcePageIndex) {
      throw new Error(`FIXED_PAGE_COUNT_MISMATCH: ${p.sourceUrl} has ${srcDoc.getPageCount()} pages, need page ${p.sourcePageIndex + 1}`);
    }
    if (srcDoc.getPage(p.sourcePageIndex).getRotation().angle % 360 !== 0) {
      throw new Error(`FIXED_PAGE_COUNT_MISMATCH: rotated-source ${p.sourceUrl}`);
    }
    const key = `${p.sourceUrl}#${p.sourcePageIndex}`;
    let ep = embeddedSource.get(key);
    if (ep === undefined) {
      ep = doc.embedPdf(srcDoc, [p.sourcePageIndex]).then((a) => a[0]!);
      embeddedSource.set(key, ep);
    }
    const t = p.transform;
    // The embedded page's real size (MediaBox origin handled by pdf-lib), not the recorded one.
    const real = await ep;
    const widthPt = real.width * t.scaleX;
    const heightPt = real.height * t.scaleY;
    page.drawPage(real, {
      x: t.translateXMm * MM_TO_PT,
      y: p.heightMm * MM_TO_PT - t.translateYMm * MM_TO_PT - heightPt,
      width: widthPt,
      height: heightPt,
    });
  };

  const draw = async (p: CanonicalPage): Promise<void> => {
    const page = doc.addPage([p.widthMm * MM_TO_PT, p.heightMm * MM_TO_PT]);
    switch (p.kind) {
      case 'mei':
        await drawSvgOnPage(page, p.svg.svg, deps.fonts, embedded, {
          xMm: p.svgPlacement.translateXMm,
          yMm: p.svgPlacement.translateYMm,
          ...measureSvgBounds(p.svg),
        });
        break;
      case 'scan':
        await drawScan(page, p);
        break;
      case 'fixed':
        await drawFixed(page, p);
        break;
    }
    if (p.heading !== null) await drawBlock(page, p.heading, p.heightMm, embedded);
    if (p.footer !== null) await drawBlock(page, p.footer, p.heightMm, embedded);
  };

  for (const p of result.pages) await draw(p);

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, pageCount: result.pages.length, byteSize: bytes.length };
}
