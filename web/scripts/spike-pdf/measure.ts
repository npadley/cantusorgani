// Spike S3+S4 (not shipped): build both routes' PDFs and measure them.
//
//   node scripts/spike-pdf/measure.ts <outDir> <name>=<svg>[@<wMm>x<hMm>] ...
//
// Faces are read from ../build/s34-fonts/ (staged Liberation Serif 2.1.5).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";
import { Resvg } from "@resvg/resvg-js";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef } from "pdf-lib";
import PDFKitDocument from "pdfkit";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { HEADING_TEST, type TextFaces, pagePt } from "./common.ts";
import { buildWithPdfKit } from "./routeKit.ts";
import { buildWithPdfLib } from "./routeLib.ts";
import fontkit from "@pdf-lib/fontkit";

const FONT_DIR = new URL("../../../build/s34-fonts/", import.meta.url);
const face = (f: string): Uint8Array => new Uint8Array(readFileSync(new URL(f, FONT_DIR)));
const faces: TextFaces = {
  regular: face("LiberationSerif-Regular.ttf"),
  italic: face("LiberationSerif-Italic.ttf"),
  bold: face("LiberationSerif-Bold.ttf"),
  boldItalic: face("LiberationSerif-BoldItalic.ttf"),
};
const RENDER_SCALE = Number(process.env.RENDER_SCALE ?? 2); // px per pt (2 = 144 dpi)
const BAND_PT = 14; // heading/footer test lines are excluded from the pixel diff

interface Inspect { mediaBox: [number, number]; imageXObjects: number; fonts: string[]; fontFiles: number; paintOps: number; contentBytes: number }

function streamBytes(doc: PDFDocument, obj: unknown): Uint8Array[] {
  const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (resolved instanceof PDFArray) return resolved.asArray().flatMap((o) => streamBytes(doc, o));
  if (resolved instanceof PDFRawStream) {
    const filter = resolved.dict.get(PDFName.of("Filter"));
    return [filter === undefined ? resolved.contents : new Uint8Array(inflateSync(resolved.contents))];
  }
  return [];
}

async function inspect(bytes: Uint8Array): Promise<Inspect> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const box = page.getMediaBox();
  let imageXObjects = 0;
  let fontFiles = 0;
  const fonts: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict === null) continue;
    const subtype = dict.get(PDFName.of("Subtype"));
    const type = dict.get(PDFName.of("Type"));
    if (subtype?.toString() === "/Image") imageXObjects += 1;
    if (type?.toString() === "/Font" && subtype?.toString() !== "/CIDFontType2") fonts.push(String(dict.get(PDFName.of("BaseFont"))));
    if (obj instanceof PDFRawStream && (dict.has(PDFName.of("Length1")) || subtype?.toString() === "/OpenType")) fontFiles += 1;
  }
  const content = streamBytes(doc, page.node.get(PDFName.of("Contents")));
  // XObject forms (pdfkit may wrap) are counted too.
  const text = content.map((c) => Buffer.from(c).toString("latin1")).join("\n");
  const paintOps = (text.match(/(?<=\s)(f\*?|B\*?|b\*?|S|s|F)(?=\s)/g) ?? []).length;
  return { mediaBox: [box.width, box.height], imageXObjects, fonts, fontFiles, paintOps, contentBytes: text.length };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  return tc.items.map((it) => ("str" in it ? it.str : "")).join("\u0001");
}

async function renderPdf(bytes: Uint8Array): Promise<PNG> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const w = Math.round(viewport.width);
  const h = Math.round(viewport.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  return PNG.sync.read(Buffer.from(canvas.toBuffer("image/png")));
}

function renderSvg(svg: string, widthPx: number): PNG {
  // The preview path: the SVG with its font-family pointed at the bundled face.
  const withFace = svg.replace(/font-family="Times, serif"/g, 'font-family="Liberation Serif"');
  const r = new Resvg(withFace, {
    fitTo: { mode: "width", value: widthPx },
    background: "white",
    font: { loadSystemFonts: false, fontFiles: [new URL("LiberationSerif-Regular.ttf", FONT_DIR).pathname, new URL("LiberationSerif-Italic.ttf", FONT_DIR).pathname, new URL("LiberationSerif-Bold.ttf", FONT_DIR).pathname], defaultFontFamily: "Liberation Serif" },
  });
  return PNG.sync.read(r.render().asPng());
}

function diff(a: PNG, b: PNG, bandPx: number): { diffPx: number; inkPx: number; misplaced: number; out: PNG } {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (p: PNG): Uint8Array => {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * p.width + x) * 4;
        const d = (y * w + x) * 4;
        const inBand = y < bandPx || y >= h - bandPx;
        for (let k = 0; k < 4; k++) out[d + k] = inBand ? 255 : (p.data[s + k] ?? 255);
      }
    }
    return out;
  };
  const ca = crop(a);
  const cb = crop(b);
  const out = new PNG({ width: w, height: h });
  const diffPx = pixelmatch(ca, cb, out.data, w, h, { threshold: 0.1, includeAA: false });
  let inkPx = 0;
  for (let i = 0; i < ca.length; i += 4) if ((ca[i] ?? 255) < 128) inkPx += 1;
  // Anti-aliasing-tolerant check: dark pixels in one image with no dark pixel
  // within 1 px in the other ("misplaced ink"), in both directions.
  const dark = (img: Uint8Array, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && (img[(y * w + x) * 4] ?? 255) < 160;
  const near = (img: Uint8Array, x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dark(img, x + dx, y + dy)) return true;
    return false;
  };
  let misplaced = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (dark(ca, x, y) && !near(cb, x, y)) misplaced += 1;
    if (dark(cb, x, y) && !near(ca, x, y)) misplaced += 1;
  }
  return { diffPx, inkPx, misplaced, out };
}

const [outDirArg, ...specs] = process.argv.slice(2);
if (outDirArg === undefined || specs.length === 0) throw new Error("usage: measure.ts <outDir> name=svg[@WxH] ...");
mkdirSync(outDirArg, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const spec of specs) {
  const m = /^([\w-]+)=([^@]+)(?:@([\d.]+)x([\d.]+))?$/.exec(spec);
  if (m?.[1] === undefined || m[2] === undefined) throw new Error(`bad spec ${spec}`);
  const name = m[1];
  const svg = readFileSync(m[2], "utf8");
  const mm = { widthMm: Number(m[3] ?? 157.8), heightMm: Number(m[4] ?? 227.1) };
  const page = pagePt(mm);
  const svgUses = (svg.match(/<use\b/g) ?? []).length;
  const svgPng = renderSvg(svg, Math.round(page.width * RENDER_SCALE));
  writeFileSync(`${outDirArg}/${name}-svg.png`, PNG.sync.write(svgPng));

  const lib = await buildWithPdfLib(svg, page, faces, fontkit);
  const kitCtor = PDFKitDocument as unknown as Parameters<typeof buildWithPdfKit>[0];
  const kit = await buildWithPdfKit(kitCtor, svg, page, faces, true);
  const kitRaw = await buildWithPdfKit(kitCtor, svg, page, faces, false);
  const expectedPaint = lib.stats.paths + lib.stats.shapes;
  for (const [route, bytes, extra] of [
    ["pdf-lib", lib.bytes, { walker: { ...lib.stats, textRuns: lib.stats.textRuns.length } }],
    ["pdfkit", kit.bytes, { warnings: kit.warnings.slice(0, 5), warningCount: kit.warnings.length, input: "stroke inlined" }],
    ["pdfkit-raw", kitRaw.bytes, { warningCount: kitRaw.warnings.length, input: "Verovio SVG as is" }],
  ] as const) {
    writeFileSync(`${outDirArg}/${name}-${route}.pdf`, bytes);
    const info = await inspect(bytes);
    const text = await pdfText(bytes);
    const png = await renderPdf(bytes);
    writeFileSync(`${outDirArg}/${name}-${route}.png`, PNG.sync.write(png));
    const d = diff(svgPng, png, BAND_PT * RENDER_SCALE);
    writeFileSync(`${outDirArg}/${name}-${route}-diff.png`, PNG.sync.write(d.out));
    const want = ["Ký", "rí", "lǽ", "sœn.", "ú", "lé", "eléison", HEADING_TEST];
    results.push({
      name, route, pageMm: mm, expectedMediaBox: [page.width, page.height], mediaBox: info.mediaBox,
      mediaBoxErrPt: Math.max(Math.abs(info.mediaBox[0] - page.width), Math.abs(info.mediaBox[1] - page.height)),
      imageXObjects: info.imageXObjects, fonts: info.fonts, fontFiles: info.fontFiles,
      svgUses, svgDrawables: expectedPaint, paintOps: info.paintOps,
      pdfBytes: bytes.length, contentBytes: info.contentBytes,
      textFound: Object.fromEntries(want.map((w) => [w, text.includes(w)])),
      sampleText: text.split("\u0001").slice(0, 12).join("|"),
      pixels: { width: d.out.width, height: d.out.height, diffPx: d.diffPx, inkPx: d.inkPx, diffOverInk: +(d.diffPx / Math.max(1, d.inkPx)).toFixed(4), misplacedInkPx: d.misplaced, misplacedOverInk: +(d.misplaced / Math.max(1, d.inkPx)).toFixed(5) },
      ...extra,
    });
  }
}
writeFileSync(`${outDirArg}/results.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
