/// <reference lib="webworker" />
import type { PdfWorkerRequest, PdfWorkerResponse } from "../lib/export-layout/types";
import { createAssetLoader, createExportPdf } from "../lib/export-layout/workerDeps";
import { createPdfHandler } from "../lib/export-layout/workerCore";

/** Thin wrapper around createPdfHandler; the PDF bytes are transferred, not copied. */
const scope = self as unknown as Worker;

const handler = createPdfHandler({
  exportPdf: createExportPdf(createAssetLoader()),
  post: (message: PdfWorkerResponse): void => scope.postMessage(message),
  postTransfer: (message: PdfWorkerResponse, transfer: Transferable[]): void => scope.postMessage(message, transfer),
  now: () => Date.now(),
});

self.onmessage = (event: MessageEvent<PdfWorkerRequest>): void => {
  void handler.onMessage(event.data);
};
