// Spike S3+S4 (not shipped): render the Kyrie IX experiment MEI with the
// npm Verovio 6.3.0 build in Node, at scale 100 on the ipad-11 page.
//
//   node scripts/spike-pdf/render.ts <out.svg> [--liberation] [--accents]
//
// --liberation sets Verovio's `fontTextLiberation` option.
// --accents rewrites a few syllables to exercise é á í ó ú ǽ œ.
import { readFileSync, writeFileSync } from "node:fs";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

const FIXTURE = new URL("../../src/lib/export-layout/__fixtures__/kyrie-ix-experiment.mei", import.meta.url);

/** ipad-11 preset: 157.8 x 227.1 mm, in Verovio's 0.1 mm units at scale 100. */
export const PAGE = { widthMm: 157.8, heightMm: 227.1 } as const;

export const ACCENT_SYLLABLES: readonly (readonly [string, string])[] = [
  // Replace whole syllables in the first few occurrences, keeping syllable counts.
  ["Ky", "Ký"],
  ["ri", "rí"],
  ["lé", "lǽ"],
  ["son.", "sœn."],
  ["Chri", "Chrá"],
  ["ste", "stó"],
];

export function accentMei(mei: string): string {
  let out = mei;
  for (const [from, to] of ACCENT_SYLLABLES) {
    // Only the first occurrence, so the page still has the original text too.
    out = out.replace(`>${from}</syl>`, `>${to}</syl>`);
  }
  // Add one "ú" syllable so all five acute vowels appear.
  return out.replace(">i</syl>", ">ú</syl>");
}

export async function renderPage(mei: string, liberation: boolean): Promise<{ svg: string; pages: number; version: string }> {
  const module = await createVerovioModule();
  const tk = new VerovioToolkit(module);
  tk.setOptions({
    scale: 100,
    pageWidth: Math.floor(PAGE.widthMm * 10),
    pageHeight: Math.floor(PAGE.heightMm * 10),
    pageMarginTop: 40,
    pageMarginBottom: 40,
    pageMarginLeft: 40,
    pageMarginRight: 40,
    font: "Leipzig",
    header: "none",
    footer: "none",
    svgViewBox: true,
    breaks: "auto",
    fontTextLiberation: liberation,
  });
  if (!tk.loadData(mei)) throw new Error("Verovio could not load the MEI");
  return { svg: tk.renderToSVG(1), pages: tk.getPageCount(), version: tk.getVersion() };
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) {
  const out = process.argv[2];
  if (out === undefined) throw new Error("usage: render.ts <out.svg> [--liberation] [--accents]");
  const liberation = process.argv.includes("--liberation");
  const raw = readFileSync(FIXTURE, "utf8");
  const mei = process.argv.includes("--accents") ? accentMei(raw) : raw;
  const { svg, pages, version } = await renderPage(mei, liberation);
  writeFileSync(out, svg);
  console.log(JSON.stringify({ out, pages, version, liberation, bytes: svg.length }));
}
