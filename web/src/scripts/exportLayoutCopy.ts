// UI spec 3: the copy deck. Pure functions: no DOM, no I/O.
//
// Rules the deck keeps: name the part, say what still works, offer one primary action; no codes or
// format names in visible text. `LayoutDiagnostic.detail` is developer-only and is never read here:
// nothing in this module can put it on screen.

import { PAGE_PRESETS } from '../lib/export-layout/types';
import type {
  LayoutDiagnostic,
  LayoutDiagnosticCode,
  LayoutSettings,
  LayoutSuggestion,
  StaffSizeId,
} from '../lib/export-layout/types';

export type ActionId =
  | LayoutSuggestion
  | 'try-again' | 'use-original' | 'reload' | 'report' | 'dismiss' | 'close' | 'remove-part-breaks';

export interface CopyContext {
  readonly partLabel: string;
  readonly settings: LayoutSettings;
}
export interface Copy {
  /** Starts with "Can't" for errors, so a failure is never colour-only. */
  readonly text: string;
  readonly actions: readonly ActionId[];
  /** Blocks Download. Warnings and the advisory row do not. */
  readonly blocking: boolean;
  /** Shown to nobody (CANCELLED). */
  readonly silent: boolean;
}

export const STAFF_ORDER: readonly StaffSizeId[] = ['small', 'medium', 'large'];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const staffName = (s: StaffSizeId): string => cap(s);
export const smallerStaff = (s: StaffSizeId): StaffSizeId | null => STAFF_ORDER[STAFF_ORDER.indexOf(s) - 1] ?? null;

export function paperName(settings: LayoutSettings): string {
  return settings.page === 'custom' ? 'custom-size' : PAGE_PRESETS[settings.page].label;
}
const article = (word: string): string => (/^[aeiou8]/i.test(word) || /^11/.test(word) ? 'an' : 'a');

export const ACTION_LABEL: Readonly<Record<ActionId, (ctx: CopyContext) => string>> = {
  'smaller-music': (c) => `Use ${staffName(smallerStaff(c.settings.staff) ?? 'small')} music`,
  'larger-page': () => 'Use larger paper',
  landscape: () => 'Switch to landscape',
  portrait: () => 'Switch to portrait',
  'smaller-margins': () => 'Use smaller margins',
  'fit-to-page': () => 'Use Fit to page',
  'remove-break': (c) => `Remove my breaks in ${c.partLabel}`,
  'remove-part-breaks': (c) => `Remove my breaks in ${c.partLabel}`,
  'try-again': () => 'Try again',
  'use-original': () => 'Use original layout',
  reload: () => 'Reload page',
  report: () => 'Report a problem',
  dismiss: () => 'Dismiss',
  close: () => 'Close',
};

const TRY_ORIGINAL: readonly ActionId[] = ['try-again', 'use-original'];

type Row = (d: LayoutDiagnostic, c: CopyContext) => { text: string; actions: readonly ActionId[]; blocking?: boolean; silent?: boolean };

function unsatisfiable(d: LayoutDiagnostic, c: CopyContext): { text: string; actions: readonly ActionId[] } {
  const paper = paperName(c.settings);
  const orient = c.settings.orientation;
  const size = staffName(c.settings.staff);
  const where = `${article(paper)} ${paper} ${orient}`;
  switch (d.reason) {
    case 'system-too-tall':
      return { text: `Can't fit ${c.partLabel}: at ${size} music size, one system is taller than the space on ${where} page.`, actions: d.suggestions };
    case 'system-too-wide':
      return { text: `Can't fit ${c.partLabel}: its original lines are too long for ${paper} ${orient} at ${size} music size.`, actions: d.suggestions };
    case 'heading-too-tall':
      return { text: `Can't fit ${c.partLabel}: its heading and rubric leave no room for music on ${where} page.`, actions: d.suggestions };
    case 'no-convergence':
      return { text: `Can't settle the page breaks for ${c.partLabel} with these settings.`, actions: ['remove-part-breaks', 'use-original'] };
    default:
      return { text: `Can't update the preview of ${c.partLabel}. Your settings are kept.`, actions: TRY_ORIGINAL };
  }
}

const UNKNOWN: Row = (_d, c) => ({ text: `Can't update the preview of ${c.partLabel}. Your settings are kept.`, actions: TRY_ORIGINAL });

/** Every LayoutDiagnosticCode has a row; the Record type makes a missing one a compile error. */
export const COPY_DECK: Readonly<Record<LayoutDiagnosticCode, Row>> = {
  UNSATISFIABLE_LAYOUT: unsatisfiable,
  ASSET_MISSING: (_d, c) => ({ text: `Can't update the preview. The music for ${c.partLabel} didn't load. Check your connection and try again.`, actions: TRY_ORIGINAL }),
  ASSET_HASH_MISMATCH: (_d, c) => ({ text: `Can't use the music for ${c.partLabel}: it doesn't match the approved version. If the site was just updated, reloading the page will fix this.`, actions: ['reload', 'use-original'] }),
  UNSAFE_SVG: (_d, c) => ({ text: `Can't show the preview of ${c.partLabel}: it failed a safety check.`, actions: ['use-original', 'report'] }),
  INVALID_PAGE: (_d, c) => ({ text: `Can't show the preview of ${c.partLabel}: it failed a safety check.`, actions: ['use-original', 'report'] }),
  RENDERER_LOAD_FAILED: () => ({ text: "Can't update the preview. The layout tools couldn't start in this browser.", actions: TRY_ORIGINAL }),
  FONT_UNAVAILABLE: () => ({ text: "Can't update the preview. The lettering for the preview didn't load.", actions: TRY_ORIGINAL }),
  TIMEOUT: () => ({ text: "Can't update the preview. The preview is taking too long. Large music on small paper takes longest.", actions: TRY_ORIGINAL }),
  FIXED_PAGE_COUNT_MISMATCH: (_d, c) => ({ text: `Can't place the typeset pages for ${c.partLabel}: they aren't what we expected.`, actions: ['use-original'] }),
  SCAN_TOO_LARGE: (_d, c) => ({
    text: `Can't fit ${c.partLabel}: one system is too wide for ${paperName(c.settings)} ${c.settings.orientation} with ${c.settings.marginMm} mm margins.`,
    actions: ['landscape', 'smaller-margins'],
  }),
  SOURCE_CEILING: () => ({ text: "Can't customize this selection: it is over the 300-system limit. Untick some parts on the page to fit.", actions: ['close'] }),
  BUDGET_EXCEEDED: () => ({ text: "Can't customize this much music at once. Untick some parts on the page, or use Export PDF.", actions: ['use-original'] }),
  PDF_FAILED: () => ({ text: "Can't make the PDF. Your settings are kept.", actions: ['try-again'] }),
  STALE_ANCHOR: (_d, c) => ({ text: `Your saved breaks for ${c.partLabel} were removed because its music was updated.`, actions: ['dismiss'], blocking: false }),
  UNSAFE_ANCHOR: (_d, c) => ({ text: `Your saved breaks for ${c.partLabel} were removed because its music was updated.`, actions: ['dismiss'], blocking: false }),
  CROWDED_ORIGINAL_LINES: () => ({ text: 'Some original lines are tight at this size. Fit to page may read better.', actions: [], blocking: false }),
  CANCELLED: () => ({ text: '', actions: [], blocking: false, silent: true }),
  // Internal layout faults: the generic row.
  CAP_EXCEEDED: UNKNOWN,
  CONTENT_CLIPPED: UNKNOWN,
  EVENT_MISSING: UNKNOWN,
  STAFF_HEIGHT_MISMATCH: UNKNOWN,
  RENDERER_FAILED: UNKNOWN,
};

export function copyFor(d: LayoutDiagnostic, ctx: CopyContext): Copy {
  const row: Row | undefined = (COPY_DECK as Readonly<Record<string, Row | undefined>>)[d.code];
  const made = (row ?? UNKNOWN)(d, ctx);
  const actions = made.actions.filter((a, i, all) => all.indexOf(a) === i && (a !== 'smaller-music' || smallerStaff(ctx.settings.staff) !== null));
  return {
    text: made.text,
    actions,
    blocking: made.blocking ?? d.severity === 'error',
    silent: made.silent ?? false,
  };
}

/** Diagnostic codes that concern the whole export rather than one part. */
export function isGlobalDiagnostic(d: LayoutDiagnostic): boolean {
  return d.partId === null;
}

// ------------------------------------------------------ custom size copy ---
export const CUSTOM_ERRORS = {
  notANumber: 'Enter a number.',
  tooNarrow: 'The long side can be at most three times the short side.',
  range: (axis: 'width' | 'height', unit: 'mm' | 'in'): string =>
    unit === 'mm' ? `Use a ${axis} between 90 and 450 mm (3.5–17.7 in).` : `Use a ${axis} between 3.5 and 17.7 in (90–450 mm).`,
} as const;

export const PRINTER_ADVISORY = "Most printers can't print this close to the edge.";
export const MM_PER_IN = 25.4;
