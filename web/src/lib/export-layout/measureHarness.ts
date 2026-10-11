// The in-page half of the timing harness: turns worker messages into Timed results (every time a
// performance.now() difference). Used by the gated test page (window.__measure, driven by
// scripts/measure-export-layout.ts) and by the device timing page, so the timings mean the same thing in both.
import type { Timed } from './measureCore';

interface Pending {
  readonly start: number;
  firstProgressMs: number | null;
  progress: number;
  readonly resolve: (timed: Timed) => void;
}
export interface Wire {
  readonly type: string;
  readonly token: number;
  readonly result?: { readonly complete: boolean; readonly pages: unknown[]; readonly diagnostics: { readonly severity: string; readonly detail: string }[] };
  readonly pageCount?: number;
  readonly byteSize?: number;
  readonly diagnostic?: { readonly detail: string };
}

export interface MeasureCore {
  readonly workersCreatedAt: number;
  /** The last completed layout result, as the PDF worker is given it. */
  lastResult(): unknown;
  layout(request: { readonly request: { readonly token: number } }): Promise<Timed>;
  pdf(token: number): Promise<Timed>;
  onLayoutMessage(message: Wire): void;
  onPdfMessage(message: Wire): void;
}

export function createMeasureCore(post: { layout(request: unknown): void; pdf(message: unknown): void }): MeasureCore {
  const layoutPending = new Map<number, Pending>();
  const pdfPending = new Map<number, Pending>();
  let lastResult: unknown = null;

  function settle(table: Map<number, Pending>, message: Wire, now: number): void {
    const pending = table.get(message.token);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.progress += 1;
      pending.firstProgressMs ??= now - pending.start;
      return;
    }
    table.delete(message.token);
    const firstError = message.result?.diagnostics.find((d) => d.severity === 'error');
    pending.resolve({
      ms: now - pending.start, firstProgressMs: pending.firstProgressMs, progress: pending.progress,
      type: message.type, token: message.token,
      complete: message.result?.complete ?? null,
      pageCount: message.result?.pages.length ?? message.pageCount ?? null,
      byteSize: message.byteSize ?? null,
      errorDetail: message.diagnostic?.detail ?? firstError?.detail ?? null,
    });
  }

  return {
    workersCreatedAt: performance.now(),
    lastResult: () => lastResult,
    layout: (request) => new Promise<Timed>((resolve) => {
      layoutPending.set(request.request.token, { start: performance.now(), firstProgressMs: null, progress: 0, resolve });
      post.layout(request);
    }),
    pdf: (token) => new Promise<Timed>((resolve) => {
      pdfPending.set(token, { start: performance.now(), firstProgressMs: null, progress: 0, resolve });
      post.pdf({ type: 'pdf', token, result: lastResult });
    }),
    onLayoutMessage(message) {
      const now = performance.now();
      if (message.type === 'result') lastResult = message.result;
      settle(layoutPending, message, now);
    },
    onPdfMessage(message) {
      settle(pdfPending, message, performance.now());
    },
  };
}
