/**
 * Drawing checks on a laid-out Verovio page (mirrors precheck.py): nothing is drawn for a hidden
 * continuation, a revealed continuation has no stem, and no tie or slur is a stub in mid-system.
 * Coordinates are inner SVG units (0.01 mm).
 */
const nums = (d: string): number[] => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** Heads drawn on the page: [x, y]. */
function heads(svg: string): [number, number][] {
  return [...svg.matchAll(/<g class="notehead">\s*<use[^>]*transform="translate\(([-\d.]+),\s*([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

/** Ledger lines with no drawn head on them: they belong to a hidden head. */
export function orphanLedgerLines(svg: string): string[] {
  const hs = heads(svg);
  const lines = [...svg.matchAll(/<path[^>]*d="M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)"/g)];
  const ys = [...new Set(lines.filter((m) => m[2] === m[4]).map((m) => Number(m[2])))].sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!).filter((d) => d > 100);
  const spacing = gaps.length > 0 ? Math.min(...gaps) : 180;
  const out: string[] = [];
  for (const g of svg.matchAll(/class="ledgerLines (above|below)">([\s\S]*?)<\/g>/g)) {
    for (const p of g[2]!.matchAll(/d="M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)"/g)) {
      const [x1, y, x2] = [Number(p[1]), Number(p[2]), Number(p[3])];
      // A ledger line serves every head on it or further out from the staff.
      const serves = (hy: number): boolean => (g[1] === 'above' ? hy <= y + 0.7 * spacing : hy >= y - 0.7 * spacing);
      if (!hs.some(([hx, hy]) => hx >= x1 - 60 && hx <= x2 + 60 && serves(hy))) out.push(`ledger ${x1}-${x2} @ ${y}`);
    }
  }
  return out;
}

/** Revealed continuations (a drawn head) that also draw a stem, flag or accidental. */
export function stemmedContinuations(svg: string): string[] {
  const out: string[] = [];
  const re = /<g\b[^>]*id="([^"]+)"[^>]*class="note split-continuation"[^>]*>/g;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    // The note group ends where the next note or layer group begins (notes do not nest).
    const rest = svg.slice(m.index + m[0].length);
    const end = rest.search(/<g\b[^>]*class="(?:note|layer|staff|measure)[ "]/);
    const body = end < 0 ? rest : rest.slice(0, end);
    if (body.includes('class="notehead"') && (/class="(stem|flag)"/.test(body) || /class="accid">\s*<use/.test(body))) out.push(m[1]!);
  }
  return out;
}

/** Ties and slurs shorter than `minUnits` that neither start a system nor end at its right edge. */
export function stubArcs(svg: string, minUnits = 100): string[] {
  const staff = [...svg.matchAll(/<path[^>]*d="M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)"/g)].filter((m) => m[2] === m[4]);
  if (staff.length === 0) return [];
  const left = Math.min(...staff.map((m) => Number(m[1])));
  const right = Math.max(...staff.map((m) => Number(m[3])));
  const out: string[] = [];
  for (const m of svg.matchAll(/<g\b[^>]*class="((?:tie|slur)[^"]*)"[^>]*>\s*<path[^>]*d="([^"]*)"/g)) {
    const xs = nums(m[2]!).filter((_, k) => k % 2 === 0);
    const lo = Math.min(...xs); const hi = Math.max(...xs);
    if (hi - lo >= minUnits) continue;
    if (hi >= right - 200 || lo <= left + 1200) continue; // a piece at a system edge
    out.push(`${m[1]} ${Math.round(lo)}-${Math.round(hi)}`);
  }
  return out;
}
