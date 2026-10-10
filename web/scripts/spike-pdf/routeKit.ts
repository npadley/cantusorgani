// Spike S4 route (i): pdfkit + svg-to-pdfkit. The PDFDocument constructor is
// injected so Node uses `pdfkit` and the browser bundle uses the standalone build.
import type PDFKit from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { HEADING_TEST, type TextFaces } from "./common.ts";

/**
 * svg-to-pdfkit 0.1.8 does not apply Verovio's `#id path {stroke:currentColor}`
 * rule (measured: staff lines, stems and barlines vanish). Inline it as an
 * attribute first. Route (i) needs this pre-pass; route (ii) applies the rule itself.
 */
export function inlineVerovioStroke(svg: string): string {
  return svg.replace(/<(path|rect|ellipse|polygon|polyline)\b(?![^>]*\sstroke=)/g, '<$1 stroke="currentColor"');
}

type DocCtor = new (options: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument;

export function buildWithPdfKit(Ctor: DocCtor, svg: string, page: { width: number; height: number }, faces: TextFaces, inline = true): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const doc = new Ctor({ size: [page.width, page.height], margin: 0, autoFirstPage: true, compress: true });
  const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer;
  doc.registerFont("Text", toBuf(faces.regular));
  doc.registerFont("Text-Italic", toBuf(faces.italic));
  doc.registerFont("Text-Bold", toBuf(faces.bold));
  doc.registerFont("Text-BoldItalic", toBuf(faces.boldItalic));
  const warnings: string[] = [];
  SVGtoPDF(doc, inline ? inlineVerovioStroke(svg) : svg, 0, 0, {
    width: page.width,
    height: page.height,
    preserveAspectRatio: "xMidYMid meet",
    fontCallback: (_family, bold, italic) => (bold ? (italic ? "Text-BoldItalic" : "Text-Bold") : italic ? "Text-Italic" : "Text"),
    warningCallback: (m) => { warnings.push(m); },
  });
  doc.font("Text").fontSize(7).text(HEADING_TEST, 12, 3, { lineBreak: false });
  doc.font("Text-Italic").fontSize(6).text(HEADING_TEST, 12, page.height - 11, { lineBreak: false });
  const chunks: Uint8Array[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Uint8Array) => { chunks.push(c); });
    doc.on("end", () => {
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      resolve({ bytes: out, warnings });
    });
    doc.on("error", reject);
    doc.end();
  });
}
