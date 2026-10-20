import { describe, expect, it } from 'vitest';
import { CHANT_AFTER_GAP_MM, NO_CHANT, firstAccompanimentTopMm, planChant } from './chantPlan';
import type { ChantLineArt } from './types';

const art = (line: number, heightMm: number, chantId = 1): ChantLineArt => ({
  chantId, line, heightMm, widthMm: 100, svg: { svg: '<svg/>', ids: [], namespace: `c${chantId}l${line}` },
});
const lines = (n: number, h: number): ChantLineArt[] => Array.from({ length: n }, (_, i) => art(i, h));

describe('planChant', () => {
  it('returns the empty plan for no lines', () => {
    expect(planChant([], 10, 200, 40, true)).toBe(NO_CHANT);
  });

  it('shares the page when the remaining height is at least the minimum', () => {
    const plan = planChant(lines(2, 20), 15, 200, 40, true);
    expect(plan).toMatchObject({ pageCount: 1, chantPages: 0, shared: true });
    expect(plan.placed.map((l) => l.topMm)).toEqual([15, 35]);
    // heading 15 + chant 40 + gap
    expect(15 + plan.tailMm).toBe(55 + CHANT_AFTER_GAP_MM);
    expect(firstAccompanimentTopMm(15, plan.chantPages, plan.tailMm)).toBe(58);
  });

  it('pushes the accompaniment to a new page when less than the minimum remains', () => {
    const plan = planChant(lines(1, 150), 15, 200, 40, true);
    expect(plan).toMatchObject({ pageCount: 1, chantPages: 1, tailMm: 0, shared: false });
    expect(firstAccompanimentTopMm(15, plan.chantPages, plan.tailMm)).toBe(0);
  });

  it('does not share when asked not to', () => {
    const plan = planChant(lines(1, 20), 0, 200, 40, false);
    expect(plan).toMatchObject({ chantPages: 1, shared: false });
  });

  it('breaks pages between lines, keeps order and starts later pages at the top', () => {
    const plan = planChant(lines(10, 30), 20, 200, 40, true);
    // page 0 holds 6 lines (20 + 180 = 200), page 1 holds 4
    expect(plan.placed.map((l) => l.page)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(plan.placed.map((l) => l.art.line)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.placed[6]?.topMm).toBe(0);
    expect(plan.pageCount).toBe(2);
    // the last chant page is shared: heading is on page 0, so the tail is the page-1 chant plus the gap
    expect(plan).toMatchObject({ chantPages: 1, shared: true, tailMm: 120 + CHANT_AFTER_GAP_MM });
    expect(firstAccompanimentTopMm(20, plan.chantPages, plan.tailMm)).toBe(123);
  });

  it('puts a line that fits only on an empty page on that page, and rejects a line taller than a page', () => {
    expect(() => planChant([art(0, 201)], 0, 200, 40, true)).toThrow(RangeError);
    const plan = planChant([art(0, 190), art(1, 190)], 0, 200, 40, true);
    expect(plan.placed.map((l) => l.page)).toEqual([0, 1]);
  });

  it('moves a first line that cannot fit beside the heading to the next page', () => {
    const plan = planChant([art(0, 190)], 30, 200, 40, true);
    expect(plan.placed[0]).toMatchObject({ page: 1, topMm: 0 });
  });
});
