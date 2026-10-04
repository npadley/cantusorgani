/// <reference lib="webworker" />
import { buildPdf, httpPdfFetcher, httpPngFetcher, validateSelection } from "../lib/pdf";
import type { Paper, PdfHeading, TypesetInsert } from "../lib/pdf";

/**
 * Thin message-passing wrapper. All assembly logic lives in ../lib/pdf.ts so it
 * can be tested in Node against real slice files -- a browser download triggers
 * a navigation, which makes asserting on it from a test harness unreliable.
 */

export interface BuildRequest {
  readonly refs: readonly string[];
  readonly base: string;
  readonly title: string;
  /** A part's heading above its first system; optional for older callers. */
  readonly headings?: readonly PdfHeading[];
  readonly paper?: Paper;
  /** Typeset music in place of some systems (see buildPdf). */
  readonly typeset?: readonly TypesetInsert[];
}

export type BuildResponse =
  | { readonly kind: "progress"; readonly done: number; readonly total: number }
  | { readonly kind: "ok"; readonly bytes: Uint8Array; readonly pages: number; readonly fallbacks: readonly string[] }
  | { readonly kind: "error"; readonly message: string };

function post(message: BuildResponse): void {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = async (event: MessageEvent<BuildRequest>): Promise<void> => {
  const { refs, base, title, headings, paper, typeset } = event.data;

  const problem = validateSelection(refs.length);
  if (problem) {
    post({ kind: "error", message: problem });
    return;
  }

  try {
    const { bytes, pages, fallbacks } = await buildPdf({
      refs,
      title,
      headings: headings ?? [],
      paper: paper ?? "letter",
      typeset: typeset ?? [],
      fetchPng: httpPngFetcher(base),
      fetchPdf: httpPdfFetcher,
      onProgress: (done, total) => post({ kind: "progress", done, total }),
    });
    post({ kind: "ok", bytes, pages, fallbacks });
  } catch (error) {
    post({
      kind: "error",
      message: error instanceof Error ? error.message : "Export failed.",
    });
  }
};
