import { describe, expect, it } from 'vitest';
import { chantScale } from './chantScale';
import {
  DEFAULT_SETTINGS,
  LYRIC_SIZE,
  STAFF_SIZES,
  type LayoutSettings,
  type LyricSizeId,
  type StaffSizeId,
} from './types';

const STAFFS: readonly StaffSizeId[] = ['small', 'medium', 'large'];
const LYRICS: readonly LyricSizeId[] = ['small', 'medium', 'large'];
const LETTER_PRINTABLE_MM = 191.9;

const withSizes = (staff: StaffSizeId, lyrics: LyricSizeId): LayoutSettings =>
  ({ ...DEFAULT_SETTINGS, staff, lyrics });

/** DL D30 formulae, written out independently of the implementation: punctum width = notehead width. */
function expectedMmPerUnit(unit: number): number {
  const spaceMm = (2 * unit) / 10;
  return (spaceMm * 1.2556) / 6.25;
}
function expectedSetFont(unit: number, lyrics: LyricSizeId): number {
  const lyricMm = (LYRIC_SIZE[lyrics] * unit) / 10;
  return lyricMm / expectedMmPerUnit(unit) / 0.9;
}

describe('chantScale mmPerUnit', () => {
  it('gives about 0.281 / 0.362 / 0.482 for Small / Medium / Large Music size (2.51 x the equal-staff-space scale)', () => {
    expect(chantScale(withSizes('small', 'medium'), LETTER_PRINTABLE_MM, 'mei').mmPerUnit).toBeCloseTo(0.112 * 2.5114, 3);
    expect(chantScale(withSizes('medium', 'medium'), LETTER_PRINTABLE_MM, 'mei').mmPerUnit).toBeCloseTo(0.144 * 2.5114, 3);
    expect(chantScale(withSizes('large', 'medium'), LETTER_PRINTABLE_MM, 'mei').mmPerUnit).toBeCloseTo(0.192 * 2.5114, 3);
  });

  it.each(STAFFS)('matches the spec formula for Music size %s', (staff) => {
    const s = chantScale(withSizes(staff, 'medium'), LETTER_PRINTABLE_MM, 'mei');
    expect(s.mmPerUnit).toBeCloseTo(expectedMmPerUnit(STAFF_SIZES[staff].unit), 9);
  });
});

describe('chantScale widthUnits', () => {
  it('gives 531 (+-1) for Letter printable width 191.9 mm at Medium', () => {
    const s = chantScale(withSizes('medium', 'medium'), LETTER_PRINTABLE_MM, 'mei');
    expect(Math.abs(s.widthUnits - 531)).toBeLessThanOrEqual(1);
  });

  it.each(STAFFS)('equals round(printableWidthMm / mmPerUnit) for Music size %s', (staff) => {
    const s = chantScale(withSizes(staff, 'medium'), LETTER_PRINTABLE_MM, 'mei');
    expect(s.widthUnits).toBe(Math.round(LETTER_PRINTABLE_MM / expectedMmPerUnit(STAFF_SIZES[staff].unit)));
  });
});

describe('chantScale setFontSize', () => {
  it('keeps the lyrics at 4.05 mm: 4.05 / mmPerUnit / 0.9 at Medium/Medium', () => {
    const s = chantScale(withSizes('medium', 'medium'), LETTER_PRINTABLE_MM, 'mei');
    expect(Math.abs(s.setFontSize - 4.05 / s.mmPerUnit / 0.9)).toBeLessThanOrEqual(0.01);
    expect(s.setFontSize * 0.9 * s.mmPerUnit).toBeCloseTo(4.05, 6);
  });

  it.each(STAFFS.flatMap((staff) => LYRICS.map((lyrics) => [staff, lyrics] as const)))(
    'matches the spec formula for Music %s x Sung text %s',
    (staff, lyrics) => {
      const s = chantScale(withSizes(staff, lyrics), LETTER_PRINTABLE_MM, 'mei');
      expect(Math.abs(s.setFontSize - expectedSetFont(STAFF_SIZES[staff].unit, lyrics))).toBeLessThanOrEqual(0.01);
    },
  );
});

describe('chantScale errors', () => {
  it.each([0, -1, Number.NaN])('throws for a non-positive printable width (%s)', (widthMm) => {
    expect(() => chantScale(withSizes('medium', 'medium'), widthMm, 'mei')).toThrow(RangeError);
  });
});

describe('chantScale for scan and fixed parts', () => {
  it.each(['scan', 'fixed'] as const)('uses Medium staff for %s regardless of the Music setting', (partKind) => {
    const medium = chantScale(withSizes('medium', 'medium'), LETTER_PRINTABLE_MM, 'mei');
    for (const staff of STAFFS) {
      const s = chantScale(withSizes(staff, 'medium'), LETTER_PRINTABLE_MM, partKind);
      expect(s.mmPerUnit).toBeCloseTo(medium.mmPerUnit, 9);
      expect(s.widthUnits).toBe(medium.widthUnits);
      expect(s.setFontSize).toBeCloseTo(medium.setFontSize, 9);
    }
  });

  it.each(['scan', 'fixed'] as const)('follows settings.lyrics but with unit 9 for %s', (partKind) => {
    for (const lyrics of LYRICS) {
      const s = chantScale(withSizes('large', lyrics), LETTER_PRINTABLE_MM, partKind);
      expect(Math.abs(s.setFontSize - expectedSetFont(9, lyrics))).toBeLessThanOrEqual(0.01);
    }
  });
});
