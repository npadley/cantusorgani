import { describe, it, expect } from 'vitest';
import { createExportController } from './controller';
import { DEFAULT_SETTINGS, PREFERENCES_KEY, PROVISIONAL_LIMITS } from './types';
import type {
  BreakOverride, ControllerDependencies, ExportController, ExportPart, LayoutDiagnostic, LayoutRequest, LayoutResult,
  MeiExportPart, StorageLike, WorkerLike,
} from './types';

class FakeWorker implements WorkerLike {
  posts: { type: string; token?: number; request?: LayoutRequest }[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: unknown): void {
    this.posts.push(message as { type: string; token?: number; request?: LayoutRequest });
  }
  terminate(): void { this.terminated = true; }
  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
  get layouts(): number[] { return this.posts.filter((p) => p.type === 'layout').map((p) => p.request?.token ?? -1); }
}

function mei(id: string, target: string, rev = 'r1'): MeiExportPart {
  return {
    id, kind: 'mei', label: id, heading: null, sourceSystemCount: 2, sourceRevision: rev,
    target, renderHash: rev,
    conversion: {
      digest: 'd', meiUrl: 'u', meiSha256: 's', sourceRevision: rev, profile: 'p', verovio: 'v',
      boundaries: [], capabilities: { manualBreaks: true },
    },
  };
}

function result(token: number, over: Partial<LayoutResult> = {}): LayoutResult {
  return {
    token, partIds: ['p1'],
    digests: { input: 'i', settings: 's', fonts: 'f', renderer: 'r', result: 'x' },
    effectiveBreaks: [], diagnostics: [], pages: [], complete: true, ...over,
  };
}

function diag(severity: 'error' | 'warning'): LayoutDiagnostic {
  return { code: 'CONTENT_CLIPPED', severity, partId: null, pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail: '' };
}

function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

function setup(storage: StorageLike | null = memStorage(), parts: ExportPart[] = [mei('p1', 'movement:a')]) {
  const layoutWorkers: FakeWorker[] = [];
  const pdfWorkers: FakeWorker[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  const saved: { bytes: Uint8Array; filename: string }[] = [];
  const deps: ControllerDependencies = {
    createLayoutWorker: () => { const w = new FakeWorker(); layoutWorkers.push(w); return w; },
    createPdfWorker: () => { const w = new FakeWorker(); pdfWorkers.push(w); return w; },
    storage, now: () => 0,
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    saveFile: (bytes, filename) => { saved.push({ bytes, filename }); },
    limits: PROVISIONAL_LIMITS,
  };
  const c: ExportController = createExportController(deps);
  const fire = (ms: number) => {
    for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); }
  };
  let state = (() => { let s = null as unknown; c.subscribe((x) => { s = x; }); return () => s as import('./types').ControllerState; })();
  c.open(parts, 'Kyrie');
  const lw = (i: number): FakeWorker => { const w = layoutWorkers[i]; if (w === undefined) throw new Error('no layout worker'); return w; };
  const pw = (i: number): FakeWorker => { const w = pdfWorkers[i]; if (w === undefined) throw new Error('no pdf worker'); return w; };
  return { lw, pw, c, layoutWorkers, pdfWorkers, timers, saved, fire, st: () => state(), deps };
}

function ready(t: ReturnType<typeof setup>, token = 1) {
  t.lw(0).emit({ type: 'result', token, result: result(token) });
}

describe('export controller', () => {
  it('opens lazily: loading, token 1 posted', () => {
    const t = setup();
    expect(t.layoutWorkers).toHaveLength(1);
    expect(t.lw(0).layouts).toEqual([1]);
    expect(t.st().phase).toBe('loading');
    ready(t);
    expect(t.st().phase).toBe('ready');
    expect(t.st().canDownload).toBe(true);
  });

  it('discards a stale token-1 result after token 2', () => {
    const t = setup();
    ready(t);
    t.c.updateSettings({ staff: 'large' });
    expect(t.st().requestToken).toBe(2);
    const w = t.lw(0);
    w.emit({ type: 'result', token: 2, result: result(2) });
    w.emit({ type: 'result', token: 1, result: result(1) });
    expect(t.st().result?.token).toBe(2);
    expect(t.st().requestToken).toBe(2);
  });

  it('download during rendering does nothing', async () => {
    const t = setup();
    ready(t);
    t.c.updateSettings({ staff: 'large' });
    expect(t.st().phase).toBe('rendering');
    expect(t.st().previousResult?.token).toBe(1);
    await t.c.download();
    expect(t.pdfWorkers).toHaveLength(0);
    expect(t.st().phase).toBe('rendering');
  });

  it('coalesces a stepper burst of maxSystems into one request', () => {
    const t = setup();
    ready(t);
    for (let i = 1; i <= 5; i++) t.c.updateSettings({ maxSystems: i });
    expect(t.lw(0).layouts).toEqual([1]);
    t.fire(250);
    expect(t.lw(0).layouts).toEqual([1, 2]);
    expect(t.lw(0).posts.filter((p) => p.type === 'layout').pop()?.request?.settings.maxSystems).toBe(5);
  });

  it('a result arriving during the debounce window is not accepted', () => {
    const t = setup();
    t.c.updateSettings({ marginMm: 8 });
    ready(t);
    expect(t.st().phase).not.toBe('ready');
  });

  it('timeout terminates the worker, errors, and recreates it on next post', () => {
    const t = setup();
    t.fire(PROVISIONAL_LIMITS.jobTimeoutMs);
    expect(t.lw(0).terminated).toBe(true);
    expect(t.st().phase).toBe('error');
    expect(t.st().diagnostics[0]?.code).toBe('TIMEOUT');
    expect(t.st().canDownload).toBe(false);
    t.c.updateSettings({ staff: 'small' });
    expect(t.layoutWorkers).toHaveLength(2);
    expect(t.lw(1).layouts).toEqual([2]);
  });

  it('result clears the watchdog', () => {
    const t = setup();
    ready(t);
    t.fire(PROVISIONAL_LIMITS.jobTimeoutMs);
    expect(t.st().phase).toBe('ready');
  });

  it('worker error for the current token sets error phase and keeps settings', () => {
    const t = setup();
    t.c.updateSettings({ staff: 'large' });
    t.lw(0).emit({ type: 'error', token: 2, diagnostic: diag('error') });
    expect(t.st().phase).toBe('error');
    expect(t.st().settings.staff).toBe('large');
    expect(t.st().diagnostics).toHaveLength(1);
    expect(t.st().canDownload).toBe(false);
  });

  it('downloads the PDF with a titled filename', async () => {
    const t = setup();
    ready(t);
    const p = t.c.download();
    expect(t.st().phase).toBe('exporting');
    t.pw(0).emit({ type: 'pdf', token: 1, bytes: new Uint8Array([1, 2]).buffer, pageCount: 1, byteSize: 2 });
    await p;
    expect(t.saved).toHaveLength(1);
    expect(t.saved[0]?.filename).toBe('Kyrie (Letter).pdf');
    expect(t.st().phase).toBe('ready');
  });

  it('a settings change during exporting means saveFile is never called', async () => {
    const t = setup();
    ready(t);
    const p = t.c.download();
    t.c.updateSettings({ staff: 'large' });
    t.pw(0).emit({ type: 'pdf', token: 1, bytes: new ArrayBuffer(1), pageCount: 1, byteSize: 1 });
    await p;
    expect(t.saved).toHaveLength(0);
  });

  it('cancelDownload ignores the pending PDF', async () => {
    const t = setup();
    ready(t);
    const p = t.c.download();
    t.c.cancelDownload();
    t.pw(0).emit({ type: 'pdf', token: 1, bytes: new ArrayBuffer(1), pageCount: 1, byteSize: 1 });
    await p;
    expect(t.saved).toHaveLength(0);
    expect(t.st().phase).toBe('ready');
  });

  it('close during download never saves and terminates both workers', async () => {
    const t = setup();
    ready(t);
    const p = t.c.download();
    const pdf = t.pw(0);
    t.c.close();
    pdf.emit({ type: 'pdf', token: 1, bytes: new ArrayBuffer(1), pageCount: 1, byteSize: 1 });
    t.lw(0).emit({ type: 'result', token: 1, result: result(1) });
    await p;
    expect(t.saved).toHaveLength(0);
    expect(pdf.terminated).toBe(true);
    expect(t.lw(0).terminated).toBe(true);
  });

  it('reset keeps page, customSize and orientation', () => {
    const t = setup();
    t.c.updateSettings({ page: 'a4', orientation: 'landscape', staff: 'large' });
    t.c.setBreak('p1', { boundaryId: 'b1', sourceRevision: 'r1', kind: 'system' });
    t.c.resetLayout();
    const s = t.st();
    expect(s.settings.page).toBe('a4');
    expect(s.settings.orientation).toBe('landscape');
    expect(s.settings.staff).toBe('medium');
    expect(s.overrides).toEqual({});
  });

  it('undo restores previous overrides; stack caps at 50', () => {
    const t = setup();
    const a: BreakOverride = { boundaryId: 'b1', sourceRevision: 'r1', kind: 'system' };
    t.c.setBreak('p1', a);
    t.c.setBreak('p1', { boundaryId: 'b2', sourceRevision: 'r1', kind: 'page' });
    expect(t.st().overrides.p1).toHaveLength(2);
    t.c.undo();
    expect(t.st().overrides.p1).toEqual([a]);
    t.c.setBreak('p1', { boundaryId: 'b1', kind: 'remove' });
    expect(t.st().overrides.p1).toBeUndefined();
    t.c.undo();
    expect(t.st().overrides.p1).toEqual([a]);

    const u = setup();
    for (let i = 0; i < 60; i++) u.c.setBreak('p1', { boundaryId: `b${i}`, sourceRevision: 'r1', kind: 'system' });
    let n = 0;
    while (u.st().canUndo) { u.c.undo(); n++; }
    expect(n).toBe(50);
  });

  it('canDownload is false for error diagnostics or incomplete results', () => {
    const t = setup();
    t.lw(0).emit({ type: 'result', token: 1, result: result(1, { diagnostics: [diag('error')] }) });
    expect(t.st().phase).toBe('ready');
    expect(t.st().canDownload).toBe(false);
    t.c.updateSettings({ staff: 'large' });
    t.lw(0).emit({ type: 'result', token: 2, result: result(2, { complete: false }) });
    expect(t.st().canDownload).toBe(false);
    t.c.updateSettings({ staff: 'small' });
    t.lw(0).emit({ type: 'result', token: 3, result: result(3, { diagnostics: [diag('warning')] }) });
    expect(t.st().canDownload).toBe(true);
  });

  it('writes preferences on change, keyed by target', () => {
    const s = memStorage();
    const t = setup(s);
    t.c.updateSettings({ staff: 'large' });
    t.c.setBreak('p1', { boundaryId: 'b1', sourceRevision: 'r1', kind: 'system' });
    const saved = JSON.parse(s.data[PREFERENCES_KEY] ?? 'null');
    expect(saved.settings.staff).toBe('large');
    expect(saved.overrides['movement:a']).toHaveLength(1);
  });

  it('works with null storage', () => {
    const t = setup(null);
    expect(t.st().notices.some((n) => n.code === 'STORAGE_BLOCKED')).toBe(true);
    t.c.updateSettings({ staff: 'large' });
    expect(t.st().settings.staff).toBe('large');
    expect(t.lw(0).layouts).toEqual([1, 2]);
  });

  it('drops stale overrides on open with a STALE_ANCHOR notice', () => {
    const prefs = {
      version: 2, settings: DEFAULT_SETTINGS,
      overrides: { 'movement:a': [{ boundaryId: 'b1', sourceRevision: 'old', kind: 'system' }] },
    };
    const t = setup(memStorage({ [PREFERENCES_KEY]: JSON.stringify(prefs) }));
    expect(t.st().notices.some((n) => n.code === 'STALE_ANCHOR')).toBe(true);
    expect(t.st().overrides.p1).toBeUndefined();
  });

  it('margin follows the page kind unless the user set one', () => {
    const a = setup();
    a.c.updateSettings({ page: 'ipad-11' });
    expect(a.st().settings.marginMm).toBe(4);
    const b = setup();
    b.c.updateSettings({ marginMm: 18 });
    b.c.updateSettings({ page: 'ipad-11' });
    expect(b.st().settings.marginMm).toBe(18);
    const c = setup();
    c.c.updateSettings({ page: 'ipad-11', marginMm: 7 });
    expect(c.st().settings.marginMm).toBe(7);
  });

  it('subscribe emits immediately and unsubscribes', () => {
    const t = setup();
    let count = 0;
    const off = t.c.subscribe(() => { count++; });
    expect(count).toBe(1);
    off();
    t.c.updateSettings({ staff: 'large' });
    expect(count).toBe(1);
  });
});
