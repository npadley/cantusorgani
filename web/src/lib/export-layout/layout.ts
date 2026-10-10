import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { resolveBreaks } from './breaks';
import { materialiseBreaks, revealSplitSustainsAfter } from './meiDoc';
import { paginate } from './paginate';
import { paperDimensions, verovioOptions } from './settings';
import { measureSvgPage } from './svgGeometry';
import type { MeasuredPage, MeasuredSystem } from './svgGeometry';
import { STAFF_SIZES } from './types';
import type {
  BreakOverride,
  EffectiveBreak,
  EffectiveBreaks,
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
  const partId = part.part.id;
  const eff = resolveBreaks(part, settings, overrides);
  const diagnostics: LayoutDiagnostic[] = [];
  const base = verovioOptions(settings, page.content);
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
    const pass1Options: OptionRecord = {
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
    const measured1 = measureSvgPage(renderPage(1));
    const sys1 = measured1.systems;
    if (sys1.length === 0) return failed('pass 1 produced no systems');
    await tick();
    if (ctx.isCancelled()) return cancelled();

    const allMeasures = sys1.flatMap((s) => s.measureIds);
    const measureIndex = new Map(allMeasures.map((id, i) => [id, i] as const));
    const boundaryBeforeMeasure = (measureId: string): string | null => {
      const i = measureIndex.get(measureId) ?? 0;
      return i <= 0 ? null : (boundaryByMeasure.get(allMeasures[i - 1] ?? '') ?? null);
    };

    // Right edge. Original lines are compressed, never split, so overhang is a warning there.
    const crowdedDetails: string[] = [];
    const overhang1 = Math.max(...sys1.map((s) => s.maxXMm)) - page.content.widthMm;
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

    // Automatic reflow: Verovio breaks at any measure, even inside a word ("Chri-" / "ste"). Move
    // such a start back to the nearest earlier word boundary, then verify with ONE encoded render
    // that nothing overflows. All or nothing, and never repeated.
    if (settings.linePolicy === 'automatic' && planned.length > 1) {
      const wordFinal = wordFinalMeasures(part.meiXml);
      const pinned = new Set(realisable.map((b) => nextMeasureInMei.get(measureByBoundary.get(b.boundaryId) ?? '') ?? ''));
      const moved: string[] = [];
      planned.forEach((p, k) => {
        moved.push(k === 0 || pinned.has(p.startMeasureId)
          ? p.startMeasureId
          : moveToWordStart(p.startMeasureId, moved[k - 1] ?? '', allMeasures, measureIndex, wordFinal, boundaryByMeasure));
      });
      if (moved.some((m, k) => m !== planned[k]?.startMeasureId)) {
        const messagesBefore = consoleMessages.length;
        const mei1b = rewriteBreaks(part.meiXml, { stripSb: true, insertBefore: new Map(moved.slice(1).map((m) => [m, 'system'] as const)) });
        const bad1b = apply({ ...pass1Options, breaks: 'encoded' });
        if (bad1b.length > 0) return failed(`word-boundary options not applied: ${bad1b.join('; ')}`);
        if (!load(mei1b)) return failed('loadData failed in the word-boundary pass');
        const pages1b = captureConsole(consoleMessages, () => tk.getPageCount());
        const sys1b = pages1b === 1 ? measureSvgPage(renderPage(1)).systems : [];
        // Moving a start back makes one line denser. Only accept it while Verovio does not compress
        // that line (no ratio below 0.8): at 0.7 to 0.76 neighbouring syllables overlap, which is
        // worse than breaking inside a word. Large staves on narrow pages therefore keep theirs.
        const ratios = consoleMessages.slice(messagesBefore)
          .map((m) => /ratio smaller than [\d.]+: ([\d.]+)/.exec(m)?.[1])
          .flatMap((r) => (r === undefined ? [] : [Number(r)]));
        const sameStarts = sys1b.length === moved.length && sys1b.every((s, k) => s.firstMeasureId === moved[k]);
        const fits = Math.max(...sys1b.map((s) => s.maxXMm)) - page.content.widthMm <= RIGHT_EDGE_TOLERANCE_MM;
        if (sameStarts && fits && ratios.every((r) => r >= MIN_WORD_BREAK_RATIO)) {
          planned = planSystems(sys1b, allMeasures, [], measureByBoundary, boundaryBeforeMeasure);
          measuredForGaps = sys1b;
        }
        await tick();
        if (ctx.isCancelled()) return cancelled();
      }
    }
    const gaps = measuredForGaps.slice(1).map((s, i) => s.topMm - ((measuredForGaps[i]?.topMm ?? 0) + (measuredForGaps[i]?.heightMm ?? 0)));
    const minGapMm = gaps.length > 0 ? Math.max(0, ...gaps) : 0; // R1: the maximum measured gap

    const userPageBoundaries = new Set(eff.breaks.filter((b) => b.origin === 'user' && b.kind === 'page').map((b) => b.boundaryId));
    const forcedPageStarts = new Set<number>();
    planned.forEach((s, i) => { if (s.firstBoundaryId !== null && userPageBoundaries.has(s.firstBoundaryId)) forcedPageStarts.add(i); });

    const pagInput = {
      systems: planned.map((s) => ({ heightMm: s.heightMm, startsAfterBoundary: s.firstBoundaryId })),
      contentHeightMm: page.content.heightMm,
      firstPageContentHeightMm: page.firstPageContent.heightMm,
      minGapMm,
      maxSystems: settings.maxSystems,
      forcedPageStarts,
    };
    const pag = paginate(pagInput);
    if (!pag.ok) {
      const bad = planned[pag.systemIndex];
      const prefix = paginate({ ...pagInput, systems: pagInput.systems.slice(0, pag.systemIndex) });
      const pageIndex = prefix.ok ? prefix.pages.length : 0;
      const headingBound = pageIndex === 0 && (bad?.heightMm ?? 0) <= page.content.heightMm;
      return fail(diag(partId, 'UNSATISFIABLE_LAYOUT', 'error', {
        pageIndex,
        boundaryIds: bad?.firstBoundaryId ? [bad.firstBoundaryId] : [],
        reason: headingBound ? 'heading-too-tall' : 'system-too-tall',
        suggestions: sizeSuggestions(settings, 'tall'),
        detail: `system ${pag.systemIndex} is ${bad?.heightMm} mm tall; the page offers ${pageIndex === 0 ? page.firstPageContent.heightMm : page.content.heightMm} mm`,
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
    const pass2Options: OptionRecord = { ...base, breaks: pass2Breaks, svgBoundingBoxes: true };
    finalOptions = { ...base, breaks: pass2Breaks };

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
    if (problems.length > 0) return { ...layout, pages: [], diagnostics: [...diagnostics, ...problems] };
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
    for (const m of block.matchAll(/<syl\b[^>]*?\swordpos="([imts])"/g)) open = m[1] === 'i' || m[1] === 'm';
    if (id && !open) out.add(id);
  }
  return out;
}

/** Nearest start at or before `start` (after `prevStart`) that begins a new word and follows a safe boundary. */
function moveToWordStart(
  start: string,
  prevStart: string,
  allMeasures: readonly string[],
  measureIndex: ReadonlyMap<string, number>,
  wordFinal: ReadonlySet<string>,
  boundaryByMeasure: ReadonlyMap<string, string>,
): string {
  const idx = measureIndex.get(start) ?? 0;
  const lo = (measureIndex.get(prevStart) ?? -1) + 1;
  for (let j = idx; j > lo; j--) {
    const before = allMeasures[j - 1] ?? '';
    if (wordFinal.has(before) && boundaryByMeasure.has(before)) return allMeasures[j] ?? start;
  }
  return start;
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
