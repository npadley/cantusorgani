/**
 * What is waiting, counted one way everywhere: the admin home, the admin
 * navigation and the Review and Typeset pages all show these numbers
 * (/admin/api/summary).
 *
 * Each list's items were built with the site (/admin/review.json). An item is
 * - **waiting to publish** when an editor has marked it (Looks right,
 *   Proofread) or chosen its part, and that is not yet published;
 * - **skipped** when an editor left a note on it instead;
 * - **left** otherwise: still to do.
 * So `left + waiting + skipped = total`. Published answers are not on the
 * lists at all: the site was rebuilt without them.
 */
import type { ReviewIndex } from "./reviews";

/** A Review group or a Typeset queue. */
export type Bucket = "fix" | "check" | "info" | "matches" | "errors" | "proofreading";
export const BUCKETS: readonly Bucket[] = ["fix", "check", "info", "matches", "errors", "proofreading"];

export interface Count {
  readonly total: number;
  readonly left: number;
  readonly waiting: number;
  readonly skipped: number;
}

export interface Summary {
  /** Readers' reports still to accept or reject. */
  readonly reports: number;
  /** Approved changes waiting for **Publish changes**. */
  readonly approved: number;
  readonly lists: Readonly<Record<Bucket, Count>>;
  /** Every part shown typeset, and how many of them are proofread (published or waiting). */
  readonly proofreading: { readonly parts: number; readonly proofread: number };
  /** The batch on GitHub now, if any. */
  readonly open: { readonly batch: string; readonly pr: number | null; readonly count: number } | null;
}

/** The rows the summary reads: approved or queued corrections. */
export interface SummaryRow {
  readonly field: string;
  readonly target: string | null;
  readonly status: string;
  readonly batch_id: string | null;
  readonly pr_number: number | null;
}

export function summarize(index: ReviewIndex, rows: readonly SummaryRow[], skips: readonly { target: string }[],
                          reports: number): Summary {
  // A review (Looks right, Proofread) or a typeset file's chosen part answers its item.
  const answered = new Set(rows.filter((r) => r.field === "reviewed" ||
    (r.field === "match" && (r.target ?? "").startsWith("typeset:"))).map((r) => r.target ?? ""));
  const skipped = new Set(skips.map((s) => s.target));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, { total: 0, left: 0, waiting: 0, skipped: 0 }])) as
    Record<Bucket, { total: number; left: number; waiting: number; skipped: number }>;
  for (const [target, item] of Object.entries(index.items)) {
    // An index built before buckets: a typeset file is a match to make, anything else a check.
    const bucket = item.bucket ?? (target.startsWith("typeset:") ? "matches" : "check");
    const c = counts[bucket];
    c.total++;
    if (answered.has(target)) c.waiting++;
    else if (skipped.has(target)) c.skipped++;
    else c.left++;
  }
  const parts = index.totals?.proofreading ?? counts.proofreading.total;
  const queued = rows.filter((r) => r.status === "queued" && r.batch_id);
  const first = queued[0];
  return {
    reports,
    approved: rows.filter((r) => r.status === "approved").length,
    lists: counts,
    proofreading: { parts, proofread: parts - counts.proofreading.total + counts.proofreading.waiting },
    open: first ? { batch: first.batch_id as string, pr: first.pr_number,
                    count: queued.filter((r) => r.batch_id === first.batch_id).length } : null,
  };
}
