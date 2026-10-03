import { describe, expect, it } from "vitest";

import type { ReviewIndex } from "./reviews";
import { summarize } from "./summary";
import type { SummaryRow } from "./summary";

const INDEX: ReviewIndex = {
  items: {
    "review:a": { fingerprint: "1", label: "A", piece: null, bucket: "fix" },
    "review:b": { fingerprint: "2", label: "B", piece: null, bucket: "fix" },
    "review:c": { fingerprint: "3", label: "C", piece: null, bucket: "fix" },
    "review:d": { fingerprint: "4", label: "D", piece: null, bucket: "check" },
    "typeset:m.ly": { fingerprint: "5", label: "M", piece: null, bucket: "matches", review: false },
    "typeset:p.ly": { fingerprint: "6", label: "P", piece: null, bucket: "proofreading" },
    "typeset:q.ly": { fingerprint: "7", label: "Q", piece: null, bucket: "proofreading" },
  },
  totals: { proofreading: 10 },
};

const row = (field: string, target: string, status = "approved", batch: string | null = null): SummaryRow =>
  ({ field, target, status, batch_id: batch, pr_number: batch ? 71 : null });

describe("summarize", () => {
  it("should count each list as left, waiting to publish and skipped, adding up to its total", () => {
    const s = summarize(INDEX, [row("reviewed", "review:a"), row("match", "typeset:m.ly", "queued", "b-1"),
                                row("reviewed", "typeset:p.ly")],
                        [{ target: "review:b" }], 2);
    expect(s.lists.fix).toEqual({ total: 3, left: 1, waiting: 1, skipped: 1 });
    expect(s.lists.check).toEqual({ total: 1, left: 1, waiting: 0, skipped: 0 });
    expect(s.lists.matches).toEqual({ total: 1, left: 0, waiting: 1, skipped: 0 });
    expect(s.reports).toBe(2);
    expect(s.approved).toBe(2);
    expect(s.open).toEqual({ batch: "b-1", pr: 71, count: 1 });
  });

  it("should count proofreading as progress: published, plus waiting, out of every typeset part", () => {
    // 10 parts typeset; 2 still listed (8 proofread and published); 1 of those marked now.
    const s = summarize(INDEX, [row("reviewed", "typeset:p.ly")], [], 0);
    expect(s.proofreading).toEqual({ parts: 10, proofread: 9 });
  });

  it("should not count a review already answered as skipped too", () => {
    const s = summarize(INDEX, [row("reviewed", "review:a")], [{ target: "review:a" }], 0);
    expect(s.lists.fix).toEqual({ total: 3, left: 2, waiting: 1, skipped: 0 });
  });

  it("should read an index built before buckets, and say when nothing is open", () => {
    const old: ReviewIndex = { items: { "review:x": { fingerprint: "1", label: "X", piece: null },
                                        "typeset:y.ly": { fingerprint: "2", label: "Y", piece: null } } };
    const s = summarize(old, [], [], 0);
    expect(s.lists.check.total).toBe(1);
    expect(s.lists.matches.total).toBe(1);
    expect(s.open).toBeNull();
  });
});
