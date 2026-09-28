/**
 * Browser-side helpers for the admin pages. Everything shown is built with
 * DOM calls and textContent: values from the database are never parsed as HTML.
 */
import type { Scans, Shown } from "./scans";
import type { Targets } from "./targets";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** A call to /admin/api, with every failure turned into a sentence. */
export async function api<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  const init: RequestInit = { credentials: "same-origin", headers: { accept: "application/json" } };
  if (body !== undefined) {
    init.method = "POST";
    init.headers = { accept: "application/json", "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(`/admin/api${path}`, init);
  } catch {
    return { ok: false, status: 0, error: "Could not reach the site. Check the connection and try again." };
  }
  // Access answers an expired session with its sign-in page, not JSON.
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return { ok: false, status: 401, error: "Your session ended. Sign in again." };
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) return { ok: false, status: response.status, error: data.error ?? `The request failed (${response.status}).` };
  return { ok: true, data };
}

let targetsPromise: Promise<Targets | null> | null = null;
export function loadTargets(): Promise<Targets | null> {
  targetsPromise ??= fetch("/corrections/targets.json", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<Targets>) : null)).catch(() => null);
  return targetsPromise;
}

let scansPromise: Promise<Scans | null> | null = null;
export function loadScans(): Promise<Scans | null> {
  scansPromise ??= fetch("/admin/scans.json", { credentials: "same-origin" })
    .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? (r.json() as Promise<Scans>) : null))
    .catch(() => null);
  return scansPromise;
}

/** The pictures of the systems a correction names, each captioned with its ref. */
export function scanFigures(systems: readonly Shown[], href: string | null): HTMLElement | null {
  if (systems.length === 0) return null;
  return h("div", { class: "scan" },
    ...systems.map((s) => h("figure", {},
      s.stem ? h("img", { src: `${s.stem}.webp`, alt: `${s.caption}, as printed`, loading: "lazy",
                          width: s.aspect ? String(s.aspect[0]) : undefined, height: s.aspect ? String(s.aspect[1]) : undefined })
        : null,
      h("figcaption", { class: "small muted" }, s.caption))),
    href ? h("p", { class: "small" }, h("a", { href }, "Open the page")) : null);
}

/** Runs `fn` once typing pauses: the pictures change while the editor types,
 * never as focus leaves the field, which would move the button being pressed. */
export function whenTypingPauses(fn: () => void, ms = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

type Child = Node | string | null | undefined | false;

/** Builds an element: attributes set as attributes, children appended as text
 * or nodes. */
export function h(tag: string, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value === undefined) continue;
    el.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

/** Announces an outcome to screen readers and shows it. */
export function say(region: HTMLElement | null, message: string, state: "ok" | "error" | "" = ""): void {
  if (!region) return;
  region.textContent = message;
  region.dataset["state"] = state;
}

/** The sign-in link shown when a session has ended: back to this very page. */
export function signInAgain(region: HTMLElement | null): void {
  if (!region) return;
  region.replaceChildren(h("p", { class: "notice" }, "Your session ended. ",
    h("a", { href: location.pathname + location.search }, "Sign in again"), " — your unsaved changes are kept."));
}

/** Per-tab drafts: survive a sign-in round trip, never shared. */
export const drafts = {
  get(key: string): string | null {
    try { return sessionStorage.getItem(`admin:${key}`); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { sessionStorage.setItem(`admin:${key}`, value); } catch { /* storage unavailable */ }
  },
  clear(key: string): void {
    try { sessionStorage.removeItem(`admin:${key}`); } catch { /* storage unavailable */ }
  },
};
