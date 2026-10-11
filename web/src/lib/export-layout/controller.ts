import type {
  BreakAction,
  BreakOverride,
  BudgetInput,
  ControllerDependencies,
  ControllerState,
  ExportController,
  ExportPart,
  LayoutDiagnostic,
  LayoutResult,
  LayoutSettings,
  LayoutWorkerResponse,
  MeiExportPart,
  PdfWorkerResponse,
  ResourceProfile,
  SettingsNotice,
  WorkerLike,
} from './types';
import { DEFAULT_SETTINGS, PAGE_PRESETS } from './types';
import { defaultMarginFor, nextMargin, normalizeSettings } from './settings';
import { checkLayoutBudget } from './limits';
import { readPreferences, writePreferences } from './preferences';

const DEBOUNCE_MS = 250;
const UNDO_CAP = 50;

type Overrides = Readonly<Record<string, readonly BreakOverride[]>>;
interface Snapshot { readonly settings: LayoutSettings; readonly overrides: Overrides }
type SettingsPatch = Partial<Omit<LayoutSettings, 'version'>>;

function timeoutDiagnostic(detail: string): LayoutDiagnostic {
  return { code: 'TIMEOUT', severity: 'error', partId: null, pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail };
}
function failureDiagnostic(code: 'RENDERER_FAILED' | 'PDF_FAILED', detail: string): LayoutDiagnostic {
  return { code, severity: 'error', partId: null, pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail };
}

function budgetDiagnostic(code: 'BUDGET_EXCEEDED' | 'SOURCE_CEILING', detail: string): LayoutDiagnostic {
  return { code, severity: 'error', partId: null, pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail };
}

/**
 * Default estimate when sizes are unknown: sums sourceSystemCount, reports 0 bytes and 0 events,
 * and predicts ceil(sourceSystems / 3) pages (a deliberately conservative 3 systems per page).
 */
function defaultEstimate(parts: readonly ExportPart[]): BudgetInput {
  const sourceSystems = parts.reduce((sum, p) => sum + p.sourceSystemCount, 0);
  const meiCount = parts.filter((p) => p.kind === 'mei').length;
  return {
    meiBytes: new Array<number>(meiCount).fill(0),
    eventCounts: new Array<number>(meiCount).fill(0),
    sourceSystems,
    predictedPages: Math.ceil(sourceSystems / 3),
  };
}

function isMei(part: ExportPart): part is MeiExportPart {
  return part.kind === 'mei';
}

function computeCanDownload(phase: ControllerState['phase'], result: LayoutResult | null, token: number): boolean {
  return (
    phase === 'ready' &&
    result !== null &&
    result.token === token &&
    result.complete &&
    !result.diagnostics.some((d) => d.severity === 'error')
  );
}

export function createExportController(deps: ControllerDependencies): ExportController {
  const profile: ResourceProfile = deps.profile ?? {
    version: 1, provisional: true, limits: deps.limits, maxAggregateEvents: Number.MAX_SAFE_INTEGER,
    measuredOn: [], rendererDigest: '', fontDigest: '',
  };
  const estimate = deps.estimate ?? defaultEstimate;
  const listeners = new Set<(state: ControllerState) => void>();
  let state: ControllerState = {
    phase: 'idle', parts: [], settings: DEFAULT_SETTINGS, overrides: {}, requestToken: 0,
    result: null, previousResult: null, diagnostics: [], notices: [], canUndo: false, canDownload: false,
  };
  let title = 'Export';
  let closed = false;
  let layoutWorker: WorkerLike | null = null;
  let pdfWorker: WorkerLike | null = null;
  let debounceId: number | null = null;
  let dirty = false;
  let layoutWatchdog: number | null = null;
  let pdfWatchdog: number | null = null;
  let inflight: number | null = null;
  let exportToken: number | null = null;
  let exportResolve: (() => void) | null = null;
  let undoStack: Snapshot[] = [];
  // Stored overrides keyed by target, including targets not part of this export.
  let storedOverrides: Record<string, readonly BreakOverride[]> = {};

  function set(patch: Partial<ControllerState>): void {
    const next = { ...state, ...patch };
    state = {
      ...next,
      canUndo: undoStack.length > 0,
      canDownload: computeCanDownload(next.phase, next.result, next.requestToken),
    };
    for (const l of [...listeners]) l(state);
  }

  function clearDebounce(): void {
    if (debounceId !== null) { deps.clearTimeout(debounceId); debounceId = null; }
  }
  function clearLayoutWatchdog(): void {
    if (layoutWatchdog !== null) { deps.clearTimeout(layoutWatchdog); layoutWatchdog = null; }
  }
  function clearPdfWatchdog(): void {
    if (pdfWatchdog !== null) { deps.clearTimeout(pdfWatchdog); pdfWatchdog = null; }
  }

  function endExport(): void {
    exportToken = null;
    clearPdfWatchdog();
    if (pdfWorker !== null) { pdfWorker.terminate(); pdfWorker = null; }
    const resolve = exportResolve;
    exportResolve = null;
    if (resolve !== null) resolve();
  }

  function ensureLayoutWorker(): WorkerLike {
    if (layoutWorker !== null) return layoutWorker;
    const w = deps.createLayoutWorker();
    w.onmessage = (event: MessageEvent) => {
      if (layoutWorker !== w || closed) return;
      onLayoutMessage(event.data as LayoutWorkerResponse);
    };
    w.onerror = () => {
      if (layoutWorker !== w || closed) return;
      onLayoutMessage({ type: 'error', token: state.requestToken, diagnostic: failureDiagnostic('RENDERER_FAILED', 'worker onerror') });
    };
    layoutWorker = w;
    return w;
  }

  function ensurePdfWorker(): WorkerLike {
    if (pdfWorker !== null) return pdfWorker;
    const w = deps.createPdfWorker();
    w.onmessage = (event: MessageEvent) => {
      if (pdfWorker !== w || closed) return;
      onPdfMessage(event.data as PdfWorkerResponse);
    };
    w.onerror = () => {
      if (pdfWorker !== w || closed) return;
      onPdfMessage({ type: 'error', token: exportToken ?? -1, diagnostic: failureDiagnostic('PDF_FAILED', 'worker onerror') });
    };
    pdfWorker = w;
    return w;
  }

  function onLayoutMessage(msg: LayoutWorkerResponse): void {
    if (msg.type === 'progress') return;
    if (msg.token !== state.requestToken || dirty) return;
    clearLayoutWatchdog();
    inflight = null;
    if (msg.type === 'result' && msg.result.pages.length > profile.limits.maxPages) {
      set({
        phase: 'error', result: null,
        diagnostics: [budgetDiagnostic('BUDGET_EXCEEDED', `${msg.result.pages.length} pages exceeds ${profile.limits.maxPages}`)],
      });
    } else if (msg.type === 'result') {
      set({ phase: 'ready', result: msg.result, previousResult: msg.result, diagnostics: msg.result.diagnostics });
    } else {
      set({ phase: 'error', result: null, diagnostics: [msg.diagnostic] });
    }
  }

  function onPdfMessage(msg: PdfWorkerResponse): void {
    if (msg.type === 'progress') return;
    if (exportToken === null || msg.token !== exportToken || msg.token !== state.requestToken || state.phase !== 'exporting') return;
    if (msg.type === 'pdf') {
      const label = state.settings.page === 'custom' ? 'custom' : PAGE_PRESETS[state.settings.page].label;
      endExport();
      deps.saveFile(new Uint8Array(msg.bytes), `${title} (${label}).pdf`);
      set({ phase: 'ready' });
    } else {
      endExport();
      set({ phase: 'ready', diagnostics: [msg.diagnostic] });
    }
  }

  /** A change invalidates any running PDF job and the current result. */
  function markStale(): void {
    if (exportToken !== null) endExport();
    clearLayoutWatchdog();
    const lastGood = state.result ?? state.previousResult;
    set({ phase: lastGood !== null ? 'rendering' : 'loading', result: null, previousResult: lastGood });
  }

  function postLayout(): void {
    clearDebounce();
    dirty = false;
    markStale();
    const decision = checkLayoutBudget(estimate(state.parts), profile);
    if (!decision.eligible) {
      // Rejected before any worker (and its WASM) is created. Bump the token so late results are ignored.
      if (layoutWorker !== null && inflight !== null) layoutWorker.postMessage({ type: 'cancel', token: inflight });
      inflight = null;
      set({
        requestToken: state.requestToken + 1, phase: 'error', result: null,
        diagnostics: [budgetDiagnostic(decision.code, decision.limit)],
      });
      return;
    }
    const worker = ensureLayoutWorker();
    if (inflight !== null) worker.postMessage({ type: 'cancel', token: inflight });
    const token = state.requestToken + 1;
    inflight = token;
    set({ requestToken: token, diagnostics: [] });
    worker.postMessage({
      type: 'layout',
      request: { token, title, parts: state.parts, settings: state.settings, overrides: state.overrides },
    });
    layoutWatchdog = deps.setTimeout(() => {
      layoutWatchdog = null;
      if (closed || state.requestToken !== token) return;
      if (layoutWorker !== null) { layoutWorker.terminate(); layoutWorker = null; }
      inflight = null;
      set({ phase: 'error', result: null, diagnostics: [timeoutDiagnostic(`layout job ${token} exceeded ${deps.limits.jobTimeoutMs} ms`)] });
    }, deps.limits.jobTimeoutMs);
  }

  function scheduleDebounced(): void {
    clearDebounce();
    dirty = true;
    markStale();
    debounceId = deps.setTimeout(() => {
      debounceId = null;
      if (!closed) postLayout();
    }, DEBOUNCE_MS);
  }

  function persist(): void {
    const byTarget: Record<string, readonly BreakOverride[]> = { ...storedOverrides };
    for (const part of state.parts) {
      if (!isMei(part)) continue;
      const list = state.overrides[part.id];
      if (list !== undefined && list.length > 0) byTarget[part.target] = list;
      else delete byTarget[part.target];
    }
    storedOverrides = byTarget;
    writePreferences(deps.storage, { version: 2, settings: state.settings, overrides: byTarget });
  }

  function pushUndo(): void {
    undoStack.push({ settings: state.settings, overrides: state.overrides });
    if (undoStack.length > UNDO_CAP) undoStack = undoStack.slice(undoStack.length - UNDO_CAP);
  }

  const controller: ExportController = {
    open(parts, exportTitle) {
      closed = false;
      clearDebounce();
      clearLayoutWatchdog();
      if (exportToken !== null) endExport();
      dirty = false;
      inflight = null;
      undoStack = [];
      title = exportTitle ?? 'Export';
      const revisions: Record<string, string> = {};
      for (const p of parts) if (isMei(p)) revisions[p.target] = p.conversion.sourceRevision;
      const { preferences, notices } = readPreferences(deps.storage, revisions);
      storedOverrides = { ...preferences.overrides };
      const overrides: Record<string, readonly BreakOverride[]> = {};
      for (const p of parts) {
        if (!isMei(p)) continue;
        const list = preferences.overrides[p.target];
        if (list !== undefined && list.length > 0) overrides[p.id] = list;
      }
      set({
        phase: 'loading', parts, settings: preferences.settings, overrides, requestToken: 0,
        result: null, previousResult: null, diagnostics: [], notices,
      });
      postLayout();
    },

    updateSettings(patch: SettingsPatch) {
      if (closed || state.phase === 'idle') return;
      const merged = { ...state.settings, ...patch, version: 2 };
      if (patch.page !== undefined && patch.marginMm === undefined) {
        const kindOf = (page: LayoutSettings['page']) => (page === 'custom' ? 'custom' as const : PAGE_PRESETS[page].kind);
        merged.marginMm = nextMargin(kindOf(state.settings.page), kindOf(patch.page), state.settings.marginMm);
      }
      const { settings, notices } = normalizeSettings(merged);
      const extra: SettingsNotice[] = [...notices];
      set({ settings, notices: [...state.notices, ...extra] });
      persist();
      const keys = Object.keys(patch);
      const immediate = keys.some((k) => k !== 'maxSystems' && k !== 'marginMm' && k !== 'customSize');
      if (immediate) postLayout();
      else scheduleDebounced();
    },

    setBreak(partId, action: BreakAction) {
      if (closed || state.phase === 'idle') return;
      if (!state.parts.some((p) => p.id === partId)) return;
      pushUndo();
      const current = state.overrides[partId] ?? [];
      const rest = current.filter((o) => o.boundaryId !== action.boundaryId);
      const nextList = action.kind === 'remove' ? rest : [...rest, action];
      const overrides: Record<string, readonly BreakOverride[]> = { ...state.overrides };
      if (nextList.length > 0) overrides[partId] = nextList;
      else delete overrides[partId];
      set({ overrides });
      persist();
      postLayout();
    },

    resetLayout() {
      if (closed || state.phase === 'idle') return;
      pushUndo();
      const { page, customSize, orientation } = state.settings;
      const kind = page === 'custom' ? 'custom' : PAGE_PRESETS[page].kind;
      const { settings } = normalizeSettings({
        ...DEFAULT_SETTINGS, page, customSize, orientation, marginMm: defaultMarginFor(kind),
      });
      set({ settings, overrides: {} });
      persist();
      postLayout();
    },

    undo() {
      if (closed || state.phase === 'idle') return;
      const snap = undoStack.pop();
      if (snap === undefined) return;
      set({ settings: snap.settings, overrides: snap.overrides });
      persist();
      postLayout();
    },

    download() {
      if (closed || !state.canDownload || state.result === null) return Promise.resolve();
      const result = state.result;
      return new Promise<void>((resolve) => {
        exportToken = result.token;
        exportResolve = resolve;
        set({ phase: 'exporting' });
        const worker = ensurePdfWorker();
        worker.postMessage({ type: 'pdf', token: result.token, result });
        const token = result.token;
        pdfWatchdog = deps.setTimeout(() => {
          pdfWatchdog = null;
          if (closed || exportToken !== token) return;
          endExport();
          set({ phase: 'ready', diagnostics: [timeoutDiagnostic(`pdf job ${token} exceeded ${deps.limits.jobTimeoutMs} ms`)] });
        }, deps.limits.jobTimeoutMs);
      });
    },

    cancelDownload() {
      if (state.phase !== 'exporting') return;
      endExport();
      set({ phase: 'ready' });
    },

    close() {
      closed = true;
      clearDebounce();
      clearLayoutWatchdog();
      clearPdfWatchdog();
      if (layoutWorker !== null) { layoutWorker.terminate(); layoutWorker = null; }
      endExport();
      inflight = null;
      listeners.clear();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
  };
  return controller;
}
