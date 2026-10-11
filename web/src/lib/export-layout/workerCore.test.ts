import { describe, expect, it } from 'vitest';
import { createLayoutHandler, createPdfHandler } from './workerCore';
import type { LayoutHandlerDeps, PdfHandlerDeps } from './workerCore';
import { DEFAULT_SETTINGS, PROVISIONAL_LIMITS } from './types';
import type {
  FontProfile, LayoutRequest, LayoutResult, LayoutWorkerResponse, MeiExportPart, MeiLayout, PdfResult,
  PdfWorkerResponse, ExportPart, VerovioLike,
} from './types';

function mei(id: string): MeiExportPart {
  return {
    id, kind: 'mei', label: id, heading: null, sourceSystemCount: 1, sourceRevision: 'r1', target: `t:${id}`, renderHash: 'r1',
    conversion: { digest: 'd', meiUrl: 'u', meiSha256: 's', sourceRevision: 'r1', profile: 'p', verovio: 'v', boundaries: [], capabilities: { manualBreaks: true } },
  };
}
function scan(id: string): ExportPart {
  return { id, kind: 'scan', label: id, heading: null, sourceSystemCount: 1, sourceRevision: 's', stems: ['a'], customizableAvailable: false };
}
function request(token: number, parts: readonly ExportPart[]): LayoutRequest {
  return { token, title: 'T', parts, settings: DEFAULT_SETTINGS, overrides: {} };
}
function layoutOf(partId: string): MeiLayout {
  return {
    partId, pages: [], effectiveBreaks: { partId, breaks: [], droppedOverrides: [] }, staffHeightMm: 7,
    verovioOptions: {}, diagnostics: [],
  };
}
function resultOf(token: number): LayoutResult {
  return {
    token, partIds: [], digests: { input: '', settings: '', fonts: '', renderer: '', result: '' },
    effectiveBreaks: [], diagnostics: [], pages: [], complete: true,
  };
}
const FONTS = { id: 'leipzig+serif' } as unknown as FontProfile;
const TOOLKIT = {} as unknown as VerovioLike;

/** A promise the test resolves by hand. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

/** Let every already-queued promise continuation run. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function harness(overrides: Partial<LayoutHandlerDeps> = {}) {
  const posted: LayoutWorkerResponse[] = [];
  const counts = { loads: 0 };
  const deps: LayoutHandlerDeps = {
    loadToolkit: async () => { counts.loads += 1; return TOOLKIT; },
    loadFonts: async () => FONTS,
    limits: PROVISIONAL_LIMITS,
    renderPart: async (part) => layoutOf(part.id),
    compose: async (_parts, _layouts, _settings, token) => resultOf(token),
    post: (m) => { posted.push(m); },
    now: () => 0,
    ...overrides,
  };
  return { handler: createLayoutHandler(deps), posted, counts };
}

describe('createLayoutHandler', () => {
  it('renders each mei part, posts progress per part, then the result', async () => {
    const { handler, posted } = harness();
    await handler.onMessage({ type: 'layout', request: request(1, [mei('a'), scan('s'), mei('b')]) });
    expect(posted.map((m) => m.type)).toEqual(['progress', 'progress', 'result']);
    expect(posted[0]).toEqual({ type: 'progress', token: 1, partId: 'a', done: 1, total: 2 });
    expect(posted[1]).toEqual({ type: 'progress', token: 1, partId: 'b', done: 2, total: 2 });
  });

  it('hands compose the parts, the layouts in part order, the settings and the token', async () => {
    let seen: { layouts: readonly string[]; token: number } | null = null;
    const { handler } = harness({
      compose: async (_p, layouts, _s, token) => { seen = { layouts: layouts.map((l) => l.partId), token }; return resultOf(token); },
    });
    await handler.onMessage({ type: 'layout', request: request(4, [mei('a'), mei('b')]) });
    expect(seen).toEqual({ layouts: ['a', 'b'], token: 4 });
  });

  it('loads the toolkit once across requests', async () => {
    const { handler, counts } = harness();
    await handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    await handler.onMessage({ type: 'layout', request: request(2, [mei('a')]) });
    expect(counts.loads).toBe(1);
  });

  it('loads the toolkit once when two requests overlap', async () => {
    const g = gate();
    const { handler, counts } = harness({ loadToolkit: async () => { counts2.loads += 1; await g.promise; return TOOLKIT; } });
    const counts2 = counts;
    const first = handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    const second = handler.onMessage({ type: 'layout', request: request(2, [mei('a')]) });
    g.open();
    await Promise.all([first, second]);
    expect(counts2.loads).toBe(1);
  });

  it('posts only token 2 when token 2 arrives while token 1 is rendering', async () => {
    const g = gate();
    const rendered: number[] = [];
    const { handler, posted } = harness({
      renderPart: async (part, _s, _o, ctx) => {
        rendered.push(ctx.token);
        if (ctx.token === 1) await g.promise;
        return layoutOf(part.id);
      },
    });
    const first = handler.onMessage({ type: 'layout', request: request(1, [mei('a'), mei('b')]) });
    await settle();
    const second = handler.onMessage({ type: 'layout', request: request(2, [mei('a')]) });
    g.open();
    await Promise.all([first, second]);
    expect(posted.every((m) => m.token === 2)).toBe(true);
    expect(posted.map((m) => m.type)).toEqual(['progress', 'result']);
    // Token 1 stopped after its first part; the toolkit was never used by two jobs at once.
    expect(rendered).toEqual([1, 2]);
  });

  it('reports a stale ctx.isCancelled to the renderer as soon as a newer token arrives', async () => {
    const g = gate();
    let flag: (() => boolean) | null = null;
    const { handler } = harness({
      renderPart: async (part, _s, _o, ctx) => { if (ctx.token === 1) { flag = ctx.isCancelled; await g.promise; } return layoutOf(part.id); },
    });
    const first = handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    await settle();
    expect(flag).not.toBeNull();
    expect(flag!()).toBe(false);
    const second = handler.onMessage({ type: 'layout', request: request(2, [mei('a')]) });
    expect(flag!()).toBe(true);
    g.open();
    await Promise.all([first, second]);
  });

  it('posts nothing for a token cancelled before compose', async () => {
    const g = gate();
    let composed = false;
    const { handler, posted } = harness({
      renderPart: async (part) => { await g.promise; return layoutOf(part.id); },
      compose: async (_p, _l, _s, token) => { composed = true; return resultOf(token); },
    });
    const job = handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    await settle();
    await handler.onMessage({ type: 'cancel', token: 1 });
    g.open();
    await job;
    expect(posted).toEqual([]);
    expect(composed).toBe(false);
  });

  it('drops a result when the token is cancelled while compose runs', async () => {
    const g = gate();
    const { handler, posted } = harness({ compose: async (_p, _l, _s, token) => { await g.promise; return resultOf(token); } });
    const job = handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    await settle();
    await handler.onMessage({ type: 'cancel', token: 1 });
    g.open();
    await job;
    expect(posted.filter((m) => m.type === 'result')).toEqual([]);
  });

  it('posts RENDERER_LOAD_FAILED when the toolkit fails to load, with detail only', async () => {
    const { handler, posted } = harness({ loadToolkit: async () => { throw new Error('wasm blocked'); } });
    await handler.onMessage({ type: 'layout', request: request(3, [mei('a')]) });
    expect(posted).toHaveLength(1);
    const msg = posted[0]!;
    expect(msg.type).toBe('error');
    if (msg.type !== 'error') return;
    expect(msg.token).toBe(3);
    expect(msg.diagnostic).toMatchObject({ code: 'RENDERER_LOAD_FAILED', severity: 'error', partId: null, detail: 'wasm blocked' });
  });

  it('retries the toolkit load on the next request after a failure', async () => {
    let attempts = 0;
    const { handler, posted } = harness({
      loadToolkit: async () => { attempts += 1; if (attempts === 1) throw new Error('flaky'); return TOOLKIT; },
    });
    await handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    await handler.onMessage({ type: 'layout', request: request(2, [mei('a')]) });
    expect(posted.map((m) => m.type)).toEqual(['error', 'progress', 'result']);
  });

  it('posts RENDERER_FAILED when a render throws', async () => {
    const { handler, posted } = harness({ renderPart: async () => { throw new Error('boom'); } });
    await handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    expect(posted).toHaveLength(1);
    const msg = posted[0]!;
    if (msg.type !== 'error') throw new Error('expected error');
    expect(msg.diagnostic).toMatchObject({ code: 'RENDERER_FAILED', detail: 'boom' });
  });

  it('posts RENDERER_FAILED when compose throws', async () => {
    const { handler, posted } = harness({ compose: async () => { throw new Error('NOT_WIRED: compose'); } });
    await handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    expect(posted.map((m) => m.type)).toEqual(['progress', 'error']);
    const msg = posted[1]!;
    if (msg.type !== 'error') throw new Error('expected error');
    expect(msg.diagnostic.detail).toBe('NOT_WIRED: compose');
  });

  it('does not post an error for a token that is no longer current', async () => {
    const g = gate();
    const { handler, posted } = harness({
      renderPart: async (part, _s, _o, ctx) => { if (ctx.token === 1) { await g.promise; throw new Error('late'); } return layoutOf(part.id); },
    });
    const first = handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    await Promise.resolve();
    const second = handler.onMessage({ type: 'layout', request: request(2, [mei('a')]) });
    g.open();
    await Promise.all([first, second]);
    expect(posted.every((m) => m.token === 2)).toBe(true);
  });

  it('survives an error and serves the next request', async () => {
    let calls = 0;
    const { handler, posted } = harness({ renderPart: async (part) => { calls += 1; if (calls === 1) throw new Error('x'); return layoutOf(part.id); } });
    await handler.onMessage({ type: 'layout', request: request(1, [mei('a')]) });
    await handler.onMessage({ type: 'layout', request: request(2, [mei('a')]) });
    expect(posted.map((m) => `${m.type}:${m.token}`)).toEqual(['error:1', 'progress:2', 'result:2']);
  });
});

describe('createPdfHandler', () => {
  function pdfHarness(overrides: Partial<PdfHandlerDeps> = {}) {
    const posted: { message: PdfWorkerResponse; transfer: Transferable[] }[] = [];
    const deps: PdfHandlerDeps = {
      exportPdf: async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), pageCount: 1, byteSize: 4 }),
      postTransfer: (message, transfer) => { posted.push({ message, transfer }); },
      post: (message) => { posted.push({ message, transfer: [] }); },
      now: () => 0,
      ...overrides,
    };
    return { handler: createPdfHandler(deps), posted };
  }

  it('posts the pdf with its buffer in the transfer list', async () => {
    const { handler, posted } = pdfHarness();
    await handler.onMessage({ type: 'pdf', token: 5, result: resultOf(5) });
    expect(posted).toHaveLength(1);
    const { message, transfer } = posted[0]!;
    if (message.type !== 'pdf') throw new Error('expected pdf');
    expect(message).toMatchObject({ token: 5, pageCount: 1, byteSize: 4 });
    expect(message.bytes).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(message.bytes))).toEqual([37, 80, 68, 70]);
    expect(transfer).toEqual([message.bytes]);
  });

  it('sends exactly the viewed bytes when the view is a slice of a larger buffer', async () => {
    const big = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const { handler, posted } = pdfHarness({
      exportPdf: async (): Promise<PdfResult> => ({ bytes: big.subarray(2, 5), pageCount: 1, byteSize: 3 }),
    });
    await handler.onMessage({ type: 'pdf', token: 1, result: resultOf(1) });
    const message = posted[0]!.message;
    if (message.type !== 'pdf') throw new Error('expected pdf');
    expect(Array.from(new Uint8Array(message.bytes))).toEqual([1, 2, 3]);
  });

  it('never posts a stale token', async () => {
    const g = gate();
    const { handler, posted } = pdfHarness({
      exportPdf: async (result) => {
        if (result.token === 1) await g.promise;
        return { bytes: new Uint8Array([result.token]), pageCount: 1, byteSize: 1 };
      },
    });
    const first = handler.onMessage({ type: 'pdf', token: 1, result: resultOf(1) });
    await Promise.resolve();
    const second = handler.onMessage({ type: 'pdf', token: 2, result: resultOf(2) });
    g.open();
    await Promise.all([first, second]);
    expect(posted.map((p) => p.message.token)).toEqual([2]);
  });

  it('posts PDF_FAILED with detail only when export throws, and nothing if stale', async () => {
    const { handler, posted } = pdfHarness({ exportPdf: async () => { throw new Error('NOT_WIRED: exportPdf'); } });
    await handler.onMessage({ type: 'pdf', token: 7, result: resultOf(7) });
    const message = posted[0]!.message;
    if (message.type !== 'error') throw new Error('expected error');
    expect(message).toMatchObject({ token: 7, diagnostic: { code: 'PDF_FAILED', severity: 'error', detail: 'NOT_WIRED: exportPdf' } });
    expect(posted[0]!.transfer).toEqual([]);
  });
});
