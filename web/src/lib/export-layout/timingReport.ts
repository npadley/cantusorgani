// C2c: the report of the in-browser timing page (/e2e/export-timing/): per-condition statistics, device facts, the
// desktop baseline beside them, and the Markdown and JSON a person pastes back. Pure; the page only does the I/O.
import { fmtMs, kib, mib, stat } from './measureCore';
import type { Condition, SequenceResult, Stat } from './measureCore';

export interface DeviceInfo {
  readonly userAgent: string;
  readonly hardwareConcurrency: number | null;
  /** navigator.deviceMemory in GiB (Chromium only); null when the browser does not report it. */
  readonly deviceMemoryGiB: number | null;
  readonly screen: { readonly width: number; readonly height: number; readonly devicePixelRatio: number };
  readonly crossOriginIsolated: boolean;
  readonly secureContext: boolean;
}
export interface RunMemory {
  /** performance.measureUserAgentSpecificMemory result in bytes, or null with the reason it could not be read. */
  readonly bytes: number | null;
  readonly reason: string | null;
}
export interface RunOutcome extends SequenceResult { readonly run: number; readonly memory: RunMemory }

export interface BaselineStats { readonly n: number; readonly p50: number | null; readonly p95: number | null; readonly max: number | null }
export interface Baseline {
  readonly commit: string;
  readonly date: string;
  readonly browser: string;
  readonly cpu: string;
  readonly platform: string;
  readonly runsPerCondition: number;
  readonly conditions: Readonly<Record<string, Readonly<Record<string, BaselineStats>>>>;
}

export const METRICS = [
  { key: 'coldMs', label: 'Cold: first layout, new workers', unit: 'ms' },
  { key: 'firstPartMs', label: 'First part ready', unit: 'ms' },
  { key: 'warmMs', label: 'Warm: settings change', unit: 'ms' },
  { key: 'pdfColdMs', label: 'PDF, cold', unit: 'ms' },
  { key: 'pdfWarmMs', label: 'PDF, warm', unit: 'ms' },
  { key: 'pdfBytes', label: 'PDF size', unit: 'bytes' },
  { key: 'memoryUserAgentSpecificBytes', label: 'Memory (browser-reported)', unit: 'bytes' },
] as const;
export type MetricKey = (typeof METRICS)[number]['key'];

export interface ConditionReport {
  readonly id: string;
  readonly description: string;
  readonly parts: number;
  readonly runs: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly failures: readonly { readonly run: number; readonly stage: string | null; readonly detail: string | null }[];
  readonly pages: { readonly cold: number | null; readonly warm: number | null };
  readonly stats: Readonly<Record<MetricKey, Stat>>;
  /** Why there is no memory figure, when there is none. Never an estimate. */
  readonly memoryNote: string | null;
}
export interface Report {
  readonly generatedAt: string;
  readonly runsPerCondition: number;
  readonly device: DeviceInfo;
  readonly notes: readonly string[];
  readonly conditions: readonly ConditionReport[];
  readonly desktopBaseline: Omit<Baseline, 'conditions'>;
}

export const NOTES: readonly string[] = [
  'Cold means new workers: Verovio, the fonts and the music are parsed and laid out from scratch. It does NOT mean an empty HTTP cache (a page cannot clear its own), so the files may already be cached: these cold numbers are warm-cache cold. The first run after a fresh page load also downloaded them.',
  'The desktop figures are the quiet-machine p50 from the C2b run (Playwright, headless Chromium, 5 runs); the iPad and the desktop run the same code and the same measurement.',
  'Memory comes from performance.measureUserAgentSpecificMemory only. Where the browser does not offer it (all of iOS) it is "not available": nothing is estimated.',
];

export function buildReport(args: {
  readonly conditions: readonly Condition[];
  readonly outcomes: Readonly<Record<string, readonly RunOutcome[]>>;
  readonly device: DeviceInfo;
  readonly baseline: Baseline;
  readonly runsPerCondition: number;
  readonly now?: Date;
}): Report {
  const conditions = args.conditions.map((c): ConditionReport => {
    const runs = args.outcomes[c.id] ?? [];
    const ok = runs.filter((r) => r.ok);
    const mems = ok.map((r) => r.memory);
    const reasons = [...new Set(mems.filter((m) => m.bytes === null).map((m) => m.reason ?? 'not available'))];
    return {
      id: c.id, description: c.description, parts: c.parts, runs: runs.length, succeeded: ok.length, failed: runs.length - ok.length,
      failures: runs.filter((r) => !r.ok).map((r) => ({ run: r.run, stage: r.failedStage, detail: r.failureDetail })),
      pages: { cold: ok[0]?.coldPages ?? null, warm: ok[0]?.warmPages ?? null },
      stats: {
        coldMs: stat(ok.map((r) => r.coldMs)), firstPartMs: stat(ok.map((r) => r.firstPartMs)), warmMs: stat(ok.map((r) => r.warmMs)),
        pdfColdMs: stat(ok.map((r) => r.pdfColdMs)), pdfWarmMs: stat(ok.map((r) => r.pdfWarmMs)), pdfBytes: stat(ok.map((r) => r.pdfColdBytes)),
        memoryUserAgentSpecificBytes: stat(mems.map((m) => m.bytes)),
      },
      memoryNote: reasons.length > 0 && ok.length > 0 ? `not available (${reasons.join('; ')})` : null,
    };
  });
  const { conditions: _ignored, ...baseline } = args.baseline;
  return { generatedAt: (args.now ?? new Date()).toISOString(), runsPerCondition: args.runsPerCondition, device: args.device, notes: NOTES, conditions, desktopBaseline: baseline };
}

const fmt = (m: (typeof METRICS)[number], v: number | null): string => (v === null ? 'n/a' : m.unit === 'bytes' ? (m.key === 'pdfBytes' ? kib(v) : mib(v)) : fmtMs(v));

/** The desktop p50 for a metric, and the ratio of this device's p50 to it. */
export function compare(report: Report, baseline: Baseline, id: string, key: MetricKey): { desktop: number | null; ratio: number | null } {
  const desktop = baseline.conditions[id]?.[key]?.p50 ?? null;
  const own = report.conditions.find((c) => c.id === id)?.stats[key].p50 ?? null;
  return { desktop, ratio: desktop !== null && own !== null && desktop > 0 ? own / desktop : null };
}

export function toMarkdown(report: Report, baseline: Baseline): string {
  const d = report.device;
  const out: string[] = [
    '# Export timing', '',
    `Generated ${report.generatedAt}; ${report.runsPerCondition} run(s) per condition.`, '',
    '## Device', '',
    `- User agent: ${d.userAgent}`,
    `- Cores (hardwareConcurrency): ${d.hardwareConcurrency ?? 'not reported'}`,
    `- Device memory: ${d.deviceMemoryGiB === null ? 'not reported' : `${d.deviceMemoryGiB} GiB`}`,
    `- Screen: ${d.screen.width} x ${d.screen.height} at ${d.screen.devicePixelRatio}x`,
    `- Secure context: ${d.secureContext ? 'yes' : 'no'}; cross-origin isolated: ${d.crossOriginIsolated ? 'yes' : 'no'}`, '',
    '## Notes', '', ...report.notes.map((n) => `- ${n}`), '',
    `Desktop baseline: ${baseline.cpu}, ${baseline.browser}, commit ${baseline.commit}, ${baseline.date.slice(0, 10)}, ${baseline.runsPerCondition} runs.`, '',
    '## Results (p50 / p95 / max; desktop p50; this device as a multiple of desktop)', '',
  ];
  for (const c of report.conditions) {
    out.push(`### ${c.id}: ${c.description}`, '', `${c.succeeded}/${c.runs} runs succeeded${c.failed > 0 ? ` (${c.failed} FAILED)` : ''}; pages ${c.pages.cold ?? 'n/a'} cold, ${c.pages.warm ?? 'n/a'} warm.`, '');
    out.push('| Metric | p50 | p95 | max | Desktop p50 | x desktop |', '|---|---|---|---|---|---|');
    for (const m of METRICS) {
      const s = c.stats[m.key];
      const cmp = compare(report, baseline, c.id, m.key);
      if (m.key === 'memoryUserAgentSpecificBytes' && s.n === 0) {
        out.push(`| ${m.label} | ${c.memoryNote ?? 'not available'} | | | ${fmt(m, cmp.desktop)} | |`);
        continue;
      }
      out.push(`| ${m.label} (${m.unit === 'ms' ? 'ms' : m.key === 'pdfBytes' ? 'KiB' : 'MiB'}) | ${fmt(m, s.p50)} | ${fmt(m, s.p95)} | ${fmt(m, s.max)} | ${fmt(m, cmp.desktop)} | ${cmp.ratio === null || m.unit === 'bytes' ? '' : cmp.ratio.toFixed(1)} |`);
    }
    for (const f of c.failures) out.push('', `FAILED run ${f.run} at ${f.stage ?? '?'}: ${f.detail ?? 'no detail'}`);
    out.push('');
  }
  return out.join('\n');
}
