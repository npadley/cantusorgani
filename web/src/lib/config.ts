/**
 * Public build configuration.
 *
 * Everything here is compiled into the client bundle. The Turnstile *site* key
 * is public by design — it is rendered into the widget markup and identifies the
 * widget, not the account. The Turnstile *secret* key is never here: it lives in
 * Cloudflare, set with `wrangler secret put TURNSTILE_SECRET`, and is only ever
 * read by the Worker.
 */

function orDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

// Each variable by its full name, never `import.meta.env[name]`: Vite replaces
// a static reference with its value alone, whereas a dynamic lookup can inline
// the whole env object -- and web/.env (mounted from 1Password) also holds the
// R2 keys the pipeline uses.

/** Base URL for system slices. Falls back to a local path for development. */
export const ASSET_BASE = orDefault(import.meta.env.PUBLIC_ASSET_BASE, "/systems").replace(/\/$/, "");

export const TURNSTILE_SITE_KEY = orDefault(import.meta.env.PUBLIC_TURNSTILE_SITE_KEY, "");

export const CORRECTIONS_ENDPOINT = orDefault(import.meta.env.PUBLIC_CORRECTIONS_ENDPOINT, "").replace(/\/$/, "");

/**
 * Ceiling on a single PDF export. Slices are ~12 KB each (@2x.png, measured
 * 2026-09-26), so 300 systems is ~3.6 MB of images and ~67 A4 pages -- far more
 * than any day's Proper and Ordinary. It exists to stop a runaway selection,
 * not to ration ordinary use. Shared by the export bar, pdf.ts and the Worker.
 */
export const EXPORT_CEILING = 300;
