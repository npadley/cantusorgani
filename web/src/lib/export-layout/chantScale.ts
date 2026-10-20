import { paperDimensions } from './settings';
import { LYRIC_SIZE, STAFF_SIZES, type ExportPart, type LayoutSettings, type PartKind } from './types';

/** Scale for chant notation: the chant keeps the proportions it has on the site next to the typeset music (DL D30, which supersedes spec 4.2's equal staff space). */
export interface ChantScale {
  /** mm per Exsurge unit: the chant's staff space (CHANT_SIZE_FACTOR x the accompaniment's) divided by Exsurge's 12.5-unit staff space. */
  readonly mmPerUnit: number;
  /** Exsurge layout width in units for the printable width. */
  readonly widthUnits: number;
  /** Exsurge setFont size: lyric mm / mmPerUnit / 0.9 (Exsurge prints lyrics at 0.9 of the set size). */
  readonly setFontSize: number;
}

/** Exsurge staff space (distance between staff lines) in units at glyph scaling 1/16. */
export const EXSURGE_STAFF_SPACE_UNITS = 12.5;
/**
 * How much larger than the accompaniment's staff space the chant's staff space is. Measured on the site itself
 * (DL D30, Kyrie IX at a 1200 px viewport, 960 px content): the chant's staff-line gap is 12.5 CSS px (Exsurge at 1 px
 * per unit) and the typeset accompaniment's is 7.99 px (LilyPond SVG gap 4.484 x 960/539), a ratio of 1.565.
 */
export const CHANT_SIZE_FACTOR = 1.565;
/**
 * The chant's lyric size against the accompaniment's on the site: 19.2 px against 2.25 staff gaps of 7.99 px (the lyric
 * to staff ratio the Verovio side is built to match), a ratio of 1.07.
 */
export const CHANT_LYRIC_FACTOR = 1.07;
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
  const mmPerUnit = (spaceMm * CHANT_SIZE_FACTOR) / EXSURGE_STAFF_SPACE_UNITS;
  const widthUnits = Math.round(printableWidthMm / mmPerUnit);
  const lyricMm = (LYRIC_SIZE[settings.lyrics] * unit * CHANT_LYRIC_FACTOR) / 10;
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

