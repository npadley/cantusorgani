// C2b/C2c: the measurement logic shared by scripts/measure-export-layout.ts (Playwright, desktop Chromium) and the
// in-browser timing page (/e2e/export-timing/, any device), so that both produce comparable numbers.
//
// What is measured, per run, always as performance.now() differences taken inside the page:
//   cold      first `layout` post -> first `result` (Verovio WASM init, fonts, MEI fetch, layout, compose)
//   firstPart first `layout` post -> first `progress` message (the first part rendered)
//   warm      a settings change (staff medium -> large; large -> medium for the large condition), same worker
//   pdfCold   `pdf` post -> `pdf` response for the cold result (includes starting the PDF worker)
//   pdfWarm   a second `pdf` post for the warm result, same PDF worker
// This module is pure: no DOM, no Node API, and only type imports, so a browser and Node can both load it.

export interface Timed {
  readonly ms: number;
  readonly firstProgressMs: number | null;
  readonly progress: number;
  readonly type: string;
  readonly token: number;
  readonly complete: boolean | null;
  readonly pageCount: number | null;
  readonly byteSize: number | null;
  readonly errorDetail: string | null;
}

export interface Settings {
  readonly version: 2; readonly page: string; readonly customSize: null; readonly orientation: 'portrait'; readonly marginMm: number;
  readonly staff: 'small' | 'medium' | 'large'; readonly lyrics: 'medium'; readonly spacing: 'normal'; readonly maxSystems: null;
  readonly linePolicy: 'original' | 'automatic';
}
export interface Condition { readonly id: string; readonly description: string; readonly parts: number; readonly settings: Settings; readonly warmStaff: 'medium' | 'large' }

/** What a measuring page or script has to provide: post a layout (or pdf) request and get its timing back. */
export interface SequenceHarness {
  layout(request: unknown): Promise<Timed>;
  pdf(token: number): Promise<Timed>;
}

export interface SequenceResult {
  coldMs: number | null; firstPartMs: number | null; coldPages: number | null;
  warmMs: number | null; warmPages: number | null;
  pdfColdMs: number | null; pdfColdBytes: number | null; pdfColdPages: number | null;
  pdfWarmMs: number | null; pdfWarmBytes: number | null;
  ok: boolean; failedStage: string | null; failureDetail: string | null;
}

const base = (patch: Partial<Settings>): Settings => ({
  version: 2, page: 'letter', customSize: null, orientation: 'portrait', marginMm: 12, staff: 'medium',
  lyrics: 'medium', spacing: 'normal', maxSystems: null, linePolicy: 'original', ...patch,
});

export const CONDITIONS: readonly Condition[] = [
  { id: 'letter-p-orig', description: 'Kyrie, Letter portrait, medium staff, original lines', parts: 1, settings: base({}), warmStaff: 'large' },
  { id: 'ipad11-p-auto', description: 'Kyrie, iPad 11 portrait (4 mm margins), medium staff, automatic lines', parts: 1, settings: base({ page: 'ipad-11', marginMm: 4, linePolicy: 'automatic' }), warmStaff: 'large' },
  { id: 'letter-p-large-auto', description: 'Kyrie, Letter portrait, large staff, automatic lines (warm change goes large to medium)', parts: 1, settings: base({ staff: 'large', linePolicy: 'automatic' }), warmStaff: 'medium' },
  { id: 'multi-3x', description: 'Kyrie repeated as 3 separate parts (distinct ids, same MEI), Letter, original lines', parts: 3, settings: base({}), warmStaff: 'large' },
  { id: 'multi-6x', description: 'Kyrie repeated as 6 separate parts (distinct ids, same MEI), Letter, original lines', parts: 6, settings: base({}), warmStaff: 'large' },
];

/** `count` parts that share one conversion (`entry`, a fixture manifest part) but have distinct ids. */
export function makeParts(count: number, entry: Readonly<Record<string, unknown>>, meiUrl: string): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `kyrie:${i}`, kind: 'mei', label: `Kyrie IX (${i + 1})`,
    heading: { label: `Kyrie IX (${i + 1})`, rubric: 'Lord, have mercy', rubricTranslation: null, credit: null },
    sourceSystemCount: 5, sourceRevision: entry['renderHash'], target: entry['target'], renderHash: entry['renderHash'],
    conversion: { ...entry, meiUrl },
  }));
}

export const layoutRequest = (parts: readonly unknown[], token: number, settings: Settings): unknown =>
  ({ type: 'layout', request: { token, title: 'Kyrie', parts, settings, overrides: {} } });

/** The cold layout, cold PDF, warm layout, warm PDF sequence for one condition on one fresh pair of workers. */
export async function runSequence(h: SequenceHarness, condition: Condition, parts: readonly unknown[]): Promise<SequenceResult> {
  const r: SequenceResult = {
    coldMs: null, firstPartMs: null, coldPages: null, warmMs: null, warmPages: null,
    pdfColdMs: null, pdfColdBytes: null, pdfColdPages: null, pdfWarmMs: null, pdfWarmBytes: null,
    ok: false, failedStage: null, failureDetail: null,
  };
  const out = r as { -readonly [K in keyof SequenceResult]: SequenceResult[K] };
  let stage = 'cold layout';
  try {
    const cold = await h.layout(layoutRequest(parts, 1, condition.settings));
    out.coldMs = cold.ms; out.firstPartMs = cold.firstProgressMs; out.coldPages = cold.pageCount;
    if (cold.type !== 'result' || cold.complete !== true) throw new Error(`layout ${cold.type}${cold.complete === false ? ' (incomplete)' : ''}: ${cold.errorDetail ?? 'no detail'}`);

    stage = 'cold pdf';
    const pdfCold = await h.pdf(1);
    out.pdfColdMs = pdfCold.ms; out.pdfColdBytes = pdfCold.byteSize; out.pdfColdPages = pdfCold.pageCount;
    if (pdfCold.type !== 'pdf') throw new Error(`pdf ${pdfCold.type}: ${pdfCold.errorDetail ?? 'no detail'}`);

    stage = 'warm layout';
    const warm = await h.layout(layoutRequest(parts, 2, { ...condition.settings, staff: condition.warmStaff }));
    out.warmMs = warm.ms; out.warmPages = warm.pageCount;
    if (warm.type !== 'result' || warm.complete !== true) throw new Error(`warm layout ${warm.type}${warm.complete === false ? ' (incomplete)' : ''}: ${warm.errorDetail ?? 'no detail'}`);

    stage = 'warm pdf';
    const pdfWarm = await h.pdf(2);
    out.pdfWarmMs = pdfWarm.ms; out.pdfWarmBytes = pdfWarm.byteSize;
    if (pdfWarm.type !== 'pdf') throw new Error(`warm pdf ${pdfWarm.type}: ${pdfWarm.errorDetail ?? 'no detail'}`);
    out.ok = true;
  } catch (e) {
    out.failedStage = stage;
    out.failureDetail = e instanceof Error ? e.message : String(e);
  }
  return out;
}

// ---------------------------------------------------------------- stats ---
export interface Stat { readonly n: number; readonly p50: number | null; readonly p95: number | null; readonly max: number | null }

/** Nearest-rank percentiles over the non-null values; with 5 runs p95 equals the max. */
export function stat(values: readonly (number | null)[]): Stat {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, p50: null, p95: null, max: null };
  const rank = (p: number): number => xs[Math.max(0, Math.ceil(p * xs.length) - 1)] as number;
  return { n: xs.length, p50: rank(0.5), p95: rank(0.95), max: xs[xs.length - 1] as number };
}
export const fmtMs = (v: number | null): string => (v === null ? 'n/a' : v >= 100 ? v.toFixed(0) : v.toFixed(1));
export const fmtTriple = (s: Stat): string => (s.n === 0 ? 'n/a' : `${fmtMs(s.p50)} / ${fmtMs(s.p95)} / ${fmtMs(s.max)}`);
export const kib = (b: number | null): string => (b === null ? 'n/a' : `${(b / 1024).toFixed(1)} KiB`);
export const mib = (b: number | null): string => (b === null ? 'unavailable' : `${(b / 1048576).toFixed(1)} MiB`);
