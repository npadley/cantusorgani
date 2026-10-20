import type { ExsurgeLib } from "./exsurge";

let library: Promise<ExsurgeLib> | null = null;

/**
 * Loads the vendored Exsurge (/vendor/exsurge/exsurge.min.js) once, however many callers ask
 * (the page's chant switch, the export editor). Reuses `window.exsurge` when a script already set it.
 * A failed load is not cached, so a later call can retry.
 */
export function loadExsurge(): Promise<ExsurgeLib> {
  library ??= new Promise<ExsurgeLib>((resolve, reject) => {
    if (window.exsurge) { resolve(window.exsurge); return; }
    const script = document.createElement("script");
    script.src = "/vendor/exsurge/exsurge.min.js";
    script.onload = () => (window.exsurge ? resolve(window.exsurge) : reject(new Error("no exsurge")));
    script.onerror = () => reject(new Error("exsurge did not load"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    library = null;
    throw error;
  });
  return library;
}

/** Test hook: forget the cached load. */
export function resetExsurgeLoader(): void {
  library = null;
}
