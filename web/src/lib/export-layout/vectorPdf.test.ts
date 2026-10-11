import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadFontProfile } from './fonts';
import type { FontProfile, PhysicalPage, SanitizedSvg } from './types';
import { createEmbeddedFonts, drawSvgOnPage, svgToVectorPdf } from './vectorPdf';

const FONT_DIR = new URL('../../../public/fonts/export/', import.meta.url);
const FIXTURE_DIR = new URL('./__fixtures__/', import.meta.url);
const PAGE: PhysicalPage = { widthMm: 157.8, heightMm: 227.1, kind: 'screen' };
const MM = 72 / 25.4;

let fonts: FontProfile;
beforeAll(async () => {
  fonts = await loadFontProfile(async (u) => new Uint8Array(readFileSync(new URL(u.slice(u.lastIndexOf('/') + 1), FONT_DIR))));
});

const wrap = (svg: string): SanitizedSvg => ({ svg, ids: [], namespace: 'http://www.w3.org/2000/svg' });
const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map((it) => ('str' in it ? it.str : '')).join('');
}

/** Number of path-construction operators on page 1, as pdf.js decodes them. */
async function pathOpCount(bytes: Uint8Array): Promise<number> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
  const ops = await (await doc.getPage(1)).getOperatorList();
  return ops.fnArray.filter((fn) => fn === pdfjs.OPS.constructPath).length;
}

const MEI_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0"><meiHead><fileDesc><titleStmt><title>t</title></titleStmt><pubStmt/></fileDesc></meiHead><music><body><mdiv><score><scoreDef><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>';
const MEI_TAIL = '</section></score></mdiv></body></music></mei>';
const measure = (inner: string, ctrl = ''): string =>
  `<measure n="1"><staff n="1"><layer n="1">${inner}</layer></staff>${ctrl}</measure>`;

async function renderMei(body: string): Promise<string> {
  const tk = new VerovioToolkit(await createVerovioModule());
  tk.setOptions({ scale: 100, pageWidth: 1578, pageHeight: 600, font: 'Leipzig', header: 'none', footer: 'none', svgViewBox: true, xmlIdChecksum: true });
  if (!tk.loadData(MEI_HEAD + body + MEI_TAIL)) throw new Error('Verovio could not load the MEI');
  return tk.renderToSVG(1);
}

const QUILISMA =
  '<note xml:id="q1" dur="4" pname="b" oct="4" stem.visible="false" head.visible="false"/>';
const quilismaDir = '<dir startid="#q1" place="within"><symbol glyph.auth="smufl" glyph.num="U+E56C"/></dir>';

describe('svgToVectorPdf', () => {
  it('usesExactPageDimensions', async () => {
    const svg = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M0 0L100 100" stroke-width="2"/></svg>';
    const bytes = await svgToVectorPdf(wrap(svg), PAGE, fonts);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const box = doc.getPage(0).getMediaBox();
    expect(Math.abs(box.width - 447.307)).toBeLessThan(0.01);
    expect(Math.abs(box.height - 643.748)).toBeLessThan(0.01);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
  });

  it('exportsAccentsAndReferencedGlyphs', async () => {
    const mei = measure(
      '<note xml:id="a" dur="4" pname="g" oct="4"><verse n="1"><syl>eléison</syl></verse></note><note dur="4" pname="a" oct="4"/>',
    );
    const rendered = await renderMei(mei);
    // A heading line as B6b draws them: accented, with a styled run.
    const svg = rendered.replace(
      /<\/svg>\s*$/,
      '<text x="100" y="60" font-size="40px">Kýrie eléison — cǽlum</text></svg>',
    );
    expect(svg).toContain('<use');
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([PAGE.widthMm * MM, PAGE.heightMm * MM]);
    const stats = await drawSvgOnPage(page, svg, fonts, createEmbeddedFonts(doc, fonts));
    expect(stats.uses).toBeGreaterThan(0);
    expect(stats.usesResolved).toBe(stats.uses);
    const bytes = await doc.save({ useObjectStreams: false });
    expect(latin1(bytes)).not.toMatch(/\/Subtype\s*\/Image/);
    const text = await pdfText(bytes);
    expect(text).toContain('eléison');
    expect(text).toContain('Kýrie eléison — cǽlum');
  });

  it('draws the checked-in Kyrie page with every <use> resolved and no image', async () => {
    const svg = readFileSync(new URL('kyrie-ix-verovio-page1.svg', FIXTURE_DIR), 'utf8');
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([210 * MM, 297 * MM]);
    const stats = await drawSvgOnPage(page, svg, fonts, createEmbeddedFonts(doc, fonts));
    expect(stats.uses).toBeGreaterThan(300);
    expect(stats.usesResolved).toBe(stats.uses);
    expect(stats.paintOps).toBeGreaterThan(1000);
    const text = await pdfText(await doc.save({ useObjectStreams: false }));
    expect(text).toContain('Ky');
    expect(text).toContain('lé');
  });

  it('embedsOnlyTextFonts', async () => {
    const svg =
      '<svg viewBox="0 0 1000 400" xmlns="http://www.w3.org/2000/svg"><text x="10" y="100" font-size="40px">eléison</text>' +
      '<g class="dir"><text x="10" y="200" font-size="40px">dolce</text></g></svg>';
    const bytes = await svgToVectorPdf(wrap(svg), PAGE, fonts);
    const raw = latin1(bytes);
    const baseFonts = [...new Set([...raw.matchAll(/\/BaseFont\s*\/([^\s/>]+)/g)].map((m) => m[1] ?? ''))];
    expect(baseFonts.length).toBe(2); // regular + italic subsets (Type0 and CIDFont share a name); bold never used
    for (const name of baseFonts) expect(name).toMatch(/Liberation/);
    expect(raw).not.toMatch(/Leipzig/i);
    expect(raw).not.toMatch(/Bold/);
    const doc = await PDFDocument.create({ updateMetadata: false });
    const stats = await drawSvgOnPage(doc.addPage([300, 300]), svg, fonts, createEmbeddedFonts(doc, fonts));
    expect(stats.facesUsed.sort()).toEqual(['italic', 'regular']);
  });

  it('hidesInvisibleNotes', async () => {
    const note = '<path d="M10 10 L200 10 L200 50 Z" />';
    const hiddenBlock =
      '<defs><g id="hd"><path d="M0 0 L40 0 L40 40 Z"/></g></defs>' +
      '<g class="note" visibility="hidden"><use xlink:href="#hd" transform="translate(300,10)"/><path d="M300 200 L350 250"/>' +
      '<text x="20" y="300" font-size="30px">ghost</text></g>' +
      '<path d="M0 0 L5 5" display="none"/>';
    const ns = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
    const withHidden = `<svg viewBox="0 0 500 400" ${ns}>${hiddenBlock}${note}</svg>`;
    const without = `<svg viewBox="0 0 500 400" ${ns}>${note}</svg>`;
    const a = await svgToVectorPdf(wrap(withHidden), PAGE, fonts);
    const b = await svgToVectorPdf(wrap(without), PAGE, fonts);
    expect(await pathOpCount(a)).toBe(1);
    expect(await pathOpCount(a)).toBe(await pathOpCount(b));
    expect(await pdfText(a)).not.toContain('ghost');
    const doc = await PDFDocument.create({ updateMetadata: false });
    const stats = await drawSvgOnPage(doc.addPage([300, 300]), withHidden, fonts, createEmbeddedFonts(doc, fonts));
    expect(stats.paintOps).toBe(1);
    expect(stats.hiddenSkipped).toBe(3);
    // A visible child may switch visibility back on.
    const reshown = `<svg viewBox="0 0 500 400" ${ns}><g visibility="hidden"><path visibility="visible" d="M0 0 L9 9"/><path d="M1 1 L8 8"/></g></svg>`;
    const doc2 = await PDFDocument.create({ updateMetadata: false });
    const stats2 = await drawSvgOnPage(doc2.addPage([300, 300]), reshown, fonts, createEmbeddedFonts(doc2, fonts));
    expect(stats2.paintOps).toBe(1);
  });

  it('rejectsUnsupportedElements', async () => {
    const ns = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';
    const cases: readonly [string, string][] = [
      [`<svg viewBox="0 0 10 10" ${ns}><foreignObject width="5" height="5"/></svg>`, 'UNSAFE_SVG: foreignObject'],
      [`<svg viewBox="0 0 10 10" ${ns}><g><image href="#x" width="5" height="5"/></g></svg>`, 'UNSAFE_SVG: image'],
      [`<svg viewBox="0 0 10 10" ${ns}><path d="M0 0L1 1" style="fill:red"/></svg>`, 'UNSAFE_SVG: path@style'],
      [`<svg viewBox="0 0 10 10" ${ns}><rect width="5" height="5" rx="1"/></svg>`, 'UNSAFE_SVG: rect@rx'],
      [`<svg viewBox="0 0 10 10" ${ns}><use xlink:href="https://example.com/a.svg#x"/></svg>`, 'UNSAFE_SVG: use@xlink:href (external reference)'],
      [`<svg viewBox="0 0 10 10" ${ns}><use xlink:href="#missing"/></svg>`, 'UNSAFE_SVG: use: unresolved reference'],
      [`<svg viewBox="0 0 10 10" ${ns}><path d="M0 0L1 1" fill="url(#g)"/></svg>`, 'UNSAFE_SVG: colour'],
      [`<svg viewBox="0 0 10 10" ${ns}><path d="M0 0L1 1" transform="foo(1)"/></svg>`, 'UNSAFE_SVG: transform: foo'],
      [`<svg viewBox="0 0 10 10" ${ns}><text x="0" y="5" dx="2">a</text></svg>`, 'UNSAFE_SVG: text@dx'],
      [`<svg viewBox="0 0 10 10" ${ns}><text x="0" y="5"><a>a</a></text></svg>`, 'UNSAFE_SVG: text>a'],
      [`<!DOCTYPE svg><svg viewBox="0 0 10 10" ${ns}/>`, 'UNSAFE_SVG: xml: DOCTYPE'],
      ['<html/>', 'UNSAFE_SVG: root element html'],
    ];
    for (const [svg, message] of cases) {
      await expect(svgToVectorPdf(wrap(svg), PAGE, fonts), svg).rejects.toThrow(message);
    }
  });

  it('drawsDashedStrokesWithADashOperator', async () => {
    const ns = 'xmlns="http://www.w3.org/2000/svg"';
    const dashed = `<svg viewBox="0 0 500 400" ${ns}><path d="M10 10 L400 300" stroke-width="40" stroke-linecap="round" stroke-dasharray="1 120"/></svg>`;
    const solid = `<svg viewBox="0 0 500 400" ${ns}><path d="M10 10 L400 300" stroke-width="40" stroke-linecap="round"/></svg>`;
    const op = async (svg: string): Promise<number[][]> => {
      const bytes = await svgToVectorPdf(wrap(svg), PAGE, fonts);
      const ops = await (await (await pdfjs.getDocument({ data: bytes.slice() }).promise).getPage(1)).getOperatorList();
      return ops.fnArray.flatMap((fn, k) => {
        const arr = fn === pdfjs.OPS.setDash ? ((ops.argsArray[k] as number[][])[0] ?? []) : [];
        return arr.length > 0 ? [arr] : [];
      });
    };
    expect(await op(solid)).toEqual([]);
    expect(await op(dashed)).toEqual([[1, 120]]);
    await expect(svgToVectorPdf(wrap(dashed.replace('1 120', '1 x')), PAGE, fonts)).rejects.toThrow('UNSAFE_SVG: stroke-dasharray');
  });

  it('refuses Leipzig text glyphs instead of printing a blank (R8)', async () => {
    const rendered = await renderMei(measure(`<note dur="4" pname="g" oct="4" stem.visible="false"/>${QUILISMA}`, quilismaDir));
    expect(rendered).toMatch(/font-family="Leipzig"[^>]*>\uE56C</);
    expect(rendered).not.toMatch(/id="E56C-/);
    await expect(svgToVectorPdf(wrap(rendered), PAGE, fonts)).rejects.toThrow('UNSAFE_SVG: leipzig text glyph U+E56C');
  });

  it('places the drawing inside a placement box without changing the page size', async () => {
    const svg = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="100"/></svg>';
    const bytes = await svgToVectorPdf(wrap(svg), PAGE, fonts, { xMm: 10, yMm: 20, widthMm: 50, heightMm: 50 });
    const doc = await PDFDocument.load(bytes);
    expect(Math.abs(doc.getPage(0).getWidth() - PAGE.widthMm * MM)).toBeLessThan(0.01);
    const ops = await (await (await pdfjs.getDocument({ data: bytes.slice() }).promise).getPage(1)).getOperatorList();
    expect(ops.fnArray.length).toBeGreaterThan(0);
  });

  it('refuses embedded fonts built for another profile', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const embedded = createEmbeddedFonts(doc, { ...fonts, digest: 'other' });
    await expect(drawSvgOnPage(doc.addPage([100, 100]), '<svg viewBox="0 0 1 1"/>', fonts, embedded)).rejects.toThrow('FONT_UNAVAILABLE');
  });
});
