// Spike S4 route (ii): pdf-lib + a fontkit + walker.ts. Browser/worker safe.
// The fontkit is injected: @pdf-lib/fontkit 1.1.1, or fontkit 2.0.4 via fontkit2Adapter.ts.
import { PDFDocument, rgb } from "pdf-lib";

export type Fontkit = Parameters<PDFDocument["registerFontkit"]>[0];
import { HEADING_TEST, type TextFaces } from "./common.ts";
import { type WalkStats, drawVerovioSvg } from "./walker.ts";

export async function buildWithPdfLib(svg: string, page: { width: number; height: number }, faces: TextFaces, kit: Fontkit): Promise<{ bytes: Uint8Array; stats: WalkStats }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(kit);
  const [regular, italic, bold, boldItalic] = await Promise.all([
    doc.embedFont(faces.regular, { subset: true }),
    doc.embedFont(faces.italic, { subset: true }),
    doc.embedFont(faces.bold, { subset: true }),
    doc.embedFont(faces.boldItalic, { subset: true }),
  ]);
  const p = doc.addPage([page.width, page.height]);
  const stats = drawVerovioSvg(p, svg, { xPt: 0, yTopPt: 0, widthPt: page.width, heightPt: page.height }, { regular, italic, bold, boldItalic });
  p.drawText(HEADING_TEST, { x: 12, y: page.height - 9, size: 7, font: regular, color: rgb(0, 0, 0) });
  p.drawText(HEADING_TEST, { x: 12, y: 5, size: 6, font: italic, color: rgb(0, 0, 0) });
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, stats };
}
