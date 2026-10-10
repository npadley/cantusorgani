// Break editing (UI spec 4): the overlay of break-point handles and the action panel.
//
// Everything here lives in the preview DOM only. The overlay is a sibling of each page's
// aria-hidden sheet (handles must be focusable), and nothing is ever written into a
// CanonicalPage or its SVG: the layout result is read, never changed. Handles are positioned
// from the result (system starts, in mm) or from the drawn measure's box (inside a system),
// expressed as fractions of the page frame so zoom needs no rebuild.

import type { ControllerState, ExportPart, MeiExportPart, SafeBoundary } from '../lib/export-layout/types';
import { captionOf, glyphOf, handleLabel, kindOf, menuModel, navigate, statusAfter, thin } from './exportBreaks';
import type { BreakKind, NavKey } from './exportBreaks';

export interface BreakHost {
  readonly preview: HTMLElement;
  state(): ControllerState | null;
  parts(): readonly ExportPart[];
  partLabel(id: string): string;
  view(): 'pages' | 'continuous';
  setBreak(partId: string, boundaryId: string, sourceRevision: string, kind: 'system' | 'page' | 'remove'): void;
  say(text: string): void;
  armUndo(): void;
  /** Esc on a handle: the Settings button below 62rem, else the mode button. */
  leaveOverlay(): void;
  /** Footer height in px, so the narrow action panel sits above it. */
  footerHeight(): number;
}

interface Handle {
  readonly boundary: SafeBoundary;
  readonly index: number;
  readonly total: number;
  readonly part: MeiExportPart;
  readonly page: number;
  readonly kind: BreakKind;
  readonly xFrac: number;
  readonly yFrac: number;
  readonly hFrac: number;
  readonly sysStart: boolean;
  el: HTMLButtonElement;
  line: HTMLElement;
  overlay: HTMLElement;
  visible: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls !== undefined) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const pct = (f: number): string => `${f * 100}%`;
const isNav = (k: string): k is NavKey => k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End';

export class BreakEditor {
  private mode = false;
  private handles: Handle[] = [];
  private currentId: string | null = null;
  private menuId: string | null = null;
  private pendingFocus: string | null = null;
  private readonly resize: ResizeObserver | null;

  constructor(private readonly host: BreakHost) {
    const p = host.preview;
    p.addEventListener('click', this.onClick);
    p.addEventListener('keydown', this.onKeydown);
    p.addEventListener('focusin', this.onFocusIn);
    p.addEventListener('cx-zoom-change', this.onZoom);
    const pages = p.querySelector('[data-cx-pages]');
    this.resize = typeof ResizeObserver === 'undefined' || pages === null ? null : new ResizeObserver(() => this.applyThinning());
    if (pages !== null) this.resize?.observe(pages);
  }

  get active(): boolean { return this.mode; }

  destroy(): void {
    const p = this.host.preview;
    p.removeEventListener('click', this.onClick);
    p.removeEventListener('keydown', this.onKeydown);
    p.removeEventListener('focusin', this.onFocusIn);
    p.removeEventListener('cx-zoom-change', this.onZoom);
    this.resize?.disconnect();
    this.clear();
    this.mode = false;
  }

  /** Turn the mode on or off. Returns the first handle's focus target availability. */
  setMode(on: boolean): void {
    this.mode = on;
    this.menuId = null;
    this.refresh();
  }

  /** Rebuild the overlay from the shown result. Called after every preview draw. */
  refresh(): void {
    this.clear();
    const state = this.host.state();
    if (!this.mode || state === null || this.host.view() !== 'pages') return;
    const result = state.result ?? state.previousResult;
    if (result === null) return;
    const pagesHost = this.host.preview.querySelector<HTMLElement>('[data-cx-pages]');
    if (pagesHost === null) return;
    const overlays = new Map<number, HTMLElement>();
    const overlayFor = (pageIndex: number): HTMLElement | null => {
      let o = overlays.get(pageIndex);
      if (o === undefined) {
        const box = pagesHost.querySelector<HTMLElement>(`.cx-pg[data-page="${pageIndex + 1}"] .cx-pagebox`);
        if (box === null) return null;
        o = el('div', 'cx-overlay');
        o.setAttribute('role', 'group');
        o.setAttribute('aria-label', `Break points, page ${pageIndex + 1}`);
        box.append(o);
        overlays.set(pageIndex, o);
      }
      return o;
    };

    const out: Handle[] = [];
    for (const part of this.host.parts()) {
      if (part.kind !== 'mei' || !part.conversion.capabilities.manualBreaks) continue;
      const effective = new Map((result.effectiveBreaks.find((e) => e.partId === part.id)?.breaks ?? []).map((b) => [b.boundaryId, b] as const));
      const starts = new Map<string, { page: number; x: number; y: number; h: number }>();
      result.pages.forEach((p, i) => {
        if (p.kind !== 'mei' || p.partId !== part.id) return;
        for (const b of p.boundaries) starts.set(b.boundaryId, { page: i, x: b.rect.xMm / p.widthMm, y: b.rect.yMm / p.heightMm, h: b.rect.heightMm / p.heightMm });
      });
      const total = part.conversion.boundaries.length;
      part.conversion.boundaries.forEach((boundary, index) => {
        let page = -1;
        let xFrac = 0;
        let yFrac = 0;
        let hFrac = 0;
        const start = starts.get(boundary.id);
        if (start !== undefined) {
          ({ page, x: xFrac, y: yFrac, h: hFrac } = start);
        } else {
          for (let i = 0; i < result.pages.length && page < 0; i++) {
            const p = result.pages[i]!;
            if (p.kind !== 'mei' || p.partId !== part.id) continue;
            const wrap = pagesHost.querySelector<HTMLElement>(`.cx-pg[data-page="${i + 1}"]`);
            const frame = wrap?.querySelector<HTMLElement>('.cx-page');
            const measure = wrap?.querySelector<Element>(`.cx-svg [id="${p.svg.namespace}-${boundary.measureId}"]`);
            if (frame == null || measure == null) continue;
            const f = frame.getBoundingClientRect();
            const m = measure.getBoundingClientRect();
            if (f.width === 0 || f.height === 0) continue;
            // The staves' own lines give the system's top and bottom (notes and lyrics would make every handle differ).
            const staves = [...measure.querySelectorAll(':scope > g.staff')];
            const lines = (s: Element | undefined): DOMRect[] => [...(s?.querySelectorAll(':scope > path') ?? [])].map((l) => l.getBoundingClientRect());
            const top = lines(staves[0]).map((r) => r.top);
            const bottom = lines(staves[staves.length - 1]).map((r) => r.bottom);
            const topPx = top.length > 0 ? Math.min(...top) : m.top;
            const bottomPx = bottom.length > 0 ? Math.max(...bottom) : m.bottom;
            page = i;
            xFrac = (m.right - f.left) / f.width;
            yFrac = (topPx - f.top) / f.height;
            hFrac = (bottomPx - topPx) / f.height;
          }
        }
        if (page < 0) return;
        const overlay = overlayFor(page);
        if (overlay === null) return;
        const kind = kindOf(effective.get(boundary.id));
        const handle: Handle = {
          boundary, index, total, part, page: page + 1, kind, xFrac, yFrac, hFrac, sysStart: start !== undefined,
          el: el('button', 'cx-bp'), line: el('div', 'cx-bpline'), overlay, visible: true,
        };
        this.build(handle);
        out.push(handle);
      });
    }
    this.handles = out;
    this.applyThinning();
    if (this.pendingFocus !== null && state.result !== null) {
      const id = this.pendingFocus;
      this.pendingFocus = null;
      this.focusHandle(id, false);
    }
    if (this.menuId !== null) this.openMenu(this.menuId, false);
  }

  /** Focus the first visible handle (used when the mode is turned on). */
  focusFirst(): void {
    const first = this.handles.find((h) => h.visible);
    if (first !== undefined) this.focusHandle(first.boundary.id, true);
  }

  /** After the next fresh result, put focus on this boundary's handle. */
  focusAfterUpdate(boundaryId: string): void { this.pendingFocus = boundaryId; }

  // ------------------------------------------------------------------ build ---
  private clear(): void {
    for (const o of this.host.preview.querySelectorAll('.cx-overlay')) o.remove();
    this.handles = [];
  }

  private build(h: Handle): void {
    const { el: b, line } = h;
    b.type = 'button';
    b.dataset['boundary'] = h.boundary.id;
    b.dataset['kind'] = h.kind;
    b.tabIndex = -1;
    b.setAttribute('aria-label', handleLabel({ index: h.index, total: h.total, part: this.host.partLabel(h.part.id), afterText: h.boundary.afterText, page: h.page, kind: h.kind }));
    b.setAttribute('aria-haspopup', 'true');
    b.style.left = pct(h.xFrac);
    b.style.top = pct(h.yFrac);
    if (h.sysStart) b.style.marginLeft = '22px'; // system-start handles sit just inside the line's left edge
    const box = el('span', 'box', glyphOf(h.kind));
    box.setAttribute('aria-hidden', 'true');
    const cap = el('span', 'cx-bplab', captionOf(h.boundary.afterText));
    cap.setAttribute('aria-hidden', 'true');
    b.append(box, cap);
    line.setAttribute('aria-hidden', 'true');
    line.style.left = pct(h.xFrac);
    line.style.top = pct(h.yFrac);
    line.style.height = pct(h.hFrac);
    h.overlay.append(line, b);
  }

  /** Hide handles closer than 44 CSS px; hit areas are never shrunk. */
  private applyThinning(): void {
    if (this.handles.length === 0) return;
    const centers = this.handles.map((h) => {
      const r = h.overlay.getBoundingClientRect();
      return { row: `${h.page}:${Math.round(h.yFrac * r.height / 8)}`, x: h.xFrac * r.width + (h.sysStart ? 22 : 0) };
    });
    const flags = thin(centers);
    this.handles.forEach((h, i) => {
      const forced = h.boundary.id === this.currentId || h.boundary.id === this.menuId;
      h.visible = flags[i]! || forced;
      h.el.hidden = !h.visible;
      h.line.hidden = !h.visible;
    });
    this.setTabStops();
  }

  /** One tab stop per page section: the current handle if it is there, else the first visible one. */
  private setTabStops(): void {
    const byOverlay = new Map<HTMLElement, Handle[]>();
    for (const h of this.handles) byOverlay.set(h.overlay, [...(byOverlay.get(h.overlay) ?? []), h]);
    for (const list of byOverlay.values()) {
      const visible = list.filter((h) => h.visible);
      const stop = visible.find((h) => h.boundary.id === this.currentId) ?? visible[0];
      for (const h of list) h.el.tabIndex = h === stop ? 0 : -1;
    }
  }

  private handleFor(id: string): Handle | undefined { return this.handles.find((h) => h.boundary.id === id); }

  private focusHandle(id: string, scroll: boolean): void {
    const h = this.handleFor(id);
    if (h === undefined) return;
    this.currentId = id;
    h.visible = true;
    h.el.hidden = false;
    h.line.hidden = false;
    this.setTabStops();
    h.el.focus({ preventScroll: !scroll });
    if (scroll) h.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // ------------------------------------------------------------------- menu ---
  private closeMenu(refocus: boolean): void {
    const id = this.menuId;
    this.menuId = null;
    for (const m of this.host.preview.querySelectorAll('.cx-menu')) m.remove();
    if (refocus && id !== null) this.focusHandle(id, false);
  }

  private openMenu(id: string, focus: boolean): void {
    const h = this.handleFor(id);
    if (h === undefined) return;
    for (const m of this.host.preview.querySelectorAll('.cx-menu')) m.remove();
    this.menuId = id;
    this.currentId = id;
    const model = menuModel({ index: h.index, total: h.total, afterText: h.boundary.afterText, kind: h.kind });
    const menu = el('div', 'cx-menu');
    menu.id = 'cx-menu';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-labelledby', 'cx-menu-title');
    menu.dataset['boundary'] = id;
    menu.style.left = pct(h.xFrac);
    menu.style.top = pct(h.yFrac);
    menu.style.bottom = `${this.host.footerHeight()}px`; // only used by the narrow, fixed layout
    const title = el('p', 'cx-menu-title');
    title.id = 'cx-menu-title';
    const strong = el('strong', undefined, model.title);
    title.append(strong);
    const nav = el('div', 'cx-menu-nav');
    const prev = el('button', undefined, '◀ Previous');
    prev.type = 'button';
    prev.dataset['m'] = 'prev';
    prev.disabled = h.index === 0;
    const next = el('button', undefined, 'Next ▶');
    next.type = 'button';
    next.dataset['m'] = 'next';
    next.disabled = h.index === h.total - 1;
    nav.append(prev, next);
    const now = el('p', 'small', model.now);
    menu.append(title, nav, now);
    const action = (key: string, label: string, disabled: boolean): HTMLButtonElement => {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.dataset['m'] = key;
      b.disabled = disabled;
      return b;
    };
    if (model.originalNote !== null) menu.append(el('p', 'small muted', model.originalNote));
    else if (model.system !== null) menu.append(action('system', model.system.label, model.system.disabled));
    menu.append(action('page', model.page.label, model.page.disabled));
    if (model.remove) menu.append(action('remove', 'Remove my break', false));
    const cancel = action('cancel', 'Cancel', false);
    cancel.className = 'link';
    menu.append(cancel);
    h.overlay.append(menu);
    this.clampMenu(menu, h.overlay);
    if (focus) (menu.querySelector<HTMLButtonElement>('[data-m=system]:not(:disabled), [data-m=page]:not(:disabled)') ?? menu.querySelector<HTMLButtonElement>('[data-m=remove], [data-m=cancel]'))?.focus();
  }

  private clampMenu(menu: HTMLElement, overlay: HTMLElement): void {
    if (matchMedia('(max-width: 39.99rem)').matches) return;
    const width = overlay.getBoundingClientRect().width;
    const half = menu.offsetWidth / 2;
    if (menu.offsetLeft - half < 0) menu.style.left = `${half}px`;
    else if (menu.offsetLeft + half > width) menu.style.left = `${width - half}px`;
  }

  // ---------------------------------------------------------------- events ---
  private readonly onZoom = (): void => this.applyThinning();

  private readonly onFocusIn = (e: Event): void => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('.cx-bp') : null;
    if (t?.dataset['boundary'] !== undefined) { this.currentId = t.dataset['boundary']; this.setTabStops(); }
  };

  private readonly onClick = (e: Event): void => {
    const t = e.target instanceof Element ? e.target : null;
    const menuBtn = t?.closest<HTMLButtonElement>('.cx-menu button');
    if (menuBtn !== null && menuBtn !== undefined) { this.onMenuAction(menuBtn); return; }
    const handle = t?.closest<HTMLButtonElement>('.cx-bp') ?? null;
    if (handle?.dataset['boundary'] !== undefined) {
      const id = handle.dataset['boundary'];
      if (this.menuId === id) this.closeMenu(true);
      else this.openMenu(id, true);
    }
  };

  private onMenuAction(btn: HTMLButtonElement): void {
    const id = this.menuId;
    const h = id === null ? undefined : this.handleFor(id);
    if (id === null || h === undefined) return;
    const key = btn.dataset['m'];
    if (key === 'cancel') { this.closeMenu(true); return; }
    if (key === 'prev' || key === 'next') {
      const to = this.handles[this.handles.indexOf(h) + (key === 'next' ? 1 : -1)];
      if (to !== undefined) { this.currentId = to.boundary.id; this.menuId = to.boundary.id; this.applyThinning(); this.focusHandle(to.boundary.id, true); this.openMenu(to.boundary.id, true); }
      return;
    }
    if (key === 'system' || key === 'page' || key === 'remove') {
      this.closeMenu(false);
      this.pendingFocus = id;
      this.focusHandle(id, false);
      this.host.setBreak(h.part.id, id, h.part.conversion.sourceRevision, key);
      this.host.say(statusAfter(key, h.boundary.afterText));
      this.host.armUndo();
    }
  }

  private readonly onKeydown = (e: Event): void => {
    const k = e as KeyboardEvent;
    const t = k.target instanceof Element ? k.target : null;
    if (t === null) return;
    const inMenu = t.closest('.cx-menu') !== null;
    if (k.key === 'Escape' && (inMenu || t.closest('.cx-bp') !== null)) {
      k.preventDefault(); // keep the dialog open: Esc only steps out of the overlay
      k.stopPropagation();
      if (this.menuId !== null) this.closeMenu(true);
      else this.host.leaveOverlay();
      return;
    }
    const handle = t.closest<HTMLButtonElement>('.cx-bp');
    if (handle?.dataset['boundary'] === undefined || inMenu) return;
    const visible = this.handles.filter((h) => h.visible);
    const here = visible.findIndex((h) => h.boundary.id === handle.dataset['boundary']);
    if (isNav(k.key)) {
      k.preventDefault();
      const to = visible[navigate(here, k.key, visible.length)];
      if (to !== undefined) { if (this.menuId !== null) this.closeMenu(false); this.focusHandle(to.boundary.id, true); }
    }
    // Enter and Space activate the focused <button>: its click opens the action panel.
  };
}
