import { describe, expect, it } from "vitest";

import reviewedJson from "../../../../data/reviewed.json";

import { REVIEW_KINDS, reviewKind } from "./reviewKinds";
import type { QueueItem } from "./reviewKinds";
import { pieceBySlug } from "../catalog";
import type { BorrowedPart, ChantPairing, Piece, PrintedPart } from "../catalog";
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

  it("should leave out a Proper's missing chant as a whole, and give each kind its confirming words", () => {
    expect(entries.some((e) => e.kind === "unpaired" && e.group === "info")).toBe(false);
    expect(entries.find((e) => e.kind === "part_to_check")?.confirm).toBe("Starts here: right");
    expect(entries.every((e) => e.confirm.length > 0)).toBe(true);
  });

  it("should list every queue item and part to check once, fix first and information last", () => {
    const targets = entries.map((e) => e.target);
    expect(new Set(targets).size).toBe(targets.length);
    // Every item not yet confirmed (data/reviewed.json); a confirmed one is done until a rebuild changes it.
    const done = (reviewedJson as { reviewed: Record<string, { was?: string }> }).reviewed;
    // Less "no chant for the Proper as a whole": a Proper's chants are linked on its parts.
    const open = QUEUE.filter((i) => done[i.key]?.was !== i.fingerprint && !settled(i, pieceBySlug(i.piece ?? ""))
      && !(i.kind === "unpaired" && i.genre === "proper"));
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


// The pipeline queue predates corrections; these current section records are
// the facts the admin list must use to recognize resolved work.
describe("settled corrections after the pipeline queue was written", () => {
  const base = pieceBySlug("dominica-i-adventus")!;
  const printed: PrintedPart = { kind: "printed", part: "gradual", variant: "", system: 0,
    ref: base.systems[0]!, placed: "reviewed", label: null, title: null, gregobaseId: null };
  const lender: Piece = { ...base, slug: "settlement-lender", parts: [printed] };
  const borrowed: BorrowedPart = { kind: "borrowed", part: "gradual", variant: "", label: null, title: null,
    gregobaseId: null, borrowedFrom: lender.slug, borrowedRef: printed.ref, borrowedVolume: lender.volume, borrowedPage: 3 };
  const withPart = (part: PrintedPart | BorrowedPart): Piece => ({ ...base, parts: [part] });
  const partItem = (kind: string, variant = "") => item(kind, { piece: base.slug, part: "gradual", variant });
  const chant: ChantPairing = { source: "gregobase", id: 7, movement: "kyrie", incipit: "Kyrie", mode: "I", score: 1, status: "verified" };

  it("settles an unresolved borrowed-part report only when the lender has a confident music range", () => {
    const queued = partItem("part_borrowed_unresolved");
    expect(settled(queued, withPart(borrowed), [lender])).toBe(true);
    expect(settled(queued, withPart({ ...borrowed, borrowedFrom: null }), [lender])).toBe(false);
    expect(settled(queued, withPart({ ...borrowed, borrowedRef: null }), [lender])).toBe(false);
    expect(settled(queued, withPart(borrowed), [])).toBe(false);
    expect(settled(queued, withPart({ ...borrowed, borrowedRef: "noh1/9999/000" }), [lender])).toBe(false);
    expect(settled(queued, withPart(borrowed), [{ ...lender, parts: [{ ...printed, placed: "order" }] }])).toBe(false);
    expect(settled(queued, withPart(borrowed), [{ ...lender, parts: [] }])).toBe(false);
    expect(settled(partItem("part_borrowed_unresolved", "paschal"), withPart(borrowed), [lender])).toBe(false);
  });

  it("settles parts-not-divided reports once a confident section or resolved borrowed range is present", () => {
    const queued = item("part_unsupported", { piece: base.slug });
    expect(settled(queued, withPart(printed))).toBe(true);
    expect(settled(queued, withPart(borrowed), [lender])).toBe(true);
    expect(settled(queued, { ...base, parts: [] })).toBe(false);
    expect(settled(queued, withPart({ ...printed, placed: "order" }))).toBe(false);
    expect(settled(queued, withPart({ ...printed, ref: "noh1/9999/000" }))).toBe(false);
    expect(settled(queued, withPart(borrowed), [])).toBe(false);
  });

  it("settles guessed-start reports only for the named section now confidently placed", () => {
    expect(settled(partItem("part_by_order"), withPart(printed))).toBe(true);
    expect(settled(partItem("part_by_order"), withPart({ ...printed, placed: "order" }))).toBe(false);
    expect(settled(partItem("part_by_order"), withPart({ ...printed, ref: "noh1/9999/000" }))).toBe(false);
    expect(settled(partItem("part_by_order", "paschal"), withPart(printed))).toBe(false);
  });

  it("settles a missing chant link after a verified pairing, keeping unverified and other-movement links open", () => {
    const paired = { ...base, genre: "mass_ordinary" as const, chant: [chant] };
    expect(settled(item("unpaired"), paired)).toBe(true);
    expect(settled(item("unpaired", { movement: "kyrie" }), paired)).toBe(true);
    expect(settled(item("unpaired", { movement: "gloria" }), paired)).toBe(false);
    expect(settled(item("unpaired"), { ...paired, chant: [{ ...chant, status: "unverified" }] })).toBe(false);
    expect(settled(item("unpaired"), { ...paired, chant: [] })).toBe(false);
  });

  it("settles an unverified-pairing report only after that exact movement is verified", () => {
    const paired = { ...base, genre: "mass_ordinary" as const, chant: [chant] };
    expect(settled(item("unverified_pairing", { movement: "kyrie" }), paired)).toBe(true);
    expect(settled(item("unverified_pairing", { movement: "gloria" }), paired)).toBe(false);
    expect(settled(item("unverified_pairing", { movement: "kyrie" }), { ...paired, chant: [{ ...chant, status: "unverified" }] })).toBe(false);
    expect(settled(item("unverified_pairing"), paired)).toBe(false);
    expect(settled(item("unverified_pairing"), { ...paired, chant: [{ ...chant, movement: null }] })).toBe(true);
  });
});
