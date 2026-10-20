// Guard (K9 finding): the chant staff space, measured on real Exsurge output, must equal the accompaniment's staff
// space for every Music size. The constant in chantScale.ts (12.5 units) is checked against the staff lines Exsurge
// actually draws, not assumed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chantScale } from './chantScale';
import { DEFAULT_SETTINGS, STAFF_SIZES } from './types';
import type { StaffSizeId } from './types';

const fixture = (file: string): string => (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', file), 'utf8')) as { svg: string }).svg;

/** Distance between neighbouring staff lines of the first chant line, in Exsurge units, from the SVG itself. */
function measuredSpaceUnits(svg: string): number {
  const ys = [...svg.matchAll(/<line\b[^>]*\by1="(-?[\d.]+)"[^>]*class="staffLine"/g)].slice(0, 4).map((m) => Number(m[1]));
  expect(ys).toHaveLength(4);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
  return gaps[0]!;
}

describe('chant staff space equals the accompaniment staff space', () => {
  for (const file of ['al-1-749.json', 'gr-277-1333.json', 'tr-889-749.json']) {
    for (const staff of Object.keys(STAFF_SIZES) as StaffSizeId[]) {
      it(`${file} at ${staff} music`, () => {
        const units = measuredSpaceUnits(fixture(file));
        const { mmPerUnit } = chantScale({ ...DEFAULT_SETTINGS, staff }, 191.9, 'mei');
        const chantMm = units * mmPerUnit;
        const musicMm = STAFF_SIZES[staff].heightMm / 4; // five lines = four spaces
        expect(Math.abs(chantMm / musicMm - 1)).toBeLessThan(0.02);
      });
    }
  }
});
