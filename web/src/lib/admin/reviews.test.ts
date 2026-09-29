import { describe, expect, it } from "vitest";

import { REVIEW_KINDS, reviewKind } from "./reviewKinds";
import type { QueueItem } from "./reviewKinds";
import { QUEUE, reviewEntries, reviewIndex } from "./reviews";
import { buildTargets } from "./targetIndex";
import { describeTarget } from "./targets";

function item(kind: string, extra: Partial<QueueItem> = {}): QueueItem {
  return { key: `review:noh1/${kind}/0000000${Object.keys(extra).length}`, fingerprint: "abcdefabcdef",
           volume: "noh1", kind, ...extra };
}

describe("reviewKind", () => {
  it("should have words for every kind in the committed review queue", () => {
    const unknown = [...new Set(QUEUE.map((i) => i.kind))].filter((k) => !(k in REVIEW_KINDS));
    expect(unknown).toEqual([]);
  });

  it("should make an unpaired Proper information only, and an unknown kind Other", () => {
    expect(reviewKind({ kind: "unpaired", genre: "proper" }).group).toBe("info");
    expect(reviewKind({ kind: "unpaired", genre: "asperges" }).group).toBe("fix");
    expect(reviewKind({ kind: "something_new" })).toMatchObject({ label: "Other", group: "check" });
  });
});

describe("reviewEntries", () => {
  const entries = reviewEntries();

  it("should list every queue item and part to check once, fix first and information last", () => {
    const targets = entries.map((e) => e.target);
    expect(new Set(targets).size).toBe(targets.length);
    expect(entries.filter((e) => e.target.startsWith("review:"))).toHaveLength(QUEUE.length);
    const groups = entries.map((e) => e.group);
    expect(groups.indexOf("check")).toBeGreaterThan(groups.lastIndexOf("fix"));
    expect(groups.indexOf("info")).toBeGreaterThan(groups.lastIndexOf("check"));
  });

  it("should offer Correct only for targets the edit page can open", () => {
    const targets = buildTargets();
    const correctable = entries.filter((e) => e.correct);
    expect(correctable.length).toBeGreaterThan(0);
    for (const e of correctable) expect(describeTarget(targets, e.correct!), e.correct!).not.toBeNull();
  });

  it("should show the page's systems for a page no piece claims", () => {
    const page = entries.find((e) => e.kind === "segmentation_fallback" && e.about.includes("scan page"));
    expect(page).toBeDefined();
    expect(page!.scans.length).toBeGreaterThan(0);
    expect(page!.scans.length).toBeLessThanOrEqual(4);
  });

  it("should leave out an item reviewed as it is now, and bring it back when it changes", () => {
    const queue = [item("part_missing", { piece: "dominica-i-adventus", part: "alleluia" })];
    const key = queue[0]!.key;
    expect(reviewEntries(queue, { [key]: { was: "abcdefabcdef", date: "2026-09-28" } })
      .filter((e) => e.target === key)).toEqual([]);
    expect(reviewEntries(queue, { [key]: { was: "000000000000", date: "2026-09-28" } })
      .filter((e) => e.target === key)).toHaveLength(1);
  });
});

describe("reviewIndex", () => {
  it("should give each item its fingerprint and piece, for the API to check a review against", () => {
    const entries = reviewEntries();
    const index = reviewIndex(entries);
    const first = entries.find((e) => e.target.startsWith("review:") && e.href)!;
    expect(index.items[first.target]).toMatchObject({ fingerprint: first.fingerprint });
    expect(index.items[first.target]!.piece).toBe(first.href!.split("/")[2]);
  });
});
