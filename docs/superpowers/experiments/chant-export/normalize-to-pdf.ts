// Spike (2026-10-19), regex prototype only; card K1 replaces it with a DOM-based normalizer.
// Exsurge SVG -> normalize -> sanitizePageSvg (unchanged) -> svgToVectorPdf (unchanged).
// Run from web/ after copying this file to web/scripts/.spike-chant/run.ts:
//   node --import ./scripts/register-extensionless.mjs scripts/.spike-chant/run.ts <exsurge.svg> <out.pdf> [contentWidthMm]
import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizePageSvg } from '../../src/lib/export-layout/svg';
import { svgToVectorPdf } from '../../src/lib/export-layout/vectorPdf';
import { loadFontProfile } from '../../src/lib/export-layout/fonts';

const [inFile, outPdf, widthMmArg] = process.argv.slice(2);
let s = readFileSync(inFile!, 'utf8');
// Class font sizes from Exsurge's <style> block, inlined as attributes.
const sizes = new Map<string, string>();
for (const m of s.matchAll(/svg\.Exsurge \.(\w+)\{[^}]*font-size:([\d.]+)px/g)) sizes.set(m[1]!, m[2]!);
s = s.replace(/<style>[\s\S]*?<\/style>/, '')
  .replace(' xlink="http://www.w3.org/1999/xlink"', ' xmlns:xlink="http://www.w3.org/1999/xlink"')
  .replace(/ (?:source-index|element-index|key)="[^"]*"/g, '')
  .replace(/ class=""/g, '')
  .replace(/<use([^>]*?) id="[^"]*"/g, '<use$1')
  .replace(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"([^>]*)><\/line>/g, '<path d="M$1 $2L$3 $4"$5></path>')
  .replace(/ style="font-variant: small-caps;"/g, '')
  .replace(/ style="font-family: 'Exsurge Characters';fill: #d00;"/g, ' fill="#000"')
  .replace(/ style="font-style: italic;"/g, ' font-style="italic"')
  .replace(/ style="font-weight: bold;"/g, ' font-weight="bold"')
  .replace(/ style="fill: #d00;"/g, ' fill="#000"').replace(/ style=""/g, '')
  .replace(/<text([^>]*?) class="(\w+)"/g, (all, pre: string, cls: string) => sizes.has(cls) ? `<text${pre} class="${cls}" font-size="${sizes.get(cls)}" font-family="Liberation Serif" fill="#000"` : all);
writeFileSync(outPdf! + '.svg', s);
const left = [...new Set([...s.matchAll(/ (style|[a-z-]+:?[a-z-]*)="/g)].map((m) => m[1]))];
console.log('attrs after normalize:', left.join(' '));
const t0 = performance.now();
const clean = sanitizePageSvg(s, 'ch');
const t1 = performance.now();
const fonts = await loadFontProfile(async (url) => new Uint8Array(readFileSync('public' + url)));
const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(s)!;
const wMm = Number(widthMmArg ?? 191.9); const k = wMm / Number(vb[1]);
const pdf = await svgToVectorPdf(clean, { widthMm: wMm + 24, heightMm: Number(vb[2]) * k + 24, kind: 'print' }, fonts,
  { xMm: 12, yMm: 12, widthMm: wMm, heightMm: Number(vb[2]) * k } as never);
writeFileSync(outPdf!, pdf);
console.log('sanitize ms', (t1 - t0).toFixed(1), 'pdf bytes', pdf.length, 'mm/unit', k.toFixed(4));
