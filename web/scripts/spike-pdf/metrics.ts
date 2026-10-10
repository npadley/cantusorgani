// Spike S3 (not shipped): compare Verovio 6.3.0's text-metric table
// (data/text/Times*.xml, copied to build/s34/) with candidate text faces.
//
//   node scripts/spike-pdf/metrics.ts <verovio-Times.xml> <face.ttf> [more.ttf ...]
//
// Verovio keys its table with strtol(c, 16). The Latin-1 rows are written as
// UTF-8 byte pairs ("C3A9" for é), so they load as code 0xC3A9, never match a
// code point, and every non-ASCII character is measured with the 'o' advance.
// This script reproduces that lookup exactly.
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";

interface VerovioTable { readonly upem: number; readonly advance: ReadonlyMap<number, number> }

export function parseVerovioTable(xml: string): VerovioTable {
  const upemMatch = /units-per-em="(\d+)"/.exec(xml);
  if (upemMatch?.[1] === undefined) throw new Error("no units-per-em");
  const advance = new Map<number, number>();
  // AddGlyphToTextExtend: the advance is h-a-x, or the bbox width w when h-a-x is absent.
  for (const m of xml.matchAll(/<g c="([0-9A-Fa-f]+)"([^>]*)\/>/g)) {
    const code = m[1];
    const attrs = m[2] ?? "";
    if (code === undefined) continue;
    const hax = /h-a-x="([\d.]+)"/.exec(attrs)?.[1] ?? /\bw="([\d.]+)"/.exec(attrs)?.[1];
    if (hax === undefined) continue;
    advance.set(Number.parseInt(code, 16), Number.parseFloat(hax));
  }
  return { upem: Number.parseInt(upemMatch[1], 10), advance };
}

/** Verovio's per-character advance in em, as DeviceContext::GetTextExtent computes it. */
export function verovioAdvanceEm(table: VerovioTable, cp: number): number {
  const fallback = table.advance.get(0x6f);
  if (fallback === undefined) throw new Error("table has no 'o'");
  const direct = table.advance.get(cp);
  if (direct !== undefined) return direct / table.upem;
  if (cp === 0x20) return (table.advance.get(0x2e) ?? fallback) / table.upem;
  return fallback / table.upem;
}

const isMain = process.argv[1]?.endsWith("metrics.ts") === true;
if (isMain) {
  const [tablePath, ...faces] = process.argv.slice(2);
  if (tablePath === undefined || faces.length === 0) throw new Error("usage: metrics.ts <Times.xml> <face.ttf>...");
  const table = parseVerovioTable(readFileSync(tablePath, "utf8"));
  const ascii = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => 0x21 + i);
  const accents = [..."éáíóúýǽæœÉÁÍÓÚǼÆŒëïü"].map((c) => c.codePointAt(0) ?? 0);
  for (const facePath of faces) {
    const font = fontkit.create(readFileSync(facePath));
    let maxAsciiErr = 0;
    let worst = "";
    for (const cp of ascii) {
      const want = verovioAdvanceEm(table, cp);
      const got = font.glyphForCodePoint(cp).advanceWidth / font.unitsPerEm;
      const err = Math.abs(want - got);
      if (err > maxAsciiErr) { maxAsciiErr = err; worst = String.fromCodePoint(cp); }
    }
    const rows = accents.map((cp) => {
      const has = font.hasGlyphForCodePoint(cp);
      const got = has ? font.glyphForCodePoint(cp).advanceWidth / font.unitsPerEm : Number.NaN;
      const want = verovioAdvanceEm(table, cp);
      return { ch: String.fromCodePoint(cp), has, faceEm: +got.toFixed(4), verovioEm: +want.toFixed(4), deltaEm: +(got - want).toFixed(4) };
    });
    console.log(JSON.stringify({ face: facePath.split("/").pop(), upem: font.unitsPerEm, asciiGlyphs: ascii.length, maxAsciiErrEm: +maxAsciiErr.toFixed(5), worst, accents: rows }, null, 1));
  }
}
