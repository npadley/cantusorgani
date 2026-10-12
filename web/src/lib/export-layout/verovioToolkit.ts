// The Verovio engraver, in a module of its own so that the layout worker can import() it only when a part reflows.
// Use the `verovio/wasm` and `verovio/esm` subpaths; the bare `verovio` import is a 7 MB legacy build (S6).
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import type { VerovioLike } from './types';

export async function createToolkit(): Promise<VerovioLike> {
  return new VerovioToolkit(await createVerovioModule());
}
