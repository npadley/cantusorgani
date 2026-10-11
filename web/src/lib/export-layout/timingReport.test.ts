import { describe, expect, it } from 'vitest';
import baselineJson from './__fixtures__/desktop-baseline.json';
import { CONDITIONS } from './measureCore';
import type { SequenceResult } from './measureCore';
import { buildReport, compare, toMarkdown } from './timingReport';
import type { Baseline, DeviceInfo, RunOutcome } from './timingReport';

const baseline = baselineJson as unknown as Baseline;
const device: DeviceInfo = { userAgent: 'iPad UA', hardwareConcurrency: 8, deviceMemoryGiB: null, screen: { width: 834, height: 1194, devicePixelRatio: 2 }, crossOriginIsolated: false, secureContext: false };
const ok = (run: number, x: number): RunOutcome => ({
  run, ok: true, failedStage: null, failureDetail: null, coldMs: 1000 + x, firstPartMs: 900 + x, coldPages: 2, warmMs: 300 + x, warmPages: 3,
  pdfColdMs: 200 + x, pdfColdBytes: 51_089, pdfColdPages: 2, pdfWarmMs: 100 + x, pdfWarmBytes: 60_000, memory: { bytes: null, reason: 'performance.measureUserAgentSpecificMemory is not available' },
} satisfies SequenceResult & { run: number; memory: unknown });

describe('desktop baseline', () => {
  it('should carry the commit, date and all five conditions with p50s', () => {
    expect(baseline.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(baseline.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(baseline.conditions).sort()).toEqual(CONDITIONS.map((c) => c.id).sort());
    for (const c of Object.values(baseline.conditions)) expect(c['coldMs']!.p50).toBeGreaterThan(0);
  });
});

describe('buildReport and toMarkdown', () => {
  const outcomes = Object.fromEntries(CONDITIONS.map((c) => [c.id, [ok(1, 0), ok(2, 10), ok(3, 20)]]));
  const failed: RunOutcome = { ...ok(4, 0), ok: false, failedStage: 'cold pdf', failureDetail: 'pdf error: boom', pdfColdMs: null };
  const report = buildReport({ conditions: CONDITIONS, outcomes: { ...outcomes, 'multi-6x': [ok(1, 0), failed] }, device, baseline, runsPerCondition: 3, now: new Date('2026-10-11T00:00:00Z') });

  it('should give p50, p95 and max per metric over the successful runs only', () => {
    const c = report.conditions[0]!;
    expect(c.stats.coldMs).toEqual({ n: 3, p50: 1010, p95: 1020, max: 1020 });
    expect(c.succeeded).toBe(3);
    const six = report.conditions.find((x) => x.id === 'multi-6x')!;
    expect([six.runs, six.succeeded, six.failed]).toEqual([2, 1, 1]);
    expect(six.failures).toEqual([{ run: 4, stage: 'cold pdf', detail: 'pdf error: boom' }]);
  });

  it('should say memory is not available instead of estimating it', () => {
    const c = report.conditions[0]!;
    expect(c.stats.memoryUserAgentSpecificBytes.n).toBe(0);
    expect(c.memoryNote).toBe('not available (performance.measureUserAgentSpecificMemory is not available)');
    const md = toMarkdown(report, baseline);
    expect(md).toContain('not available (performance.measureUserAgentSpecificMemory is not available)');
  });

  it('should put the desktop p50 beside this device and the ratio', () => {
    const cmp = compare(report, baseline, 'letter-p-orig', 'coldMs');
    expect(cmp.desktop).toBeCloseTo(510.1, 0);
    expect(cmp.ratio).toBeCloseTo(1010 / 510.1, 1);
    const md = toMarkdown(report, baseline);
    expect(md).toContain(`commit ${baseline.commit}`);
    expect(md).toContain('warm-cache cold');
    expect(md).toContain('FAILED run 4 at cold pdf: pdf error: boom');
    expect(md).toContain('### letter-p-orig:');
    expect(md).toContain('iPad UA');
  });

  it('should round-trip as JSON', () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
