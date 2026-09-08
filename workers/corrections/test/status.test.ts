import { describe, expect, it } from "vitest";

import { toPublicRow, toPublicRows } from "../src/status";
import type { StoredRow } from "../src/status";

const ROW: StoredRow = {
  id: 1,
  piece_id: "noh5-ordinarium-missae-i",
  field: "mode",
  proposed: "IV",
  note: "some private remark",
  status: "pending",
  created_at: "2026-09-08 02:14:11",
};

describe("toPublicRow", () => {
  it("omits the submitter's note entirely", () => {
    const row = toPublicRow({ ...ROW, note: "<script>alert(1)</script>" });
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain("script");
    expect(row && "note" in row).toBe(false);
  });

  it("drops a row whose stored value fails revalidation", () => {
    // A row written before a schema tightening is still in the table. "We
    // validated it on input" is a property of the code that ran that day, not
    // of the data.
    expect(toPublicRow({ ...ROW, proposed: "<img onerror=1>" })).toBeNull();
  });

  it("drops a row with an unknown field", () => {
    expect(toPublicRow({ ...ROW, field: "submitter_hash" })).toBeNull();
  });

  it("drops a row with a status outside the enum", () => {
    expect(toPublicRow({ ...ROW, status: "published" })).toBeNull();
  });

  it("drops a row with a malformed timestamp", () => {
    expect(toPublicRow({ ...ROW, created_at: "yesterday" })).toBeNull();
  });

  it("publishes only structural fields", () => {
    const row = toPublicRow(ROW);
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ["createdAt", "field", "id", "pieceId", "proposedValue", "status"],
    );
  });

  it("emits the validated value, not the raw stored string", () => {
    const row = toPublicRow(ROW);
    expect(row?.proposedValue).toBe("IV");
  });
});

describe("toPublicRows", () => {
  it("filters out unpublishable rows without failing the whole page", () => {
    const rows = toPublicRows([
      ROW,
      { ...ROW, id: 2, proposed: "<script>" },
      { ...ROW, id: 3, proposed: "VIII" },
    ]);
    expect(rows.map((r) => r.id)).toEqual([1, 3]);
  });

  it("survives an XSS payload round-tripping through the store", () => {
    const payloads = [
      "<script>alert(1)</script>",
      "\"><svg onload=alert(1)>",
      "javascript:alert(1)",
      "'; DROP TABLE corrections; --",
    ];
    for (const payload of payloads) {
      const rows = toPublicRows([{ ...ROW, proposed: payload }]);
      expect(rows, `payload published: ${payload}`).toHaveLength(0);
    }
  });
});
