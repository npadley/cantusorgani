/**
 * Browser-side helpers for the admin pages. Everything shown is built with
 * DOM calls and textContent: values from the database are never parsed as HTML.
 */
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
