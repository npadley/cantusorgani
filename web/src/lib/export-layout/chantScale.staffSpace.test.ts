// Guard (K9 finding, DL D30): measured on real Exsurge output, the chant's staff-line gap is CHANT_SIZE_FACTOR x the
// accompaniment's staff space for every Music size, and its lyrics keep the site's proportion to that gap. The constants in
// chantScale.ts are checked against the staff lines Exsurge actually draws, not assumed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANT_LYRIC_FACTOR, CHANT_SIZE_FACTOR, chantScale } from './chantScale';
import { DEFAULT_SETTINGS, LYRIC_SIZE, STAFF_SIZES } from './types';
import type { StaffSizeId } from './types';

const FIXTURES = ['al-1-479.json', 'al-1-852.json', 'gr-277-479.json', 'gr-277-852.json', 'tr-889-479.json', 'tr-889-852.json'];
const fixture = (file: string): string => (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', file), 'utf8')) as { svg: string }).svg;

/** Distance between neighbouring staff lines of the first chant line, in Exsurge units, from the SVG itself. */
function measuredSpaceUnits(svg: string): number {
  const ys = [...svg.matchAll(/<line\b[^>]*\by1="(-?[\d.]+)"[^>]*class="staffLine"/g)].slice(0, 4).map((m) => Number(m[1]));
  expect(ys).toHaveLength(4);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
  return gaps[0]!;
}

describe('chant size against the accompaniment (DL D30)', () => {
  for (const file of FIXTURES) {
    for (const staff of Object.keys(STAFF_SIZES) as StaffSizeId[]) {
      it(`${file} at ${staff}: staff-line gap is CHANT_SIZE_FACTOR x the accompaniment's`, () => {
        const spaceMm = STAFF_SIZES[staff].heightMm / 4; // five lines = four spaces
        const { mmPerUnit } = chantScale({ ...DEFAULT_SETTINGS, staff }, 191.9, 'mei');
        const chantMm = measuredSpaceUnits(fixture(file)) * mmPerUnit;
        expect(Math.abs(chantMm / (spaceMm * CHANT_SIZE_FACTOR) - 1)).toBeLessThan(0.02);
      });
    }
  }

  it("keeps the site's proportions: lyric size to staff-line gap is 19.2 / 12.5, and the lyrics are 1.07 x the accompaniment's", () => {
    for (const staff of Object.keys(STAFF_SIZES) as StaffSizeId[]) {
      const unit = STAFF_SIZES[staff].unit;
      const s = chantScale({ ...DEFAULT_SETTINGS, staff }, 191.9, 'mei');
      const lyricMm = s.setFontSize * 0.9 * s.mmPerUnit;
      const gapMm = 12.5 * s.mmPerUnit;
      expect(Math.abs(lyricMm / gapMm / (19.2 / 12.5) - 1)).toBeLessThan(0.03);
      expect(lyricMm).toBeCloseTo((LYRIC_SIZE.medium * unit * CHANT_LYRIC_FACTOR) / 10, 6);
    }
  });

  it('is between the equal-staff-space scale (1) and the notehead-matching scale (2.51)', () => {
    expect(CHANT_SIZE_FACTOR).toBeGreaterThan(1);
    expect(CHANT_SIZE_FACTOR).toBeLessThan(2.51);
  });
});
