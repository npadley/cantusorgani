/**
 * The admin pages' copy of /admin/api/summary: fetched once per page, again
 * (shortly after) whenever an editor acts, and announced as an `admin:summary`
 * event so the navigation and the admin home redraw their counts from one
 * source.
 */
import { api } from "./client";
import type { Summary } from "./summary";

let current: Promise<Summary | null> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function loadSummary(fresh = false): Promise<Summary | null> {
  if (fresh || !current) {
    current = api<Summary>("/summary").then((r) => (r.ok ? r.data : null));
    void current.then((s) => {
      if (s) document.dispatchEvent(new CustomEvent<Summary>("admin:summary", { detail: s }));
    });
  }
  return current;
}

/** After an action: fetch the counts again once the editor pauses. */
export function refreshSummary(ms = 800): void {
  clearTimeout(timer);
  timer = setTimeout(() => void loadSummary(true), ms);
}

export function onSummary(fn: (s: Summary) => void): void {
  document.addEventListener("admin:summary", (e) => fn((e as CustomEvent<Summary>).detail));
}

/** What the navigation shows beside each page. */
export function navCounts(s: Summary): { home: number; review: number; typeset: number; publish: number } {
  return {
    home: s.reports,
    review: s.lists.fix.left + s.lists.check.left,
    typeset: s.lists.matches.left + s.lists.errors.left,
    publish: s.approved,
  };
}
