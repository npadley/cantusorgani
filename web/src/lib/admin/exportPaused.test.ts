import { describe, expect, it } from "vitest";
import { EXPORT_PAUSED, MEI_RECORDS, pausedExports, type MeiRecordSummary, type StaleReport } from "./exportPaused";
import { TYPESET } from "./typesetData";

const record = (patch: Partial<MeiRecordSummary> = {}): MeiRecordSummary => ({
  source_path: "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly",
  target: "movement:ordinarium-missae-ix/kyrie",
  render_hash: "a".repeat(32),
  state: "approved",
  ...patch,
});
const matched = (hash = "a".repeat(32), target = "movement:ordinarium-missae-ix/kyrie") => [{ target, file: "k.ly", hash }];

describe("pausedExports", () => {
  it("should list nothing when the approved record still matches the site's render hash", () => {
    expect(pausedExports([record()], matched(), null)).toEqual([]);
  });

  it("should pause a piece whose render hash moved, naming both hashes", () => {
    const [paused] = pausedExports([record()], matched("b".repeat(32)), null);
    expect(paused?.target).toBe("movement:ordinarium-missae-ix/kyrie");
    expect(paused?.sourcePath).toBe("data/typeset/src/vol-5/missa-ix/kyrie_IX.ly");
    expect(paused?.reasons).toEqual(["The chant source or an include file changed (render hash moved)."]);
    expect(paused?.recordedRenderHash).toBe("a".repeat(32));
    expect(paused?.currentRenderHash).toBe("b".repeat(32));
  });

  it("should pause a piece whose target is no longer in the typeset manifest", () => {
    const [paused] = pausedExports([record()], [], null);
    expect(paused?.reasons[0]).toMatch(/no longer matched/);
    expect(paused?.currentRenderHash).toBeNull();
  });

  it("should ignore records that were never approved", () => {
    expect(pausedExports([record({ state: "needs-review" })], matched("b".repeat(32)), null)).toEqual([]);
  });

  it("should add the reasons from the stale report once, in plain words", () => {
    const report: StaleReport = {
      checked: 1,
      stale: [{
        sourcePath: "data/typeset/src/vol-5/missa-ix/kyrie_IX.ly",
        reasons: [{ reason: "converter" }, { reason: "include" }, { reason: "profile" }, { reason: "profile" }, { reason: "render_hash" }],
      }],
    };
    const [paused] = pausedExports([record()], matched(), report);
    expect(paused?.reasons).toEqual([
      "The MEI converter code changed.",
      "An include file this piece loads changed.",
      "The conversion profile changed.",
    ]);
  });

  it("should not repeat the render hash reason when the report also lists it", () => {
    const report: StaleReport = { checked: 1, stale: [{ sourcePath: record().source_path, reasons: [{ reason: "render_hash" }] }] };
    const [paused] = pausedExports([record()], matched("b".repeat(32)), report);
    expect(paused?.reasons).toHaveLength(1);
  });

  it("should tolerate a missing or malformed stale report", () => {
    expect(pausedExports([record()], matched(), { checked: 0, stale: [] })).toEqual([]);
    expect(pausedExports([record()], matched(), {} as unknown as StaleReport)).toEqual([]);
  });

  it("should sort the paused pieces by target", () => {
    const rows = pausedExports(
      [record({ target: "movement:b/kyrie", source_path: "b.ly" }), record({ target: "movement:a/kyrie", source_path: "a.ly" })],
      [], null,
    );
    expect(rows.map((r) => r.target)).toEqual(["movement:a/kyrie", "movement:b/kyrie"]);
  });
});

describe("the committed records against the committed manifest", () => {
  it("should pause nothing while Kyrie IX's record matches the site manifest", () => {
    expect(MEI_RECORDS.some((r) => r.target === "movement:ordinarium-missae-ix/kyrie" && r.state === "approved")).toBe(true);
    expect(pausedExports(MEI_RECORDS, TYPESET.parts, null)).toEqual([]);
  });

  it("should expose a list for the admin page", () => {
    expect(Array.isArray(EXPORT_PAUSED)).toBe(true);
  });
});
