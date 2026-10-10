/// <reference lib="webworker" />
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

import { loadFontProfile } from "../lib/export-layout/fonts";
import { PROVISIONAL_LIMITS } from "../lib/export-layout/types";
import type { LayoutWorkerRequest, LayoutWorkerResponse, VerovioLike } from "../lib/export-layout/types";
import { composeExport, createRenderPart } from "../lib/export-layout/workerDeps";
import type { FetchBytes } from "../lib/export-layout/workerDeps";
import { createLayoutHandler } from "../lib/export-layout/workerCore";

/**
 * Thin wrapper: wires the real Verovio toolkit, fonts and fetch into the handler in
 * workerCore.ts, where all the message logic (and its tests) live. Use the `verovio/wasm` and
 * `verovio/esm` subpaths; the bare `verovio` import is a 7 MB legacy build (S6).
 */

const fetchBytes: FetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ASSET_MISSING: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
};

const handler = createLayoutHandler({
  loadToolkit: async (): Promise<VerovioLike> => new VerovioToolkit(await createVerovioModule()),
  loadFonts: () => loadFontProfile(fetchBytes),
  limits: PROVISIONAL_LIMITS,
  renderPart: createRenderPart(fetchBytes),
  compose: composeExport,
  post: (message: LayoutWorkerResponse): void => (self as unknown as Worker).postMessage(message),
  now: () => Date.now(),
});

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>): void => {
  void handler.onMessage(event.data);
};
