import { describe, expect, it } from "vitest";
import { snapshotSelection } from "./selection";
import type { ApprovedConversion, ConversionLookup, SelectionInput } from "./types";

type Run = SelectionInput["segments"][number]["runs"][number];
type Segment = SelectionInput["segments"][number];

const HASH = "a".repeat(32);
const conversion: ApprovedConversion = {
  digest: "b".repeat(64), meiUrl: "/x.mei", meiSha256: "b".repeat(64), sourceRevision: HASH,
  profile: "p", verovio: "6.3.0", boundaries: [], capabilities: { manualBreaks: true },
};
const lookup: ConversionLookup = (target, hash) => (target === "t/ok" && hash === HASH ? conversion : null);

const run = (over: Partial<Run> = {}): Run => ({
  count: 1, key: "k", label: "L", target: "t/ok", hash: HASH, letter: "l.pdf", a4: "a.pdf", showsScans: false, ...over,
});
const scanRun = (count = 1): Run => run({ count, key: null, label: null, target: null, hash: null, letter: null, a4: null });
const segment = (over: Partial<Segment> = {}): Segment => ({
  segmentId: "s", label: "Intr", rubric: "R", rubricTranslation: "T", credit: null, stems: ["a", "b", "c"], runs: [run()], ...over,
});
const input = (...segments: Segment[]): SelectionInput => ({ title: "x", segments });

describe("snapshotSelection", () => {
  it("should keep mei, scan and fixed parts in order", () => {
    const seg = segment({ stems: ["a", "b", "c"], runs: [run(), scanRun(), run({ target: "t/other" })] });
    const parts = snapshotSelection(input(seg), lookup);
    expect(parts.map((p) => p.kind)).toEqual(["mei", "scan", "fixed"]);
    expect(parts.map((p) => p.id)).toEqual(["s:0", "s:1", "s:2"]);
    expect(parts[0]?.sourceRevision).toBe(HASH);
    expect(parts[1]?.sourceRevision).toBe("b");
    expect(parts[0]?.heading).toEqual({ label: "Intr", rubric: "R", rubricTranslation: "T", credit: null });
  });

  it("should make a scan marked customizable when the reader sees scans", () => {
    const [part] = snapshotSelection(input(segment({ stems: ["a"], runs: [run({ showsScans: true })] })), lookup);
    expect(part).toMatchObject({ kind: "scan", stems: ["a"], customizableAvailable: true });
  });

  it("should send the whole segment as one scan when run counts do not sum", () => {
    const parts = snapshotSelection(input(segment({ stems: ["a", "b", "c"], runs: [run({ count: 1 })] })), lookup);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: "scan", stems: ["a", "b", "c"], customizableAvailable: false, sourceSystemCount: 3 });
  });

  it("should fall back to fixed when the render hash is stale", () => {
    const [part] = snapshotSelection(input(segment({ stems: ["a"], runs: [run({ hash: "c".repeat(32) })] })), lookup);
    expect(part?.kind).toBe("fixed");
  });

  it("should merge adjacent scan runs", () => {
    const parts = snapshotSelection(input(segment({ stems: ["a", "b", "c"], runs: [scanRun(), run({ showsScans: true }), scanRun()] })), lookup);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: "scan", stems: ["a", "b", "c"], sourceSystemCount: 3, customizableAvailable: true });
  });

  it("should throw on a duplicate part id", () => {
    expect(() => snapshotSelection(input(segment(), segment()), lookup)).toThrow("DUPLICATE_PART: s:0");
  });
});
