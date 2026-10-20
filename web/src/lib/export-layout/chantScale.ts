import { LYRIC_SIZE, STAFF_SIZES, type LayoutSettings, type PartKind } from './types';

/** Scale for chant notation so it matches the accompaniment (spec 4.2). */
export interface ChantScale {
  /** mm per Exsurge unit: staff space (2 * unit / 10 mm) divided by Exsurge's 12.5-unit staff space. */
  readonly mmPerUnit: number;
  /** Exsurge layout width in units for the printable width. */
  readonly widthUnits: number;
  /** Exsurge setFont size: lyric mm / mmPerUnit / 0.9 (Exsurge prints lyrics at 0.9 of the set size). */
  readonly setFontSize: number;
}

/** Exsurge staff space in units at glyph scaling 1/16. */
const EXSURGE_STAFF_SPACE_UNITS = 12.5;
/** Exsurge prints lyrics at this fraction of the setFont size. */
const EXSURGE_LYRIC_FACTOR = 0.9;
/** Scan and fixed parts always use the Medium Music size (Verovio unit 9). */
const FIXED_PART_UNIT = STAFF_SIZES.medium.unit;

export function chantScale(settings: LayoutSettings, printableWidthMm: number, partKind: PartKind): ChantScale {
  if (!(printableWidthMm > 0)) {
    throw new RangeError(`printableWidthMm must be positive, got ${printableWidthMm}`);
  }
  const unit = partKind === 'mei' ? STAFF_SIZES[settings.staff].unit : FIXED_PART_UNIT;
  const spaceMm = (2 * unit) / 10;
  const mmPerUnit = spaceMm / EXSURGE_STAFF_SPACE_UNITS;
  const widthUnits = Math.round(printableWidthMm / mmPerUnit);
  const lyricMm = (LYRIC_SIZE[settings.lyrics] * unit) / 10;
  const setFontSize = lyricMm / mmPerUnit / EXSURGE_LYRIC_FACTOR;
  return { mmPerUnit, widthUnits, setFontSize };
}
