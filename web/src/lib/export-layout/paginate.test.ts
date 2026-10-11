import { describe, it, expect } from 'vitest';
import { paginate } from './paginate';
import type { PaginateInput, PaginateResult } from './paginate';

type Sys = PaginateInput['systems'][number];

const sys = (heightMm: number): Sys => ({ heightMm, startsAfterBoundary: null });

function input(over: Partial<PaginateInput> & { heights?: readonly number[] }): PaginateInput {
  const { heights, ...rest } = over;
  return {
    systems: (heights ?? []).map(sys),
    contentHeightMm: 100,
    firstPageContentHeightMm: 100,
    minGapMm: 0,
    maxSystems: null,
    forcedPageStarts: new Set<number>(),
    ...rest,
  };
}

function pagesOf(r: PaginateResult): readonly (readonly number[])[] {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r.pages;
}

describe('paginate: hand cases', () => {
  it('returns no pages for no systems', () => {
    expect(pagesOf(paginate(input({ heights: [] })))).toEqual([]);
  });

  it('puts one system on one page', () => {
    expect(pagesOf(paginate(input({ heights: [30] })))).toEqual([[0]]);
  });

  it('cap 1 gives one system per page', () => {
    expect(pagesOf(paginate(input({ heights: [10, 10, 10], maxSystems: 1 })))).toEqual([[0], [1], [2]]);
  });

  it('cap 2 with 5 systems', () => {
    expect(pagesOf(paginate(input({ heights: [10, 10, 10, 10, 10], maxSystems: 2 })))).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('starts a new page on height overflow, counting gaps', () => {
    // 40 + 5 + 40 = 85 fits; + 5 + 40 = 130 does not.
    expect(pagesOf(paginate(input({ heights: [40, 40, 40], minGapMm: 5 })))).toEqual([[0, 1], [2]]);
    // exactly full is allowed: 45 + 10 + 45 = 100
    expect(pagesOf(paginate(input({ heights: [45, 45], minGapMm: 10 })))).toEqual([[0, 1]]);
    // one mm over is not
    expect(pagesOf(paginate(input({ heights: [45, 46], minGapMm: 10 })))).toEqual([[0], [1]]);
  });

  it('honours forced page starts', () => {
    expect(pagesOf(paginate(input({ heights: [10, 10, 10, 10], forcedPageStarts: new Set([2]) })))).toEqual([[0, 1], [2, 3]]);
  });

  it('forced start 0 is a no-op', () => {
    expect(pagesOf(paginate(input({ heights: [10, 10], forcedPageStarts: new Set([0]) })))).toEqual([[0, 1]]);
  });

  it('uses the first-page height for page one only', () => {
    const r = paginate(input({ heights: [30, 30, 30], firstPageContentHeightMm: 40, contentHeightMm: 100 }));
    expect(pagesOf(r)).toEqual([[0], [1, 2]]);
  });

  it('reports SYSTEM_TOO_TALL on the first page', () => {
    const r = paginate(input({ heights: [10, 60], firstPageContentHeightMm: 50, contentHeightMm: 100 }));
    // system 1 would start page 2 (height 100) -> fits there
    expect(pagesOf(r)).toEqual([[0], [1]]);
    expect(paginate(input({ heights: [60], firstPageContentHeightMm: 50, contentHeightMm: 100 }))).toEqual({
      ok: false, code: 'SYSTEM_TOO_TALL', systemIndex: 0,
    });
  });

  it('reports SYSTEM_TOO_TALL on a later page', () => {
    expect(paginate(input({ heights: [10, 120], maxSystems: 1 }))).toEqual({
      ok: false, code: 'SYSTEM_TOO_TALL', systemIndex: 1,
    });
  });

  it('does not mutate its input', () => {
    const i = input({ heights: [10, 20, 30], forcedPageStarts: new Set([1]), maxSystems: 2 });
    const snapshot = JSON.stringify({ s: i.systems, f: [...i.forcedPageStarts] });
    paginate(i);
    expect(JSON.stringify({ s: i.systems, f: [...i.forcedPageStarts] })).toBe(snapshot);
  });
});

// mulberry32 seeded PRNG
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('paginate: properties (500 seeded random inputs)', () => {
  it('holds all invariants for every ok result', () => {
    const rand = prng(20261008);
    const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
    let okCount = 0;
    let tallCount = 0;

    for (let iter = 0; iter < 500; iter++) {
      const n = int(0, 25);
      const heights = Array.from({ length: n }, () => 5 + rand() * 60);
      const forced = new Set<number>();
      const nForced = int(0, 5);
      for (let k = 0; k < nForced; k++) forced.add(int(0, Math.max(0, n)));
      const contentHeightMm = 80 + rand() * 120;
      const firstPageContentHeightMm = contentHeightMm - rand() * 40;
      const minGapMm = rand() * 8;
      const maxSystems = rand() < 0.4 ? null : int(1, 8);
      const inp: PaginateInput = {
        systems: heights.map(sys), contentHeightMm, firstPageContentHeightMm, minGapMm, maxSystems, forcedPageStarts: forced,
      };
      const r = paginate(inp);
      if (!r.ok) {
        tallCount++;
        expect(r.code).toBe('SYSTEM_TOO_TALL');
        const h = heights[r.systemIndex]!;
        expect(h).toBeGreaterThan(0);
        continue;
      }
      okCount++;
      const eps = 1e-9;
      r.pages.forEach((page, pi) => {
        expect(page.length).toBeGreaterThan(0);
        if (maxSystems !== null) expect(page.length).toBeLessThanOrEqual(maxSystems);
        const limit = pi === 0 ? firstPageContentHeightMm : contentHeightMm;
        const total = page.reduce((s, idx) => s + heights[idx]!, 0) + minGapMm * (page.length - 1);
        expect(total).toBeLessThanOrEqual(limit + eps);
      });
      const starts = new Set(r.pages.map((p) => p[0]!));
      for (const f of forced) if (f !== 0 && f < n) expect(starts.has(f)).toBe(true);
      expect(r.pages.flat()).toEqual(Array.from({ length: n }, (_, i) => i));
    }
    expect(okCount).toBeGreaterThan(100);
    expect(tallCount + okCount).toBe(500);
  });
});
