import { paperDimensions } from './settings';
import { LYRIC_SIZE, STAFF_SIZES, type ExportPart, type LayoutSettings, type PartKind } from './types';

/** Scale for chant notation: a punctum is as wide as an accompaniment notehead (DL D30, which supersedes spec 4.2's equal staff space). */
export interface ChantScale {
  /** mm per Exsurge unit: the accompaniment notehead's width divided by Exsurge's 6.25-unit punctum. */
  readonly mmPerUnit: number;
  /** Exsurge layout width in units for the printable width. */
  readonly widthUnits: number;
  /** Exsurge setFont size: lyric mm / mmPerUnit / 0.9 (Exsurge prints lyrics at 0.9 of the set size). */
  readonly setFontSize: number;
}

/** Exsurge staff space (distance between staff lines) in units at glyph scaling 1/16. */
export const EXSURGE_STAFF_SPACE_UNITS = 12.5;
/** Exsurge punctum width in units at glyph scaling 1/16 (glyph 100 wide x 1/16; measured on the fixtures: 6.25). */
export const EXSURGE_PUNCTUM_UNITS = 6.25;
/**
 * Width of Verovio's Leipzig black notehead (E0A4) in staff spaces: 314 glyph units x 0.072 = 22.6 page units against an
 * 18-unit staff space at Medium, measured with getBBox on a real Verovio page (Kyrie IX). It scales with the Music size.
 */
export const NOTEHEAD_STAFF_SPACES = 1.2556;
/** How much larger than the equal-staff-space scale the chant is drawn: about 2.5. */
export const CHANT_SIZE_FACTOR = (NOTEHEAD_STAFF_SPACES * EXSURGE_STAFF_SPACE_UNITS) / EXSURGE_PUNCTUM_UNITS;
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
  const mmPerUnit = (spaceMm * NOTEHEAD_STAFF_SPACES) / EXSURGE_PUNCTUM_UNITS;
  const widthUnits = Math.round(printableWidthMm / mmPerUnit);
  const lyricMm = (LYRIC_SIZE[settings.lyrics] * unit) / 10;
  const setFontSize = lyricMm / mmPerUnit / EXSURGE_LYRIC_FACTOR;
  return { mmPerUnit, widthUnits, setFontSize };
}

/** The Exsurge scale a chant was rendered at: the first part that carries it decides (the controller does the same). */
export function chantScaleFor(settings: LayoutSettings, part: ExportPart): ChantScale {
  const page = paperDimensions(settings);
  return chantScale(settings, page.widthMm - 2 * settings.marginMm, part.kind);
}

/** The chants to draw, each once, with the part kind whose scale applies. */
export function chantJobs(parts: readonly ExportPart[]): { readonly id: number; readonly part: ExportPart }[] {
  const seen = new Set<number>();
  const out: { id: number; part: ExportPart }[] = [];
  for (const part of parts) {
    for (const ref of part.chants) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      out.push({ id: ref.id, part });
    }
  }
  return out;
}

