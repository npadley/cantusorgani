// Guard (K9 finding, DL D30): measured on real Exsurge output, the chant is drawn so a punctum is as wide as the
// accompaniment's notehead, and its staff-line gap is CHANT_SIZE_FACTOR x the accompaniment's staff space, for every
// Music size. The constants in chantScale.ts are checked against the staff lines and puncta Exsurge actually draws,
// not assumed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANT_SIZE_FACTOR, NOTEHEAD_STAFF_SPACES, chantScale } from './chantScale';
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

/** The punctum's drawn width in Exsurge units: its glyph is `bounds.width` 100 at the 1/16 scale the SVG declares. */
function measuredPunctumUnits(svg: string): number {
  const scale = /<g id="PunctumQuadratum"[^>]*transform="scale\(([\d.]+)\)"/.exec(svg);
  expect(scale).not.toBeNull();
  const glyphWidth = 100; // Exsurge's Glyphs.PunctumQuadratum.bounds.width (vendored build 16c626f)
  return glyphWidth * Number(scale![1]);
}

describe('chant size against the accompaniment (DL D30)', () => {
  for (const file of ['al-1-749.json', 'gr-277-1333.json', 'tr-889-749.json']) {
    for (const staff of Object.keys(STAFF_SIZES) as StaffSizeId[]) {
      const spaceMm = STAFF_SIZES[staff].heightMm / 4; // five lines = four spaces
      const { mmPerUnit } = chantScale({ ...DEFAULT_SETTINGS, staff }, 191.9, 'mei');

      it(`${file} at ${staff}: staff-line gap is CHANT_SIZE_FACTOR x the accompaniment's`, () => {
        const chantMm = measuredSpaceUnits(fixture(file)) * mmPerUnit;
        expect(Math.abs(chantMm / (spaceMm * CHANT_SIZE_FACTOR) - 1)).toBeLessThan(0.02);
      });

      it(`${file} at ${staff}: punctum width equals the Leipzig notehead width`, () => {
        const punctumMm = measuredPunctumUnits(fixture(file)) * mmPerUnit;
        expect(Math.abs(punctumMm / (spaceMm * NOTEHEAD_STAFF_SPACES) - 1)).toBeLessThan(0.02);
      });
    }
  }

  it('is about 2.5 times the equal-staff-space scale', () => {
    expect(CHANT_SIZE_FACTOR).toBeGreaterThan(2.4);
    expect(CHANT_SIZE_FACTOR).toBeLessThan(2.6);
  });
});
