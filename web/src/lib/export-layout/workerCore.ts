// B7c: the message handling of the two export workers, with every dependency injected so it
// can be unit-tested without a real worker, WASM or fonts. The thin wrappers in
// src/workers/export-layout*.worker.ts wire the real dependencies.
//
// Stale-token rule: only the latest `layout` token may post. A newer request, or a `cancel`,
// makes an older job's `ctx.isCancelled()` return true, and nothing is posted for it. Jobs run
// one at a time because they share one stateful Verovio toolkit; a superseded job notices
// within a part and the next job starts straight after it.
import type {
  BreakOverride,
  ExportPart,
  FontProfile,
  LayoutDiagnostic,
  LayoutDiagnosticCode,
  LayoutResult,
  LayoutSettings,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
  MeiExportPart,
  MeiLayout,
  PdfResult,
  PdfWorkerRequest,
  PdfWorkerResponse,
  RenderContext,
  ResourceLimits,
  VerovioLike,
} from './types';

export interface LayoutHandlerDeps {
  /** Called lazily and at most once while it succeeds; a rejection is retried on the next request. */
  readonly loadToolkit: () => Promise<VerovioLike>;
  /** Same laziness as loadToolkit. A rejection is reported as FONT_UNAVAILABLE. */
  readonly loadFonts: () => Promise<FontProfile>;
  readonly limits: ResourceLimits;
  readonly renderPart: (
    part: MeiExportPart,
    settings: LayoutSettings,
    overrides: readonly BreakOverride[],
    ctx: RenderContext,
  ) => Promise<MeiLayout>;
  readonly compose: (
    parts: readonly ExportPart[],
    layouts: readonly MeiLayout[],
    settings: LayoutSettings,
    token: number,
    fonts: FontProfile,
  ) => Promise<LayoutResult>;
  readonly post: (message: LayoutWorkerResponse) => void;
  /** Reserved for timing; the controller owns the job timeout and terminates the worker. */
  readonly now: () => number;
}

export interface LayoutHandler {
  onMessage(message: LayoutWorkerRequest): Promise<void>;
}

export interface PdfHandlerDeps {
  readonly exportPdf: (result: LayoutResult) => Promise<PdfResult>;
  readonly post: (message: PdfWorkerResponse) => void;
  /** Posts a message and transfers the listed buffers to the page. */
  readonly postTransfer: (message: PdfWorkerResponse, transfer: Transferable[]) => void;
  readonly now: () => number;
}

export interface PdfHandler {
  onMessage(message: PdfWorkerRequest): Promise<void>;
}

function diagnostic(code: LayoutDiagnosticCode, detail: string): LayoutDiagnostic {
  return { code, severity: 'error', partId: null, pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMei(part: ExportPart): part is MeiExportPart {
  return part.kind === 'mei';
}

export function createLayoutHandler(deps: LayoutHandlerDeps): LayoutHandler {
  let toolkitPromise: Promise<VerovioLike> | null = null;
  let fontsPromise: Promise<FontProfile> | null = null;
  let latest = -1;
  const cancelled = new Set<number>();
  let queue: Promise<void> = Promise.resolve();

  const isCurrent = (token: number): boolean => token === latest && !cancelled.has(token);

  function toolkit(): Promise<VerovioLike> {
    if (toolkitPromise === null) {
      const attempt = deps.loadToolkit();
      toolkitPromise = attempt;
      attempt.catch(() => { if (toolkitPromise === attempt) toolkitPromise = null; });
    }
    return toolkitPromise;
  }
  function fonts(): Promise<FontProfile> {
    if (fontsPromise === null) {
      const attempt = deps.loadFonts();
      fontsPromise = attempt;
      attempt.catch(() => { if (fontsPromise === attempt) fontsPromise = null; });
    }
    return fontsPromise;
  }

  function fail(token: number, code: LayoutDiagnosticCode, error: unknown): void {
    if (!isCurrent(token)) return;
    deps.post({ type: 'error', token, diagnostic: diagnostic(code, messageOf(error)) });
  }

  async function run(request: LayoutWorkerRequest & { readonly type: 'layout' }): Promise<void> {
    const { token, parts, settings, overrides } = request.request;
    if (!isCurrent(token)) return;

    let tk: VerovioLike;
    try {
      tk = await toolkit();
    } catch (error) {
      fail(token, 'RENDERER_LOAD_FAILED', error);
      return;
    }
    let fontProfile: FontProfile;
    try {
      fontProfile = await fonts();
    } catch (error) {
      fail(token, 'FONT_UNAVAILABLE', error);
      return;
    }
    if (!isCurrent(token)) return;

    const ctx: RenderContext = {
      token,
      fonts: fontProfile,
      limits: deps.limits,
      isCancelled: () => !isCurrent(token),
      toolkit: tk,
    };

    try {
      const meiParts = parts.filter(isMei);
      const layouts: MeiLayout[] = [];
      for (const part of meiParts) {
        if (!isCurrent(token)) return;
        const layout = await deps.renderPart(part, settings, overrides[part.id] ?? [], ctx);
        if (!isCurrent(token)) return;
        layouts.push(layout);
        deps.post({ type: 'progress', token, partId: part.id, done: layouts.length, total: meiParts.length });
      }
      const result = await deps.compose(parts, layouts, settings, token, fontProfile);
      if (!isCurrent(token)) return;
      deps.post({ type: 'result', token, result });
    } catch (error) {
      fail(token, 'RENDERER_FAILED', error);
    }
  }

  return {
    onMessage(message: LayoutWorkerRequest): Promise<void> {
      if (message.type === 'cancel') {
        cancelled.add(message.token);
        return Promise.resolve();
      }
      latest = message.request.token;
      cancelled.delete(message.request.token);
      const job = queue.then(() => run(message));
      queue = job.catch(() => undefined);
      return job;
    },
  };
}

/** The exact bytes of a view as a standalone, transferable ArrayBuffer. */
function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function createPdfHandler(deps: PdfHandlerDeps): PdfHandler {
  let latest = -1;
  return {
    async onMessage(message: PdfWorkerRequest): Promise<void> {
      const { token, result } = message;
      latest = token;
      try {
        const pdf = await deps.exportPdf(result);
        if (token !== latest) return;
        const bytes = standaloneBuffer(pdf.bytes);
        deps.postTransfer({ type: 'pdf', token, bytes, pageCount: pdf.pageCount, byteSize: pdf.byteSize }, [bytes]);
      } catch (error) {
        if (token !== latest) return;
        deps.post({ type: 'error', token, diagnostic: diagnostic('PDF_FAILED', messageOf(error)) });
      }
    },
  };
}
