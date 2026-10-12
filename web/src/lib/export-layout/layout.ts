import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import type { Element } from '@xmldom/xmldom';
import { resolveBreaks } from './breaks';
import { materialiseBreaks, revealSplitSustainsAfter } from './meiDoc';
import { paginate } from './paginate';
import { paperDimensions, verovioOptions } from './settings';
import { lyricCollisions } from './lyricGeometry';
import { measureSvgPage } from './svgGeometry';
import type { MeasuredPage, MeasuredSystem } from './svgGeometry';
import { STAFF_SIZES } from './types';
import type {
  BreakOverride,
  EffectiveBreak,
  EffectiveBreaks,
  FontProfile,
  LayoutConstraints,
  LayoutDiagnostic,
  LayoutDiagnosticCode,
  LayoutSettings,
  LayoutSuggestion,
  MeiLayout,
  MeiPageLayout,
  MeiPart,
  RectMm,
  RenderContext,
  SystemGeometry,
  UnsatisfiableReason,
  VerovioLike,
} from './types';

/*
 * Two-pass MEI layout (spike S2, section 7).
 *
 *  1. Pass 1 renders the whole part on one 6 m page to measure natural system extents.
 *  2. paginate() assigns systems to pages from those extents.
 *  3. Every system start is written back as <sb/> (and <pb/> at a page start).
 *  4. Pass 2 renders with breaks: "encoded" and must reproduce pass 1's system starts. There is
 *     no retry loop: a divergence is reported as UNSATISFIABLE_LAYOUT / no-convergence.
 */

type OptionRecord = Readonly<Record<string, string | number | boolean>>;

/** Verovio's maximum page height (0.1 mm units): pass 1 uses it to keep everything on one page. */
const TALL_PAGE = 60000;
const STAFF_TOLERANCE_MM = 0.1;
/** Lowest justification ratio accepted when moving an automatic line break to a word boundary. */
const MIN_WORD_BREAK_RATIO = 0.8;
/** Closest two lyric syllables may sit after a word-boundary move. */
const MIN_SYLLABLE_GAP_MM = 0.3;
/** Lowest justification ratio accepted when the syllable gaps were verified with real lyric widths. */
const MIN_CHECKED_RATIO = 0.7;
const RIGHT_EDGE_TOLERANCE_MM = 0.5;
const BOTTOM_TOLERANCE_MM = 0.05;
const MEI_NS = 'http://www.music-encoding.org/ns/mei';

export interface PageRects {
  /** Region handed to Verovio: the page minus margins and any footer reservation. */
  readonly content: RectMm;
  /** Same, minus the heading block (page 1 of a part). */
  readonly firstPageContent: RectMm;
}

// ---------------------------------------------------------------- helpers ---
interface OptionReader { getOptions(): Readonly<Record<string, unknown>> }
const canReadOptions = (tk: VerovioLike): tk is VerovioLike & OptionReader =>
  typeof (tk as Partial<OptionReader>).getOptions === 'function';

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Verovio 6.3.0 reports warnings and rejected options on console only; getLog() is empty. */
function captureConsole<T>(sink: string[], fn: () => T): T {
  const origError = console.error;
  const origWarn = console.warn;
  const grab = (...args: readonly unknown[]): void => { sink.push(args.map(String).join(' ').trim()); };
  console.error = grab;
  console.warn = grab;
  try {
    return fn();
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
}

function sameOption(requested: string | number | boolean, actual: unknown): boolean {
  if (typeof requested === 'number') return typeof actual === 'number' && Math.abs(actual - requested) < 1e-9;
  return actual === requested;
}

/** setOptions never reports a rejected option (R2): read the values back and list any that differ. */
function optionMismatches(tk: VerovioLike & OptionReader, requested: OptionRecord): string[] {
  const actual = tk.getOptions();
  const bad: string[] = [];
  for (const [key, value] of Object.entries(requested)) {
    if (!sameOption(value, actual[key])) bad.push(`${key}: requested ${String(value)}, got ${String(actual[key])}`);
  }
  return bad;
}

function diag(
  partId: string,
  code: LayoutDiagnosticCode,
  severity: 'error' | 'warning',
  o: {
    readonly pageIndex?: number | null;
    readonly boundaryIds?: readonly string[];
    readonly reason?: UnsatisfiableReason | null;
    readonly suggestions?: readonly LayoutSuggestion[];
    readonly detail: string;
  },
): LayoutDiagnostic {
  return {
    code,
    severity,
    partId,
    pageIndex: o.pageIndex ?? null,
    boundaryIds: o.boundaryIds ?? [],
    reason: o.reason ?? null,
    suggestions: o.suggestions ?? [],
    detail: o.detail,
  };
}

/** Make the music smaller / the page bigger / turn the page. Order is the order the UI offers them. */
function sizeSuggestions(settings: LayoutSettings, kind: 'tall' | 'wide'): LayoutSuggestion[] {
  const out: LayoutSuggestion[] = [];
  if (kind === 'wide') out.push('fit-to-page');
  if (settings.staff !== 'small') out.push('smaller-music');
  if (kind === 'tall') {
    out.push('larger-page');
    if (settings.orientation === 'landscape') out.push('portrait');
  } else if (settings.orientation === 'portrait') {
    out.push('landscape');
  }
  return out;
}

function stripBoundingBoxes(svg: string): string {
  const out = svg
    .replace(/<g\b[^>]*\bclass="[^"]*\bbounding-box\b[^"]*"[^>]*\/>/g, '')
    .replace(/<g\b[^>]*\bclass="[^"]*\bbounding-box\b[^"]*"[^>]*>\s*(?:<rect\b[^>]*\/>\s*)*<\/g>/g, '');
  if (out.includes('bounding-box')) throw new Error('RENDERER_FAILED: bounding boxes could not be stripped from the SVG');
  return out;
}

function noteIdsInMei(meiXml: string): Set<string> {
  return new Set([...meiXml.matchAll(/<note\b[^>]*?\sxml:id="([^"]+)"/g)].map((m) => m[1] ?? ''));
}
function measureOrderInMei(meiXml: string): string[] {
  return [...meiXml.matchAll(/<measure\b[^>]*?\sxml:id="([^"]+)"/g)].map((m) => m[1] ?? '');
}

/**
 * Parse MEI, drop `<pb/>` (and `<sb/>` when `stripSb`), then write `<pb/><sb/>` or `<sb/>`
 * immediately before each listed measure. Event ids are untouched.
 */
function rewriteBreaks(
  meiXml: string,
  opts: { readonly stripSb: boolean; readonly insertBefore?: ReadonlyMap<string, 'page' | 'system'> },
): string {
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === 'error' || level === 'fatalError') throw new Error(`MEI_PARSE_ERROR: ${msg}`);
    },
  }).parseFromString(meiXml, 'text/xml');
  const drop = (tag: string): void => {
    for (const el of Array.from(doc.getElementsByTagName(tag))) el.parentNode?.removeChild(el);
  };
  drop('pb');
  if (opts.stripSb) drop('sb');
  if (opts.insertBefore && opts.insertBefore.size > 0) {
    const measures = new Map<string, Element>();
    for (const m of Array.from(doc.getElementsByTagName('measure'))) {
      const id = m.getAttribute('xml:id');
      if (id) measures.set(id, m);
    }
    for (const [measureId, kind] of opts.insertBefore) {
      const measure = measures.get(measureId);
      if (!measure?.parentNode) throw new Error(`UNSAFE_ANCHOR: ${measureId}`);
      if (kind === 'page') measure.parentNode.insertBefore(doc.createElementNS(MEI_NS, 'pb'), measure);
      measure.parentNode.insertBefore(doc.createElementNS(MEI_NS, 'sb'), measure);
    }
  }
  const out = new XMLSerializer().serializeToString(doc);
  const decl = /^\s*(<\?xml[^?]*\?>)/.exec(meiXml);
  return decl && !out.startsWith('<?xml') ? `${decl[1]}\n${out}` : out;
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function noteIdsInSvg(svg: string): Set<string> {
  const ids = new Set<string>();
  for (const tag of svg.matchAll(/<g\b[^>]*>/g)) {
    const cls = /\sclass="([^"]*)"/.exec(tag[0]);
    if (!cls || !(cls[1] ?? '').split(/\s+/).includes('note')) continue;
    const id = /\sid="([^"]*)"/.exec(tag[0]);
    if (id?.[1]) ids.add(id[1]);
  }
  return ids;
}

// --------------------------------------------------------------- validate ---
function validateCore(layout: MeiLayout, constraints: LayoutConstraints, seenNotes: ReadonlySet<string>): LayoutDiagnostic[] {
  const out: LayoutDiagnostic[] = [];
  const partId = layout.partId;

  // Cap: a maximum, never an exact count.
  if (constraints.maxSystems !== null) {
    layout.pages.forEach((page, pageIndex) => {
      if (page.systems.length > constraints.maxSystems!) {
        out.push(diag(partId, 'CAP_EXCEEDED', 'error', {
          pageIndex,
          boundaryIds: page.systems.slice(constraints.maxSystems!).flatMap((s) => (s.firstBoundaryId ? [s.firstBoundaryId] : [])),
          detail: `page ${pageIndex} has ${page.systems.length} systems, cap ${constraints.maxSystems}`,
        }));
      }
    });
  }

  // Every event must still be drawn.
  const missing = [...constraints.expectedEventIds].filter((id) => !seenNotes.has(id));
  if (missing.length > 0) {
    out.push(diag(partId, 'EVENT_MISSING', 'error', {
      detail: `${missing.length} of ${constraints.expectedEventIds.size} events missing, e.g. ${missing.slice(0, 5).join(', ')}`,
    }));
  }

  // Staff height (D8).
  if (!(Math.abs(layout.staffHeightMm - constraints.staffHeightMm) <= STAFF_TOLERANCE_MM)) {
    out.push(diag(partId, 'STAFF_HEIGHT_MISMATCH', 'error', {
      detail: `measured ${layout.staffHeightMm} mm, expected ${constraints.staffHeightMm} mm +/- ${STAFF_TOLERANCE_MM}`,
    }));
  }

  // Nothing may be drawn below the content area.
  layout.pages.forEach((page, pageIndex) => {
    const bottom = Math.max(0, ...page.systems.map((s) => s.topMm + s.heightMm));
    if (bottom > constraints.usable.heightMm + BOTTOM_TOLERANCE_MM) {
      out.push(diag(partId, 'CONTENT_CLIPPED', 'error', {
        pageIndex,
        boundaryIds: page.systems.flatMap((s) => (s.firstBoundaryId ? [s.firstBoundaryId] : [])),
        suggestions: constraints.staffHeightMm > STAFF_SIZES.small.heightMm ? ['smaller-music', 'smaller-margins'] : ['smaller-margins'],
        detail: `page ${pageIndex} content bottom ${round3(bottom)} mm exceeds ${constraints.usable.heightMm} mm`,
      }));
    }
  });

  // Required breaks must survive: a page break starts a page, a system break starts a system.
  const pageStarts = new Set(layout.pages.flatMap((p) => (p.systems[0]?.firstBoundaryId ? [p.systems[0].firstBoundaryId] : [])));
  const systemStarts = new Set(layout.pages.flatMap((p) => p.systems.flatMap((s) => (s.firstBoundaryId ? [s.firstBoundaryId] : []))));
  for (const br of constraints.requiredBreaks) {
    const ok = br.kind === 'page' ? pageStarts.has(br.boundaryId) : systemStarts.has(br.boundaryId);
    if (!ok) {
      out.push(diag(partId, 'UNSATISFIABLE_LAYOUT', 'error', {
        boundaryIds: [br.boundaryId],
        reason: 'no-convergence',
        suggestions: br.origin === 'user' ? ['remove-break'] : [],
        detail: `required ${br.kind} break after ${br.boundaryId} (${br.origin}) is not present in the layout`,
      }));
    }
  }
  return out;
}

/**
 * Check a finished layout against its constraints: system cap, event presence, staff height
 * (+/- 0.1 mm), content inside the usable height, and required breaks. Right-edge overhang is
 * checked by renderMei, which has the bounding boxes.
 */
export function validateLayout(layout: MeiLayout, constraints: LayoutConstraints): LayoutDiagnostic[] {
  const seen = new Set<string>();
  for (const page of layout.pages) for (const id of noteIdsInSvg(page.svg)) seen.add(id);
  return validateCore(layout, constraints, seen);
}

// ----------------------------------------------------------------- render ---
interface PlannedSystem {
  readonly startMeasureId: string;
  readonly firstBoundaryId: string | null;
  readonly topMm: number;
  readonly heightMm: number;
}

/** System sizes measured in pass 2, handed to a second planning run when pass 1 under-estimated them. */
interface GeometryHint { readonly heights: readonly number[]; readonly gapMm: number }
const measuredHints = new WeakMap<MeiLayout, GeometryHint>();

/**
 * Lay out one MEI part. Never rejects for layout problems: they come back as diagnostics on
 * the returned MeiLayout (pages is empty when any error stops the run).
 */
export async function renderMei(
  part: MeiPart,
  settings: LayoutSettings,
  overrides: readonly BreakOverride[],
  ctx: RenderContext,
  page: PageRects,
): Promise<MeiLayout> {
  const layout = await layoutOnce(part, settings, overrides, ctx, page, null);
  // Pass 1 measures with the sustain continuations hidden; revealing them at the final starts (and
  // their ties) can make a system a few mm taller, so the last system of a page can land below the
  // content area. Pass 2 knows the true sizes: plan the pages again from them, once.
  const hint = measuredHints.get(layout);
  if (hint !== undefined) return layoutOnce(part, settings, overrides, ctx, page, hint);
  return layout;
}

async function layoutOnce(
  part: MeiPart,
  settings: LayoutSettings,
  overrides: readonly BreakOverride[],
  ctx: RenderContext,
  page: PageRects,
  hint: GeometryHint | null,
): Promise<MeiLayout> {
  const partId = part.part.id;
  const eff = resolveBreaks(part, settings, overrides);
  const diagnostics: LayoutDiagnostic[] = [];
  const base: OptionRecord = verovioOptions(settings, page.content);
  let finalOptions: OptionRecord = base;

  for (const d of eff.droppedOverrides) {
    diagnostics.push(diag(partId, d.reason, 'warning', {
      boundaryIds: [d.override.boundaryId],
      suggestions: ['remove-break'],
      detail: `override ${d.override.kind} at ${d.override.boundaryId} dropped: ${d.reason}`,
    }));
  }
  const fail = (...errors: LayoutDiagnostic[]): MeiLayout => ({
    partId, pages: [], effectiveBreaks: eff, staffHeightMm: 0, verovioOptions: finalOptions,
    diagnostics: [...diagnostics, ...errors],
  });
  const failed = (message: string): MeiLayout => fail(diag(partId, 'RENDERER_FAILED', 'error', { detail: message }));
  const cancelled = (): MeiLayout => fail(diag(partId, 'CANCELLED', 'error', { detail: 'cancelled by the caller' }));

  try {
    if (ctx.isCancelled()) return cancelled();
    const tk = ctx.toolkit;
    if (!canReadOptions(tk)) return failed('toolkit cannot read options back (getOptions missing)');
    const consoleMessages: string[] = [];

    /** setOptions with read-back; returns the mismatches (empty when every value stuck). */
    const apply = (options: OptionRecord): string[] =>
      captureConsole(consoleMessages, () => { tk.setOptions(options); return optionMismatches(tk, options); });
    const load = (mei: string): boolean => captureConsole(consoleMessages, () => tk.loadData(mei));
    const renderPage = (n: number): string => captureConsole(consoleMessages, () => tk.renderToSVG(n));

    const boundaries = part.part.conversion.boundaries;
    const boundaryByMeasure = new Map(boundaries.map((b) => [b.measureId, b.id] as const));
    const measureByBoundary = new Map(boundaries.map((b) => [b.id, b.measureId] as const));
    const meiMeasures = measureOrderInMei(part.meiXml);
    const nextMeasureInMei = new Map(meiMeasures.map((id, i) => [id, meiMeasures[i + 1] ?? null] as const));
    /** Breaks that have a measure after them; a break after the final measure is a no-op. */
    const realisable = eff.breaks.filter((b) => {
      const m = measureByBoundary.get(b.boundaryId);
      return m !== undefined && (nextMeasureInMei.get(m) ?? null) !== null;
    });

    // ------------------------------------------------------------ pass 1 ---
    // Pass 1 sees user breaks as system breaks (<pb/> is ignored under 'line'); under 'auto'
    // they are ignored and handled by inserting extra system starts below.
    const systemised: EffectiveBreaks = { ...eff, breaks: realisable.map((b): EffectiveBreak => ({ ...b, kind: 'system' })) };
    const mei1 = rewriteBreaks(materialiseBreaks(part.meiXml, systemised, boundaries, settings.linePolicy, false), { stripSb: false });
    /** Right reserve in 0.1 mm; grows when Verovio overflows the width and the lines are re-measured. */
    let reserveRight = Number(base['pageMarginRight']);
    let pass1Options: OptionRecord = {
      ...base,
      pageHeight: TALL_PAGE,
      justifyVertically: false,
      svgBoundingBoxes: true,
      breaks: settings.linePolicy === 'original' ? 'line' : 'auto',
    };
    const bad1 = apply(pass1Options);
    if (bad1.length > 0) return failed(`pass 1 options not applied: ${bad1.join('; ')}`);
    if (!load(mei1)) return failed('loadData failed in pass 1');
    const pageCount1 = captureConsole(consoleMessages, () => tk.getPageCount());
    if (pageCount1 !== 1) return failed(`pass 1 produced ${pageCount1} pages; the part is taller than one 6 m page`);
    let svg1 = renderPage(1);
    const measured1 = measureSvgPage(svg1);
    let sys1 = measured1.systems;
    if (sys1.length === 0) return failed('pass 1 produced no systems');
    await tick();
    if (ctx.isCancelled()) return cancelled();

    const allMeasures = sys1.flatMap((s) => s.measureIds);
    const measureIndex = new Map(allMeasures.map((id, i) => [id, i] as const));
    const boundaryBeforeMeasure = (measureId: string): string | null => {
      const i = measureIndex.get(measureId) ?? 0;
      return i <= 0 ? null : (boundaryByMeasure.get(allMeasures[i - 1] ?? '') ?? null);
    };

    const wordFinal = wordFinalMeasures(part.meiXml);
    const pinned = new Set(realisable.map((b) => nextMeasureInMei.get(measureByBoundary.get(b.boundaryId) ?? '') ?? ''));
    const lyricFont = lyricFontOf(ctx);
    const pairKey = (c: { a: string; b: string }): string => `${c.a}|${c.b}`;
    /** Syllable pairs that already sit too close in Verovio's own layout: moving a break did not cause them. */
    const baselinePairs = (): Map<string, number> => {
      const m = new Map<string, number>();
      if (lyricFont !== null) for (const c of lyricCollisions(svg1, lyricFont, MIN_SYLLABLE_GAP_MM)) m.set(pairKey(c), (m.get(pairKey(c)) ?? 0) + 1);
      return m;
    };
    /**
     * ONE encoded render with a system start at each of `moved`. Accepted only when the systems match,
     * nothing overhangs, Verovio does not compress a line (ratio below 0.8) and no two syllables on a
     * system next to a changed start are closer than 0.3 mm.
     */
    type AttemptResult = { ok: boolean; systems: readonly MeasuredSystem[]; sameStarts: boolean; ratiosOk: boolean; bad: ReadonlySet<number> };
    const attempt = async (moved: readonly string[], original: readonly string[]): Promise<AttemptResult | string> => {
      const messagesBefore = consoleMessages.length;
      const mei1b = rewriteBreaks(part.meiXml, { stripSb: true, insertBefore: new Map(moved.slice(1).map((m) => [m, 'system'] as const)) });
      const bad1b = apply({ ...pass1Options, breaks: 'encoded' });
      if (bad1b.length > 0) return `word-boundary options not applied: ${bad1b.join('; ')}`;
      if (!load(mei1b)) return 'loadData failed in the word-boundary pass';
      const pages1b = captureConsole(consoleMessages, () => tk.getPageCount());
      const svg1b = pages1b === 1 ? renderPage(1) : '';
      const sys1b = svg1b ? measureSvgPage(svg1b).systems : [];
      const ratios = consoleMessages.slice(messagesBefore)
        .map((m) => /ratio smaller than [\d.]+: ([\d.]+)/.exec(m)?.[1])
        .flatMap((r) => (r === undefined ? [] : [Number(r)]));
      const sameStarts = sys1b.length === moved.length && sys1b.every((s, k) => s.firstMeasureId === moved[k]);
      // With the real lyric widths to check syllable gaps, a denser line is acceptable down to 0.7.
      const minRatio = lyricFont !== null ? MIN_CHECKED_RATIO : MIN_WORD_BREAK_RATIO;
      const ratiosOk = ratios.every((r) => r >= minRatio);
      // Systems that overhang the content or whose syllables come closer than the minimum gap.
      const bad = new Set<number>();
      sys1b.forEach((x, i) => { if (x.maxXMm - page.content.widthMm > RIGHT_EDGE_TOLERANCE_MM) bad.add(i); });
      if (svg1b !== '' && lyricFont !== null) {
        const allowed = baselinePairs();
        for (const c of lyricCollisions(svg1b, lyricFont, MIN_SYLLABLE_GAP_MM)) {
          const left = allowed.get(pairKey(c)) ?? 0;
          if (left > 0) allowed.set(pairKey(c), left - 1);
          else bad.add(c.system);
        }
      }
      const known = new Set(original);
      const touched = new Set<number>();
      moved.forEach((m, k) => { if (!known.has(m)) { touched.add(k - 1); touched.add(k); } });
      const ok = sameStarts && sys1b.length > 0 && ratiosOk && [...touched].every((i) => !bad.has(i));
      return { ok, systems: sys1b, sameStarts, ratiosOk, bad };
    };

    // Right edge. Original lines are compressed, never split, so overhang is a warning there.
    const crowdedDetails: string[] = [];
    let overhang1 = Math.max(...sys1.map((s) => s.maxXMm)) - page.content.widthMm;
    if (overhang1 > RIGHT_EDGE_TOLERANCE_MM && settings.linePolicy === 'automatic') {
      // A line Verovio cannot compress further overflows the width. Reserve the overflow on the right
      // for the measuring passes and let Verovio break again: pass 2 then has that room to spare.
      reserveRight = Number(base['pageMarginRight']) + Math.ceil((overhang1 + 0.15) * 10);
      pass1Options = { ...pass1Options, pageMarginRight: reserveRight };
      const badRetry = apply(pass1Options);
      if (badRetry.length > 0) return failed(`pass 1 retry options not applied: ${badRetry.join('; ')}`);
      if (!load(mei1)) return failed('loadData failed in the pass 1 retry');
      const svgRetry = captureConsole(consoleMessages, () => tk.getPageCount()) === 1 ? renderPage(1) : '';
      const retried = svgRetry ? measureSvgPage(svgRetry).systems : [];
      if (retried.length > 0) svg1 = svgRetry;
      if (retried.length > 0) {
        sys1 = retried;
        overhang1 = Math.max(...sys1.map((x) => x.maxXMm)) - page.content.widthMm;
      }
    }
    if (overhang1 > RIGHT_EDGE_TOLERANCE_MM && settings.linePolicy === 'automatic') {
      // Verovio let an automatic line run past the content width (glyph and barline overhang). Pull
      // the start of the next system back to an earlier word boundary (or split the last system)
      // and re-measure once.
      const starts = sys1.map((x) => x.firstMeasureId);
      const next = [...starts];
      sys1.forEach((x, i) => {
        if (x.maxXMm - page.content.widthMm <= RIGHT_EDGE_TOLERANCE_MM) return;
        if (i + 1 < starts.length) {
          const idx = measureIndex.get(starts[i + 1] ?? '') ?? 0;
          if (!pinned.has(starts[i + 1] ?? '')) next[i + 1] = moveToWordStart(allMeasures[idx - 1] ?? '', starts[i] ?? '', allMeasures, measureIndex, wordFinal, boundaryByMeasure, -1);
        } else {
          const lastIdx = (measureIndex.get(starts[i] ?? '') ?? 0) + x.measureIds.length - 1;
          const split = moveToWordStart(allMeasures[lastIdx] ?? '', starts[i] ?? '', allMeasures, measureIndex, wordFinal, boundaryByMeasure, -1);
          if (split !== starts[i]) next.push(split);
        }
      });
      next.sort((a, b) => (measureIndex.get(a) ?? 0) - (measureIndex.get(b) ?? 0));
      if (next.length !== starts.length || next.some((m, k) => m !== starts[k])) {
        const r = await attempt(next, starts);
        if (typeof r === 'string') return failed(r);
        await tick();
        if (ctx.isCancelled()) return cancelled();
        if (r.ok) { sys1 = [...r.systems]; overhang1 = Math.max(...sys1.map((x) => x.maxXMm)) - page.content.widthMm; }
      }
    }
    if (overhang1 > RIGHT_EDGE_TOLERANCE_MM) {
      if (settings.linePolicy === 'original') {
        crowdedDetails.push(`right edge overhang ${round3(overhang1)} mm`);
      } else {
        const worst = sys1.find((s) => s.maxXMm - page.content.widthMm > RIGHT_EDGE_TOLERANCE_MM);
        const before = worst ? boundaryBeforeMeasure(worst.firstMeasureId) : null;
        return fail(diag(partId, 'UNSATISFIABLE_LAYOUT', 'error', {
          pageIndex: 0,
          boundaryIds: before ? [before] : [],
          reason: 'system-too-wide',
          suggestions: sizeSuggestions(settings, 'wide'),
          detail: `a system is ${round3(overhang1)} mm wider than the ${page.content.widthMm} mm content width`,
        }));
      }
    }
    const compression = consoleMessages.filter((m) => /compress/i.test(m));
    if (settings.linePolicy === 'original' && compression.length > 0) {
      crowdedDetails.push(`Verovio: ${compression[0]}`);
    }

    // ------------------------------------------------------- planning ---
    let planned = planSystems(sys1, allMeasures, realisable, measureByBoundary, boundaryBeforeMeasure);
    let measuredForGaps: readonly MeasuredSystem[] = sys1;

    // Automatic reflow: Verovio breaks at any measure, even inside a word ("Chri-" / "ste"). Try to
    // move each such start to a word boundary: the nearest one either way, then only backward, then
    // only forward. Each try is ONE encoded render; the moves that leave their two systems clean
    // (no overhang, no syllables closer than 0.3 mm, no justification ratio below 0.7/0.8) are kept,
    // confirmed by one more render when only some of them were. At most three tries, never repeated.
    if (settings.linePolicy === 'automatic' && planned.length > 1) {
      const original = planned.map((p) => p.startMeasureId);
      let current = [...original];
      let currentSystems: readonly MeasuredSystem[] | null = null;
      const midWord = (m: string): boolean => !wordFinal.has(allMeasures[(measureIndex.get(m) ?? 0) - 1] ?? '');
      const movable = (k: number): boolean => k > 0 && !pinned.has(original[k] ?? '') && midWord(current[k] ?? '');
      const pick = (mode: 'nearest' | 'back' | 'forward' | 'cascade' | 'cascade-forward'): string[] => {
        const out = [...current];
        if (mode === 'cascade' || mode === 'cascade-forward') {
          const dir = mode === 'cascade' ? -1 : 1;
          // A word too long to start earlier without overfilling the next system: shift this start back
          // to its word boundary and every later start back by the same number of measures (each to a
          // word boundary), so the extra measures flow to the end of the part.
          const k = out.findIndex((_, i) => movable(i));
          if (k < 0) return out;
          const at = measureIndex.get(out[k]!) ?? 0;
          const b = moveToWordStart(out[k]!, dir === -1 ? (out[k - 1] ?? '') : (out[k + 1] ?? ''), allMeasures, measureIndex, wordFinal, boundaryByMeasure, dir);
          if (b === out[k]) return out;
          const d = (measureIndex.get(b) ?? 0) - at; // negative: earlier
          out[k] = b;
          for (let j = k + 1; j < out.length; j++) {
            if (pinned.has(original[j] ?? '')) break;
            const target = (measureIndex.get(out[j]!) ?? 0) + d;
            const prev = measureIndex.get(out[j - 1]!) ?? 0;
            let found = '';
            // nearest word boundary to the shifted position, on the side of the shift
            for (let t = target; dir === -1 ? t > prev : t < allMeasures.length; t += dir === -1 ? -1 : 1) {
              const before = allMeasures[t - 1] ?? '';
              if (t > prev && wordFinal.has(before) && boundaryByMeasure.has(before)) { found = allMeasures[t] ?? ''; break; }
            }
            if (found === '') break;
            out[j] = found;
          }
          return out;
        }
        for (let k = 1; k < out.length; k++) {
          if (!movable(k)) continue;
          const m = out[k]!;
          const b = moveToWordStart(m, out[k - 1] ?? '', allMeasures, measureIndex, wordFinal, boundaryByMeasure, -1);
          const f = moveToWordStart(m, out[k + 1] ?? '', allMeasures, measureIndex, wordFinal, boundaryByMeasure, 1);
          const at = measureIndex.get(m) ?? 0;
          const db = b === m ? Infinity : at - (measureIndex.get(b) ?? 0);
          const df = f === m ? Infinity : (measureIndex.get(f) ?? 0) - at;
          out[k] = mode === 'back' ? b : mode === 'forward' ? f : db <= df ? b : f;
        }
        return out;
      };
      for (const mode of ['nearest', 'back', 'forward', 'cascade', 'cascade-forward'] as const) {
        if (!current.some((_, k) => movable(k))) break;
        const moved = pick(mode);
        const changed = moved.map((m, k) => (m !== current[k] ? k : -1)).filter((k) => k >= 0);
        if (changed.length === 0) continue;
        const r = await attempt(moved, current);
        if (typeof r === 'string') return failed(r);
        await tick();
        if (ctx.isCancelled()) return cancelled();
        if (!r.sameStarts || !r.ratiosOk) continue;
        if (mode === 'cascade' || mode === 'cascade-forward') {
          if (r.ok) { current = moved; currentSystems = r.systems; }
          continue;
        }
        const keep = changed.filter((k) => !r.bad.has(k - 1) && !r.bad.has(k));
        if (keep.length === 0) continue;
        if (keep.length === changed.length) {
          current = moved;
          currentSystems = r.systems;
          continue;
        }
        const subset = current.map((m, k) => (keep.includes(k) ? moved[k]! : m));
        const r2 = await attempt(subset, current);
        if (typeof r2 === 'string') return failed(r2);
        await tick();
        if (ctx.isCancelled()) return cancelled();
        if (r2.ok) {
          current = subset;
          currentSystems = r2.systems;
        }
      }
      if (currentSystems !== null) {
        planned = planSystems(currentSystems, allMeasures, [], measureByBoundary, boundaryBeforeMeasure);
        measuredForGaps = currentSystems;
      }
    }
    const gaps = measuredForGaps.slice(1).map((s, i) => s.topMm - ((measuredForGaps[i]?.topMm ?? 0) + (measuredForGaps[i]?.heightMm ?? 0)));
    const minGapMm = gaps.length > 0 ? Math.max(0, ...gaps) : 0; // R1: the maximum measured gap

    const userPageBoundaries = new Set(eff.breaks.filter((b) => b.origin === 'user' && b.kind === 'page').map((b) => b.boundaryId));
    const forcedPageStarts = new Set<number>();
    planned.forEach((s, i) => { if (s.firstBoundaryId !== null && userPageBoundaries.has(s.firstBoundaryId)) forcedPageStarts.add(i); });

    const pagInput = {
      systems: planned.map((s, i) => ({ heightMm: hint !== null && hint.heights.length === planned.length ? Math.max(s.heightMm, hint.heights[i] ?? 0) : s.heightMm, startsAfterBoundary: s.firstBoundaryId })),
      contentHeightMm: page.content.heightMm,
      firstPageContentHeightMm: page.firstPageContent.heightMm,
      minGapMm: hint !== null ? Math.max(minGapMm, hint.gapMm) : minGapMm,
      maxSystems: settings.maxSystems,
      forcedPageStarts,
    };
    const pag = paginate(pagInput);
    if (!pag.ok) {
      const bad = planned[pag.systemIndex];
      const prefix = paginate({ ...pagInput, systems: pagInput.systems.slice(0, pag.systemIndex) });
      const pageIndex = prefix.ok ? prefix.pages.length : 0;
      const badHeight = pagInput.systems[pag.systemIndex]?.heightMm ?? bad?.heightMm ?? 0;
      const headingBound = pageIndex === 0 && badHeight <= page.content.heightMm;
      return fail(diag(partId, 'UNSATISFIABLE_LAYOUT', 'error', {
        pageIndex,
        boundaryIds: bad?.firstBoundaryId ? [bad.firstBoundaryId] : [],
        reason: headingBound ? 'heading-too-tall' : 'system-too-tall',
        suggestions: sizeSuggestions(settings, 'tall'),
        detail: `system ${pag.systemIndex} is ${badHeight} mm tall; the page offers ${pageIndex === 0 ? page.firstPageContent.heightMm : page.content.heightMm} mm`,
      }));
    }
    if (ctx.isCancelled()) return cancelled();

    // ---------------------------------------------- materialise (pass 2) ---
    const inserts = new Map<string, 'page' | 'system'>();
    pag.pages.forEach((indices, pi) => {
      indices.forEach((si, k) => {
        if (si === 0) return;
        const start = planned[si]?.startMeasureId;
        if (start) inserts.set(start, k === 0 && pi > 0 ? 'page' : 'system');
      });
    });
    // D17: a sustain crossing ANY final system or page start (user, source, automatic or
    // pagination) must show its continuation, tied. Pass 1 measured with them hidden.
    const brokenAfter = new Set<string>();
    for (const si of pag.pages.flat()) {
      const start = planned[si]?.startMeasureId;
      const i = start === undefined ? -1 : (measureIndex.get(start) ?? -1);
      if (i > 0) brokenAfter.add(allMeasures[i - 1] ?? '');
    }
    const mei2 = revealSplitSustainsAfter(rewriteBreaks(part.meiXml, { stripSb: true, insertBefore: inserts }), brokenAfter);
    const plannedPages = pag.pages.map((indices) => indices.map((i) => planned[i]?.startMeasureId ?? ''));
    // R5: with no break element 'encoded' silently falls back to 'auto'. A one-system part must
    // stay one system, so ask for 'none' instead.
    const pass2Breaks = planned.length <= 1 ? 'none' : 'encoded';
    const pass2Options: OptionRecord = { ...base, pageMarginRight: reserveRight, breaks: pass2Breaks, svgBoundingBoxes: true };
    finalOptions = { ...base, pageMarginRight: reserveRight, breaks: pass2Breaks };

    // ------------------------------------------------------------ pass 2 ---
    const bad2 = apply(pass2Options);
    if (bad2.length > 0) return failed(`pass 2 options not applied: ${bad2.join('; ')}`);
    if (!load(mei2)) return failed('loadData failed in pass 2');
    const pageCount2 = captureConsole(consoleMessages, () => tk.getPageCount());
    const rendered: { svg: string; measured: MeasuredPage }[] = [];
    for (let n = 1; n <= pageCount2; n++) {
      await tick();
      if (ctx.isCancelled()) return cancelled();
      const raw = renderPage(n);
      rendered.push({ svg: stripBoundingBoxes(raw), measured: measureSvgPage(raw) });
    }

    // R4: Verovio has one pageHeight, and justification would stretch page 1 into the heading
    // space. Render page 1 alone at the smaller height.
    if (base['justifyVertically'] === true && page.firstPageContent.heightMm < page.content.heightMm - BOTTOM_TOLERANCE_MM && rendered.length > 0) {
      const firstOptions: OptionRecord = { ...pass2Options, pageHeight: Math.floor(page.firstPageContent.heightMm * 10) };
      const badFirst = apply(firstOptions);
      if (badFirst.length > 0) return failed(`first-page options not applied: ${badFirst.join('; ')}`);
      if (!load(mei2)) return failed('loadData failed for the first page');
      await tick();
      if (ctx.isCancelled()) return cancelled();
      const raw = renderPage(1);
      rendered[0] = { svg: stripBoundingBoxes(raw), measured: measureSvgPage(raw) };
    }
    await tick();
    if (ctx.isCancelled()) return cancelled();

    // -------------------------------------------------------- convergence ---
    const actualPages = rendered.map((r) => r.measured.systems.map((s) => s.firstMeasureId));
    const mismatchAt = firstMismatch(plannedPages, actualPages);
    if (mismatchAt !== null) {
      const startId = plannedPages[mismatchAt.page]?.[mismatchAt.system] ?? actualPages[mismatchAt.page]?.[mismatchAt.system] ?? '';
      const boundary = startId ? boundaryBeforeMeasure(startId) : null;
      return fail(diag(partId, 'UNSATISFIABLE_LAYOUT', 'error', {
        pageIndex: mismatchAt.page,
        boundaryIds: boundary ? [boundary] : [],
        reason: 'no-convergence',
        suggestions: eff.breaks.some((b) => b.origin === 'user') ? ['remove-break'] : sizeSuggestions(settings, 'tall'),
        detail: `pass 2 system starts differ from pass 1 at page ${mismatchAt.page}, system ${mismatchAt.system}: planned ${JSON.stringify(plannedPages)}, got ${JSON.stringify(actualPages)}`,
      }));
    }

    // ----------------------------------------------------------- results ---
    let nextIndex = 0;
    const pages: MeiPageLayout[] = rendered.map((r) => ({
      svg: r.svg,
      systems: r.measured.systems.map((s): SystemGeometry => ({
        index: nextIndex++,
        firstBoundaryId: boundaryBeforeMeasure(s.firstMeasureId),
        topMm: s.topMm,
        heightMm: s.heightMm,
      })),
    }));
    const staffHeightMm = round3(mean(rendered.flatMap((r) => [...r.measured.staffHeightsMm])));
    const seenNotes = new Set<string>();
    for (const r of rendered) for (const id of r.measured.noteIds) seenNotes.add(id);

    const constraints: LayoutConstraints = {
      page: paperDimensions(settings),
      usable: page.content,
      maxSystems: settings.maxSystems,
      staffHeightMm: STAFF_SIZES[settings.staff].heightMm,
      requiredBreaks: realisable,
      expectedEventIds: noteIdsInMei(part.meiXml),
    };
    const layout: MeiLayout = {
      partId, pages, effectiveBreaks: eff, staffHeightMm, verovioOptions: finalOptions, diagnostics,
    };
    const problems = validateCore(layout, constraints, seenNotes);

    // Right edge after pass 2 (the same overhang pass 1 saw, now on the real pages).
    const overhang2 = Math.max(...rendered.flatMap((r) => r.measured.systems.map((s) => s.maxXMm))) - page.content.widthMm;
    const left2 = Math.min(...rendered.flatMap((r) => r.measured.systems.map((s) => s.minXMm)));
    if (overhang2 > RIGHT_EDGE_TOLERANCE_MM) {
      if (settings.linePolicy === 'original') {
        if (!crowdedDetails.some((d) => d.startsWith('right edge'))) crowdedDetails.push(`right edge overhang ${round3(overhang2)} mm on the final pages`);
      }
      else problems.push(diag(partId, 'CONTENT_CLIPPED', 'error', {
        suggestions: sizeSuggestions(settings, 'wide').filter((s) => s !== 'fit-to-page'),
        detail: `content overhangs the right edge by ${round3(overhang2)} mm`,
      }));
    }
    if (left2 < -BOTTOM_TOLERANCE_MM) {
      problems.push(diag(partId, 'CONTENT_CLIPPED', 'error', {
        suggestions: ['smaller-margins'],
        detail: `content starts ${round3(-left2)} mm left of the content area`,
      }));
    }
    if (crowdedDetails.length > 0) {
      diagnostics.push(diag(partId, 'CROWDED_ORIGINAL_LINES', 'warning', {
        suggestions: sizeSuggestions(settings, 'wide').filter((s) => s !== 'fit-to-page'),
        detail: [...new Set(crowdedDetails)].join('; '),
      }));
    }
    if (problems.length > 0) {
      const failedLayout: MeiLayout = { ...layout, pages: [], diagnostics: [...diagnostics, ...problems] };
      if (hint === null && problems.some((d) => d.code === 'CONTENT_CLIPPED' && d.detail.includes('content bottom'))) {
        const sys = rendered.flatMap((r) => r.measured.systems);
        const gaps = rendered.flatMap((r) => r.measured.systems.slice(1).map((x, i) => x.topMm - ((r.measured.systems[i]?.topMm ?? 0) + (r.measured.systems[i]?.heightMm ?? 0))));
        measuredHints.set(failedLayout, { heights: sys.map((x) => x.heightMm), gapMm: gaps.length > 0 ? Math.max(0, ...gaps) : 0 });
      }
      return failedLayout;
    }
    return { ...layout, diagnostics };
  } catch (e) {
    const message = errorMessage(e);
    if (message.startsWith('UNSAFE_ANCHOR')) {
      return fail(diag(partId, 'UNSAFE_ANCHOR', 'error', { suggestions: ['remove-break'], detail: message }));
    }
    return failed(message);
  }
}

/**
 * Measures after which a lyric word is complete, from the `wordpos` of each `<syl>`
 * (i = initial, m = medial: still inside a word; t = terminal, s = single). Measures without
 * lyrics keep the state of the one before.
 */
export function wordFinalMeasures(meiXml: string): Set<string> {
  const out = new Set<string>();
  let open = false;
  for (const block of meiXml.split(/<measure\b/).slice(1)) {
    const id = /\sxml:id="([^"]+)"/.exec(block)?.[1];
    // A syllable without wordpos is a whole word.
    for (const m of block.matchAll(/<syl\b[^>]*>/g)) {
      const pos = /\swordpos="([imts])"/.exec(m[0])?.[1];
      open = pos === 'i' || pos === 'm';
    }
    if (id && !open) out.add(id);
  }
  return out;
}

/**
 * A start that begins a new word and follows a safe boundary: the nearest one at or before `start`
 * (dir -1, keeping the previous system's first measure) or at or after it (dir 1, stopping before
 * the next system's first measure). Returns `start` when there is none.
 */
function moveToWordStart(
  start: string,
  limit: string,
  allMeasures: readonly string[],
  measureIndex: ReadonlyMap<string, number>,
  wordFinal: ReadonlySet<string>,
  boundaryByMeasure: ReadonlyMap<string, string>,
  dir: -1 | 1,
): string {
  const idx = measureIndex.get(start) ?? 0;
  const ok = (j: number): boolean => {
    const before = allMeasures[j - 1] ?? '';
    return wordFinal.has(before) && boundaryByMeasure.has(before);
  };
  if (dir === -1) {
    const lo = (measureIndex.get(limit) ?? -1) + 1;
    for (let j = idx; j > lo; j--) if (ok(j)) return allMeasures[j] ?? start;
  } else {
    const hi = measureIndex.get(limit) ?? allMeasures.length; // the last system has no next start
    for (let j = idx; j < hi; j++) if (ok(j)) return allMeasures[j] ?? start;
  }
  return start;
}

const fontCache = new WeakMap<Uint8Array, Font>();
/** The lyric face, when the render context carries one (unit tests with fakes do not). */
function lyricFontOf(ctx: RenderContext): Font | null {
  const bytes = (ctx.fonts as Partial<FontProfile>).lyricFont?.bytes;
  if (!bytes) return null;
  let f = fontCache.get(bytes);
  if (f === undefined) { f = fontkit.create(bytes); fontCache.set(bytes, f); }
  return f;
}

/** First (page, system) where planned and actual system-start lists differ, or null when identical. */
function firstMismatch(planned: readonly (readonly string[])[], actual: readonly (readonly string[])[]): { page: number; system: number } | null {
  const pages = Math.max(planned.length, actual.length);
  for (let p = 0; p < pages; p++) {
    const a = planned[p] ?? [];
    const b = actual[p] ?? [];
    const n = Math.max(a.length, b.length);
    for (let s = 0; s < n; s++) if (a[s] !== b[s]) return { page: p, system: s };
  }
  return null;
}

/**
 * Pass-1 systems plus an extra start after every required break that does not already begin a
 * system (user breaks under 'auto', where Verovio ignores <sb/>). A split system keeps the
 * height of the pass-1 system it came from, which is conservative.
 */
function planSystems(
  sys1: readonly MeasuredSystem[],
  allMeasures: readonly string[],
  breaks: readonly EffectiveBreak[],
  measureByBoundary: ReadonlyMap<string, string>,
  boundaryBeforeMeasure: (measureId: string) => string | null,
): PlannedSystem[] {
  const index = new Map(allMeasures.map((id, i) => [id, i] as const));
  const owner = new Map<string, number>();
  sys1.forEach((s, si) => { for (const m of s.measureIds) owner.set(m, si); });
  const starts = new Map<string, number>();
  sys1.forEach((s, si) => starts.set(s.firstMeasureId, si));
  for (const br of breaks) {
    const after = measureByBoundary.get(br.boundaryId);
    const next = after === undefined ? undefined : allMeasures[(index.get(after) ?? -1) + 1];
    if (next !== undefined && !starts.has(next)) starts.set(next, owner.get(next) ?? 0);
  }
  return [...starts.entries()]
    .sort((a, b) => (index.get(a[0]) ?? 0) - (index.get(b[0]) ?? 0))
    .map(([measureId, si]) => ({
      startMeasureId: measureId,
      firstBoundaryId: boundaryBeforeMeasure(measureId),
      topMm: sys1[si]?.topMm ?? 0,
      heightMm: sys1[si]?.heightMm ?? 0,
    }));
}
