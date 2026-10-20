// Chant placement (CS §3): pure geometry for one part's chant lines. Lines are atomic: a page break
// falls between lines, never inside one. The result tells compose where each line goes and how much
// of the last chant page the accompaniment may use.
import type { ChantLineArt } from './types';

/** Credit text added to the part's footer whenever the part printed chant (CS §3.8). */
export const CHANT_CREDIT = 'Chant: GregoBase (CC0), drawn with Exsurge.';
/** Space kept between the last chant line and the accompaniment that follows on the same page. */
export const CHANT_AFTER_GAP_MM = 3;
/** Fallback for the smallest room the accompaniment needs below the chant, for scan and fixed parts (CS §3.4). */
export const MIN_ACCOMPANIMENT_FALLBACK_MM = 40;

export interface PlacedChantLine {
  readonly art: ChantLineArt;
  /** 0-based among the pages that hold chant. */
  readonly page: number;
  /** Top of the line, mm below the top of the printable area. Page 0 includes the heading. */
  readonly topMm: number;
}

export interface ChantPlan {
  readonly placed: readonly PlacedChantLine[];
  /** Pages that hold chant, the shared one included. */
  readonly pageCount: number;
  /** Chant-only pages before the accompaniment. */
  readonly chantPages: number;
  /** Chant height (plus the gap) on the accompaniment's first page; 0 unless it shares a page. */
  readonly tailMm: number;
  /** The accompaniment starts on the last chant page. */
  readonly shared: boolean;
}

export const NO_CHANT: ChantPlan = { placed: [], pageCount: 0, chantPages: 0, tailMm: 0, shared: false };

/**
 * @param lines          every chant line of the part, in print order
 * @param headingMm      height of the heading block at the top of page 0
 * @param pageHeightMm   usable height of every page (printable minus the footer reservation)
 * @param minAccompanimentMm  smallest room below the chant that lets the accompaniment share the page
 * @param share          false forces the accompaniment onto a fresh page
 * @throws RangeError when one line is taller than a page
 */
export function planChant(
  lines: readonly ChantLineArt[],
  headingMm: number,
  pageHeightMm: number,
  minAccompanimentMm: number,
  share: boolean,
): ChantPlan {
  if (lines.length === 0) return NO_CHANT;
  const placed: PlacedChantLine[] = [];
  let page = 0;
  let y = headingMm;
  for (const art of lines) {
    if (art.heightMm > pageHeightMm + 1e-9) throw new RangeError(`chant line ${art.line} is ${art.heightMm} mm tall; a page offers ${pageHeightMm} mm`);
    const startsPage = y === 0;
    if (!startsPage && y + art.heightMm > pageHeightMm + 1e-9) {
      page += 1;
      y = 0;
    }
    placed.push({ art, page, topMm: y });
    y += art.heightMm;
  }
  const pageCount = page + 1;
  const used = y + CHANT_AFTER_GAP_MM;
  const shared = share && pageHeightMm - used >= minAccompanimentMm - 1e-9;
  if (!shared) return { placed, pageCount, chantPages: pageCount, tailMm: 0, shared: false };
  return { placed, pageCount, chantPages: pageCount - 1, tailMm: pageCount === 1 ? used - headingMm : used, shared: true };
}

/** Where the accompaniment's first page starts below the top of the printable area. */
export function firstAccompanimentTopMm(headingMm: number, chantPages: number, tailMm: number): number {
  return (chantPages > 0 ? 0 : headingMm) + tailMm;
}
