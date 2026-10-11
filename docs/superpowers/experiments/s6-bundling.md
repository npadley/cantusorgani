# S6: Verovio WASM bundling in Astro

Date: 2026-10-08. Branch `export/s6` (throwaway, not merged). Base `811cbfd`.
Verdict: **bundles with no Astro or Vite config changes.** One ambient `.d.ts` is needed because the package ships no types.

## Working import snippet

`web/src/workers/spike-verovio.worker.ts` (spike):

```ts
/// <reference lib="webworker" />
import createVerovioModule from "verovio/wasm";   // ./dist/verovio-module.mjs (WASM inlined)
import { VerovioToolkit } from "verovio/esm";      // ./dist/verovio.mjs (JS wrapper)
import mei from "./fixtures/kyrie-ix.mei?raw";

self.onmessage = async (): Promise<void> => {
  const module = await createVerovioModule();
  const toolkit = new VerovioToolkit(module);
  toolkit.loadData(mei);
  const svg = toolkit.renderToSVG(1);
  (self as unknown as Worker).postMessage({ kind: "ok", svgLength: svg.length, pages: toolkit.getPageCount() });
};
```

Loader, inside an Astro page `<script>` (same pattern as `ExportBar.astro` and `pdf.worker.ts`):

```ts
const worker = new Worker(new URL("../workers/spike-verovio.worker.ts", import.meta.url), { type: "module" });
```

Notes:
- Use the subpaths `verovio/wasm` and `verovio/esm`. The bare `verovio` import resolves to `verovio-toolkit-wasm.js` (7.3 MB, a legacy UMD-style build); do not use it.
- `verovio` has no TypeScript declarations. `web/src/workers/verovio.d.ts` declares the two modules (`createVerovioModule`, and `VerovioToolkit` with `loadData`, `renderToSVG`, `getPageCount`, `getVersion`, `setOptions`, `destroy`) with no `any`. `pnpm typecheck` gives 0 errors with it and 2 errors (TS7016) without it. B4 should extend it.
- The MEI fixture is imported with `?raw`. Production code will pass MEI in by `postMessage`.
- The package is LGPL-3.0-or-later. The licence implications of shipping it in a static bundle have not been assessed.

## Config changes needed

None. `web/astro.config.mjs` and Vite defaults are unchanged. The build prints one warning, which is harmless:
`Module "node:module" has been externalized for browser compatibility, imported by verovio/dist/verovio-module.mjs`.
It comes from the Node-only branch (`if (ENVIRONMENT_IS_NODE) await import("node:module")`). The string is absent from the emitted chunk and is never reached in a browser.

## Emitted chunks

Sizes in bytes; gzip is `gzip -9`. Only files over 90 KB are listed (the other `_astro/*.js` files are about 25 KB each and are pre-existing).

| Chunk | Raw | Gzip | New? |
|---|---:|---:|---|
| `_astro/spike-verovio.worker-a4DAISKg.js` | 8,307,650 (7.92 MiB) | 2,401,338 (2.29 MiB) | yes, the only new file |
| `_astro/pdf.worker-BACaMyRT.js` | 426,584 | 177,399 | existing |
| `_astro/ExportBar.astro_astro_type_script_index_0_lang.CtTBzPFK.js` | 424,271 | 176,663 | existing |
| `_astro/edit.astro_astro_type_script_index_0_lang.CrCR8E4E.js` | 388,349 | 123,602 | existing |
| `_astro/index.astro_astro_type_script_index_0_lang.CeFCamZD.js` | 94,025 | 17,239 | existing |

- Per-file limit: the largest file in `dist/` is the Verovio chunk at 7.92 MiB, against Cloudflare Pages' 25 MiB. `find dist -size +20M` finds nothing. That is about 32% of the limit.
- Verovio is a single self-contained chunk. The 7.3 MB source module accounts for most of it, plus the Verovio JS wrapper and Leipzig/Bravura font data (embedded as base64 woff2).
- The spike page's own script (`/spike-verovio/index.html`, inline) is not a separate file.

## WASM delivery mode

**Inlined, not a separate `.wasm` file.** `verovio-module.mjs` embeds the binary as a string literal decoded by `binaryDecode(...)` in `findWasmBinary()`. No `.wasm` file appears in `dist/`, and `find dist -iname '*.wasm'` is empty. Consequences:
- There is no `application/wasm` MIME or `Content-Type` concern on Cloudflare Pages.
- There is no streaming compile. The 7.3 MB decode happens on the worker thread, which is the right place for it.
- The compressed transfer is about 2.3 MiB (Cloudflare serves brotli, which should be smaller than the gzip figure).
- A new version of the package means a new hashed chunk, so there is no stale-WASM caching problem.

## Ordinary pages do not reference the chunk

Build log: local only (not retained).

```
$ grep -rl verovio dist --include='*.html'
dist/spike-verovio/index.html
```

The only HTML that mentions it is the throwaway test page that creates the worker (`src/pages/spike-verovio.astro`). Across the other 1,650 built pages the result is empty. The same holds for `spike-verovio.worker`. The chunk is referenced only as a `new Worker(new URL(...))` target, and no `modulepreload` or `<script src>` points at it.

The Playwright test also logs requests (below). Visiting `/` and `/piece/dominica-i-adventus/` produced no request matching `verovio`.

This is the one structural precondition B9 needs: the worker is only fetched when `new Worker(...)` runs, which happens only on a page that executes that code. Carry the same pattern into the editor. Keep the `new Worker` call in editor-only code, and never import `verovio` from a shared module that an ordinary page's script also imports.

## Playwright smoke run

`web/e2e/spike-verovio.e2e.ts`, run with `pnpm exec playwright test e2e/spike-verovio.e2e.ts`. It uses the existing `playwright.config.ts` (wrangler `pages dev dist` on port 8799).

```
S6 payload {"kind":"ok","svgLength":243744,"pages":2,"version":"6.3.0-425dd7b","ms":365} verovio-requests [
  'http://localhost:8799/spike-verovio/',
  'http://localhost:8799/_astro/spike-verovio.worker-a4DAISKg.js'
]
  ✓  1 [chromium] › S6: module worker renders the Kyrie IX MEI to SVG (1.3s)
  1 passed (10.1s)
```

- The worker loaded over wrangler's Pages runtime, initialised WASM, parsed the 91 KB MEI and returned a 243,744-character SVG for page 1 (the toolkit reports 2 pages at default options). Init plus load plus render took 365 ms on desktop Chromium.
- The test then visited `/` and `/piece/dominica-i-adventus/`. No `verovio` request was made.
- `ms` is a desktop figure. It says nothing about an iPad.

## Build and the link check

`PUBLIC_ASSET_BASE=/systems pnpm build` runs `astro build`, `build-discovery.ts`, pagefind and then `check-links.ts`.
- With the spike page present, `astro build` (1651 pages), discovery and pagefind all pass, but `check-links.ts` exits 1: `/spike-verovio/` is an orphan ("no link leads to"). That is the spike page's only fault; there is no exemption mechanism in the script. I did not link it from an ordinary page, because that would break the isolation proof.
- `pnpm exec astro build` alone exits 0. In the real editor the entry will be linked, so this will not recur. If the editor page is `noindex` or unlinked, B9 will need a link-check exemption.
- The spike page is wrapped in `Layout.astro`, because `build-discovery.ts` requires canonical, description, `og:url` and `og:image` on every non-noindex page.

## iPadOS module-worker requirement

`new Worker(url, { type: "module" })` needs Safari / iPadOS **15+** (module workers shipped in Safari 15, September 2021). Other relevant facts:
- The existing site already depends on this (`ExportBar.astro` and `pdf.worker.ts` use `{ type: "module" }`), so Verovio adds no new minimum.
- Module workers can use `import`, top-level `await` and `import.meta.url`. The emitted chunk uses `import.meta.url`, so a classic worker would not work.
- iPadOS 14 and earlier (iPad Air 2, iPad mini 4 and older that never got 15) fall back to no editor. B7 should feature-detect and show a message rather than failing. A sketch is `try { new Worker(url, { type: "module" }) }`, since older Safari ignores the `type` option and then fails when the script uses `import`; test with `onerror`.
- **Not verified on a physical device.** This spike ran only in desktop Chromium. The iPad cold-start time, the 7.3 MB base64-to-binary decode and the WASM compile on Safari remain for C2 (device runs). The eng review's concern is a cold start on an older iPad exceeding the 60 s watchdog. The 8 MB source is small enough that this is unlikely, but it is unmeasured.
- Verovio is a large WASM heap. iPad Safari tab memory limits apply to the worker, which is a further C2 check.

## Commands (exit codes)

| Command | Exit |
|---|---:|
| `cd web && pnpm install --frozen-lockfile` | 0 |
| `cd web && pnpm add verovio@6.3.0 --save-exact` | 0 |
| `PUBLIC_ASSET_BASE=/systems pnpm build` (first try, no Layout) | 1 (discovery: missing canonical etc.) |
| `PUBLIC_ASSET_BASE=/systems pnpm build` (with Layout) | 1 (`check-links`: orphan spike page only) |
| `pnpm exec playwright test e2e/spike-verovio.e2e.ts` | 0 |
| `pnpm typecheck` (no `.d.ts`) | 1 (2x TS7016) |
| `pnpm typecheck` (with `verovio.d.ts`) | 0 |
| `PUBLIC_ASSET_BASE=/systems pnpm exec astro build` | 0 |

## Recommendation for B4d and B7c

1. Re-apply `pnpm add verovio@6.3.0 --save-exact` and copy `web/src/workers/verovio.d.ts`.
2. Use the `verovio/wasm` + `verovio/esm` subpath imports as above. No Astro or Vite config change is needed.
3. Keep the `new Worker(new URL(...), { type: "module" })` call only in editor-only code and add the B9 request-log assertion (the spike test is a template).
4. Budget about 2.3 MiB gzip on first editor use. It is cached by hash afterwards.
5. Defer iPad timing and memory to C2.
