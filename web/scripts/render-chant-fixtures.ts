// Renders the chant fixtures for the export-layout tests (spec CS §4.3, §5).
//
//   node scripts/render-chant-fixtures.ts
//
// Draws each chant with the vendored Exsurge (web/public/vendor/exsurge) in
// headless Chromium, with the export settings: rubrics #d00, Liberation Serif
// loaded from web/public/fonts/export, GABC from data/chants.json with the
// GregoBase tags Exsurge does not know removed. Writes, per chant and width,
// {svg, lines:[{y,height}]} to src/lib/export-layout/__fixtures__/chant/.
//
// The output is deterministic: running it twice gives byte-identical files.
// Those files are committed; run this only when the fixtures need to change.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { cleanGabc } from "../src/lib/gabc.ts";

interface ChantRecord {
  readonly part: string | null;
  readonly mode: string | null;
  readonly incipit: string;
  readonly gabc: string;
}

interface FixtureSpec {
  readonly file: string;
  readonly chantId: string;
  readonly width: number;
}

// The annotation printed over the initial, from web/src/lib/chants.ts
// (PART_ABBREVIATIONS). Copied here because chants.ts imports the JSON
// without an import attribute, which plain Node cannot load.
const PART_ABBREVIATIONS: Readonly<Record<string, string>> = {
  in: "Intr.", gr: "Grad.", al: "Allel.", tr: "Tract.", of: "Offert.", co: "Comm.", se: "Seq.", sq: "Seq.",
  an: "Ant.", hy: "Hymn.",
};

// DL D30: the chant is drawn at 1.565 x the accompaniment's staff space (as on the site), Medium music. These numbers
// repeat chantScale.ts: mmPerUnit = 1.8 mm x 1.565 / 12.5 = 0.22536; width units = printable width / mmPerUnit, with the
// Letter (191.9 mm) and iPad mini (107.9 mm) printable widths; the lyric is 4.05 mm x 1.07, as setFont(size / 0.9).
const MM_PER_UNIT = (1.8 * 1.565) / 12.5;
const LETTER_UNITS = Math.round(191.9 / MM_PER_UNIT);
const MINI_UNITS = Math.round(107.9 / MM_PER_UNIT);
const FIXTURES: readonly FixtureSpec[] = [1, 277, 889].flatMap((id) => {
  const kind = id === 1 ? "al" : id === 277 ? "gr" : "tr";
  return [MINI_UNITS, LETTER_UNITS].map((width): FixtureSpec => ({ file: `${kind}-${id}-${width}.json`, chantId: String(id), width }));
});

const SET_FONT_SIZE = (4.05 * 1.07) / MM_PER_UNIT / 0.9;

const FONT_FILES: readonly { family: string; style: string; file: string }[] = [
  { family: "Liberation Serif", style: "normal", file: "LiberationSerif-Regular.ttf" },
  { family: "Liberation Serif", style: "italic", file: "LiberationSerif-Italic.ttf" },
  { family: "Liberation Serif", style: "bold", file: "LiberationSerif-Bold.ttf" },
];

const REPO = new URL("../../", import.meta.url);
const DATA_CHANTS = new URL("data/chants.json", REPO);
const EXSURGE = new URL("web/public/vendor/exsurge/exsurge.min.js", REPO);
const FONT_DIR = new URL("web/public/fonts/export/", REPO);
const OUT_DIR = new URL("web/src/lib/export-layout/__fixtures__/chant/", REPO);

interface RenderedLine { readonly y: number; readonly height: number }
interface Rendered { readonly svg: string; readonly lines: readonly RenderedLine[] }

interface RenderArgs {
  readonly gabc: string;
  readonly annotation: string;
  readonly mode: string;
  readonly width: number;
  readonly setFontSize: number;
}

// Runs in the browser page. Keep it free of TypeScript-only syntax beyond
// annotations: the function body is serialised and sent to Chromium as is.
function renderInPage(args: RenderArgs): Promise<Rendered> {
  interface PageCtxt {
    setGlyphScaling(scale: number): void;
    setFont(family: string, size: number): void;
    setRubricColor(color: string): void;
    textColor: string;
    staffLineColor: string;
    neumeLineColor: string;
    dividerLineColor: string;
    negativeFillColor: string;
    spaceBetweenSystems: number;
  }
  interface PageScore {
    annotation: unknown;
    lines: readonly { bounds: { y: number; height: number } }[];
    performLayoutAsync(ctxt: PageCtxt, done: () => void): void;
    layoutChantLines(ctxt: PageCtxt, width: number, done: () => void): void;
    createSvgNode(ctxt: PageCtxt): { outerHTML: string };
  }
  interface PageLib {
    ChantContext: new (strategy: unknown) => PageCtxt;
    TextMeasuringStrategy: { Canvas: unknown };
    ChantScore: new (ctxt: PageCtxt, mappings: unknown, dropCap: boolean) => PageScore;
    Annotations: new (ctxt: PageCtxt, first: string, second: string) => unknown;
    Gabc: { createMappingsFromSource(ctxt: PageCtxt, gabc: string): unknown };
  }
  const round = (n: number): number => Math.round(n * 100) / 100;
  return new Promise<Rendered>((resolve, reject) => {
    const lib = (window as unknown as { exsurge?: PageLib }).exsurge;
    if (!lib) {
      reject(new Error("exsurge is not loaded"));
      return;
    }
    const ctxt = new lib.ChantContext(lib.TextMeasuringStrategy.Canvas);
    ctxt.setGlyphScaling(1 / 16);
    ctxt.setFont("'Liberation Serif'", args.setFontSize);
    ctxt.setRubricColor("#d00");
    ctxt.textColor = "#000";
    ctxt.staffLineColor = "#000";
    ctxt.neumeLineColor = "#000";
    ctxt.dividerLineColor = "#000";
    ctxt.negativeFillColor = "#fff";
    ctxt.spaceBetweenSystems = 0;
    const score = new lib.ChantScore(ctxt, lib.Gabc.createMappingsFromSource(ctxt, args.gabc), true);
    score.annotation = new lib.Annotations(ctxt, `%${args.annotation}%`, `%${args.mode}%`);
    score.performLayoutAsync(ctxt, () => {
      score.layoutChantLines(ctxt, args.width, () => {
        const svg = score.createSvgNode(ctxt).outerHTML;
        const lines = score.lines.map((l) => ({ y: round(l.bounds.y), height: round(l.bounds.height) }));
        resolve({ svg, lines });
      });
    });
  });
}

async function fontFaceCss(): Promise<string> {
  const faces: string[] = [];
  for (const face of FONT_FILES) {
    const bytes = await readFile(new URL(face.file, FONT_DIR));
    const src = `data:font/ttf;base64,${bytes.toString("base64")}`;
    faces.push(`@font-face { font-family: '${face.family}'; font-style: ${face.style};` +
      ` font-weight: ${face.style === "bold" ? "bold" : "normal"}; src: url(${src}) format('truetype'); }`);
  }
  return faces.join("\n");
}

async function main(): Promise<void> {
  const chants = JSON.parse(await readFile(DATA_CHANTS, "utf8")) as { chants: Record<string, ChantRecord> };
  const exsurgeSource = await readFile(EXSURGE, "utf8");
  const css = await fontFaceCss();

  // CHROME_EXECUTABLE points at a Chromium build other than Playwright's own
  // (for a machine whose cached browser is a different version). Unset, the
  // Playwright-managed browser is used.
  const executablePath = process.env["CHROME_EXECUTABLE"];
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>` +
      `<body style="font-family: 'Liberation Serif', serif"></body></html>`);
    await page.addScriptTag({ content: exsurgeSource });
    await page.evaluate(async () => {
      await document.fonts.load("1em 'Liberation Serif'");
      await document.fonts.load("italic 1em 'Liberation Serif'");
      await document.fonts.load("bold 1em 'Liberation Serif'");
    });

    for (const spec of FIXTURES) {
      const chant = chants.chants[spec.chantId];
      if (!chant) throw new Error(`chant #${spec.chantId} is not in data/chants.json`);
      const annotation = PART_ABBREVIATIONS[chant.part ?? ""] ?? "";
      const mode = chant.mode ?? "";
      const rendered = await page.evaluate(renderInPage, {
        gabc: cleanGabc(chant.gabc),
        annotation,
        mode,
        width: spec.width,
        setFontSize: SET_FONT_SIZE,
      });
      const out = `${JSON.stringify(rendered, null, 2)}\n`;
      await writeFile(new URL(spec.file, OUT_DIR), out);
      console.log(`${spec.file}: #${spec.chantId} "${chant.incipit}" width ${spec.width}, ${rendered.lines.length} lines, ${out.length} bytes`);
    }
  } finally {
    await browser.close();
  }
}

await main();
