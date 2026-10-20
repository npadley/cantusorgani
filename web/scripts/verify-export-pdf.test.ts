import { describe, expect, it } from 'vitest';
import { groupStaves, splitStaves } from './verify-export-pdf';

const staff5 = (top: number, space = 1.8): number[] => [0, 1, 2, 3, 4].map((k) => top + k * space);
const staff4 = (top: number, space = 1.8): number[] => [0, 1, 2, 3].map((k) => top + k * space);

describe('splitStaves', () => {
  it('counts chant staves apart from five-line staves, even at the same spacing', () => {
    const ys = [...staff4(20), ...staff4(40), ...staff5(60), ...staff5(80)];
    const { staves, chant } = splitStaves(ys, 1.8);
    expect(staves).toHaveLength(2);
    expect(chant).toHaveLength(2);
    expect(chant[0]).toEqual(staff4(20));
  });

  it('finds no chant staves when none were asked for, and leaves five-line grouping as it was', () => {
    const ys = [...staff4(20), ...staff5(60)];
    expect(splitStaves(ys, undefined).chant).toEqual([]);
    expect(splitStaves(ys, undefined).staves).toEqual(groupStaves(ys));
  });

  it('finds 0 five-line staves on a chant-only page', () => {
    const { staves, chant } = splitStaves([...staff4(20), ...staff4(45), ...staff4(70)], 1.8);
    expect(staves).toEqual([]);
    expect(chant).toHaveLength(3);
  });

  it('ignores four lines at the wrong spacing', () => {
    expect(splitStaves(staff4(20, 2.4), 1.8).chant).toEqual([]);
  });
});
