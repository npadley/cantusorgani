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
      ["createdAt", "field", "id", "pieceId", "proposedValue", "status", "target"],
    );
  });

  it("emits the validated value, not the raw stored string", () => {
    const row = toPublicRow(ROW);
    expect(row?.proposedValue).toBe("IV");
  });
});

describe("toPublicRow with the admin statuses", () => {
  it("should show approved and queued rows as pending, and a duplicate as rejected", () => {
    const status = (s: string) => toPublicRow({ ...ROW, status: s })?.status;
    expect(status("approved")).toBe("pending");
    expect(status("queued")).toBe("pending");
    expect(status("duplicate")).toBe("rejected");
    expect(status("published")).toBeUndefined();
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

describe("canonical stored fields", () => {
  const cases = [
    { piece_id: "kyrie-i", target: null, field: "printed_pages", proposed: "5-10", publicField: "printedPages" },
    { piece_id: "kyrie-i", target: "piece:kyrie-i", field: "printed_pages", proposed: "5-10", publicField: "printedPages" },
    { piece_id: "ordinarium-missae-i", target: "part:ordinarium-missae-i/other:ite", field: "start_system", proposed: "3", publicField: "startSystem" },
    { piece_id: "ordinarium-missae-i", target: "part:ordinarium-missae-i/other:ite", field: "chant", proposed: "123", publicField: "gregobaseId" },
    { piece_id: "ordinarium-missae-i", target: "pairing:ordinarium-missae-i/kyrie", field: "chant", proposed: "none", publicField: "gregobaseId" },
    { piece_id: "vespers", target: "vespers:adv1/antiphon-1", field: "chant", proposed: "123", publicField: "gregobaseId" },
  ];
  it.each(cases)("keeps $target $field visible through the lifecycle", ({ publicField, ...data }) => {
    for (const [status, publicStatus] of [["approved", "pending"], ["queued", "pending"], ["accepted", "accepted"],
                                        ["pending", "pending"], ["rejected", "rejected"]]) {
      const row = toPublicRow({ ...ROW, ...data, status: status! });
      expect(row).toMatchObject({ field: publicField, status: publicStatus, proposedValue: data.proposed });
      expect(JSON.stringify(row)).not.toContain(ROW.note);
    }
  });

  it.each(["title", "incipit"])("publishes valid editor-normalized %s using the canonical plain-text rule", (field) => {
    expect(toPublicRow({ ...ROW, field, proposed: "Kýrie – fons bonitatis; alternate setting" })?.proposedValue)
      .toBe("Kýrie – fons bonitatis; alternate setting");
    expect(toPublicRow({ ...ROW, field, proposed: "A" })).toBeNull();
    expect(toPublicRow({ ...ROW, field, proposed: "<svg onload=alert(1)>" })).toBeNull();
    expect(toPublicRow({ ...ROW, field, proposed: "Kyrie\u0001" })).toBeNull();
  });

  it("still rejects malformed canonical values and fields on the wrong target kind", () => {
    expect(toPublicRow({ ...ROW, field: "printed_pages", proposed: "<script>" })).toBeNull();
    expect(toPublicRow({ ...ROW, field: "start_system", proposed: "3" })).toBeNull();
    expect(toPublicRow({ ...ROW, piece_id: "vespers", target: "vespers:adv1/antiphon-1", field: "chant", proposed: "not a chant id" })).toBeNull();
  });
});
