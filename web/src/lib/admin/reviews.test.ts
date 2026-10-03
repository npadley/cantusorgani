import { describe, expect, it } from "vitest";

import reviewedJson from "../../../../data/reviewed.json";

import { REVIEW_KINDS, reviewKind } from "./reviewKinds";
import type { QueueItem } from "./reviewKinds";
import { pieceBySlug } from "../catalog";
import { QUEUE, reviewEntries, reviewIndex, settled } from "./reviews";
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

describe("settled", () => {
  const piece = (slug: string) => pieceBySlug(slug)!;

  it("should settle a part not found that a reviewed list has since placed or borrowed", () => {
    // The Ember Saturday of Advent's fourth Gradual is placed by its reviewed list.
    expect(settled(item("part_missing", { part: "gradual", variant: "4" }), piece("sabbato-temporum-adventus"))).toBe(true);
    expect(settled(item("part_missing", { part: "tract", variant: "9" }), piece("sabbato-temporum-adventus"))).toBe(false);
  });

  it("should settle a piece with no music of its own whose page shows the music it cites", () => {
    const silvester = piece("s-silvestri");
    expect(settled(item("no_systems"), silvester)).toBe(true);
    expect(settled(item("starts_mid_page"), silvester)).toBe(true);
    expect(settled(item("no_systems"), { ...silvester, reference: null, referenceSources: [] })).toBe(false);
    expect(settled(item("unpaired"), silvester)).toBe(false);
    expect(settled(item("no_systems"), undefined)).toBe(false);
  });
});

describe("reviewEntries", () => {
  const entries = reviewEntries();

  it("should list every queue item and part to check once, fix first and information last", () => {
    const targets = entries.map((e) => e.target);
    expect(new Set(targets).size).toBe(targets.length);
    // Every item not yet confirmed (data/reviewed.json); a confirmed one is done until a rebuild changes it.
    const done = (reviewedJson as { reviewed: Record<string, { was?: string }> }).reviewed;
    const open = QUEUE.filter((i) => done[i.key]?.was !== i.fingerprint && !settled(i, pieceBySlug(i.piece ?? "")));
    expect(open.length).toBeLessThan(QUEUE.length);
    expect(entries.filter((e) => e.target.startsWith("review:"))).toHaveLength(open.length);
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
    // The committed queue may have none left (NOH5 p. 151 and the rest were re-sliced): use one of its pages.
    const [page] = reviewEntries([item("segmentation_fallback", { volume: "noh5", pdf_page: 197 })])
      .filter((e) => e.kind === "segmentation_fallback");
    expect(page?.about).toContain("scan page 197");
    expect(page!.scans.length).toBeGreaterThan(0);
    expect(page!.scans.length).toBeLessThanOrEqual(4);
  });

  it("should leave out an item reviewed as it is now, and bring it back when it changes", () => {
    const queue = [item("part_missing", { piece: "dominica-i-adventus", part: "tract" })];   // Advent I prints no Tract: never settled
    const key = queue[0]!.key;
    expect(reviewEntries(queue, { [key]: { was: "abcdefabcdef", date: "2026-09-28" } })
      .filter((e) => e.target === key)).toEqual([]);
    expect(reviewEntries(queue, { [key]: { was: "000000000000", date: "2026-09-28" } })
      .filter((e) => e.target === key)).toHaveLength(1);
  });
});

describe("reviewIndex", () => {
  it("should say which list each item is on, and how many parts are typeset in all", () => {
    const index = reviewIndex();
    const buckets = new Set(Object.values(index.items).map((i) => i.bucket));
    expect([...buckets].every((b) => ["fix", "check", "info", "matches", "errors", "proofreading"].includes(b ?? ""))).toBe(true);
    expect(Object.values(index.items).every((i) => i.bucket)).toBe(true);
    expect(index.totals?.proofreading).toBeGreaterThan(0);
  });

  it("should link an item about where a part starts to its piece's Sections screen, and no other", () => {
    const entries = reviewEntries();
    const part = entries.find((e) => e.kind === "part_to_check");
    expect(part?.sections).toMatch(/^\/admin\/sections\/\?piece=[a-z0-9-]+$/);
    expect(entries.filter((e) => e.kind === "unpaired").every((e) => e.sections === null)).toBe(true);
  });

  it("should give each item its fingerprint and piece, for the API to check a review against", () => {
    const entries = reviewEntries();
    const index = reviewIndex(entries);
    const first = entries.find((e) => e.target.startsWith("review:") && e.href)!;
    expect(index.items[first.target]).toMatchObject({ fingerprint: first.fingerprint });
    expect(index.items[first.target]!.piece).toBe(first.href!.split("/")[2]);
  });
});
