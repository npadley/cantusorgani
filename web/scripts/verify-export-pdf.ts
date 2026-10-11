// Checks a PDF made by the export editor against the canonical layout it was made from (B10a).
//
//   node scripts/verify-export-pdf.ts <file.pdf> <expected.json>
//
// `expected.json` is a CanonicalExpectation, which the e2e harness reads out of the editor's own layout
// result (page sizes, staff-line positions and text, in mm, from the drawn canonical SVG). pdf.js opens the
// PDF and the verifier compares what a reader would get:
//   - the page count;
//   - each page's MediaBox in mm, within 0.5 pt;
//   - each page's staves, found as five equally spaced long horizontal strokes (position of every staff line
//     within STAFF_TOLERANCE_MM, and the staff height within STAFF_HEIGHT_TOLERANCE_MM of the expected size);
//   - the page's text content and order (heading, sung text, credit), compared as the sequence of letters,
//     so that a changed, dropped, added or reordered syllable fails and hyphen or spacing differences do not.
// Nothing is drawn: pdf.js is asked for the operator list and the text layer, so the check is exact rather than
// pixel-approximate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MEDIABOX_TOLERANCE_PT = 0.5;
/** Each staff line, canonical vs PDF. Both come from the same SVG numbers, so real differences are far larger. */
export const STAFF_TOLERANCE_MM = 0.1;
/** Staff height against the size the setting promises (Contracts section 3: within 0.1 mm). */
export const STAFF_HEIGHT_TOLERANCE_MM = 0.1;
/** A horizontal stroke shorter than this is a ledger line or a barline stub, not a staff line. */
const MIN_STAFF_LINE_MM = 12;

const PT_PER_MM = 72 / 25.4;
const STROKING = ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke'] as const;

export interface ExpectedPage {
  readonly widthMm: number;
  readonly heightMm: number;
  /** Staves top to bottom; each is its five line positions in mm from the top of the page. */
  readonly staves: readonly (readonly number[])[];
  /** Every string the page draws, in drawing order (sung syllables, then heading and credit lines). */
  readonly text: readonly string[];
}
export interface CanonicalExpectation {
  readonly staffHeightMm: number;
  readonly pages: readonly ExpectedPage[];
}
export interface PageReport {
  readonly mediaBoxMm: { readonly width: number; readonly height: number };
  readonly staves: readonly (readonly number[])[];
  readonly maxStaffDeltaMm: number;
  readonly staffHeightsMm: readonly number[];
  readonly letters: string;
}
export interface VerifyReport {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly pageCount: number;
  readonly pages: readonly PageReport[];
}

// ---- the slice of pdf.js we use -------------------------------------------------------------------------
interface PdfjsPage {
  readonly view: readonly number[];
  getOperatorList(): Promise<{ readonly fnArray: readonly number[]; readonly argsArray: readonly unknown[] }>;
  getTextContent(): Promise<{ readonly items: readonly { readonly str?: string }[] }>;
}
interface PdfjsDoc { readonly numPages: number; getPage(n: number): Promise<PdfjsPage>; destroy?(): Promise<void> }
interface PdfjsModule {
  readonly OPS: Readonly<Record<string, number>>;
  getDocument(src: { data: Uint8Array; useSystemFonts?: boolean; verbosity?: number }): { readonly promise: Promise<PdfjsDoc>; destroy?(): Promise<void> };
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** `m` applied after `base` (PDF `cm`: the new matrix is premultiplied). */
const compose = (m: Matrix, base: Matrix): Matrix => [
  m[0] * base[0] + m[1] * base[2], m[0] * base[1] + m[1] * base[3],
  m[2] * base[0] + m[3] * base[2], m[2] * base[1] + m[3] * base[3],
  m[4] * base[0] + m[5] * base[2] + base[4], m[4] * base[1] + m[5] * base[3] + base[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export const lettersOf = (strings: readonly string[]): string => strings.join('').normalize('NFC').replace(/[^\p{L}]/gu, '');

interface Segment { readonly y: number; readonly length: number }

/** Long horizontal stroked segments of one page, in PDF points from the bottom edge. */
function horizontalStrokes(ops: Readonly<Record<string, number>>, list: { fnArray: readonly number[]; argsArray: readonly unknown[] }): Segment[] {
  const out: Segment[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  const MOVE = 0;
  const LINE = 1;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]!;
    const args = list.argsArray[i];
    if (fn === ops['save']) stack.push(ctm);
    else if (fn === ops['restore']) ctm = stack.pop() ?? IDENTITY;
    else if (fn === ops['transform']) ctm = compose(args as unknown as Matrix, ctm);
    else if (fn === ops['constructPath']) {
      const [op, data] = args as [number, ArrayLike<number>[]];
      // pdf-lib paints an SVG path with fill and stroke together, so any painting operator that strokes counts.
      if (!STROKING.some((name) => op === ops[name])) continue;
      const path = data[0];
      if (path === undefined || path === null) continue;
      let at = 0;
      let cx = 0;
      let cy = 0;
      let sx = 0;
      let sy = 0;
      while (at < path.length) {
        const code = path[at]!;
        if (code === MOVE) { [cx, cy] = apply(ctm, path[at + 1]!, path[at + 2]!); sx = cx; sy = cy; at += 3; }
        else if (code === LINE) {
          const [nx, ny] = apply(ctm, path[at + 1]!, path[at + 2]!);
          if (Math.abs(ny - cy) < 0.01 && Math.abs(nx - cx) / PT_PER_MM >= MIN_STAFF_LINE_MM) out.push({ y: ny, length: Math.abs(nx - cx) });
          cx = nx; cy = ny; at += 3;
        } else if (code === 2) at += 7; // curveTo
        else if (code === 3) at += 5; // quadraticCurveTo
        else { cx = sx; cy = sy; at += 1; } // closePath
      }
    }
  }
  return out;
}

/** Group sorted line positions (mm from the top) into staves: five lines with equal spacing. */
export function groupStaves(ys: readonly number[]): number[][] {
  const sorted = [...ys].sort((a, b) => a - b);
  // Merge lines drawn at the same height (a staff line is one stroke per system, never two).
  const unique: number[] = [];
  for (const y of sorted) if (unique.length === 0 || y - unique[unique.length - 1]! > 0.02) unique.push(y);
  const staves: number[][] = [];
  for (let i = 0; i + 4 < unique.length;) {
    const five = unique.slice(i, i + 5);
    const gaps = five.slice(1).map((y, k) => y - five[k]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / 4;
    if (gaps.every((g) => Math.abs(g - mean) <= mean * 0.12)) { staves.push(five); i += 5; } else i += 1;
  }
  return staves;
}

export async function verifyExportPdf(bytes: Uint8Array, expected: CanonicalExpectation): Promise<VerifyReport> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const problems: string[] = [];
  const pages: PageReport[] = [];
  try {
    if (doc.numPages !== expected.pages.length) problems.push(`page count ${doc.numPages}, expected ${expected.pages.length}`);
    for (let n = 1; n <= Math.min(doc.numPages, expected.pages.length); n++) {
      const want = expected.pages[n - 1]!;
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      const widthPt = x1 - x0;
      const heightPt = y1 - y0;
      if (Math.abs(widthPt - want.widthMm * PT_PER_MM) > MEDIABOX_TOLERANCE_PT || Math.abs(heightPt - want.heightMm * PT_PER_MM) > MEDIABOX_TOLERANCE_PT) {
        problems.push(`page ${n}: MediaBox ${(widthPt / PT_PER_MM).toFixed(2)} x ${(heightPt / PT_PER_MM).toFixed(2)} mm, expected ${want.widthMm} x ${want.heightMm} mm (tolerance ${MEDIABOX_TOLERANCE_PT} pt)`);
      }

      const strokes = horizontalStrokes(pdfjs.OPS, await page.getOperatorList());
      const staves = groupStaves(strokes.map((s) => (heightPt - (s.y - y0)) / PT_PER_MM));
      const heights = staves.map((s) => s[4]! - s[0]!);
      if (staves.length !== want.staves.length) {
        problems.push(`page ${n}: ${staves.length} staves in the PDF, ${want.staves.length} in the canonical layout`);
      }
      let maxDelta = 0;
      for (let s = 0; s < Math.min(staves.length, want.staves.length); s++) {
        for (let k = 0; k < 5; k++) maxDelta = Math.max(maxDelta, Math.abs(staves[s]![k]! - want.staves[s]![k]!));
        if (Math.abs(heights[s]! - expected.staffHeightMm) > STAFF_HEIGHT_TOLERANCE_MM) {
          problems.push(`page ${n} staff ${s + 1}: height ${heights[s]!.toFixed(3)} mm, expected ${expected.staffHeightMm} mm +/- ${STAFF_HEIGHT_TOLERANCE_MM}`);
        }
      }
      if (maxDelta > STAFF_TOLERANCE_MM) problems.push(`page ${n}: a staff line is ${maxDelta.toFixed(3)} mm from the canonical position (tolerance ${STAFF_TOLERANCE_MM} mm)`);

      const text = await page.getTextContent();
      const letters = lettersOf(text.items.map((it) => it.str ?? ''));
      const wantLetters = lettersOf(want.text);
      if (letters !== wantLetters) {
        let at = 0;
        while (at < letters.length && letters[at] === wantLetters[at]) at++;
        problems.push(`page ${n}: text differs at letter ${at} (PDF "${letters.slice(Math.max(0, at - 8), at + 12)}", canonical "${wantLetters.slice(Math.max(0, at - 8), at + 12)}")`);
      }
      pages.push({ mediaBoxMm: { width: widthPt / PT_PER_MM, height: heightPt / PT_PER_MM }, staves, maxStaffDeltaMm: maxDelta, staffHeightsMm: heights, letters });
    }
  } finally {
    await doc.destroy?.().catch(() => undefined);
  }
  return { ok: problems.length === 0, problems, pageCount: doc.numPages, pages };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [pdfPath, expectedPath] = process.argv.slice(2);
  if (pdfPath === undefined || expectedPath === undefined) {
    console.error('usage: node scripts/verify-export-pdf.ts <file.pdf> <expected.json>');
    process.exit(2);
  }
  const report = await verifyExportPdf(new Uint8Array(readFileSync(pdfPath)), JSON.parse(readFileSync(expectedPath, 'utf8')) as CanonicalExpectation);
  for (const p of report.problems) console.error(`FAIL ${p}`);
  console.log(report.ok ? `OK ${report.pageCount} pages` : `${report.problems.length} problem(s)`);
  process.exit(report.ok ? 0 : 1);
}
