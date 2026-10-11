// B6a: canonical composition. A pure geometry pass in mm: it places already
// laid-out MEI pages, packs scan images and fits fixed PDF pages onto the
// target page, reserves heading and credit space, and fills the digests. It
// draws nothing; B6b turns the result into a PDF and B6c into a preview.
//
// Conventions B6b / B6c rely on:
//  - All coordinates are page-absolute mm, origin top-left.
//  - MEI: the sanitized SVG is drawn with its own origin at
//    (svgPlacement.translateXMm, svgPlacement.translateYMm) at scale 1 (Verovio
//    was rendered at the content size, so 1 SVG mm = 1 page mm).
//  - Fixed: the source page, whose natural size in mm is
//    sourceSizePt * 25.4 / 72, is multiplied by transform.scaleX (== scaleY)
//    and its top-left is placed at (translateXMm, translateYMm).
//  - A part with `heading === null` gets no heading and no footer.
//  - Fixed parts reserve nothing: their typeset PDFs already carry their own
//    heading and credit.
//  - The credit footer is reserved on EVERY page of a MEI or scan part (that is
//    what the caller's PageRects.content for renderMei must subtract), but is
//    drawn only on the part's last page.
import fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import { sha256Hex } from './fonts';
import { paperDimensions } from './settings';
import { measureSvgBounds, sanitizePageSvg } from './svg';
import type {
  AssetLoader,
  CanonicalPage,
  EffectiveBreaks,
  ExportPart,
  FixedCanonicalPage,
  FontAsset,
  FontProfile,
  HeadingBlock,
  LayoutDiagnostic,
  LayoutDiagnosticCode,
  LayoutResult,
  LayoutSettings,
  LayoutSuggestion,
  MeiCanonicalPage,
  MeiLayout,
  PartHeading,
  RectMm,
  ScanCanonicalPage,
  UnsatisfiableReason,
} from './types';

export interface ComposeDeps {
  readonly assets: AssetLoader;
  readonly fonts: FontProfile;
  readonly pngSize: (bytes: Uint8Array) => { width: number; height: number };
  readonly pdfPageSize: (bytes: Uint8Array, index: number) => Promise<{ width: number; height: number; count: number }>;
}

export const HEADING_PT = 14;
export const RUBRIC_PT = 10;
export const TRANSLATION_PT = 9;
export const CREDIT_PT = 8;
const LEADING = 1.25;
const HEADING_GAP_MM = 2.5;
const FOOTER_GAP_MM = 2;
const PT_MM = 25.4 / 72;
/** Same inter-image gap as quick export (pdf.ts GAP = 14 pt). */
const SCAN_GAP_MM = 14 * PT_MM;
/** Scans are never enlarged past this density: width <= pxWidth / SCAN_MIN_DPI inches. */
export const SCAN_MIN_DPI = 150;
const SIZE_TOLERANCE_MM = 0.5;
const A4_ASPECT = 1.35;

// ---------------------------------------------------------------- helpers ---
const fontCache = new WeakMap<Uint8Array, Font>();
function fontOf(asset: FontAsset): Font {
  let f = fontCache.get(asset.bytes);
  if (f === undefined) {
    f = fontkit.create(asset.bytes);
    fontCache.set(asset.bytes, f);
  }
  return f;
}

/** Width of `text` in mm at `sizePt` using the font's own advances (never Helvetica). */
export function textWidthMm(asset: FontAsset, text: string, sizePt: number): number {
  const font = fontOf(asset);
  return (font.layout(text).advanceWidth * sizePt * PT_MM) / font.unitsPerEm;
}

function wrap(asset: FontAsset, text: string, sizePt: number, maxMm: number): string[] {
  const out: string[] = [];
  let line = '';
  const push = (): void => { if (line !== '') out.push(line); line = ''; };
  for (const word of text.split(/\s+/).filter((w) => w !== '')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (textWidthMm(asset, candidate, sizePt) <= maxMm) { line = candidate; continue; }
    push();
    if (textWidthMm(asset, word, sizePt) <= maxMm) { line = word; continue; }
    // A single word wider than the line: break it by characters.
    for (const ch of Array.from(word)) {
      if (line !== '' && textWidthMm(asset, line + ch, sizePt) > maxMm) push();
      line += ch;
    }
  }
  push();
  return out;
}

interface RawLine { readonly text: string; readonly role: 'heading' | 'rubric' | 'translation' | 'credit'; readonly sizePt: number; readonly asset: FontAsset }

function block(lines: readonly RawLine[], x: number, topMm: number, widthMm: number, gapMm: number): HeadingBlock {
  let y = topMm;
  const placed = lines.map((l) => {
    const leading = l.sizePt * LEADING * PT_MM;
    const f = fontOf(l.asset);
    const baselineMm = y + (f.ascent / f.unitsPerEm) * l.sizePt * PT_MM + (leading - l.sizePt * PT_MM) / 2;
    y += leading;
    return { text: l.text, role: l.role, sizePt: l.sizePt, baselineMm };
  });
  return { lines: placed, rect: { xMm: x, yMm: topMm, widthMm, heightMm: y - topMm + gapMm } };
}

function headingLines(h: PartHeading, fonts: FontProfile, widthMm: number): RawLine[] {
  const lines: RawLine[] = [];
  const add = (text: string | null, role: RawLine['role'], sizePt: number, asset: FontAsset): void => {
    if (text === null || text.trim() === '') return;
    for (const t of wrap(asset, text, sizePt, widthMm)) lines.push({ text: t, role, sizePt, asset });
  };
  add(h.label, 'heading', HEADING_PT, fonts.headingBold);
  add(h.rubric, 'rubric', RUBRIC_PT, fonts.headingItalic);
  add(h.rubricTranslation, 'translation', TRANSLATION_PT, fonts.headingItalic);
  return lines;
}
function footerLines(h: PartHeading, fonts: FontProfile, widthMm: number): RawLine[] {
  const lines: RawLine[] = [];
  if (h.credit !== null && h.credit.trim() !== '') {
    for (const t of wrap(fonts.headingRegular, h.credit, CREDIT_PT, widthMm)) {
      lines.push({ text: t, role: 'credit', sizePt: CREDIT_PT, asset: fonts.headingRegular });
    }
  }
  return lines;
}

export interface PartReservation {
  /** Height reserved above the content on the part's first page (0 when none). */
  readonly headingMm: number;
  /** Height reserved below the content on every page of the part (0 when none). */
  readonly footerMm: number;
}
/** What composeExport reserves for a part; callers build renderMei's PageRects from it so both agree. */
export function reservationFor(part: ExportPart, settings: LayoutSettings, fonts: FontProfile): PartReservation {
  if (part.kind === 'fixed' || part.heading === null) return { headingMm: 0, footerMm: 0 };
  const page = paperDimensions(settings);
  const width = page.widthMm - 2 * settings.marginMm;
  const h = block(headingLines(part.heading, fonts, width), 0, 0, width, HEADING_GAP_MM);
  const f = block(footerLines(part.heading, fonts, width), 0, 0, width, 0);
  return { headingMm: h.rect.heightMm, footerMm: f.lines.length === 0 ? 0 : f.rect.heightMm + FOOTER_GAP_MM };
}

// ------------------------------------------------------------- digests ---
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const sha = (v: unknown): Promise<string> => sha256Hex(new TextEncoder().encode(stable(v)));

function diag(
  partId: string | null,
  code: LayoutDiagnosticCode,
  detail: string,
  o: { pageIndex?: number | null; reason?: UnsatisfiableReason | null; suggestions?: readonly LayoutSuggestion[] } = {},
): LayoutDiagnostic {
  return {
    code, severity: 'error', partId, pageIndex: o.pageIndex ?? null, boundaryIds: [],
    reason: o.reason ?? null, suggestions: o.suggestions ?? [], detail,
  };
}
const codeOfError = (e: unknown, fallback: LayoutDiagnosticCode): LayoutDiagnosticCode => {
  const m = /^([A-Z_]+):/.exec(e instanceof Error ? e.message : '');
  const known: readonly LayoutDiagnosticCode[] = ['ASSET_MISSING', 'ASSET_HASH_MISMATCH', 'UNSAFE_SVG', 'INVALID_PAGE'];
  return known.find((k) => k === m?.[1]) ?? fallback;
};
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/**
 * sanitizePageSvg accepts only /^[A-Za-z][A-Za-z0-9_]*$/ (no '-' or ':'), so the
 * `${partId}-p${i}` form from the card is mapped into it. The leading global page
 * index keeps two part ids that differ only in punctuation apart.
 */
const svgNamespace = (partId: string, globalIndex: number, localIndex: number): string =>
  `s${globalIndex}_${partId.replace(/[^A-Za-z0-9]/g, '_')}_p${localIndex}`;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// --------------------------------------------------------------- compose ---
export async function composeExport(
  parts: readonly ExportPart[],
  meiLayouts: ReadonlyMap<string, MeiLayout>,
  settings: LayoutSettings,
  deps: ComposeDeps,
  token: number,
): Promise<LayoutResult> {
  const { fonts } = deps;
  const phys = paperDimensions(settings);
  const printable: RectMm = {
    xMm: settings.marginMm, yMm: settings.marginMm,
    widthMm: phys.widthMm - 2 * settings.marginMm, heightMm: phys.heightMm - 2 * settings.marginMm,
  };
  const diagnostics: LayoutDiagnostic[] = [];
  const pages: CanonicalPage[] = [];
  const effectiveBreaks: EffectiveBreaks[] = [];
  const versions = new Set<string>();

  const pageBase = (partId: string, content: RectMm, heading: HeadingBlock | null, footer: HeadingBlock | null, unused: number) => ({
    index: pages.length, widthMm: phys.widthMm, heightMm: phys.heightMm, partId, printable, content, heading, footer,
    unusedFraction: clamp01(unused),
  });

  for (const part of parts) {
    const startCount = pages.length;
    const rawHead = part.kind !== 'fixed' && part.heading !== null ? headingLines(part.heading, fonts, printable.widthMm) : [];
    const rawFoot = part.kind !== 'fixed' && part.heading !== null ? footerLines(part.heading, fonts, printable.widthMm) : [];
    const headingBlock = rawHead.length === 0 ? null : block(rawHead, printable.xMm, printable.yMm, printable.widthMm, HEADING_GAP_MM);
    const headingH = headingBlock?.rect.heightMm ?? 0;
    const footerOf = (): HeadingBlock | null => {
      if (rawFoot.length === 0) return null;
      const probe = block(rawFoot, 0, 0, printable.widthMm, 0);
      const top = printable.yMm + printable.heightMm - probe.rect.heightMm;
      return block(rawFoot, printable.xMm, top, printable.widthMm, 0);
    };
    const footerH = rawFoot.length === 0 ? 0 : block(rawFoot, 0, 0, printable.widthMm, 0).rect.heightMm + FOOTER_GAP_MM;
    const contentFor = (first: boolean): RectMm => {
      const top = first ? headingH : 0;
      return { xMm: printable.xMm, yMm: printable.yMm + top, widthMm: printable.widthMm, heightMm: printable.heightMm - top - footerH };
    };

    if (part.kind !== 'fixed' && contentFor(true).heightMm <= 0) {
      diagnostics.push(diag(part.id, 'UNSATISFIABLE_LAYOUT', `heading ${headingH} mm leaves no room on a ${printable.heightMm} mm page`, {
        pageIndex: pages.length, reason: 'heading-too-tall', suggestions: ['larger-page', 'smaller-margins'],
      }));
      continue;
    }

    try {
      if (part.kind === 'mei') {
        const layout = meiLayouts.get(part.id);
        if (layout === undefined) {
          diagnostics.push(diag(part.id, 'RENDERER_FAILED', 'no MEI layout was supplied for this part'));
          continue;
        }
        diagnostics.push(...layout.diagnostics);
        effectiveBreaks.push(layout.effectiveBreaks);
        versions.add(part.conversion.verovio);
        if (layout.pages.length === 0) {
          if (!layout.diagnostics.some((d) => d.severity === 'error')) {
            diagnostics.push(diag(part.id, 'RENDERER_FAILED', 'the MEI layout has no pages'));
          }
          continue;
        }
        const built: MeiCanonicalPage[] = [];
        let bad = false;
        for (let i = 0; i < layout.pages.length; i++) {
          const lp = layout.pages[i]!;
          const content = contentFor(i === 0);
          const maxHeight = contentFor(false).heightMm;
          const svg = sanitizePageSvg(lp.svg, svgNamespace(part.id, pages.length + i, i));
          const bounds = measureSvgBounds(svg);
          if (Math.abs(bounds.widthMm - content.widthMm) > SIZE_TOLERANCE_MM || bounds.heightMm > maxHeight + SIZE_TOLERANCE_MM) {
            diagnostics.push(diag(part.id, 'INVALID_PAGE',
              `page ${i} SVG is ${bounds.widthMm} x ${bounds.heightMm} mm; the content rect is ${content.widthMm} x ${maxHeight} mm`,
              { pageIndex: pages.length + i }));
            bad = true;
            break;
          }
          const bottom = Math.max(0, ...lp.systems.map((s) => s.topMm + s.heightMm));
          const last = i === layout.pages.length - 1;
          built.push({
            ...pageBase(part.id, content, i === 0 ? headingBlock : null, last ? footerOf() : null, 1 - bottom / content.heightMm),
            index: pages.length + i,
            kind: 'mei',
            svg,
            svgPlacement: { scaleX: 1, scaleY: 1, translateXMm: content.xMm, translateYMm: content.yMm },
            systemCount: lp.systems.length,
            boundaries: lp.systems.flatMap((s) => s.firstBoundaryId === null ? [] : [{
              boundaryId: s.firstBoundaryId,
              rect: { xMm: content.xMm, yMm: content.yMm + s.topMm, widthMm: content.widthMm, heightMm: s.heightMm },
            }]),
          });
        }
        if (!bad) pages.push(...built);
      } else if (part.kind === 'scan') {
        const sizes: { stem: string; w: number; h: number }[] = [];
        for (const stem of part.stems) {
          const bytes = await deps.assets.bytes(`${stem}@2x.png`, null);
          const s = deps.pngSize(bytes);
          sizes.push({ stem, w: s.width, h: s.height });
        }
        const cap = settings.maxSystems ?? Infinity;
        const groups: { stem: string; w: number; h: number; wMm: number; hMm: number }[][] = [[]];
        let used = 0;
        let tooLarge = false;
        for (const s of sizes) {
          const wMm = Math.min(printable.widthMm, (s.w / SCAN_MIN_DPI) * 25.4);
          const hMm = (s.h / s.w) * wMm;
          let cur = groups[groups.length - 1]!;
          let room = contentFor(groups.length === 1).heightMm;
          const extra = (n: number): number => (n === 0 ? 0 : SCAN_GAP_MM);
          if (cur.length > 0 && (cur.length >= cap || used + extra(cur.length) + hMm > room + 1e-9)) {
            groups.push([]);
            cur = groups[groups.length - 1]!;
            used = 0;
            room = contentFor(false).heightMm;
          }
          if (hMm > room + 1e-9) {
            diagnostics.push(diag(part.id, 'SCAN_TOO_LARGE', `image ${s.stem} is ${s.w}x${s.h} px, ${hMm.toFixed(1)} mm tall at ${wMm.toFixed(1)} mm wide; the content height is ${room.toFixed(1)} mm`, {
              pageIndex: pages.length, suggestions: ['larger-page', 'smaller-margins', 'landscape'],
            }));
            tooLarge = true;
            break;
          }
          used += extra(cur.length) + hMm;
          cur.push({ ...s, wMm, hMm });
        }
        if (!tooLarge) {
          groups.forEach((g, gi) => {
            const content = contentFor(gi === 0);
            let y = content.yMm;
            const images = g.map((im) => {
              const rect: RectMm = { xMm: content.xMm + (content.widthMm - im.wMm) / 2, yMm: y, widthMm: im.wMm, heightMm: im.hMm };
              y += im.hMm + SCAN_GAP_MM;
              return { stem: im.stem, rect, pxWidth: im.w, pxHeight: im.h };
            });
            const bottom = g.reduce((acc, im, k) => acc + im.hMm + (k === 0 ? 0 : SCAN_GAP_MM), 0);
            const page: ScanCanonicalPage = {
              ...pageBase(part.id, content, gi === 0 ? headingBlock : null, gi === groups.length - 1 ? footerOf() : null, 1 - bottom / content.heightMm),
              index: pages.length,
              kind: 'scan',
              images,
              systemCount: images.length,
            };
            pages.push(page);
          });
        }
      } else {
        const paper: 'letter' | 'a4' = phys.heightMm / phys.widthMm >= A4_ASPECT ? 'a4' : 'letter';
        const url = paper === 'a4' ? part.a4Pdf : part.letterPdf;
        const bytes = await deps.assets.bytes(url, null);
        const first = await deps.pdfPageSize(bytes, 0);
        if (first.count <= 0) {
          diagnostics.push(diag(part.id, 'FIXED_PAGE_COUNT_MISMATCH', `${url} has ${first.count} pages`));
          continue;
        }
        const built: FixedCanonicalPage[] = [];
        for (let i = 0; i < first.count; i++) {
          const size = i === 0 ? first : await deps.pdfPageSize(bytes, i);
          const content = printable;
          const srcW = size.width * PT_MM;
          const srcH = size.height * PT_MM;
          const scale = Math.min(content.widthMm / srcW, content.heightMm / srcH);
          const drawnW = srcW * scale;
          const drawnH = srcH * scale;
          built.push({
            ...pageBase(part.id, content, null, null, 1 - drawnH / content.heightMm),
            index: pages.length + i,
            kind: 'fixed',
            sourceUrl: url,
            sourcePaper: paper,
            sourcePageIndex: i,
            sourceSizePt: { width: size.width, height: size.height },
            transform: {
              scaleX: scale, scaleY: scale,
              translateXMm: content.xMm + (content.widthMm - drawnW) / 2,
              translateYMm: content.yMm + (content.heightMm - drawnH) / 2,
            },
            systemCount: null,
          });
        }
        pages.push(...built);
      }
    } catch (e) {
      pages.length = startCount;
      diagnostics.push(diag(part.id, codeOfError(e, part.kind === 'mei' ? 'INVALID_PAGE' : 'ASSET_MISSING'), msg(e)));
    }
  }

  const svgHashes = await Promise.all(pages.map((p) => (p.kind === 'mei' ? sha256Hex(new TextEncoder().encode(p.svg.svg)) : Promise.resolve(null))));
  const pagesForDigest = pages.map((p, i) => (p.kind === 'mei' ? { ...p, svg: { sha256: svgHashes[i], ids: p.svg.ids, namespace: p.svg.namespace } } : p));
  const [input, settingsDigest, result] = await Promise.all([
    sha(parts.map((p) => ({ id: p.id, sourceRevision: p.sourceRevision })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))),
    sha(settings),
    sha(pagesForDigest),
  ]);

  return {
    token,
    partIds: parts.map((p) => p.id),
    digests: { input, settings: settingsDigest, fonts: fonts.digest, renderer: versions.size === 0 ? 'none' : [...versions].sort().join(','), result },
    effectiveBreaks,
    diagnostics,
    pages,
    complete: !diagnostics.some((d) => d.severity === 'error'),
  };
}
