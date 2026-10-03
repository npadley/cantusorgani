import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authenticate } from "./auth";
import { fitting, handleAdmin, handleWebhook } from "./api";
import type { AdminEnv, Deps } from "./api";
import { closePullRequest, dispatchBatch, installationToken, newBatchId } from "./github";
import type { Batch } from "./github";
import { d1Store } from "./store";
import { keyPair, piece, readerReport, targets, testDb } from "./testing";
import type { KeyPair } from "./testing";
import { base64UrlDecode } from "./crypto";
import { toPublicRow } from "../../../../workers/corrections/src/status";
import type { StoredRow } from "../../../../workers/corrections/src/status";

const ORIGIN = "http://localhost:8788";
let db: ReturnType<typeof testDb>;
let env: AdminEnv;
let sent: Batch[];
let failDispatch: boolean;
let keys: KeyPair;
let closed: { pr: number; why: string }[];
let failReviews: boolean;

const REVIEW_KEY = "review:noh1/part_by_order/1a2b3c4d";
const REVIEW_INDEX = {
  items: {
    [REVIEW_KEY]: { fingerprint: "0123456789ab", label: "Part placed by its order: Dominica I Adventus · Alleluia",
                    piece: "dominica-i-adventus" },
    "part:dominica-i-adventus/introit": { fingerprint: "start 1, 2 systems", label: "Part to check: Introit",
                                          piece: "dominica-i-adventus" },
    "typeset:vol-5/missa-ix/kyrie_IX.ly": { fingerprint: "a".repeat(32), label: "Proofreading: Missa IX · Kyrie",
                                            piece: "ordinarium-missae-ix" },
    "typeset:vol-5/missa-ix/gloria_IX.ly": { fingerprint: "b".repeat(32), label: "Typeset match: Gloria",
                                             piece: "ordinarium-missae-ix", review: false as const },
  },
};
let failClose: boolean;

beforeAll(async () => { keys = await keyPair(); });

beforeEach(() => {
  db = testDb();
  sent = [];
  failDispatch = false;
  closed = [];
  failReviews = false;
  failClose = false;
  env = { DB: db.d1, EDITORS: "owner@example.org,ed@example.org", ADMIN_DEV_EMAIL: "ed@example.org",
          GITHUB_REPO: "npadley/cantusorgani", GITHUB_APP_ID: "1", GITHUB_INSTALLATION_ID: "2",
          GITHUB_APP_PRIVATE_KEY: "pem", GITHUB_WEBHOOK_SECRET: "hook-secret" };
});

function deps(e: AdminEnv = env): Deps {
  return {
    store: d1Store(db.d1),
    targets: async () => ({
      ...targets(piece("kyrie-i"), piece("dominica-i-adventus", {
        genre: "proper", title: "Dominica I Adventus", mode: null, systems: 6,
        parts: [{ part: "introit", variant: "", system: 1, borrowed: null, chant: 132 },
                { part: "gradual", variant: "", system: 3, borrowed: null, chant: null },
                { part: "offertory", variant: "", system: null, borrowed: "dominica-ii, p. 9", chant: 7 },
                { part: "communion", variant: "", system: 5, borrowed: null, chant: 1036 }],
      }), piece("ordinarium-missae-ix", { genre: "mass_ordinary", title: "Missa IX", mode: null, systems: 4,
                                          movements: ["kyrie", "gloria"] })),
      typeset: {
        "vol-5/missa-ix/kyrie_IX.ly": { label: "movement:ordinarium-missae-ix/kyrie", match: "movement:ordinarium-missae-ix/kyrie", broken: null },
        "vol-5/missa-ix/gloria_IX.ly": { label: "Gloria in excelsis", match: "", broken: null },
        "vol-5/missa-ix/ite_IX.ly": { label: "vol-5/missa-ix/ite_IX.ly", match: "", broken: "LilyPond cannot draw it (line 3: error: x)." },
      },
      vespers: { "vespers:adv1/antiphon-1": { label: "In illa die", when: "Advent I, II Vespers", href: "/vespers/2026-11-29/",
                                               tone: "VIII.G", chant: 2835, stem: null, aspect: null } },
    }),
    reviews: async () => { if (failReviews) throw new Error("review.json: HTTP 500"); return REVIEW_INDEX; },
    dispatch: async (batch) => { if (failDispatch) throw new Error("GitHub is down"); sent.push(batch); },
    authenticate: (req) => authenticate(req, e),
  };
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, e: AdminEnv = env) {
  const init: RequestInit = { method, headers: { origin: ORIGIN, "content-type": "application/json", ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await handleAdmin(new Request(`${ORIGIN}/admin/api${path}`, init), e, deps(e));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function statusOf(id: number): string {
  return (db.sqlite.prepare("SELECT status FROM corrections WHERE id = ?").get(id) as { status: string }).status;
}

describe("public tracking after editor approval", () => {
  it.each([
    ["kyrie-i", null, "printedPages", "2-3"],
    ["dominica-i-adventus", "part:dominica-i-adventus/gradual", "startSystem", "4"],
    ["dominica-i-adventus", "part:dominica-i-adventus/gradual", "gregobaseId", "133"],
  ])("keeps a reader's %s %s %s report visible through publication", async (pieceId, target, field, proposed) => {
    const id = readerReport(db.sqlite, pieceId!, field!, proposed!, "private reader source");
    db.sqlite.prepare("UPDATE corrections SET target = ? WHERE id = ?").run(target, id);
    const publicRow = () => toPublicRow(db.sqlite.prepare("SELECT * FROM corrections WHERE id = ?").get(id) as unknown as StoredRow);
    expect(publicRow()).toMatchObject({ id, field, status: "pending" });
    expect((await call("POST", `/rows/${id}/approve`, {})).status).toBe(200);
    expect(publicRow()).toMatchObject({ id, field, status: "pending" });
    const published = await call("POST", "/publish", {});
    expect(published.status).toBe(200);
    expect(JSON.stringify(sent)).not.toContain("private reader source");
    expect(db.sqlite.prepare("SELECT note FROM corrections WHERE id = ?").get(id)).toMatchObject({ note: "private reader source" });
    expect(publicRow()).toMatchObject({ id, field, status: "pending" });
    await webhook("pull_request", { action: "closed", pull_request: { number: 42, merged: true,
      merge_commit_sha: "abc1234def", head: { ref: `corrections/${published.body["batch"]}` } } });
    expect(publicRow()).toMatchObject({ id, field, status: "accepted" });
    expect(JSON.stringify(publicRow())).not.toContain("private reader source");
  });

  it("retains editor-authored public reasons in publication", async () => {
    expect((await call("POST", "/edits", { target: "piece:kyrie-i", field: "mode", value: "VII", note: "Verified in the printed book" })).status).toBe(201);
    expect((await call("POST", "/publish", {})).status).toBe(200);
    expect(sent[0]?.entries[0]).toMatchObject({ source: "editor", note: "Verified in the printed book" });
  });

  it.each([
    { pieceId: "kyrie-i", target: null, readerField: "printedPages", readerValue: "2-3", field: "system_range", value: "noh5/0001/001-noh5/0001/003" },
    { pieceId: "vespers", target: "vespers:adv1/antiphon-1", readerField: "gregobaseId", readerValue: "123", field: "refs", value: "noh8/0077/000 noh8/0077/001" },
    { pieceId: "vespers", target: "vespers:adv1/antiphon-1", readerField: "gregobaseId", readerValue: "123", field: "note", value: "The music is printed on the next page" },
  ])("keeps a reader report recategorized to $field visible through publication", async ({ pieceId, target, readerField, readerValue, field, value }) => {
    const id = readerReport(db.sqlite, pieceId, readerField, readerValue, "private reader source");
    db.sqlite.prepare("UPDATE corrections SET target = ? WHERE id = ?").run(target, id);
    const publicRow = () => toPublicRow(db.sqlite.prepare("SELECT * FROM corrections WHERE id = ?").get(id) as unknown as StoredRow);
    expect((await call("POST", `/rows/${id}/approve`, { field, value })).status).toBe(200);
    expect(publicRow()).toMatchObject({ id, field, proposedValue: value, status: "pending" });
    const published = await call("POST", "/publish", {});
    expect(published.status).toBe(200);
    expect(publicRow()).toMatchObject({ id, field, status: "pending" });
    expect(JSON.stringify(sent)).not.toContain("private reader source");
    await webhook("pull_request", { action: "closed", pull_request: { number: 42, merged: true,
      merge_commit_sha: "abc1234def", head: { ref: `corrections/${published.body["batch"]}` } } });
    expect(publicRow()).toMatchObject({ id, field, status: "accepted" });
    expect(JSON.stringify(publicRow())).not.toContain("private reader source");
  });
});

async function webhook(event: string, payload: unknown, secret = "hook-secret") {
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const signature = `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const response = await handleWebhook(new Request(`${ORIGIN}/api/github/webhook`, {
    method: "POST", body: raw, headers: { "X-GitHub-Event": event, "X-Hub-Signature-256": signature },
  }), env, d1Store(db.d1), async (pr, why) => {
    if (failClose) throw new Error("GitHub did not close PR #" + pr + " (HTTP 403)");
    closed.push({ pr, why });
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("server errors", () => {
  it("should name a database that is behind the code, instead of crashing", async () => {
    db = testDb(2);
    const { status, body } = await call("GET", "/queue");
    expect(status).toBe(503);
    expect(body["error"]).toMatch(/database needs its latest migration.*pnpm migrate:remote/);
    expect(JSON.stringify(body)).not.toMatch(/no such column|seen/);
  });

  it("should answer any other failure with a plain 500, not the error's text", async () => {
    const broken = { ...deps(), store: { ...d1Store(db.d1), list: async () => { throw new Error("D1_ERROR: disk I/O at 0x7f"); } } };
    const response = await handleAdmin(new Request(`${ORIGIN}/admin/api/queue`, { headers: { origin: ORIGIN } }), env, broken);
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("Something went wrong on the server. Try again; if it keeps happening, tell the owner.");
  });
});

describe("reading", () => {
  it("should say who is signed in, and whether publishing is set up", async () => {
    expect((await call("GET", "/me")).body).toEqual({ email: "ed@example.org", owner: false, publishing: true });
  });

  it("should list a reader's report with its piece, field and current value, and flag what cannot be approved", async () => {
    readerReport(db.sqlite, "noh5-kyrie-i", "printedPages", "1-3", "p. 3 is the Christe");
    readerReport(db.sqlite, "kyrie-i", "chant", "Kyrie IV");
    readerReport(db.sqlite, "gone", "title", "X");
    const { body } = await call("GET", "/queue");
    const pending = body["pending"] as Record<string, unknown>[];
    const pages = pending.find((p) => p["field"] === "printedPages")!;
    expect(pages).toMatchObject({ resolvedTarget: "piece:kyrie-i", resolvedField: "printed_pages", current: "1-2", problem: null });
    expect(pending.find((p) => p["field"] === "chant")!["problem"]).toMatch(/corrected on its parts/);
    expect(pending.find((p) => p["piece_id"] === "gone")!["problem"]).toBe("This piece or item no longer exists.");
    expect(body["lastReviewed"]).toBeNull();
  });
});

describe("acting on a report", () => {
  it("should approve with the editor's value, log it, and tell a second editor who got there first", async () => {
    const id = readerReport(db.sqlite, "kyrie-i", "mode", "VII");
    const first = await call("POST", `/rows/${id}/approve`, { value: "VI" });
    expect(first).toMatchObject({ status: 200, body: { status: "approved", value: "VI" } });
    const row = db.sqlite.prepare("SELECT target, field, proposed, editor_email FROM corrections WHERE id = ?").get(id);
    expect(row).toMatchObject({ target: "piece:kyrie-i", field: "mode", proposed: "VI", editor_email: "ed@example.org" });
    const again = await call("POST", `/rows/${id}/approve`, {}, {}, { ...env, ADMIN_DEV_EMAIL: "owner@example.org" });
    expect(again.status).toBe(409);
    expect(again.body["error"]).toMatch(/^Already approved by ed@example.org \(approve, /);
  });

  it("should refuse an invalid value with the rule in words", async () => {
    const id = readerReport(db.sqlite, "kyrie-i", "mode", "IX");
    const result = await call("POST", `/rows/${id}/approve`, {});
    expect(result).toMatchObject({ status: 422 });
    expect(result.body["error"]).toMatch(/expected I to VIII/);
    expect(statusOf(id)).toBe("pending");
  });

  it("should ask for a reason to reject, and mark duplicates", async () => {
    const a = readerReport(db.sqlite, "kyrie-i", "mode", "VII");
    const b = readerReport(db.sqlite, "kyrie-i", "title", "Lux");
    expect((await call("POST", `/rows/${a}/reject`, {})).status).toBe(400);
    expect((await call("POST", `/rows/${a}/reject`, { reason: "the book says VIII" })).status).toBe(200);
    expect((await call("POST", `/rows/${b}/duplicate`, {})).status).toBe(200);
    expect([statusOf(a), statusOf(b)]).toEqual(["rejected", "duplicate"]);
  });

  it("should send an unapproved report back to review, and withdraw an editor's own edit", async () => {
    const id = readerReport(db.sqlite, "kyrie-i", "mode", "VII");
    await call("POST", `/rows/${id}/approve`, {});
    await call("POST", `/rows/${id}/unapprove`, {});
    expect(statusOf(id)).toBe("pending");
    const edit = await call("POST", "/edits", { target: "piece:kyrie-i", field: "title", value: "Lux et origo lucis" });
    await call("POST", `/rows/${edit.body["id"]}/unapprove`, {});
    expect(statusOf(edit.body["id"] as number)).toBe("rejected");
  });

  it("should refuse changes from another origin, without JSON, or beyond the rate limit", async () => {
    const id = readerReport(db.sqlite, "kyrie-i", "mode", "VII");
    expect((await call("POST", `/rows/${id}/approve`, {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call("POST", `/rows/${id}/approve`, {}, { "content-type": "text/plain" })).status).toBe(415);
    for (let i = 0; i < 120; i++) db.sqlite.prepare("INSERT INTO admin_log (email, action) VALUES ('ed@example.org', 'x')").run();
    expect((await call("POST", `/rows/${id}/approve`, {})).status).toBe(429);
    expect((await call("DELETE", "/queue")).status).toBe(405);
    expect((await call("GET", "/nowhere")).status).toBe(404);
  });
});

describe("a report filed under the wrong field", () => {
  it("should let the editor accept it as the field it really corrects, and log that", async () => {
    // A reader meant Mode 1 but left the form on Title.
    const id = readerReport(db.sqlite, "kyrie-i", "title", "1");
    expect((await call("POST", `/rows/${id}/approve`, {})).body["error"]).toMatch(/at least two letters/);
    const result = await call("POST", `/rows/${id}/approve`, { field: "mode", value: "1" });
    expect(result).toMatchObject({ status: 200, body: { field: "mode", value: "I" } });
    expect(db.sqlite.prepare("SELECT field, proposed FROM corrections WHERE id = ?").get(id)).toMatchObject({ field: "mode", proposed: "I" });
    const log = db.sqlite.prepare("SELECT detail FROM admin_log WHERE action = 'approve'").get() as { detail: string };
    expect(log.detail).toBe("reader filed it under title; reader proposed: 1");
  });

  it("should refuse a mode for a Proper with the reason, and an unknown field", async () => {
    const id = readerReport(db.sqlite, "dominica-i-adventus", "title", "1");
    expect((await call("POST", `/rows/${id}/approve`, { field: "mode", value: "I" })).body["error"]).toMatch(/A Proper has no single mode/);
    expect((await call("POST", `/rows/${id}/approve`, { field: "tone", value: "I" })).status).toBe(422);
  });

  it("should let a chant report be accepted once the editor names a field it can correct", async () => {
    const id = readerReport(db.sqlite, "kyrie-i", "chant", "Lux et origo lucis");
    expect((await call("POST", `/rows/${id}/approve`, {})).status).toBe(422);
    expect((await call("POST", `/rows/${id}/approve`, { field: "incipit" })).status).toBe(200);
  });
});

describe("parts and Vespers items", () => {
  it("should correct where a part starts inside the piece, and not a part printed elsewhere", async () => {
    const ok = await call("POST", "/edits", { target: "part:dominica-i-adventus/gradual", field: "start_system", value: "4" });
    expect(ok).toMatchObject({ status: 201, body: { status: "approved" } });
    expect(ok.body["warning"]).toBeUndefined();
    const outside = await call("POST", "/edits", { target: "part:dominica-i-adventus/gradual", field: "start_system", value: "7" });
    expect(outside.body["error"]).toMatch(/outside the piece, which has 6 systems/);
    const borrowed = await call("POST", "/edits", { target: "part:dominica-i-adventus/offertory", field: "start_system", value: "4" });
    expect(borrowed.body["error"]).toMatch(/printed in another volume \(dominica-ii, p. 9\)/);
  });

  it("should set or clear a part's chant, and correct a Vespers item's tone and chant", async () => {
    expect((await call("POST", "/edits", { target: "part:dominica-i-adventus/gradual", field: "chant", value: "1169" })).status).toBe(201);
    expect((await call("POST", "/edits", { target: "part:dominica-i-adventus/communion", field: "chant", value: "" })).status).toBe(201);
    expect((await call("POST", "/edits", { target: "vespers:adv1/antiphon-1", field: "tone", value: "VIII.G*" })).status).toBe(201);
    expect((await call("POST", "/edits", { target: "vespers:adv1/antiphon-1", field: "tone", value: "IX" })).body["error"]).toMatch(/valid tone/);
    expect((await call("POST", "/edits", { target: "vespers:adv1/antiphon-1", field: "title", value: "X" })).status).toBe(422);
    const rows = db.sqlite.prepare("SELECT target, field, proposed, piece_id FROM corrections ORDER BY id").all();
    expect(rows).toEqual([
      { target: "part:dominica-i-adventus/gradual", field: "chant", proposed: "1169", piece_id: "dominica-i-adventus" },
      { target: "part:dominica-i-adventus/communion", field: "chant", proposed: "none", piece_id: "dominica-i-adventus" },
      { target: "vespers:adv1/antiphon-1", field: "tone", proposed: "VIII.G*", piece_id: "vespers" },
    ]);
  });

  it("should read a reader's report on a part by its target", async () => {
    const id = readerReport(db.sqlite, "dominica-i-adventus", "startSystem", "2");
    db.sqlite.prepare("UPDATE corrections SET target = 'part:dominica-i-adventus/introit' WHERE id = ?").run(id);
    const { body } = await call("GET", "/queue");
    const item = (body["pending"] as Record<string, unknown>[])[0]!;
    expect(item).toMatchObject({ resolvedTarget: "part:dominica-i-adventus/introit", resolvedField: "start_system", current: "1", kind: "part" });
    expect((await call("POST", `/rows/${id}/approve`, {})).status).toBe(200);
  });
});

describe("editing directly", () => {
  it("should record an editor's own fix as approved, and check it like any other", async () => {
    const made = await call("POST", "/edits", { target: "piece:dominica-i-adventus", field: "title", value: "Dominica prima Adventus", note: "p. 3" });
    expect(made).toMatchObject({ status: 201, body: { status: "approved" } });
    expect((await call("POST", "/edits", { target: "piece:kyrie-i", field: "mode", value: "VIII" })).body["error"]).toMatch(/already/);
    expect((await call("POST", "/edits", { target: "vespers:nowhere/antiphon-1", field: "tone", value: "I.g" })).status).toBe(422);
    expect((await call("POST", "/edits", { target: "piece:kyrie-i", field: "chant", value: "x" })).status).toBe(422);
  });
});

describe("a piece's whole list of sections", () => {
  // Dominica I Adventus as the Sections screen would save it: a Tract added, the Offertory kept where it is printed.
  const LIST = [{ kind: "introit", system: 1, chant: 132 }, { kind: "gradual", system: 3, chant: "none" },
                { kind: "tract", title: "Qui regis Israel", system: 4, chant: "none" },
                { kind: "offertory", borrowed_volume: "noh5", borrowed_page: 9, chant: 7 },
                { kind: "communion", system: 5, chant: 1036 }];

  it("should record a list from the Sections screen, longer than any other value, and publish it", async () => {
    const value = JSON.stringify(LIST);
    expect(value.length).toBeGreaterThan(200);
    const made = await call("POST", "/edits", { target: "sections:dominica-i-adventus", field: "sections", value, note: "p. 3" });
    expect(made).toMatchObject({ status: 201, body: { status: "approved" } });
    const approved = ((await call("GET", "/queue")).body["approved"] as Record<string, unknown>[])[0]!;
    expect(approved).toMatchObject({ kind: "sections", resolvedField: "sections", problem: null });
    expect(approved["current"]).toMatch(/^Introit at system 1; Gradual at system 3; Offertory at/);
    await call("POST", "/publish", {});
    expect(sent[0]!.entries[0]).toMatchObject({ target: "sections:dominica-i-adventus", field: "sections", value });
  });

  it("should refuse a list the pipeline would refuse, naming the section", async () => {
    const backwards = JSON.stringify([LIST[1], LIST[0]]);
    const refused = await call("POST", "/edits", { target: "sections:dominica-i-adventus", field: "sections", value: backwards });
    expect(refused).toMatchObject({ status: 422, body: { error: expect.stringMatching(/^Section 2 starts on system 1/) } });
    expect((await call("POST", "/edits", { target: "sections:nowhere", field: "sections", value: "[]" })).status).toBe(422);
  });

  it("should send a reader's report of a missing part to the Sections screen instead of approving it", async () => {
    const id = readerReport(db.sqlite, "dominica-i-adventus", "sections", "system 4: the Tract starts here");
    const item = ((await call("GET", "/queue")).body["pending"] as Record<string, unknown>[])[0]!;
    expect(item).toMatchObject({ resolvedTarget: "sections:dominica-i-adventus", kind: "sections",
                                 problem: expect.stringMatching(/Sections screen/) });
    expect((await call("POST", `/rows/${id}/approve`, {})).status).toBe(422);
    expect((await call("POST", `/rows/${id}/duplicate`, { reason: "fixed on the Sections screen (#2)" })).status).toBe(200);
    expect(statusOf(id)).toBe("duplicate");
  });

  it("should publish only what fits in one dispatch, oldest first, leaving the rest for the next", () => {
    const row = (id: number, size: number) => ({ id, proposed: "x".repeat(size), note: "" }) as Parameters<typeof fitting>[0][number];
    expect(fitting([row(1, 100), row(2, 100), row(3, 100)], 900).map((r) => r.id)).toEqual([1, 2]);
    expect(fitting([row(1, 5000)], 900).map((r) => r.id)).toEqual([1]);          // one too big still goes, alone
  });
});

describe("publishing", () => {
  it("should say so when GitHub is not set up, and when nothing is approved", async () => {
    expect((await call("POST", "/publish", {}, {}, { ...env, GITHUB_APP_ID: "" })).status).toBe(503);
    expect((await call("POST", "/publish", {})).status).toBe(400);
  });

  it("should send approved corrections as one batch, oldest first, and hold publishing while it is open", async () => {
    const reader = readerReport(db.sqlite, "kyrie-i", "mode", "VII", "Liber");
    await call("POST", `/rows/${reader}/approve`, {});
    await call("POST", "/edits", { target: "piece:dominica-i-adventus", field: "title", value: "Dominica prima Adventus" });
    const result = await call("POST", "/publish", {});
    expect(result).toMatchObject({ status: 200, body: { count: 2 } });
    expect(sent[0]!.entries).toEqual([
      { target: "piece:kyrie-i", field: "mode", value: "VII", note: "", source: `reader#${reader}`, editor_email: "ed@example.org" },
      { target: "piece:dominica-i-adventus", field: "title", value: "Dominica prima Adventus", note: "", source: "editor", editor_email: "ed@example.org" },
    ]);
    expect(statusOf(reader)).toBe("queued");
    expect((await call("POST", "/publish", {})).body["error"]).toMatch(/still being opened/);
    const queue = (await call("GET", "/queue")).body;
    expect((queue["batches"] as { items: unknown[] }[])[0]!.items).toHaveLength(2);
  });

  it("should let parts move past each other in either order, and publish only once they are in order", async () => {
    const gradual = await call("POST", "/edits", { target: "part:dominica-i-adventus/gradual", field: "start_system", value: "5" });
    expect(gradual.status).toBe(201);
    expect(gradual.body["warning"]).toMatch(/the Gradual would start on system 5 and the Communion on system 5\. A part runs until the next one starts: move the Communion too\. Publishing waits/);
    expect(gradual.body["fix"]).toEqual({ target: "part:dominica-i-adventus/communion", name: "Communion" });
    const held = await call("POST", "/publish", {});
    expect(held.status).toBe(422);
    expect(held.body["error"]).toMatch(/move the Communion too\. Nothing was published\.$/);
    expect(held.body["fix"]).toEqual({ target: "part:dominica-i-adventus/communion", name: "Communion" });
    expect(sent).toHaveLength(0);
    const communion = await call("POST", "/edits", { target: "part:dominica-i-adventus/communion", field: "start_system", value: "6" });
    expect(communion.body["warning"]).toBeUndefined();
    expect(communion.body["fix"]).toBeUndefined();
    expect(await call("POST", "/publish", {})).toMatchObject({ status: 200, body: { count: 2 } });
  });

  it("should put everything back when GitHub does not answer", async () => {
    await call("POST", "/edits", { target: "piece:kyrie-i", field: "mode", value: "VII" });
    failDispatch = true;
    const result = await call("POST", "/publish", {});
    expect(result.status).toBe(502);
    expect(result.body["error"]).toMatch(/^Publishing did not finish: GitHub is down/);
    expect(db.sqlite.prepare("SELECT status, batch_id FROM corrections").get()).toMatchObject({ status: "approved", batch_id: null });
  });
});

describe("reviews", () => {
  const looksRight = (target = REVIEW_KEY, seen = "0123456789ab", note = "") =>
    call("POST", "/reviews", { target, seen, note });

  it("should record a review as an approved correction, and publish it with what the editor saw", async () => {
    const made = await looksRight();
    expect(made).toMatchObject({ status: 201, body: { status: "approved" } });
    const row = db.sqlite.prepare("SELECT target, field, proposed, seen, piece_id, editor_email FROM corrections WHERE id = ?")
      .get(made.body["id"] as number);
    expect(row).toMatchObject({ target: REVIEW_KEY, field: "reviewed", proposed: "yes", seen: "0123456789ab",
                                piece_id: "dominica-i-adventus", editor_email: "ed@example.org" });
    const queue = (await call("GET", "/queue")).body;
    expect((queue["approved"] as Record<string, unknown>[])[0]).toMatchObject({
      resolvedField: "reviewed", label: "Part placed by its order: Dominica I Adventus · Alleluia", problem: null });
    await call("POST", "/publish", {});
    expect(sent[0]!.entries[0]).toMatchObject({ target: REVIEW_KEY, field: "reviewed", value: "yes", seen: "0123456789ab" });
  });

  it("should review a part to check by its start and length", async () => {
    expect((await looksRight("part:dominica-i-adventus/introit", "start 1, 2 systems")).status).toBe(201);
  });

  it("should refuse an item not on the list, one changed since the page was built, and a second review", async () => {
    expect((await looksRight("review:noh1/part_by_order/ffffffff")).status).toBe(404);
    const changed = await looksRight(REVIEW_KEY, "ffffffffffff");
    expect(changed).toMatchObject({ status: 409, body: { error: expect.stringMatching(/changed since this page was built/) } });
    await looksRight();
    const twice = await looksRight();
    expect(twice).toMatchObject({ status: 409, body: { error: expect.stringMatching(/Already marked .* by ed@example.org/) } });
    expect((await call("POST", "/reviews", { seen: "x" })).status).toBe(400);
  });

  it("should say so when the review list cannot be read", async () => {
    failReviews = true;
    expect((await looksRight()).status).toBe(503);
    expect((await call("GET", "/queue")).status).toBe(200);
  });

  it("should keep a skipped item with its note, drop the skip when reviewed, and remove a skip", async () => {
    expect((await call("POST", "/skips", { target: REVIEW_KEY, note: "" })).status).toBe(400);
    expect((await call("POST", "/skips", { target: REVIEW_KEY, note: "Can't tell from this scan" })).status).toBe(200);
    let state = (await call("GET", "/review-state")).body;
    expect(state["skips"]).toEqual([expect.objectContaining({ target: REVIEW_KEY, note: "Can't tell from this scan",
                                                               editor_email: "ed@example.org" })]);
    await looksRight();
    state = (await call("GET", "/review-state")).body;
    expect(state["skips"]).toEqual([]);
    expect(state["reviews"]).toEqual([expect.objectContaining({ target: REVIEW_KEY, status: "approved" })]);
    await call("POST", "/skips", { target: "part:dominica-i-adventus/introit", note: "Later" });
    expect((await call("POST", "/skips/remove", { target: "part:dominica-i-adventus/introit" })).status).toBe(200);
    expect((await call("POST", "/skips/remove", { target: "part:dominica-i-adventus/introit" })).status).toBe(404);
  });

  it("should withdraw a review before it is published", async () => {
    const made = await looksRight();
    expect((await call("POST", `/rows/${made.body["id"] as number}/unapprove`, {})).status).toBe(200);
    expect(statusOf(made.body["id"] as number)).toBe("rejected");
    expect((await looksRight()).status).toBe(201);
  });
});

describe("reopen", () => {
  it("should put a rejected or duplicate reader's report back to be answered, and refuse anything else", async () => {
    const id = readerReport(db.sqlite, "kyrie-i", "title", "Kyrie I");
    await call("POST", `/rows/${id}/reject`, { reason: "Not so in the book" });
    expect(statusOf(id)).toBe("rejected");
    expect((await call("POST", `/rows/${id}/reopen`, {})).status).toBe(200);
    expect(statusOf(id)).toBe("pending");
    expect(db.sqlite.prepare("SELECT reason FROM corrections WHERE id = ?").get(id)).toMatchObject({ reason: null });
    await call("POST", `/rows/${id}/duplicate`, {});
    expect((await call("POST", `/rows/${id}/reopen`, {})).status).toBe(200);
    expect(statusOf(id)).toBe("pending");
    // Pending already, or an editor's own fix: nothing to reopen.
    expect((await call("POST", `/rows/${id}/reopen`, {})).status).toBe(409);
  });
});

describe("summary", () => {
  it("should count what is left on each list, what waits to publish and what was skipped, and the reports", async () => {
    readerReport(db.sqlite, "kyrie-i", "title", "Kyrie I");
    await call("POST", "/reviews", { target: REVIEW_KEY, seen: "0123456789ab" });
    await call("POST", "/skips", { target: "part:dominica-i-adventus/introit", note: "Later" });
    await call("POST", "/edits", { target: "typeset:vol-5/missa-ix/gloria_IX.ly", field: "match",
                                   value: "movement:ordinarium-missae-ix/gloria" });
    const got = await call("GET", "/summary");
    expect(got.status).toBe(200);
    // REVIEW_INDEX has no buckets: typeset files count as matches, the rest as checks.
    expect(got.body).toMatchObject({
      reports: 1, approved: 2, open: null,
      lists: { check: { total: 2, left: 0, waiting: 1, skipped: 1 }, matches: { total: 2, left: 1, waiting: 1, skipped: 0 } },
    });
  });

  it("should still count the reports when the review list cannot be read", async () => {
    failReviews = true;
    readerReport(db.sqlite, "kyrie-i", "title", "Kyrie I");
    const got = await call("GET", "/summary");
    expect(got).toMatchObject({ status: 200, body: { reports: 1, lists: { fix: { total: 0 } } } });
  });
});

describe("typeset music", () => {
  const GLORIA = "typeset:vol-5/missa-ix/gloria_IX.ly";
  const choose = (target: string, value: string) => call("POST", "/edits", { target, field: "match", value });

  it("should record which part a file is as an approved correction, and publish it", async () => {
    const made = await choose(GLORIA, "movement:ordinarium-missae-ix/gloria");
    expect(made).toMatchObject({ status: 201, body: { status: "approved" } });
    const state = (await call("GET", "/review-state")).body;
    expect(state["choices"]).toEqual([expect.objectContaining({ target: GLORIA, value: "movement:ordinarium-missae-ix/gloria",
                                                                 status: "approved" })]);
    const queue = (await call("GET", "/queue")).body;
    expect((queue["approved"] as Record<string, unknown>[])[0]).toMatchObject({ resolvedField: "match", kind: "typeset", problem: null });
    await call("POST", "/publish", {});
    expect(sent[0]!.entries[0]).toMatchObject({ target: GLORIA, field: "match", value: "movement:ordinarium-missae-ix/gloria" });
  });

  it("should accept none and other-setting, and refuse a part the catalogue does not have", async () => {
    expect((await choose(GLORIA, "none")).status).toBe(201);
    expect((await choose("typeset:vol-5/missa-ix/ite_IX.ly", "other-setting")).status).toBe(201);
    const missing = await choose(GLORIA, "movement:ordinarium-missae-ix/credo");
    expect(missing).toMatchObject({ status: 422, body: { error: expect.stringMatching(/not a part, Mass movement or single-chant piece/) } });
    expect((await choose(GLORIA, "part:dominica-i-adventus/offertory")).status).toBe(422);   // printed elsewhere
    expect((await choose(GLORIA, "<script>")).status).toBe(422);
  });

  it("should refuse to show a file LilyPond cannot draw, and what it already is", async () => {
    const broken = await choose("typeset:vol-5/missa-ix/ite_IX.ly", "movement:ordinarium-missae-ix/gloria");
    expect(broken).toMatchObject({ status: 422, body: { error: expect.stringMatching(/cannot draw it.*Fix the file first/) } });
    const same = await choose("typeset:vol-5/missa-ix/kyrie_IX.ly", "movement:ordinarium-missae-ix/kyrie");
    expect(same.body["error"]).toMatch(/already/);
    expect((await choose("typeset:vol-5/missa-ix/credo_IX.ly", "none")).status).toBe(422);
  });

  it("should name who chose a part already chosen for another file", async () => {
    await choose(GLORIA, "movement:ordinarium-missae-ix/kyrie");
    const other = { ...deps(), targets: async () => ({ ...(await deps().targets()), typeset: {
      "vol-5/missa-ix/gloria_IX.ly": { label: "Gloria", match: "", broken: null },
      "vol-5/missa-ix/kyrie_IX.ly": { label: "Kyrie", match: "", broken: null } } }) };
    const response = await handleAdmin(new Request(`${ORIGIN}/admin/api/edits`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ target: "typeset:vol-5/missa-ix/kyrie_IX.ly", field: "match", value: "movement:ordinarium-missae-ix/kyrie" }),
    }), env, other);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/gloria_IX\.ly is already chosen as movement:ordinarium-missae-ix\/kyrie \(by ed@example\.org\)/);
  });

  it("should record proofreading with the render hash, and refuse it for a file still to be matched", async () => {
    const proof = await call("POST", "/reviews", { target: "typeset:vol-5/missa-ix/kyrie_IX.ly", seen: "a".repeat(32) });
    expect(proof.status).toBe(201);
    const early = await call("POST", "/reviews", { target: GLORIA, seen: "b".repeat(32) });
    expect(early).toMatchObject({ status: 422, body: { error: expect.stringMatching(/still to be matched/) } });
    expect((await call("POST", "/skips", { target: GLORIA, note: "Two candidates look alike" })).status).toBe(200);
  });
});

describe("the webhook", () => {
  async function published(): Promise<{ id: number; batch: string }> {
    const made = await call("POST", "/edits", { target: "piece:kyrie-i", field: "mode", value: "VII" });
    const { body } = await call("POST", "/publish", {});
    return { id: made.body["id"] as number, batch: body["batch"] as string };
  }

  it("should refuse an unsigned or wrongly signed delivery", async () => {
    expect((await webhook("ping", {}, "wrong")).status).toBe(401);
    expect((await webhook("ping", {})).body).toEqual({ ok: true, ignored: true });
  });

  it("should record the pull request, then accept the batch when it is merged", async () => {
    const { id, batch } = await published();
    await webhook("pull_request", { action: "opened", pull_request: { number: 42, head: { ref: `corrections/${batch}` } } });
    expect((await call("POST", "/publish", {})).body["error"]).toBe("PR #42 is open: it merges itself when its checks pass, unless it waits for the owner. Publish again once it is merged or closed.");
    await webhook("pull_request", { action: "closed", pull_request: { number: 42, merged: true, merge_commit_sha: "abc1234def",
                                                                      head: { ref: `corrections/${batch}` } } });
    expect(db.sqlite.prepare("SELECT status, commit_sha, pr_number FROM corrections WHERE id = ?").get(id))
      .toMatchObject({ status: "accepted", commit_sha: "abc1234def", pr_number: 42 });
  });

  it("should return a batch to review when its PR is closed unmerged, and to approved when its run fails", async () => {
    const first = await published();
    await webhook("pull_request", { action: "closed", pull_request: { number: 7, merged: false, head: { ref: `corrections/${first.batch}` } } });
    expect(db.sqlite.prepare("SELECT status, reason FROM corrections WHERE id = ?").get(first.id))
      .toMatchObject({ status: "approved", reason: "PR #7 was closed without merging" });
    const second = await published();
    await webhook("workflow_run", { action: "completed", workflow_run: { name: `corrections ${second.batch}`, path: ".github/workflows/corrections-batch.yml", conclusion: "failure",
      display_title: `corrections ${second.batch}`, html_url: "https://github.com/x/actions/runs/1" } });
    expect(db.sqlite.prepare("SELECT status, reason FROM corrections WHERE id = ?").get(second.id))
      .toMatchObject({ status: "approved", reason: "Publishing failed; see https://github.com/x/actions/runs/1 on GitHub" });
  });

  it("should close the pull request and return the batch to approved when the site's checks fail on it", async () => {
    const { id, batch } = await published();
    await webhook("pull_request", { action: "opened", pull_request: { number: 42, head: { ref: `corrections/${batch}` } } });
    const failed = { name: "site", conclusion: "failure", head_branch: `corrections/${batch}`,
                     html_url: "https://github.com/x/actions/runs/9" };
    expect((await webhook("workflow_run", { action: "completed", workflow_run: failed })).body).toEqual({ ok: true, updated: 1 });
    expect(db.sqlite.prepare("SELECT status, reason, batch_id FROM corrections WHERE id = ?").get(id))
      .toMatchObject({ status: "approved", reason: "The site's checks failed; see https://github.com/x/actions/runs/9 on GitHub",
                       batch_id: null });
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ pr: 42 });
    expect(closed[0]?.why).toMatch(/back on the admin screen under Approved/);
    // The close then arrives as a pull_request event: nothing is left queued, so nothing moves.
    await webhook("pull_request", { action: "closed", pull_request: { number: 42, merged: false, head: { ref: `corrections/${batch}` } } });
    expect(statusOf(id)).toBe("approved");
    // A repeat delivery of the failure finds nothing to do.
    expect((await webhook("workflow_run", { action: "completed", workflow_run: failed })).body).toEqual({ ok: true, ignored: true });
    expect(closed).toHaveLength(1);
  });

  it("should leave a batch queued when the site's checks pass, are cancelled, or are on another branch", async () => {
    const { id, batch } = await published();
    for (const run of [{ name: "site", conclusion: "success", head_branch: `corrections/${batch}` },
                       { name: "site", conclusion: "cancelled", head_branch: `corrections/${batch}` },
                       { name: "site", conclusion: "failure", head_branch: "feat/typesetting" }]) {
      expect((await webhook("workflow_run", { action: "completed", workflow_run: run })).body).toEqual({ ok: true, ignored: true });
    }
    expect(statusOf(id)).toBe("queued");
    expect(closed).toEqual([]);
  });

  it("should still return the batch, and log why, when GitHub will not close the pull request", async () => {
    const { id, batch } = await published();
    failClose = true;
    await webhook("workflow_run", { action: "completed", workflow_run: {
      name: "site", conclusion: "timed_out", head_branch: `corrections/${batch}`, pull_requests: [{ number: 5 }] } });
    expect(statusOf(id)).toBe("approved");
    expect(db.sqlite.prepare("SELECT detail FROM admin_log WHERE action = 'close-failed'").get())
      .toMatchObject({ detail: expect.stringContaining("PR #5") });
  });

  it("should ignore pull requests that are not correction batches", async () => {
    const { body } = await webhook("pull_request", { action: "opened", pull_request: { number: 3, head: { ref: "feature/x" } } });
    expect(body).toEqual({ ok: true, ignored: true });
  });
});

describe("GitHub", () => {
  it("should comment on a pull request, then close it, as the App", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.endsWith("/access_tokens")) return Response.json({ token: "inst-token" }, { status: 201 });
      calls.push({ url, method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) });
      return Response.json({}, { status: url.includes("/comments") ? 201 : 200 });
    };
    const ghEnv = { GITHUB_REPO: "npadley/cantusorgani", GITHUB_APP_ID: "123", GITHUB_INSTALLATION_ID: "456", GITHUB_APP_PRIVATE_KEY: keys.pem };
    await closePullRequest(ghEnv, 42, "Checks failed.", fetcher);
    expect(calls).toEqual([
      { url: "https://api.github.com/repos/npadley/cantusorgani/issues/42/comments", method: "POST", body: { body: "Checks failed." } },
      { url: "https://api.github.com/repos/npadley/cantusorgani/pulls/42", method: "PATCH", body: { state: "closed" } },
    ]);
  });

  it("should sign in as the App with a JWT GitHub can verify, then start the workflow", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push(init === undefined ? { url } : { url, init });
      if (url.endsWith("/access_tokens")) return Response.json({ token: "inst-token" }, { status: 201 });
      return new Response(null, { status: 204 });
    };
    const ghEnv = { GITHUB_REPO: "npadley/cantusorgani", GITHUB_APP_ID: "123", GITHUB_INSTALLATION_ID: "456", GITHUB_APP_PRIVATE_KEY: keys.pem };
    await dispatchBatch(ghEnv, { batch: "b-202609271200-abc123", entries: [] }, fetcher);
    expect(calls.map((c) => c.url)).toEqual(["https://api.github.com/app/installations/456/access_tokens",
                                             "https://api.github.com/repos/npadley/cantusorgani/dispatches"]);
    const jwt = String((calls[0]!.init!.headers as Record<string, string>)["authorization"]).replace("Bearer ", "");
    const [h, p, sig] = jwt.split(".") as [string, string, string];
    const publicKey = await crypto.subtle.importKey("jwk", { kty: "RSA", n: keys.jwk.n as string, e: keys.jwk.e as string, alg: "RS256", ext: true },
                                                    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64UrlDecode(sig).slice().buffer as ArrayBuffer,
                                              new TextEncoder().encode(`${h}.${p}`));
    expect(signed).toBe(true);
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as Record<string, unknown>;
    expect(payload["iss"]).toBe("123");
    expect(JSON.parse(String(calls[1]!.init!.body))).toMatchObject({ event_type: "corrections-batch" });
  });

  it("should report GitHub refusing the App or the dispatch", async () => {
    const ghEnv = { GITHUB_APP_ID: "1", GITHUB_INSTALLATION_ID: "2", GITHUB_APP_PRIVATE_KEY: keys.pem, GITHUB_REPO: "a/b" };
    await expect(installationToken(ghEnv, async () => new Response("no", { status: 401 }))).rejects.toThrow(/HTTP 401/);
    const fetcher = async (url: string) => url.endsWith("/access_tokens") ? Response.json({ token: "t" }) : new Response("x", { status: 404 });
    await expect(dispatchBatch(ghEnv, { batch: "b-x", entries: [] }, fetcher)).rejects.toThrow(/did not start the workflow \(HTTP 404\)/);
  });

  it("should make batch ids that name a branch safely", () => {
    const id = newBatchId(new Date("2026-09-27T14:05:00Z"), () => 0.5);
    expect(id).toBe("b-202609271405-ssssss");
    expect(id).toMatch(/^b-[0-9a-z-]{6,40}$/);
  });
});


describe("linked report resolution and safe withdrawal", () => {
  const sectionValue = JSON.stringify([{ kind: "introit", system: 1, chant: 132 }, { kind: "gradual", system: 3, chant: "none" }]);
  async function linked() {
    const report = readerReport(db.sqlite, "dominica-i-adventus", "sections", "system 4: the Tract starts here", "private evidence");
    const edit = await call("POST", "/edits", { target: "sections:dominica-i-adventus", field: "sections", value: sectionValue });
    const fix = edit.body["id"] as number;
    expect(await call("POST", `/rows/${report}/resolve`, { correctionId: fix })).toMatchObject({ status: 200 });
    return { report, fix };
  }
  it("keeps a section report pending until its linked correction merges", async () => {
    const { report, fix } = await linked();
    const projected = () => toPublicRow(db.sqlite.prepare("SELECT * FROM corrections WHERE id = ?").get(report) as unknown as StoredRow);
    expect(projected()).toMatchObject({ status: "pending", resolvedBy: fix });
    expect((await call("GET", "/queue")).body["pending"]).toEqual([]);
    const published = await call("POST", "/publish", {});
    expect(sent[0]!.entries).toHaveLength(1);
    expect(projected()?.status).toBe("pending");
    await webhook("pull_request", { action: "closed", pull_request: { number: 42, merged: true,
      merge_commit_sha: "abc1234def", head: { ref: `corrections/${published.body["batch"]}` } } });
    expect(projected()).toMatchObject({ status: "resolved", resolvedBy: fix, commitSha: "abc1234def" });
    expect(JSON.stringify(projected())).not.toContain("private evidence");
  });
  it("reopens a linked report when its editor withdraws the fix", async () => {
    const { report, fix } = await linked();
    expect((await call("POST", `/rows/${fix}/unapprove`, {})).status).toBe(200);
    expect((await call("GET", "/queue")).body["pending"]).toMatchObject([{ id: report, resolved_by: null }]);
  });
  it("refuses to resolve a report with an unrelated correction", async () => {
    const report = readerReport(db.sqlite, "dominica-i-adventus", "sections", "missing Tract");
    const edit = await call("POST", "/edits", { target: "piece:kyrie-i", field: "title", value: "Kyrie" });
    expect((await call("POST", `/rows/${report}/resolve`, { correctionId: edit.body["id"] })).status).toBe(422);
    expect(statusOf(report)).toBe("pending");
  });
  it.each(["title", "printedPages"])("withdraws a %s report safely when an identical newer report is pending", async (field) => {
    const value = field === "title" ? "Kyrie" : "2-3";
    const older = readerReport(db.sqlite, "kyrie-i", field, value, "older private note");
    expect((await call("POST", `/rows/${older}/approve`, {})).status).toBe(200);
    const newer = readerReport(db.sqlite, "kyrie-i", field, value, "newer private note");
    expect((await call("POST", `/rows/${older}/unapprove`, {})).status).toBe(200);
    expect(statusOf(older)).toBe("duplicate");
    expect(statusOf(newer)).toBe("pending");
    expect(toPublicRow(db.sqlite.prepare("SELECT * FROM corrections WHERE id = ?").get(older) as unknown as StoredRow))
      .toMatchObject({ status: "duplicate", duplicateOf: newer });
    expect(db.sqlite.prepare("SELECT note FROM corrections ORDER BY id").all()).toMatchObject([
      { note: "older private note" }, { note: "newer private note" },
    ]);
  });
  it("returns a closed section batch to approved so editors can retry publication", async () => {
    const { report, fix } = await linked();
    const published = await call("POST", "/publish", {});
    await webhook("pull_request", { action: "closed", pull_request: { number: 9, merged: false,
      head: { ref: `corrections/${published.body["batch"]}` } } });
    expect(statusOf(fix)).toBe("approved");
    expect(statusOf(report)).toBe("pending");
    expect((await call("POST", "/publish", {})).status).toBe(200);
  });
});

it("returns colliding reader reports from a cancelled batch without losing evidence", async () => {
  const older = readerReport(db.sqlite, "kyrie-i", "title", "Kyrie", "old evidence");
  await call("POST", `/rows/${older}/approve`, {});
  const published = await call("POST", "/publish", {});
  const newer = readerReport(db.sqlite, "kyrie-i", "title", "Kyrie", "new evidence");
  await webhook("pull_request", { action: "closed", pull_request: { number: 10, merged: false,
    head: { ref: `corrections/${published.body["batch"]}` } } });
  expect(statusOf(older)).toBe("duplicate");
  expect(statusOf(newer)).toBe("pending");
  expect(db.sqlite.prepare("SELECT duplicate_of FROM corrections WHERE id = ?").get(older)).toMatchObject({ duplicate_of: newer });
});

it("does not let a stale editor action change a report linked by another editor", async () => {
  const report = readerReport(db.sqlite, "dominica-i-adventus", "sections", "missing Tract");
  const store = d1Store(db.d1);
  expect((await store.get(report))?.status).toBe("pending");
  const edit = await call("POST", "/edits", { target: "sections:dominica-i-adventus", field: "sections",
    value: JSON.stringify([{ kind: "introit", system: 1, chant: 132 }]) });
  expect((await call("POST", `/rows/${report}/resolve`, { correctionId: edit.body["id"] })).status).toBe(200);
  expect(await store.move(report, "pending", "rejected", { reason: "stale action" })).toBe(false);
  expect(statusOf(report)).toBe("pending");
});

it("routes a stale music report to source repair rather than catalogue approval", async () => {
  const id = readerReport(db.sqlite, "typeset", "issue", "lyrics", "private explanation");
  db.sqlite.prepare("UPDATE corrections SET target = ?, seen = ? WHERE id = ?").run("typeset:vol-5/missa-ix/kyrie_IX.ly", "c".repeat(32), id);
  const queue = (await call("GET", "/queue")).body["pending"] as Record<string, unknown>[];
  expect(queue[0]).toMatchObject({ id, kind: "typeset", resolvedField: "issue", fields: [] });
  expect((await call("POST", `/rows/${id}/approve`, {})).status).toBe(422);
});

it("signed preview completion releases matching leases idempotently",async()=>{
  const key="a".repeat(64);
  db.sqlite.prepare("INSERT INTO typeset_previews(editor_email,preview_key,admitted_at,expires_at) VALUES ('ed',?,0,300000)").run(key);
  const event={action:"completed",workflow_run:{name:`typeset-preview ${key} lease 1`,path:'.github/workflows/typeset-preview.yml',display_title:`typeset-preview ${key} lease 1`,conclusion:"failure"}};
  expect((await webhook("workflow_run",{...event,workflow_run:{...event.workflow_run,path:'.github/workflows/site.yml'}})).body).toEqual({ok:true,ignored:true});
  expect((await webhook("workflow_run",event)).body).toEqual({ok:true,updated:1});
  expect((await webhook("workflow_run",event)).body).toEqual({ok:true,updated:0});
});
it("publishes immutable source-only snapshots, resolves on merge and keeps private notes",async()=>{
  const {typesetStore,sourceContentHash}=await import('./typesetStore');
  const file='vol-5/missa-ix/kyrie_IX.ly',s=typesetStore(db.d1);
  await s.saveDraft('ed@example.org',{file,text:'d4',baseBlobSha:'a'.repeat(40),contentHash:await sourceContentHash('d4')},0);
  const report=Number(db.sqlite.prepare("INSERT INTO corrections(piece_id,target,field,proposed,seen,note) VALUES ('typeset',?,'issue','lyrics',?,'PRIVATE-MARKER')").run(`typeset:${file}`,'b'.repeat(32)).lastInsertRowid);
  const id=await s.approveDraft('ed@example.org',file,1,'Checked scan',report);
  await s.saveDraft('ed@example.org',{file,text:'e4',baseBlobSha:'a'.repeat(40),contentHash:await sourceContentHash('e4')},1);
  const d={...deps(),prepareSources:async(batch:string,snapshots:any)=>{expect(snapshots[0].text).toBe('d4');return {branch:`corrections/${batch}`,commitSha:'c'.repeat(40)};}};
  const response=await handleAdmin(new Request(`${ORIGIN}/admin/api/publish`,{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:'{}'}),env,d);
  expect(response.status).toBe(200);expect(sent[0]?.entries).toEqual([]);expect(sent[0]?.sourceReasons).toMatchObject([{reason:'Checked scan',editorEmail:'ed@example.org'}]);
  expect(sent[0]?.sources).toMatchObject([{correctionId:id,file}]);expect(JSON.stringify(sent)).not.toMatch(/PRIVATE-MARKER|"text"/);
  const batch=sent[0]!.batch;
  await webhook('pull_request',{action:'closed',pull_request:{number:7,merged:false,head:{ref:`corrections/${batch}`}}});
  expect((await d.store.get(id!))?.status).toBe('approved');
  const again=await handleAdmin(new Request(`${ORIGIN}/admin/api/publish`,{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:'{}'}),env,d);expect(again.status).toBe(200);
  await webhook('pull_request',{action:'closed',pull_request:{number:8,merged:true,merge_commit_sha:'abc1234',head:{ref:`corrections/${sent[1]!.batch}`}}});
  expect(toPublicRow(db.sqlite.prepare('SELECT * FROM corrections WHERE id=?').get(report) as unknown as StoredRow)?.status).toBe('resolved');
  expect(db.sqlite.prepare('SELECT note FROM corrections WHERE id=?').get(report)).toMatchObject({note:'PRIVATE-MARKER'});
});
it('replayed signed completion cannot release another preview attempt',async()=>{
  const {previewStore}=await import('./typesetPreview');const s=previewStore(db.d1),key='a'.repeat(64);
  const old=await s.acquirePreview('ed',key,0);if(!old.ok)throw Error('admission');
  const event={action:'completed',workflow_run:{name:'typeset-preview',display_title:`typeset-preview ${key} lease ${old.leaseId}`,conclusion:'success'}};
  expect((await webhook('workflow_run',event)).body).toMatchObject({updated:1});
  const current=await s.acquirePreview('ed',key,1);expect(current.ok).toBe(true);
  expect((await webhook('workflow_run',event)).body).toMatchObject({updated:0});
  expect(await s.acquirePreview('ed','b'.repeat(64),2)).toEqual({ok:false,reason:'active'});
});
