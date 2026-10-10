// The export layout editor (UI spec 1-6): wires the dialog markup from ExportLayoutEditor.astro to
// createExportController and the preview.
//
// ExportBar (B9) lazy-imports this module on "Customize export" and calls openExportEditor. The
// dialog is cloned from the page's inert <template data-cx-template> on the first open only.
//
// Visitor-facing text comes from exportLayoutCopy.ts or from literals here. `LayoutDiagnostic.detail`
// is never read by any code in this file: it cannot reach the DOM.

import { createExportController } from '../lib/export-layout/controller';
import { parseResourceProfile } from '../lib/export-layout/limits';
import { capabilitiesFor } from '../lib/export-layout/capabilities';
import { paperDimensions } from '../lib/export-layout/settings';
import { PAGE_PRESETS, MARGIN_MAX_MM, MARGIN_MIN_MM, MAX_SYSTEMS_LIMIT, PAGE_MAX_MM, PAGE_MAX_RATIO, PAGE_MIN_MM, PRINT_MARGIN_ADVISORY_MM } from '../lib/export-layout/types';
import type {
  ControllerDependencies,
  ControllerState,
  ExportController,
  ExportPart,
  LayoutDiagnostic,
  LayoutSettings,
  PagePresetId,
  StorageLike,
} from '../lib/export-layout/types';
import profileJson from '../../../data/typeset/mei/resource-profile.json';
import { destroyPreview, getView, initPreview, renderPreview, setView } from './exportPagePreview';
import { BreakEditor } from './exportBreakEditor';
import { ACTION_LABEL, CUSTOM_ERRORS, MM_PER_IN, PRINTER_ADVISORY, copyFor, isGlobalDiagnostic, paperName, smallerStaff } from './exportLayoutCopy';
import type { ActionId, CopyContext } from './exportLayoutCopy';

export interface OpenExportEditorOptions {
  readonly parts: readonly ExportPart[];
  /** "Missa IX · Kyrie": shown under the heading and used in the download filename. */
  readonly title: string;
  /** Receives focus when the dialog closes (#export-customize). */
  readonly opener: HTMLElement | null;
  /** Dependency overrides (tests, the e2e fault injector). */
  readonly deps?: Partial<ControllerDependencies>;
}
export interface EditorHandle {
  readonly controller: ExportController;
  readonly dialog: HTMLDialogElement;
  close(): void;
}

const HASH = '#customize-export';
const WIDE_QUERY = '(min-width: 62rem)';
const UPDATING_DELAY_MS = 300;
const ANNOUNCE_GAP_MS = 2000;
const UNDO_VISIBLE_MS = 30_000;
const SLOW_NOTE_MS = 8000;
const MM_PRECISION = 10;

/** The URL fragment is only ever set while the editor is open; strip a stale one on load without opening. */
export function stripCustomizeHash(): void {
  if (location.hash === HASH) history.replaceState(history.state, '', location.pathname + location.search);
}
stripCustomizeHash();

// ----------------------------------------------------------------- helpers ---
function safeStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__cx_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function saveBlob(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const pageWord = (n: number): string => `${n} page${n === 1 ? '' : 's'}`;
const round1 = (n: number): number => Math.round(n * MM_PRECISION) / MM_PRECISION;
const kindOf = (page: PagePresetId): 'print' | 'ipad' | 'custom' => (page === 'custom' ? 'custom' : PAGE_PRESETS[page].kind === 'print' ? 'print' : 'ipad');
const PAPER_LADDER: Readonly<Record<'print' | 'ipad', readonly PagePresetId[]>> = {
  print: ['a5', 'a4', 'letter'],
  ipad: ['ipad-mini', 'ipad-11', 'ipad-13'],
};

// ------------------------------------------------------------------ module ---
let dialog: HTMLDialogElement | null = null;
let active: Session | null = null;

function ensureDialog(): HTMLDialogElement {
  if (dialog !== null) return dialog;
  const template = document.querySelector<HTMLTemplateElement>('template[data-cx-template]');
  const fragment = template?.content.cloneNode(true) as DocumentFragment | undefined;
  const found = fragment?.querySelector('dialog') ?? null;
  if (fragment === undefined || found === null) throw new Error('exportLayout: the page has no <template data-cx-template> (render ExportLayoutEditor.astro)');
  document.body.append(fragment);
  dialog = found;
  return dialog;
}

export function openExportEditor(options: OpenExportEditorOptions): EditorHandle {
  if (active !== null) return active.handle;
  const session = new Session(ensureDialog(), options);
  active = session;
  session.start();
  return session.handle;
}

class Session {
  readonly handle: EditorHandle;
  private readonly controller: ExportController;
  private readonly parts: readonly ExportPart[];
  private readonly partLabels: Record<string, string> = {};
  private readonly wide = window.matchMedia(WIDE_QUERY);
  private readonly preview: HTMLElement;
  private readonly extras: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly wait: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  private state: ControllerState | null = null;
  private unit: 'mm' | 'in' = 'mm';
  private lastPrint: PagePresetId = 'letter';
  private lastIpad: PagePresetId = 'ipad-11';
  private customInvalid = false;
  private naturalMax: number | null = null;
  private undoShown = false;
  private undoTimer: number | null = null;
  private updatingTimer: number | null = null;
  private slowTimer: number | null = null;
  private updating = false;
  private slow = false;
  private pushed = false;
  private suppressPop = false;
  private closing = false;
  private lastAnnounceAt = 0;
  private pendingAnnounce: string | null = null;
  private announceTimer: number | null = null;
  private lastNoticeKey = '';
  private lastShown: unknown = null;
  private lastUpdatingFlag = false;
  private dismissedStale = new Set<string>();
  private savedBytes: number | null = null;
  private hasShownResult = false;
  private moreChecked = false;
  /** A break action's own sentence is the announcement; the "Preview updated" that follows would overwrite it. */
  private holdUpdated = false;
  private breakEditor!: BreakEditor;
  private announcedFirst = false;
  private afterClose: (() => void) | null = null;
  private readonly listeners: { target: EventTarget; type: string; fn: EventListener }[] = [];

  constructor(private readonly dlg: HTMLDialogElement, private readonly options: OpenExportEditorOptions) {
    this.parts = options.parts;
    for (const p of options.parts) this.partLabels[p.id] = p.label;
    const profile = parseResourceProfile(profileJson);
    const deps: ControllerDependencies = {
      // The literal `new Worker(new URL(..., import.meta.url), ...)` form is what lets the bundler emit the worker.
      createLayoutWorker: () => new Worker(new URL('../workers/export-layout.worker.ts', import.meta.url), { type: 'module' }),
      createPdfWorker: () => new Worker(new URL('../workers/export-layout-pdf.worker.ts', import.meta.url), { type: 'module' }),
      storage: safeStorage(),
      now: () => Date.now(),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      saveFile: (bytes, filename) => { this.savedBytes = bytes.byteLength; saveBlob(bytes, filename); },
      limits: profile.limits,
      profile,
      ...options.deps,
    };
    this.controller = createExportController(deps);
    const root = dlg.querySelector<HTMLElement>('[data-cx-preview]');
    const pages = root?.querySelector<HTMLElement>('[data-cx-pages]') ?? null;
    if (root === null || pages === null) throw new Error('exportLayout: dialog has no preview');
    this.preview = root;
    this.extras = this.preview.querySelector<HTMLElement>('[data-cx-extras]') ?? (() => {
      const e = document.createElement('div');
      e.className = 'cx-extras';
      e.dataset['cxExtras'] = 'true';
      pages.before(e);
      return e;
    })();
    this.notices = this.extras.querySelector<HTMLElement>('.cx-notices') ?? (() => {
      const n = document.createElement('div');
      n.className = 'cx-notices';
      this.extras.append(n);
      return n;
    })();
    this.wait = this.extras.querySelector<HTMLElement>('.cx-wait') ?? (() => {
      const w = document.createElement('div');
      w.className = 'cx-wait';
      w.hidden = true;
      this.extras.append(w);
      return w;
    })();
    this.breakEditor = new BreakEditor({
      preview: this.preview,
      state: () => this.state,
      parts: () => this.parts,
      partLabel: (id) => this.partLabels[id] ?? 'this part',
      view: () => getView(this.preview),
      setBreak: (partId, boundaryId, sourceRevision, kind) => {
        this.controller.setBreak(partId, kind === 'remove' ? { boundaryId, kind } : { boundaryId, sourceRevision, kind });
      },
      say: (text) => { this.holdUpdated = true; this.say(text, true); },
      armUndo: () => this.armUndo(),
      leaveOverlay: () => {
        if (!this.wide.matches) this.q('settings-btn').focus();
        else this.q('break-mode').focus();
      },
      footerHeight: () => this.dlg.querySelector<HTMLElement>('.cx-foot')?.offsetHeight ?? 0,
    });
    this.handle = { controller: this.controller, dialog: dlg, close: () => this.requestClose() };
  }

  // ---------------------------------------------------------------- query ---
  private q<T extends HTMLElement = HTMLElement>(name: string): T {
    const node = this.dlg.querySelector<T>(`[data-cx="${name}"]`);
    if (node === null) throw new Error(`exportLayout: missing [data-cx="${name}"]`);
    return node;
  }
  private radios(name: string): HTMLInputElement[] {
    return [...this.dlg.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
  }
  private setRadio(name: string, value: string): void {
    for (const r of this.radios(name)) r.checked = r.value === value;
  }
  private on(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.listeners.push({ target, type, fn });
  }

  // ----------------------------------------------------------------- start ---
  start(): void {
    const { dlg, options } = this;
    this.q('selection').textContent = options.title;
    this.buildPartList();
    this.wireEvents();
    initPreview(this.preview);

    history.pushState({ cx: true }, '', HASH);
    this.pushed = true;
    dlg.showModal();
    dlg.querySelector<HTMLElement>('#cx-title')?.focus();

    this.unsubscribe = this.controller.subscribe((s) => this.onState(s));
    this.controller.open(options.parts, options.title);
    this.say('Loading the layout tools…', true);
  }

  private wireEvents(): void {
    const { dlg } = this;
    this.on(dlg, 'change', (e) => this.onChange(e));
    this.on(dlg, 'click', (e) => this.onClick(e));
    this.on(dlg, 'keydown', (e) => this.onKeydown(e as KeyboardEvent));
    this.on(dlg, 'cancel', (e) => this.onCancel(e));
    this.on(dlg, 'close', () => this.onClosed());
    this.on(window, 'popstate', () => this.onPop());
    this.on(this.preview, 'cx-view-change', (e) => {
      const view = (e as CustomEvent<string>).detail;
      if (view === 'continuous' && this.breakEditor.active) this.setBreakMode(false, false);
      else this.breakEditor.refresh();
    });
  }

  // ------------------------------------------------------------- open/close ---
  private requestClose(): void {
    if (this.dlg.open) this.dlg.close();
    else this.onClosed();
  }

  private onPop(): void {
    if (this.suppressPop) { this.suppressPop = false; return; }
    this.pushed = false;
    this.requestClose();
  }

  private onCancel(e: Event): void {
    if (this.panelOpen() && !this.wide.matches) {
      e.preventDefault();
      this.setPanel(false, true);
    }
  }

  private onClosed(): void {
    if (this.closing) return;
    this.closing = true;
    if (this.state?.phase === 'exporting') {
      const status = document.getElementById('export-status');
      if (status !== null) status.textContent = 'Custom PDF cancelled.';
    }
    this.unsubscribe?.();
    this.breakEditor.destroy();
    this.q('break-mode').setAttribute('aria-pressed', 'false');
    this.controller.close();
    destroyPreview(this.preview);
    for (const t of [this.undoTimer, this.updatingTimer, this.slowTimer, this.announceTimer]) if (t !== null) window.clearTimeout(t);
    for (const l of this.listeners) l.target.removeEventListener(l.type, l.fn);
    this.listeners.length = 0;
    this.dlg.removeAttribute('data-panel');
    this.notices.replaceChildren();
    this.wait.hidden = true;
    if (this.pushed) {
      this.pushed = false;
      this.suppressPop = true;
      history.back();
    }
    active = null;
    if (this.afterClose !== null) this.afterClose();
    else this.options.opener?.focus();
  }

  // ----------------------------------------------------------------- panel ---
  private panelOpen(): boolean { return this.dlg.dataset['panel'] === 'open'; }
  private setPanel(open: boolean, focusButton: boolean): void {
    const btn = this.q<HTMLButtonElement>('settings-btn');
    if (open) this.dlg.dataset['panel'] = 'open';
    else this.dlg.removeAttribute('data-panel');
    btn.setAttribute('aria-expanded', String(open));
    if (open) this.q('settings').focus();
    else if (focusButton) btn.focus();
  }

  // ----------------------------------------------------------------- input ---
  private patch(p: Partial<Omit<LayoutSettings, 'version'>>): void {
    this.undoShown = false;
    this.controller.updateSettings(p);
  }

  private onChange(e: Event): void {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || this.state === null) return;
    const s = this.state.settings;
    switch (t.name) {
      case 'cx-staff': this.patch({ staff: t.value as LayoutSettings['staff'] }); break;
      case 'cx-lyrics': this.patch({ lyrics: t.value as LayoutSettings['lyrics'] }); break;
      case 'cx-spacing': this.patch({ spacing: t.value as LayoutSettings['spacing'] }); break;
      case 'cx-lines': this.patch({ linePolicy: t.value as LayoutSettings['linePolicy'] }); break;
      case 'cx-orient': this.patch({ orientation: t.value as LayoutSettings['orientation'] }); break;
      case 'cx-print': this.lastPrint = t.value as PagePresetId; this.patch({ page: this.lastPrint }); break;
      case 'cx-ipad': this.lastIpad = t.value as PagePresetId; this.patch({ page: this.lastIpad }); break;
      case 'cx-tier': this.onTier(t.value, s); break;
      case 'cx-unit': this.unit = t.value === 'in' ? 'in' : 'mm'; this.fillCustom(s, true); break;
      default:
        if (t.dataset['cx'] === 'custom-w' || t.dataset['cx'] === 'custom-h') this.commitCustom();
        else if (t.dataset['cx'] === 'margin') this.commitMargin(t);
    }
  }

  private onTier(tier: string, s: LayoutSettings): void {
    if (tier === 'print') this.patch({ page: this.lastPrint });
    else if (tier === 'ipad') this.patch({ page: this.lastIpad });
    else {
      const d = paperDimensions(s);
      // Switching to Custom pre-fills the previous page's dimensions (portrait-normalised).
      const size = s.customSize ?? { widthMm: round1(Math.min(d.widthMm, d.heightMm)), heightMm: round1(Math.max(d.widthMm, d.heightMm)) };
      this.customInvalid = false;
      this.patch({ page: 'custom', customSize: size });
    }
  }

  private commitMargin(input: HTMLInputElement): void {
    const n = Number(input.value);
    if (!Number.isFinite(n) || input.value.trim() === '') { if (this.state) input.value = String(this.state.settings.marginMm); return; }
    this.patch({ marginMm: Math.min(MARGIN_MAX_MM, Math.max(MARGIN_MIN_MM, Math.round(n))) });
  }

  private parseLength(raw: string): number | null {
    const n = Number(raw.trim().replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(n)) return null;
    return this.unit === 'in' ? n * MM_PER_IN : n;
  }

  private commitCustom(): void {
    const w = this.q<HTMLInputElement>('custom-w');
    const h = this.q<HTMLInputElement>('custom-h');
    const err = this.q('custom-error');
    const show = (msg: string | null, ...bad: HTMLInputElement[]): void => {
      err.hidden = msg === null;
      err.textContent = msg ?? '';
      for (const i of [w, h]) { if (bad.includes(i)) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); }
      this.customInvalid = msg !== null;
    };
    const wm = this.parseLength(w.value);
    const hm = this.parseLength(h.value);
    if (wm === null || hm === null) { show(CUSTOM_ERRORS.notANumber, ...(wm === null ? [w] : []), ...(hm === null ? [h] : [])); return; }
    const outside = (v: number): boolean => v < PAGE_MIN_MM - 1e-9 || v > PAGE_MAX_MM + 1e-9;
    if (outside(wm)) { show(CUSTOM_ERRORS.range('width', this.unit), w); return; }
    if (outside(hm)) { show(CUSTOM_ERRORS.range('height', this.unit), h); return; }
    if (Math.max(wm, hm) / Math.min(wm, hm) > PAGE_MAX_RATIO + 1e-9) { show(CUSTOM_ERRORS.tooNarrow, w, h); return; }
    show(null);
    // Stored portrait-normalised; orientation is its own setting.
    this.patch({ page: 'custom', customSize: { widthMm: round1(Math.min(wm, hm)), heightMm: round1(Math.max(wm, hm)) } });
  }

  private onClick(e: Event): void {
    const target = e.target instanceof Element ? e.target : null;
    const btn = target?.closest<HTMLElement>('button, a');
    if (btn === null || btn === undefined || !this.dlg.contains(btn)) return;
    const action = btn.dataset['cxAction'];
    if (action !== undefined) { this.runAction(action as ActionId, btn.dataset['cxPart'] ?? null); return; }
    const s = this.state;
    switch (btn.dataset['cx']) {
      case 'close': this.requestClose(); break;
      case 'settings-btn': this.setPanel(!this.panelOpen(), true); break;
      case 'panel-done': this.setPanel(false, true); break;
      case 'cap-minus': this.stepCap(-1); break;
      case 'cap-plus': this.stepCap(1); break;
      case 'margin-minus': if (s) this.patch({ marginMm: Math.max(MARGIN_MIN_MM, s.settings.marginMm - 1) }); break;
      case 'margin-plus': if (s) this.patch({ marginMm: Math.min(MARGIN_MAX_MM, s.settings.marginMm + 1) }); break;
      case 'reset': this.controller.resetLayout(); this.armUndo(); break;
      case 'undo': this.controller.undo(); this.armUndo(); break;
      case 'cancel': this.controller.cancelDownload(); this.say('PDF stopped.', true); break;
      case 'download': void this.download(); break;
      case 'stale-dismiss': this.dismissStale(); break;
      case 'break-mode':
        this.setBreakMode(!this.breakEditor.active, true);
        break;
      default: break;
    }
  }

  private onKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      const t = e.target;
      const typing = t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'number') || t instanceof HTMLTextAreaElement;
      if (!typing) { e.preventDefault(); this.controller.undo(); this.armUndo(); }
    }
  }

  /** Break editing is available only in Pages view; turning it on switches back to Pages. */
  private setBreakMode(on: boolean, announce: boolean): void {
    const btn = this.q('break-mode');
    btn.setAttribute('aria-pressed', String(on));
    if (on) {
      if (getView(this.preview) === 'continuous') setView(this.preview, 'pages');
      if (this.panelOpen()) this.setPanel(false, false);
    }
    this.breakEditor.setMode(on);
    if (on) this.breakEditor.focusFirst();
    if (announce) this.say(on ? 'Break points shown. Select one to start a new system or page there.' : 'Break points hidden.', true);
  }

  private armUndo(): void {
    this.undoShown = true;
    if (this.undoTimer !== null) window.clearTimeout(this.undoTimer);
    this.undoTimer = window.setTimeout(() => { this.undoShown = false; if (this.state) this.syncFooter(this.state); }, UNDO_VISIBLE_MS);
  }

  private stepCap(direction: 1 | -1): void {
    const s = this.state;
    if (s === null) return;
    const cur = s.settings.maxSystems;
    const now = this.shownMaxSystems(s);
    if (cur === null) {
      if (direction === -1 && now !== null && now > 1) this.patch({ maxSystems: now - 1 });
      return;
    }
    const next = cur + direction;
    if (direction === -1) this.patch({ maxSystems: Math.max(1, next) });
    else this.patch({ maxSystems: next > MAX_SYSTEMS_LIMIT || (this.naturalMax !== null && next > this.naturalMax) ? null : next });
  }

  private async download(): Promise<void> {
    this.savedBytes = null;
    await this.controller.download();
    const s = this.state;
    if (this.savedBytes !== null && s !== null && s.phase === 'ready' && s.result !== null) {
      this.say(`PDF downloaded: ${pageWord(s.result.pages.length)}, ${(this.savedBytes / (1024 * 1024)).toFixed(1)} MB.`, true);
    }
  }

  private dismissStale(): void {
    for (const k of this.staleKeys()) this.dismissedStale.add(k);
    if (this.state) this.syncStale(this.state);
  }

  private runAction(id: ActionId, partId: string | null): void {
    const s = this.state;
    if (s === null) return;
    const set = s.settings;
    switch (id) {
      case 'smaller-music': { const smaller = smallerStaff(set.staff); if (smaller !== null) this.patch({ staff: smaller }); break; }
      case 'landscape': this.patch({ orientation: 'landscape' }); break;
      case 'portrait': this.patch({ orientation: 'portrait' }); break;
      case 'larger-page': {
        const kind = kindOf(set.page);
        if (kind === 'custom') this.patch({ page: 'a4' });
        else {
          const ladder = PAPER_LADDER[kind];
          const next = ladder[Math.min(ladder.length - 1, ladder.indexOf(set.page) + 1)];
          if (next !== undefined) this.patch({ page: next });
        }
        break;
      }
      case 'smaller-margins': this.patch({ marginMm: Math.max(MARGIN_MIN_MM, set.marginMm - 3) }); break;
      case 'fit-to-page': this.patch({ linePolicy: 'automatic' }); break;
      case 'remove-break':
      case 'remove-part-breaks':
        if (partId !== null) for (const o of s.overrides[partId] ?? []) this.controller.setBreak(partId, { boundaryId: o.boundaryId, kind: 'remove' });
        this.armUndo();
        break;
      case 'try-again': {
        const pdf = s.diagnostics.some((d) => d.code === 'PDF_FAILED');
        if (pdf) void this.download(); else this.controller.updateSettings({});
        break;
      }
      case 'use-original': this.useOriginal(); break;
      case 'reload': window.location.reload(); break;
      case 'dismiss': this.dismissStale(); break;
      case 'close': this.requestClose(); break;
      default: break;
    }
  }

  private useOriginal(): void {
    // The dialog's `close` event is queued, so focus and status are applied in onClosed.
    this.afterClose = () => {
      const status = document.getElementById('export-status');
      if (status !== null) status.textContent = 'Custom layout closed. Export PDF uses the original layout.';
      document.getElementById('export-btn')?.focus();
    };
    this.requestClose();
  }

  // ------------------------------------------------------------ live region ---
  /** One polite region, at most one announcement per 2 s; the newest pending message wins. */
  private say(text: string, immediate = false): void {
    const status = document.getElementById('cx-status');
    if (status === null || text === '') return;
    const now = Date.now();
    const wait = this.lastAnnounceAt + ANNOUNCE_GAP_MS - now;
    if (immediate || wait <= 0) { this.lastAnnounceAt = now; status.textContent = text; this.pendingAnnounce = null; return; }
    this.pendingAnnounce = text;
    if (this.announceTimer === null) {
      this.announceTimer = window.setTimeout(() => {
        this.announceTimer = null;
        if (this.pendingAnnounce !== null) { this.lastAnnounceAt = Date.now(); status.textContent = this.pendingAnnounce; this.pendingAnnounce = null; }
      }, wait);
    }
  }

  // ----------------------------------------------------------------- parts ---
  private buildPartList(): void {
    const list = this.q('partlist');
    list.replaceChildren();
    for (const part of this.parts) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'cx-pn';
      name.textContent = part.label;
      li.append(name);
      const note = capabilityNote(part);
      if (note !== null) {
        const p = document.createElement('span');
        p.className = 'small muted';
        p.textContent = note;
        li.append(p);
      }
      list.append(li);
    }
  }

  // ----------------------------------------------------------------- state ---
  private shownResult(s: ControllerState): ControllerState['result'] { return s.result ?? s.previousResult; }

  private shownMaxSystems(s: ControllerState): number | null {
    const r = this.shownResult(s);
    if (r === null) return null;
    let max = 0;
    for (const p of r.pages) if (p.systemCount !== null) max = Math.max(max, p.systemCount);
    return max === 0 ? null : max;
  }

  private onState(s: ControllerState): void {
    const prev = this.state;
    this.state = s;
    this.syncControls(s);
    this.syncPreview(s, prev);
    this.syncNotices(s);
    this.syncStale(s);
    this.syncFooter(s);
    this.syncAnnouncements(s, prev);
  }

  private syncControls(s: ControllerState): void {
    const set = s.settings;
    const kind = kindOf(set.page);
    this.setRadio('cx-staff', set.staff);
    this.setRadio('cx-lyrics', set.lyrics);
    this.setRadio('cx-spacing', set.spacing);
    this.setRadio('cx-lines', set.linePolicy);
    this.setRadio('cx-orient', set.orientation);
    this.setRadio('cx-tier', kind);
    this.setRadio('cx-unit', this.unit);
    if (kind === 'print') this.lastPrint = set.page;
    if (kind === 'ipad') this.lastIpad = set.page;
    this.setRadio('cx-print', kind === 'print' ? set.page : '');
    this.setRadio('cx-ipad', kind === 'ipad' ? set.page : '');
    this.q('tier-print').hidden = kind !== 'print';
    this.q('tier-ipad').hidden = kind !== 'ipad';
    this.q('tier-custom').hidden = kind !== 'custom';
    this.q('page-help').textContent = kind === 'custom' ? '90–450 mm (3.5–17.7 in) each side.'
      : kind === 'ipad' ? 'Fills the screen in forScore and similar apps.' : '';
    if (kind === 'custom' && !this.customInvalid) this.fillCustom(set, false);

    const margin = this.q<HTMLInputElement>('margin');
    if (document.activeElement !== margin) margin.value = String(set.marginMm);
    this.q<HTMLButtonElement>('margin-minus').disabled = set.marginMm <= MARGIN_MIN_MM;
    this.q<HTMLButtonElement>('margin-plus').disabled = set.marginMm >= MARGIN_MAX_MM;
    const inches = (set.marginMm / MM_PER_IN).toFixed(2);
    this.q('margin-help').textContent = `${set.marginMm} mm (${inches} in)` +
      (kind === 'print' && set.marginMm < PRINT_MARGIN_ADVISORY_MM ? `. ${PRINTER_ADVISORY}` : '');

    this.q('lines-help').textContent = set.linePolicy === 'original'
      ? 'Keeps the typeset lines; pages are filled to fit.'
      : 'Re-flows the music for this page and music size.';
    this.q('crowded').hidden = !(set.linePolicy === 'original' && s.diagnostics.some((d) => d.code === 'CROWDED_ORIGINAL_LINES'));

    // Capability rules.
    const mei = this.parts.filter((p) => p.kind === 'mei');
    const others = this.parts.filter((p) => p.kind !== 'mei');
    const hasMei = mei.length > 0;
    const hasBreaks = mei.some((p) => capabilitiesFor(p).manualBreaks);
    this.q('music-field').hidden = !hasMei;
    this.q('nomusic').hidden = hasMei;
    this.q('lines-field').hidden = !hasMei;
    this.q('yours-field').hidden = !hasBreaks;
    this.q('lyrics-field').hidden = !hasMei;
    this.q('spacing-field').hidden = !hasMei;
    this.q('more').hidden = !hasMei;
    const applies = this.q('applies');
    applies.hidden = !(hasMei && others.length > 0);
    applies.textContent = `Applies to: ${mei.map((p) => p.label).join(', ')}. Not to: ${others.map((p) => `${p.label} (${p.kind === 'scan' ? 'original scan' : 'fixed typeset layout'})`).join(', ')}.`;
    const fixed = this.parts.filter((p) => p.kind === 'fixed');
    const fixedNote = this.q('fixed-note');
    fixedNote.hidden = fixed.length === 0;
    fixedNote.textContent = `Doesn't apply to ${fixed.map((p) => `${p.label} (fixed typeset layout)`).join(', ')}.`;

    // More options: summary of non-default values, open when either differs.
    const more = this.q<HTMLDetailsElement>('more');
    const nonDefault: string[] = [];
    if (set.lyrics !== 'medium') nonDefault.push(`${cap(set.lyrics)} sung text`);
    if (set.spacing !== 'normal') nonDefault.push(cap(set.spacing));
    this.q('more-summary').textContent = more.open || nonDefault.length === 0 ? '' : `· ${nonDefault.join(', ')}`;
    if (!this.moreChecked) { this.moreChecked = true; if (nonDefault.length > 0) more.open = true; }

    const count = Object.values(s.overrides).reduce((n, list) => n + list.length, 0);
    const bc = this.q('break-count');
    bc.hidden = count === 0;
    bc.textContent = `${count} of your breaks`;

    this.q('storage').hidden = !s.notices.some((n) => n.code === 'STORAGE_BLOCKED');
    this.q('prefs').hidden = !s.notices.some((n) => n.code === 'PREFS_UNREADABLE');

    this.syncFit(s);
  }

  private fillCustom(set: LayoutSettings, force: boolean): void {
    const w = this.q<HTMLInputElement>('custom-w');
    const h = this.q<HTMLInputElement>('custom-h');
    if (!force && (document.activeElement === w || document.activeElement === h)) return;
    const d = set.customSize ?? { widthMm: paperDimensions(set).widthMm, heightMm: paperDimensions(set).heightMm };
    const show = (mm: number): string => String(this.unit === 'in' ? Math.round((mm / MM_PER_IN) * 100) / 100 : round1(mm));
    w.value = show(d.widthMm);
    h.value = show(d.heightMm);
    this.customInvalid = false;
    const err = this.q('custom-error');
    err.hidden = true;
    w.removeAttribute('aria-invalid');
    h.removeAttribute('aria-invalid');
  }

  private syncFit(s: ControllerState): void {
    const cur = s.settings.maxSystems;
    const now = this.shownMaxSystems(s);
    if (cur === null && now !== null && s.result !== null) this.naturalMax = now;
    const val = this.q('cap-value');
    const minus = this.q<HTMLButtonElement>('cap-minus');
    const plus = this.q<HTMLButtonElement>('cap-plus');
    if (cur === null) {
      val.textContent = now === null ? 'As many as fit' : `As many as fit (now ${now})`;
      minus.disabled = now === null || now <= 1;
      plus.disabled = true;
      plus.setAttribute('aria-label', 'Already as many as fit');
    } else {
      val.textContent = String(cur);
      minus.disabled = cur <= 1;
      plus.disabled = false;
      plus.setAttribute('aria-label', 'More systems per page');
    }
    const line = this.q('result');
    const pending = s.result === null;
    line.dataset['pending'] = String(pending);
    const r = this.shownResult(s);
    line.textContent = pending && (r === null || s.phase !== 'error') ? 'Updating…' : r === null ? '' : this.resultLine(r.pages);
    if (r !== null && !pending) line.textContent = this.resultLine(r.pages);
  }

  private resultLine(pages: readonly { partId: string; systemCount: number | null; kind: string }[]): string {
    const byPart = new Map<string, typeof pages[number][]>();
    for (const p of pages) byPart.set(p.partId, [...(byPart.get(p.partId) ?? []), p]);
    if (byPart.size <= 1) {
      const counts = pages.map((p) => p.systemCount).filter((n): n is number => n !== null);
      return counts.length === pages.length && counts.length > 0
        ? `${pageWord(pages.length)} · ${counts.join(' + ')} systems`
        : pageWord(pages.length);
    }
    return [...byPart].map(([id, list]) => {
      const kind = list[0]?.kind;
      return `${this.partLabels[id] ?? 'Part'}: ${pageWord(list.length)}${kind === 'scan' ? ' (scan)' : kind === 'fixed' ? ' (fixed)' : ''}`;
    }).join(' · ');
  }

  private syncPreview(s: ControllerState, prev: ControllerState | null): void {
    const busy = s.phase === 'rendering' || s.phase === 'loading';
    const wasBusy = prev !== null && (prev.phase === 'rendering' || prev.phase === 'loading');
    if (busy && !wasBusy) {
      this.updating = false;
      this.slow = false;
      this.clearTimers();
      this.updatingTimer = window.setTimeout(() => {
        this.updating = true;
        if (this.state !== null) { this.syncPreview(this.state, this.state); if (this.hasShownResult) this.say('Updating preview…'); }
      }, UPDATING_DELAY_MS);
      this.slowTimer = window.setTimeout(() => { this.slow = true; if (this.state) this.syncWait(this.state); }, SLOW_NOTE_MS);
    } else if (!busy) {
      this.updating = false;
      this.slow = false;
      this.clearTimers();
    }
    const shown = this.shownResult(s);
    const showUpdating = this.updating && busy && shown !== null;
    if (shown !== this.lastShown || showUpdating !== this.lastUpdatingFlag) {
      this.lastShown = shown;
      this.lastUpdatingFlag = showUpdating;
      renderPreview(this.preview, shown, { partLabels: this.partLabels, updating: showUpdating });
      this.breakEditor.refresh();
    }
    if (shown !== null) this.hasShownResult = true;
    this.syncWait(s);
  }

  private clearTimers(): void {
    if (this.updatingTimer !== null) { window.clearTimeout(this.updatingTimer); this.updatingTimer = null; }
    if (this.slowTimer !== null) { window.clearTimeout(this.slowTimer); this.slowTimer = null; }
  }

  /** First open: an empty page frame at the expected aspect ratio, with the waiting text inside. */
  private syncWait(s: ControllerState): void {
    const waiting = this.shownResult(s) === null && (s.phase === 'loading' || s.phase === 'rendering');
    this.wait.hidden = !waiting;
    if (!waiting) { this.wait.replaceChildren(); return; }
    const d = paperDimensions(s.settings);
    this.wait.style.aspectRatio = `${d.widthMm} / ${d.heightMm}`;
    const text = this.slow ? 'Getting the music ready to lay out… This can take up to a minute on a tablet.' : 'Getting the music ready to lay out…';
    if (this.wait.textContent !== text) this.wait.textContent = text;
  }

  // --------------------------------------------------------------- notices ---
  private ctxFor(d: LayoutDiagnostic, s: ControllerState): CopyContext {
    return { partLabel: d.partId !== null ? this.partLabels[d.partId] ?? 'this part' : 'this part', settings: s.settings };
  }

  private staleKeys(): string[] {
    const s = this.state;
    if (s === null) return [];
    const keys = s.notices.filter((n) => n.code === 'STALE_ANCHOR').map((n) => `n:${n.partId ?? ''}`);
    for (const d of s.diagnostics) if (d.code === 'STALE_ANCHOR' || d.code === 'UNSAFE_ANCHOR') keys.push(`d:${d.partId ?? ''}`);
    return keys;
  }

  private syncStale(s: ControllerState): void {
    const box = this.q('stale');
    const keys = this.staleKeys().filter((k) => !this.dismissedStale.has(k));
    box.hidden = keys.length === 0;
    if (keys.length === 0) return;
    const ids = new Set<string>();
    for (const n of s.notices) if (n.code === 'STALE_ANCHOR' && n.partId !== null) ids.add(n.partId);
    for (const d of s.diagnostics) if ((d.code === 'STALE_ANCHOR' || d.code === 'UNSAFE_ANCHOR') && d.partId !== null) ids.add(d.partId);
    const names = [...ids].map((id) => this.partLabels[id] ?? 'this part');
    const label = names.length === 0 ? 'this part' : names.join(', ');
    const p = box.querySelector('p');
    if (p !== null) p.textContent = `Your saved breaks for ${label} were removed because its music was updated.`;
  }

  private syncNotices(s: ControllerState): void {
    const items: { d: LayoutDiagnostic; copy: ReturnType<typeof copyFor> }[] = [];
    const seen = new Set<string>();
    for (const d of s.diagnostics) {
      if (d.code === 'STALE_ANCHOR' || d.code === 'UNSAFE_ANCHOR' || d.code === 'CROWDED_ORIGINAL_LINES') continue;
      const copy = copyFor(d, this.ctxFor(d, s));
      if (copy.silent || copy.text === '') continue;
      const key = `${d.code}|${d.partId ?? ''}|${d.reason ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ d, copy });
    }
    const signature = JSON.stringify(items.map(({ d, copy }) => [d.code, d.partId, copy.text, copy.actions]));
    if (signature === this.lastNoticeKey) return;
    this.lastNoticeKey = signature;
    this.notices.replaceChildren();
    for (const { d, copy } of items) {
      const box = document.createElement('div');
      box.className = 'notice';
      box.dataset['code'] = d.code;
      const p = document.createElement('p');
      p.textContent = copy.text;
      if (isGlobalDiagnostic(d) && copy.blocking) p.setAttribute('role', 'alert');
      box.append(p);
      if (copy.actions.length > 0) {
        const acts = document.createElement('div');
        acts.className = 'cx-acts';
        for (const id of copy.actions) {
          const label = ACTION_LABEL[id](this.ctxFor(d, s));
          if (id === 'report') {
            const a = document.createElement('a');
            a.href = '/corrections/';
            a.textContent = label;
            a.className = 'button';
            a.dataset['cxAction'] = id;
            acts.append(a);
          } else {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.dataset['cxAction'] = id;
            if (d.partId !== null) b.dataset['cxPart'] = d.partId;
            acts.append(b);
          }
        }
        box.append(acts);
      }
      this.notices.append(box);
    }
  }

  // ---------------------------------------------------------------- footer ---
  private syncFooter(s: ControllerState): void {
    const download = this.q<HTMLButtonElement>('download');
    const exporting = s.phase === 'exporting';
    download.disabled = !s.canDownload;
    download.textContent = exporting ? 'Preparing PDF…'
      : s.canDownload && s.result !== null ? `Download PDF · ${pageWord(s.result.pages.length)}` : 'Download PDF';
    this.q('reset').hidden = exporting;
    this.q('cancel').hidden = !exporting;
    this.q('undo').hidden = !(this.undoShown && s.canUndo);
  }

  private syncAnnouncements(s: ControllerState, prev: ControllerState | null): void {
    if (prev === null) return;
    if (s.phase === 'ready' && prev.phase !== 'ready' && prev.phase !== 'exporting' && s.result !== null && this.hasShownResult && prev.previousResult !== null) {
      if (this.holdUpdated) this.holdUpdated = false;
      else this.say(`Preview updated: ${pageWord(s.result.pages.length)}.`);
    } else if (s.phase === 'ready' && prev.phase !== 'ready' && prev.phase !== 'exporting' && !this.announcedFirst) {
      // First open: nothing to announce, but clear the loading message.
      this.announcedFirst = true;
      const status = document.getElementById('cx-status');
      if (status !== null) status.textContent = '';
    } else if (s.phase === 'exporting' && prev.phase !== 'exporting') {
      this.say('Preparing PDF…', true);
    } else if (prev.phase === 'exporting' && (s.phase === 'rendering' || s.phase === 'loading')) {
      this.say('Settings changed, so the PDF was stopped. Download again when the preview is ready.', true);
    } else if (s.phase === 'error' && prev.phase !== 'error') {
      this.announceError(s);
    } else if (s.phase === 'ready' && s.diagnostics.length > 0 && prev.diagnostics !== s.diagnostics && prev.phase === 'exporting') {
      this.announceError(s);
    }
  }

  /** Part errors repeat their notice sentence on the status line; global errors use their role="alert" paragraph only. */
  private announceError(s: ControllerState): void {
    const d = s.diagnostics.find((x) => !copyFor(x, this.ctxFor(x, s)).silent && copyFor(x, this.ctxFor(x, s)).blocking);
    if (d === undefined || isGlobalDiagnostic(d)) return;
    const copy = copyFor(d, this.ctxFor(d, s));
    this.say(d.code === 'UNSATISFIABLE_LAYOUT' ? `Can't lay out ${this.ctxFor(d, s).partLabel} with these settings.` : copy.text, true);
  }
}

// ----------------------------------------------------------- small helpers ---
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function capabilityNote(part: ExportPart): string | null {
  if (part.kind === 'scan') {
    return part.customizableAvailable
      ? "Page size, margins and systems per page apply. The music itself can't be resized. Customizable typeset is available. To use it, close this and choose 'Show the typeset music' on the page."
      : "Page size, margins and systems per page apply. The music itself can't be resized.";
  }
  if (part.kind === 'fixed') return "Fitted to your paper. Its lines and lettering can't change.";
  return null;
}

// Re-exported for tests and B9.
export { paperName };
