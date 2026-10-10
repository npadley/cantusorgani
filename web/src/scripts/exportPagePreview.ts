// DOM rendering of CanonicalPage[] for the export editor's preview pane (UI spec 1.6, 5).
//
// Framework-free, like the site's other scripts. `ExportPagePreview.astro` supplies the static
// scaffold (toolbar and an empty `.cx-pages`); this module wires the toolbar and draws pages.
//
// Security: the ONLY place generated SVG reaches the DOM is `insertPageSvg`, and the only string
// it is ever given is `CanonicalPage.svg.svg`, which the layout worker already ran through
// `sanitizePageSvg`. Every other node is built with createElement / createElementNS / textContent.
// The preview never mutates a LayoutResult, so `result.digests.result` is unaffected by view or zoom.
//
// pdf.js is reached only through a dynamic import of fixedPreview.ts, the first time a fixed
// page is drawn.

import previewCss from '../styles/exportPreview.css?url';
import { loadStylesheet } from './lazyStyles';
import { PAGE_PRESETS } from '../lib/export-layout/types';
import type {
  AssetLoader,
  CanonicalPage,
  FixedCanonicalPage,
  LayoutResult,
  MeiCanonicalPage,
  ScanCanonicalPage,
} from '../lib/export-layout/types';

/** Resolves when the preview's stylesheet has loaded (it is not linked from any page). */
export const previewStylesReady: Promise<void> = loadStylesheet(previewCss);

export type PreviewView = 'pages' | 'continuous';
export const ZOOM_STEPS: readonly number[] = [50, 75, 100, 125, 150, 200, 300];
export const DEFAULT_ZOOM = 100;

const SVG_NS = 'http://www.w3.org/2000/svg';
const PT_MM = 25.4 / 72;
const BLANK_NOTE_THRESHOLD = 0.25;
const CONTINUOUS_PAD_MM = 1;
const READING_NOTICE = 'Reading view: page breaks are hidden here. The PDF uses the pages shown in Pages view.';

export interface RenderOptions {
  /** Shown while `result` is null or still being replaced: it stays at full opacity. */
  readonly previous?: LayoutResult | null;
  /** Part names by part id (ExportPart.label). A missing id falls back to the page's heading, then the id. */
  readonly partLabels?: Readonly<Record<string, string>>;
  readonly view?: PreviewView;
  readonly zoom?: number;
  /** Show the "Updating preview…" indicator. */
  readonly updating?: boolean;
  /** Fetches fixed-page source PDFs. Defaults to a cached fetch. */
  readonly assets?: AssetLoader;
}

// ------------------------------------------------------------ pure helpers ---

/** Nearest zoom step at or below the request, clamped to 50..300. */
export function snapZoom(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_ZOOM;
  let best = ZOOM_STEPS[0]!;
  for (const step of ZOOM_STEPS) if (step <= percent + 1e-9) best = step;
  return best;
}

export function stepZoom(current: number, direction: 1 | -1): number {
  const i = Math.max(0, ZOOM_STEPS.indexOf(snapZoom(current)));
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + direction))]!;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.06;

/** "11-inch iPad, portrait", from the page's own size, so an updating preview never mislabels its pages. */
export function pageDescription(page: { readonly widthMm: number; readonly heightMm: number }): string {
  const orientation = page.widthMm > page.heightMm ? 'landscape' : 'portrait';
  const long = Math.max(page.widthMm, page.heightMm);
  const short = Math.min(page.widthMm, page.heightMm);
  for (const preset of Object.values(PAGE_PRESETS)) {
    if (near(preset.widthMm, short) && near(preset.heightMm, long)) return `${preset.label}, ${orientation}`;
  }
  const round = (n: number): string => String(Math.round(n * 10) / 10);
  return `Custom ${round(page.widthMm)} × ${round(page.heightMm)} mm, ${orientation}`;
}

export function partLabelOf(page: CanonicalPage, labels: Readonly<Record<string, string>> | undefined): string {
  return labels?.[page.partId] ?? page.heading?.lines[0]?.text ?? page.partId;
}

/** Bottom edge (mm, page coordinates) of what a page actually shows: used to crop Continuous view. */
export function usedBottomMm(page: CanonicalPage): number {
  let bottom = page.content.yMm + page.content.heightMm * (1 - page.unusedFraction);
  if (page.kind === 'fixed') {
    bottom = page.transform.translateYMm + page.sourceSizePt.height * PT_MM * page.transform.scaleY;
  } else if (page.kind === 'scan') {
    for (const image of page.images) bottom = Math.max(bottom, image.rect.yMm + image.rect.heightMm);
  }
  if (page.footer !== null) bottom = Math.max(bottom, page.footer.rect.yMm + page.footer.rect.heightMm);
  const floor = page.content.yMm + Math.min(10, page.content.heightMm);
  return Math.min(page.heightMm, Math.max(floor, bottom + CONTINUOUS_PAD_MM));
}

export function pageAriaLabel(page: CanonicalPage, number: number, total: number, partLabel: string): string {
  const lead = `Page ${number} of ${total}: ${partLabel}`;
  if (page.kind === 'fixed') return `${lead}, fixed typeset layout`;
  return `${lead}, ${page.systemCount} system${page.systemCount === 1 ? '' : 's'}`;
}

export function blankNote(pages: readonly CanonicalPage[], i: number): string | null {
  const page = pages[i]!;
  const next = pages[i + 1];
  if (page.kind === 'fixed' || next === undefined || next.partId !== page.partId) return null;
  if (page.unusedFraction <= BLANK_NOTE_THRESHOLD) return null;
  return `The rest of page ${i + 1} is blank: the next system doesn't fit.`;
}

const pct = (value: number, of: number): string => `${(value / of) * 100}%`;

// ------------------------------------------------------------------ state ---
interface PreviewState {
  view: PreviewView;
  zoom: number;
  shown: LayoutResult | null;
  options: RenderOptions;
  /** Bumped by every draw; async fixed-page work compares it before touching the DOM. */
  generation: number;
  /** key -> blob URL of a drawn fixed page. */
  readonly blobs: Map<string, string>;
  readonly pending: Map<string, Promise<string | null>>;
  assets: AssetLoader | null;
}
const states = new WeakMap<HTMLElement, PreviewState>();

function stateOf(root: HTMLElement): PreviewState {
  let s = states.get(root);
  if (s === undefined) {
    s = { view: 'pages', zoom: DEFAULT_ZOOM, shown: null, options: {}, generation: 0, blobs: new Map(), pending: new Map(), assets: null };
    states.set(root, s);
  }
  return s;
}

function pagesHost(root: HTMLElement): HTMLElement {
  const host = root.querySelector<HTMLElement>('[data-cx-pages]');
  if (host === null) throw new Error('exportPagePreview: root has no [data-cx-pages]');
  return host;
}

function createFetchLoader(): AssetLoader {
  const cache = new Map<string, Promise<Uint8Array>>();
  return {
    bytes(url: string): Promise<Uint8Array> {
      let hit = cache.get(url);
      if (hit === undefined) {
        hit = fetch(url).then(async (response) => {
          if (!response.ok) throw new Error(`ASSET_MISSING: ${url}`);
          return new Uint8Array(await response.arrayBuffer());
        }).catch(() => { throw new Error(`ASSET_MISSING: ${url}`); });
        hit.catch(() => cache.delete(url));
        cache.set(url, hit);
      }
      return hit;
    },
  };
}

// ---------------------------------------------------------------- toolbar ---
function syncToolbar(root: HTMLElement, s: PreviewState): void {
  const output = root.querySelector<HTMLOutputElement>('[data-cx-zoom-value]');
  if (output !== null) output.textContent = `${s.zoom}%`;
  const out = root.querySelector<HTMLButtonElement>('[data-cx-zoom="out"]');
  const inn = root.querySelector<HTMLButtonElement>('[data-cx-zoom="in"]');
  if (out !== null) out.disabled = s.zoom <= ZOOM_STEPS[0]!;
  if (inn !== null) inn.disabled = s.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  for (const radio of root.querySelectorAll<HTMLInputElement>('input[data-cx-view]')) radio.checked = radio.value === s.view;
  root.dataset['view'] = s.view;
}

function setUpdating(root: HTMLElement, on: boolean): void {
  const indicator = root.querySelector<HTMLElement>('[data-cx-updating]');
  if (indicator !== null) indicator.hidden = !on;
  root.dataset['updating'] = on ? 'true' : 'false';
}

/** Wire the toolbar. Idempotent. Emits `cx-view-change` and `cx-zoom-change` (detail: the new value). */
export function initPreview(root: HTMLElement): void {
  if (root.dataset['cxWired'] === 'true') return;
  root.dataset['cxWired'] = 'true';
  const s = stateOf(root);
  syncToolbar(root, s);
  pagesHost(root).style.setProperty('--z', String(s.zoom / 100));
  root.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset['cxView'] !== undefined) {
      setView(root, target.value === 'continuous' ? 'continuous' : 'pages');
    }
  });
  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-cx-zoom]') : null;
    if (button === null || !root.contains(button)) return;
    const kind = button.dataset['cxZoom'];
    const s2 = stateOf(root);
    setZoom(root, kind === 'fit' ? DEFAULT_ZOOM : stepZoom(s2.zoom, kind === 'in' ? 1 : -1));
  });
}

// -------------------------------------------------------------- public API ---

/** Set the zoom (snapped to a step). Changes size only: nothing is rebuilt. Returns the applied step. */
export function setZoom(root: HTMLElement, percent: number): number {
  const s = stateOf(root);
  s.zoom = snapZoom(percent);
  pagesHost(root).style.setProperty('--z', String(s.zoom / 100));
  syncToolbar(root, s);
  root.dispatchEvent(new CustomEvent('cx-zoom-change', { detail: s.zoom }));
  return s.zoom;
}

export function setView(root: HTMLElement, view: PreviewView): void {
  const s = stateOf(root);
  if (s.view === view) { syncToolbar(root, s); return; }
  s.view = view;
  syncToolbar(root, s);
  draw(root, s);
  root.dispatchEvent(new CustomEvent('cx-view-change', { detail: view }));
}

export function getView(root: HTMLElement): PreviewView { return stateOf(root).view; }
export function getZoom(root: HTMLElement): number { return stateOf(root).zoom; }

/**
 * Draw `result` (or `opts.previous` when `result` is null, the "updating" state). Pages stay at
 * full opacity: there is no dimming. Does not mutate the result.
 */
export function renderPreview(root: HTMLElement, result: LayoutResult | null, opts: RenderOptions = {}): void {
  const s = stateOf(root);
  initPreview(root);
  s.options = opts;
  s.shown = result ?? opts.previous ?? null;
  if (opts.view !== undefined) s.view = opts.view;
  if (opts.assets !== undefined) s.assets = opts.assets;
  if (opts.zoom !== undefined) s.zoom = snapZoom(opts.zoom);
  pagesHost(root).style.setProperty('--z', String(s.zoom / 100));
  syncToolbar(root, s);
  setUpdating(root, opts.updating === true);
  draw(root, s);
}

/** Revoke every blob URL and forget the state. Call when the preview is closed or removed. */
export function destroyPreview(root: HTMLElement): void {
  const s = states.get(root);
  if (s === undefined) return;
  s.generation += 1;
  for (const url of s.blobs.values()) URL.revokeObjectURL(url);
  s.blobs.clear();
  s.pending.clear();
  pagesHost(root).replaceChildren();
  states.delete(root);
}

// ------------------------------------------------------------------ drawing ---
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function draw(root: HTMLElement, s: PreviewState): void {
  const host = pagesHost(root);
  s.generation += 1;
  const generation = s.generation;
  const result = s.shown;
  const continuous = s.view === 'continuous';
  const wanted = new Set<string>();
  const fixedJobs: { page: FixedCanonicalPage; key: string; slot: HTMLElement }[] = [];
  const children: HTMLElement[] = [];

  if (result !== null) {
    if (continuous) {
      const notice = el('div', 'notice');
      notice.append(el('p', undefined, READING_NOTICE));
      notice.style.margin = '0';
      children.push(notice);
    }
    const pages = result.pages;
    pages.forEach((page, i) => {
      const previous = pages[i - 1];
      const firstOfPart = previous === undefined || previous.partId !== page.partId;
      const wrap = el('div', continuous ? 'cx-pg cont' : 'cx-pg');
      wrap.dataset['page'] = String(i + 1);
      wrap.dataset['part'] = page.partId;
      wrap.dataset['kind'] = page.kind;
      const partLabel = partLabelOf(page, s.options.partLabels);

      if (continuous) {
        if (i > 0) {
          const sep = el('div', 'cx-div small muted');
          sep.append(el('span', undefined, `Page ${i + 1} begins`));
          wrap.append(sep);
        }
      } else {
        const row = el('div', 'cx-plabel small muted');
        const left = el('span', undefined, `Page ${i + 1} of ${pages.length} · ${pageDescription(page)}`);
        if (page.kind === 'fixed' && firstOfPart) left.append(el('span', 'sub', 'Fixed typeset layout'));
        row.append(left, el('span', undefined, firstOfPart ? partLabel : ''));
        wrap.append(row);
        const note = blankNote(pages, i);
        if (note !== null) {
          const p = el('p', 'cx-blank small muted', note);
          p.dataset['cxBlank'] = 'true';
          wrap.append(p);
        }
      }

      const box = el('div', 'cx-pagebox');
      const bottomMm = continuous ? usedBottomMm(page) : page.heightMm;
      const frame = el('div', 'cx-page');
      frame.setAttribute('role', 'img');
      frame.setAttribute('aria-label', pageAriaLabel(page, i + 1, pages.length, partLabel));
      frame.style.aspectRatio = `${page.widthMm} / ${bottomMm}`;
      frame.dataset['widthMm'] = String(page.widthMm);
      frame.dataset['heightMm'] = String(page.heightMm);

      // The sheet is always the full page; Continuous only crops the frame around it.
      const sheet = el('div', 'cx-sheet');
      sheet.setAttribute('aria-hidden', 'true');
      sheet.style.height = pct(page.heightMm, bottomMm);

      if (page.kind === 'mei') drawMei(sheet, page);
      else if (page.kind === 'scan') drawScan(sheet, page, partLabel);
      else {
        const key = fixedKey(page);
        wanted.add(key);
        const slot = el('div', 'cx-fixed');
        slot.dataset['cxFixedKey'] = key;
        slot.style.left = pct(page.transform.translateXMm, page.widthMm);
        slot.style.top = pct(page.transform.translateYMm, page.heightMm);
        slot.style.width = pct(page.sourceSizePt.width * PT_MM * page.transform.scaleX, page.widthMm);
        slot.style.height = pct(page.sourceSizePt.height * PT_MM * page.transform.scaleY, page.heightMm);
        sheet.append(slot);
        fixedJobs.push({ page, key, slot });
      }
      drawTextBlocks(sheet, page);
      if (!continuous) sheet.append(guide(page));
      frame.append(sheet);
      box.append(frame);
      wrap.append(box);
      children.push(wrap);
    });
  }
  host.replaceChildren(...children);

  // Revoke blob URLs of fixed pages that are no longer shown.
  for (const [key, url] of s.blobs) {
    if (!wanted.has(key)) { URL.revokeObjectURL(url); s.blobs.delete(key); }
  }
  for (const key of s.pending.keys()) if (!wanted.has(key)) s.pending.delete(key);

  for (const job of fixedJobs) void paintFixed(root, s, generation, job.page, job.key, job.slot, host);
}

function guide(page: CanonicalPage): HTMLElement {
  const g = el('div', 'cx-guide');
  g.setAttribute('aria-hidden', 'true');
  g.dataset['cxGuide'] = 'true';
  const { printable } = page;
  g.style.left = pct(printable.xMm, page.widthMm);
  g.style.top = pct(printable.yMm, page.heightMm);
  g.style.width = pct(printable.widthMm, page.widthMm);
  g.style.height = pct(printable.heightMm, page.heightMm);
  return g;
}

/** The single entry point for generated SVG. `svg` must be a `CanonicalPage.svg.svg` string. */
function insertPageSvg(host: HTMLElement, svg: string): SVGSVGElement | null {
  host.innerHTML = svg;
  return host.querySelector('svg');
}

function svgSizeMm(svg: SVGSVGElement): { widthMm: number; heightMm: number } | null {
  const mm = (value: string | null): number | null => {
    const m = value === null ? null : /^\s*([0-9]*\.?[0-9]+)\s*mm\s*$/.exec(value);
    return m === null ? null : Number(m[1]);
  };
  const box = (node: Element | null): [number, number] | null => {
    const parts = node?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number) ?? [];
    return parts.length === 4 && parts.every(Number.isFinite) && parts[2]! > 0 && parts[3]! > 0 ? [parts[2]!, parts[3]!] : null;
  };
  const w = mm(svg.getAttribute('width'));
  const h = mm(svg.getAttribute('height'));
  if (w !== null && h !== null) return { widthMm: w, heightMm: h };
  const inner = svg.querySelector('svg.definition-scale');
  const innerBox = box(inner);
  if (innerBox !== null) return { widthMm: innerBox[0] / 100, heightMm: innerBox[1] / 100 };
  const outer = box(svg);
  return outer === null ? null : { widthMm: outer[0] / 10, heightMm: outer[1] / 10 };
}

function drawMei(sheet: HTMLElement, page: MeiCanonicalPage): void {
  const holder = el('div', 'cx-svg');
  holder.setAttribute('aria-hidden', 'true');
  const root = insertPageSvg(holder, page.svg.svg);
  const size = root === null ? null : svgSizeMm(root);
  const p = page.svgPlacement;
  holder.style.left = pct(p.translateXMm, page.widthMm);
  holder.style.top = pct(p.translateYMm, page.heightMm);
  holder.style.width = pct((size?.widthMm ?? page.widthMm) * p.scaleX, page.widthMm);
  holder.style.height = pct((size?.heightMm ?? page.heightMm) * p.scaleY, page.heightMm);
  sheet.append(holder);
}

function drawScan(sheet: HTMLElement, page: ScanCanonicalPage, partLabel: string): void {
  page.images.forEach((image, k) => {
    const img = el('img', 'cx-scanimg');
    img.src = `${image.stem}@2x.png`;
    img.alt = `Original scan of ${partLabel}, system ${k + 1} of ${page.images.length} on this page`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.style.left = pct(image.rect.xMm, page.widthMm);
    img.style.top = pct(image.rect.yMm, page.heightMm);
    img.style.width = pct(image.rect.widthMm, page.widthMm);
    img.style.height = pct(image.rect.heightMm, page.heightMm);
    sheet.append(img);
  });
}

/** Heading and credit lines, set in the same bundled Liberation Serif faces the PDF embeds. */
function drawTextBlocks(sheet: HTMLElement, page: CanonicalPage): void {
  const blocks = [page.heading, page.footer].filter((b): b is NonNullable<typeof b> => b !== null);
  if (blocks.length === 0) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'cx-text');
  svg.setAttribute('viewBox', `0 0 ${page.widthMm} ${page.heightMm}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const block of blocks) {
    for (const line of block.lines) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(block.rect.xMm));
      text.setAttribute('y', String(line.baselineMm));
      text.setAttribute('font-size', String(line.sizePt * PT_MM));
      text.setAttribute('class', `cx-line cx-line-${line.role}`);
      text.textContent = line.text;
      svg.append(text);
    }
  }
  sheet.append(svg);
}

// -------------------------------------------------------------- fixed pages ---
function fixedKey(page: FixedCanonicalPage): string {
  const t = page.transform;
  return `${page.sourceUrl}#${page.sourcePageIndex}|${page.widthMm}x${page.heightMm}|${t.scaleX},${t.translateXMm},${t.translateYMm}`;
}

function showFixedImage(slot: HTMLElement, url: string): void {
  const img = el('img');
  img.src = url;
  img.alt = 'Typeset page, fixed layout';
  img.draggable = false;
  slot.dataset['state'] = 'ready';
  slot.replaceChildren(img);
}

async function paintFixed(
  root: HTMLElement, s: PreviewState, generation: number,
  page: FixedCanonicalPage, key: string, slot: HTMLElement, host: HTMLElement,
): Promise<void> {
  const cached = s.blobs.get(key);
  if (cached !== undefined) { showFixedImage(slot, cached); return; }
  slot.dataset['state'] = 'loading';
  let job = s.pending.get(key);
  if (job === undefined) {
    job = makeFixedBlob(s, page, host);
    s.pending.set(key, job);
  }
  let url: string | null;
  try {
    url = await job;
  } catch (e) {
    if (generation === s.generation) {
      slot.dataset['state'] = 'error';
      const message = e instanceof Error ? e.message : String(e);
      root.dispatchEvent(new CustomEvent('cx-preview-error', {
        detail: { code: /^[A-Z_]+/.exec(message)?.[0] ?? 'PREVIEW_FAILED', partId: page.partId, message },
      }));
    }
    s.pending.delete(key);
    return;
  }
  s.pending.delete(key);
  if (url === null) return;
  // Removed or replaced while drawing: drop the blob. A newer draw that still wants it paints it.
  if (states.get(root) !== s || !isWanted(s, key)) { URL.revokeObjectURL(url); return; }
  s.blobs.set(key, url);
  for (const live of host.querySelectorAll<HTMLElement>('[data-cx-fixed-key]')) {
    if (live.dataset['cxFixedKey'] === key && live.dataset['state'] !== 'ready') showFixedImage(live, url);
  }
}

/** A key is wanted when some page currently shown (in `s.shown`) produces it. */
function isWanted(s: PreviewState, key: string): boolean {
  return s.shown?.pages.some((p) => p.kind === 'fixed' && fixedKey(p) === key) === true;
}

async function makeFixedBlob(s: PreviewState, page: FixedCanonicalPage, host: HTMLElement): Promise<string | null> {
  const { previewFixedPage } = await import('../lib/export-layout/fixedPreview');
  s.assets ??= createFetchLoader();
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const widthPx = host.getBoundingClientRect().width || 800;
  const pixelsPerMm = Math.max(2, (widthPx * dpr * 1.5) / page.widthMm);
  const bitmap = await previewFixedPage(page, s.assets, { pixelsPerMm });
  return URL.createObjectURL(bitmap.blob);
}
