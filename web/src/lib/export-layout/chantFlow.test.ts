// K6: how chant travels. Controller (main thread) -> worker job -> sanitized lines; a hostile string never draws.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChantLines } from './chantLines';
import { chantScale } from './chantScale';
import { renderChantSvgs } from './chantJob';
import type { ChantJobDeps } from './chantJob';
import { createExportController } from './controller';
import { createLayoutHandler } from './workerCore';
import { DEFAULT_SETTINGS, PREFERENCES_KEY, PROVISIONAL_LIMITS } from './types';
import type {
  ChantLineArt, ChantRef, ControllerDependencies, ExportPart, FontProfile, LayoutRequest, LayoutResult, LayoutSettings,
  LayoutWorkerResponse, ScanExportPart, StorageLike, VerovioLike, WorkerLike,
} from './types';

const REF: ChantRef = { id: 277, incipit: 'Exaltabo te', annotation: 'Grad.', mode: '3' };
const scan = (id: string, chants: readonly ChantRef[]): ScanExportPart => ({
  id, kind: 'scan', label: id, heading: null, sourceSystemCount: 1, chants, sourceRevision: 's', stems: ['a'], customizableAvailable: false,
});
const fixtureSvg = (file: string): string => (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', file), 'utf8')) as { svg: string }).svg;
const BEFORE: LayoutSettings = { ...DEFAULT_SETTINGS, chant: 'before' };

describe('buildChantLines', () => {
  it('turns a fixture into sanitized lines sized by the Medium scale', () => {
    const lines = buildChantLines([scan('s', [REF])], BEFORE, new Map([[277, fixtureSvg('gr-277-1333.json')]]));
    const got = lines.get(277)!;
    expect(got.length).toBe(4);
    expect(got[0]!.widthMm).toBeCloseTo(1333 * chantScale({ ...BEFORE }, 191.9, 'scan').mmPerUnit, 6);
    expect(got.every((l) => l.heightMm > 10 && l.svg.namespace.startsWith('c277l'))).toBe(true);
  });

  it('rejects a malicious chant string: null, never drawn', () => {
    const evil = fixtureSvg('gr-277-1333.json').replace('<defs>', '<defs><foreignObject><script>alert(1)</script></foreignObject>');
    const lines = buildChantLines([scan('s', [REF])], BEFORE, new Map([[277, evil]]));
    expect(lines.get(277)).toBeNull();
    const onclick = fixtureSvg('gr-277-1333.json').replace('<g ', '<g onclick="x()" ');
    expect(buildChantLines([scan('s', [REF])], BEFORE, new Map([[277, onclick]])).get(277)).toBeNull();
  });

  it('marks a chant with no SVG as null, and returns nothing when chant is off or no strings were sent', () => {
    expect(buildChantLines([scan('s', [REF])], BEFORE, new Map()).get(277)).toBeNull();
    expect(buildChantLines([scan('s', [REF])], { ...BEFORE, chant: 'off' }, new Map()).size).toBe(0);
    expect(buildChantLines([scan('s', [REF])], BEFORE, null).size).toBe(0);
  });
});

describe('layout worker with chant', () => {
  it('hands compose the lines built from the job, and a hostile chant arrives as null', async () => {
    const posted: LayoutWorkerResponse[] = [];
    let seen: ReadonlyMap<number, readonly ChantLineArt[] | null> | null = null;
    const handler = createLayoutHandler({
      loadToolkit: async () => ({}) as unknown as VerovioLike,
      loadFonts: async () => ({ id: 'f' }) as unknown as FontProfile,
      limits: PROVISIONAL_LIMITS,
      renderPart: async () => { throw new Error('no mei parts'); },
      compose: async (_p, _l, _s, token, _f, chantLines) => {
        seen = chantLines;
        return { token, partIds: [], digests: { input: '', settings: '', fonts: '', renderer: '', result: '' }, effectiveBreaks: [], diagnostics: [], pages: [], complete: true } satisfies LayoutResult;
      },
      post: (m) => { posted.push(m); },
      now: () => 0,
    });
    const good = fixtureSvg('gr-277-1333.json');
    const request: LayoutRequest = {
      token: 1, title: 'T', parts: [scan('a', [REF]), scan('b', [{ ...REF, id: 9 }])], settings: BEFORE, overrides: {},
      chantSvgs: new Map([[277, good], [9, '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil/x.png"/></svg>']]),
    };
    await handler.onMessage({ type: 'layout', request });
    expect(posted.map((m) => m.type)).toEqual(['result']);
    expect(seen!.get(277)!.length).toBe(4);
    expect(seen!.get(9)).toBeNull();
  });
});

describe('renderChantSvgs', () => {
  const deps = (over: Partial<ChantJobDeps> = {}): { deps: ChantJobDeps; calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        loadLib: async () => { calls.push('lib'); return {} as never; },
        ensureFace: async () => true,
        fetchChant: async (id) => { calls.push(`fetch ${id}`); return { gabc: '(c4)' }; },
        render: async (_l, chant) => `svg${chant.id}`,
        ...over,
      },
    };
  };

  it('loads nothing when chant is off or no part has a chant', async () => {
    const a = deps();
    expect((await renderChantSvgs([scan('s', [REF])], { ...BEFORE, chant: 'off' }, a.deps)).size).toBe(0);
    expect((await renderChantSvgs([scan('s', [])], BEFORE, a.deps)).size).toBe(0);
    expect(a.calls).toEqual([]);
  });

  it('draws each chant once and leaves out one that fails', async () => {
    const a = deps({ fetchChant: async (id) => { if (id === 9) throw new Error('404'); return { gabc: 'x' }; } });
    const out = await renderChantSvgs([scan('a', [REF]), scan('b', [REF, { ...REF, id: 9 }])], BEFORE, a.deps);
    expect([...out]).toEqual([[277, 'svg277']]);
  });

  it('leaves every chant out when the face or Exsurge is unavailable', async () => {
    expect((await renderChantSvgs([scan('s', [REF])], BEFORE, deps({ ensureFace: async () => false }).deps)).size).toBe(0);
    expect((await renderChantSvgs([scan('s', [REF])], BEFORE, deps({ loadLib: async () => { throw new Error('x'); } }).deps)).size).toBe(0);
  });
});

describe('controller with chant', () => {
  class FakeWorker implements WorkerLike {
    posts: { type: string; request?: LayoutRequest }[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    postMessage(m: unknown): void { this.posts.push(m as { type: string; request?: LayoutRequest }); }
    terminate(): void {}
  }
  const setup = (settings: LayoutSettings, parts: ExportPart[], renderChants: ControllerDependencies['renderChants']) => {
    const worker = new FakeWorker();
    const data: Record<string, string> = { [PREFERENCES_KEY]: JSON.stringify({ version: 2, settings, overrides: {} }) };
    const storage: StorageLike = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: () => {} };
    const c = createExportController({
      createLayoutWorker: () => worker, createPdfWorker: () => new FakeWorker(), storage, now: () => 0,
      setTimeout: () => 1, clearTimeout: () => {}, saveFile: () => {}, limits: PROVISIONAL_LIMITS, ...(renderChants ? { renderChants } : {}),
    });
    c.open(parts, 'T');
    return { worker };
  };
  const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

  it('chant Off performs no chant work and sends chantSvgs null', async () => {
    let called = 0;
    const { worker } = setup({ ...DEFAULT_SETTINGS, chant: 'off' }, [scan('s', [REF])], async () => { called += 1; return new Map(); });
    await flush();
    expect(called).toBe(0);
    expect(worker.posts[0]!.request!.chantSvgs).toBeNull();
  });

  it('chant On with chants draws first, then posts the job with the strings', async () => {
    const { worker } = setup(BEFORE, [scan('s', [REF])], async () => new Map([[277, '<svg/>']]));
    expect(worker.posts).toHaveLength(0);
    await flush();
    expect([...worker.posts[0]!.request!.chantSvgs!]).toEqual([[277, '<svg/>']]);
  });

  it('names a chant-only download with the (chant) suffix', async () => {
    const saved: string[] = [];
    const worker = new FakeWorker();
    const pdf = new FakeWorker();
    const data: Record<string, string> = { [PREFERENCES_KEY]: JSON.stringify({ version: 2, settings: { ...DEFAULT_SETTINGS, chant: 'only' }, overrides: {} }) };
    const c = createExportController({
      createLayoutWorker: () => worker, createPdfWorker: () => pdf,
      storage: { getItem: (k) => data[k] ?? null, setItem: () => {}, removeItem: () => {} },
      now: () => 0, setTimeout: () => 1, clearTimeout: () => {}, saveFile: (_b, name) => { saved.push(name); },
      limits: PROVISIONAL_LIMITS, renderChants: async () => new Map([[277, '<svg/>']]),
    });
    c.open([scan('s', [REF])], 'Gradual');
    await flush();
    const token = worker.posts[0]!.request!.token;
    worker.onmessage?.({ data: { type: 'result', token, result: { token, partIds: [], digests: { input: '', settings: '', fonts: '', renderer: '', result: '' }, effectiveBreaks: [], diagnostics: [], pages: [{}], complete: true } } } as MessageEvent);
    void c.download();
    await flush();
    pdf.onmessage?.({ data: { type: 'pdf', token, bytes: new ArrayBuffer(1), pageCount: 1, byteSize: 1 } } as MessageEvent);
    expect(saved).toEqual(['Gradual (Letter) (chant).pdf']);
  });

  it('chant On without chants in the selection does not draw', async () => {
    let called = 0;
    const { worker } = setup(BEFORE, [scan('s', [])], async () => { called += 1; return new Map(); });
    await flush();
    expect(called).toBe(0);
    expect(worker.posts[0]!.request!.chantSvgs).toBeNull();
  });

  it('a failed chant draw still posts the job, with no strings', async () => {
    const { worker } = setup(BEFORE, [scan('s', [REF])], async () => { throw new Error('boom'); });
    await flush();
    expect(worker.posts[0]!.request!.chantSvgs!.size).toBe(0);
  });
});
