import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testDb } from "./testing";

const databases: ReturnType<typeof testDb>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close(); });

function database(upTo?: number) {
  const db = testDb(upTo);
  databases.push(db);
  return db.sqlite;
}

function insert(db: ReturnType<typeof database>, piece: string, target: string | null, status = "pending") {
  return db.prepare("INSERT INTO corrections (piece_id, target, field, proposed, note, status) VALUES (?, ?, 'gregobaseId', '123', 'private source', ?)")
    .run(piece, target, status);
}

describe("pending report deduplication", () => {
  it.each([
    ["ordinarium-missae-i", "part:ordinarium-missae-i/other:ite", "part:ordinarium-missae-i/other:ite-paschal"],
    ["vespers", "vespers:adv1/antiphon-1", "vespers:adv1/antiphon-2"],
  ])("keeps equal-valued reports for different targets of %s", (piece, first, second) => {
    const db = database();
    insert(db, piece, first);
    expect(() => insert(db, piece, second)).not.toThrow();
    expect(db.prepare("SELECT target FROM corrections ORDER BY id").all()).toEqual([{ target: first }, { target: second }]);
    expect(() => insert(db, piece, first)).toThrow(/UNIQUE/);
  });

  it.each([false, true])("equates legacy null and explicit piece targets (legacy first: %s)", (legacyFirst) => {
    const db = database();
    insert(db, "kyrie-i", legacyFirst ? null : "piece:kyrie-i");
    expect(() => insert(db, "kyrie-i", legacyFirst ? "piece:kyrie-i" : null)).toThrow(/UNIQUE/);
  });

  it("allows a new pending report after an earlier one leaves pending", () => {
    const db = database();
    insert(db, "kyrie-i", null, "approved");
    expect(() => insert(db, "kyrie-i", "piece:kyrie-i")).not.toThrow();
    expect(() => insert(db, "kyrie-i", null)).toThrow(/UNIQUE/);
  });

  it("upgrades a populated database without changing any stored record", () => {
    const db = database(3);
    insert(db, "kyrie-i", null);
    insert(db, "vespers", "vespers:adv1/antiphon-1", "accepted");
    const before = db.prepare("SELECT * FROM corrections ORDER BY id").all();
    db.exec(readFileSync(resolve(__dirname, "../../../../workers/corrections/migrations/0004_target_deduplication.sql"), "utf8"));
    expect(db.prepare("SELECT * FROM corrections ORDER BY id").all()).toEqual(before);
    insert(db, "vespers", "vespers:adv1/antiphon-1");
    expect(() => insert(db, "vespers", "vespers:adv1/antiphon-2")).not.toThrow();
  });

  it("refuses a conflicting rollback without removing target deduplication or reports", () => {
    const db = database();
    insert(db, "vespers", "vespers:adv1/antiphon-1");
    insert(db, "vespers", "vespers:adv1/antiphon-2");
    const before = db.prepare("SELECT * FROM corrections ORDER BY id").all();
    const rollback = readFileSync(resolve(__dirname, "../../../../workers/corrections/rollback/0004_target_deduplication_down.sql"), "utf8");
    expect(() => db.exec(rollback)).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT * FROM corrections ORDER BY id").all()).toEqual(before);
    expect(() => insert(db, "vespers", "vespers:adv1/antiphon-2")).toThrow(/UNIQUE/);
    expect(() => insert(db, "vespers", "vespers:adv1/antiphon-3")).not.toThrow();
  });

  it("restores the old constraint when a rollback has no conflicting reports", () => {
    const db = database();
    insert(db, "vespers", "vespers:adv1/antiphon-1");
    db.exec(readFileSync(resolve(__dirname, "../../../../workers/corrections/rollback/0004_target_deduplication_down.sql"), "utf8"));
    expect(() => insert(db, "vespers", "vespers:adv1/antiphon-2")).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM corrections").get()).toEqual({ n: 1 });
  });
});
