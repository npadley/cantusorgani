import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authenticate } from "./auth";
import { handleAdmin, handleWebhook } from "./api";
import type { AdminEnv, Deps } from "./api";
import { dispatchBatch, installationToken, newBatchId } from "./github";
import type { Batch } from "./github";
import { d1Store } from "./store";
import { keyPair, piece, readerReport, targets, testDb } from "./testing";
import type { KeyPair } from "./testing";
import { base64UrlDecode } from "./crypto";

const ORIGIN = "http://localhost:8788";
let db: ReturnType<typeof testDb>;
let env: AdminEnv;
let sent: Batch[];
let failDispatch: boolean;
let keys: KeyPair;

beforeAll(async () => { keys = await keyPair(); });

beforeEach(() => {
  db = testDb();
  sent = [];
  failDispatch = false;
  env = { DB: db.d1, EDITORS: "owner@example.org,ed@example.org", ADMIN_DEV_EMAIL: "ed@example.org",
          GITHUB_REPO: "npadley/cantusorgani", GITHUB_APP_ID: "1", GITHUB_INSTALLATION_ID: "2",
          GITHUB_APP_PRIVATE_KEY: "pem", GITHUB_WEBHOOK_SECRET: "hook-secret" };
});

function deps(e: AdminEnv = env): Deps {
  return {
    store: d1Store(db.d1),
    targets: async () => targets(piece("kyrie-i"), piece("dominica-i-adventus", { genre: "proper", title: "Dominica I Adventus", mode: null })),
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

async function webhook(event: string, payload: unknown, secret = "hook-secret") {
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const signature = `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  const response = await handleWebhook(new Request(`${ORIGIN}/api/github/webhook`, {
    method: "POST", body: raw, headers: { "X-GitHub-Event": event, "X-Hub-Signature-256": signature },
  }), env, d1Store(db.d1));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

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
    expect(pending.find((p) => p["field"] === "chant")!["problem"]).toMatch(/fixed at the source/);
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

describe("editing directly", () => {
  it("should record an editor's own fix as approved, and check it like any other", async () => {
    const made = await call("POST", "/edits", { target: "piece:dominica-i-adventus", field: "title", value: "Dominica prima Adventus", note: "p. 3" });
    expect(made).toMatchObject({ status: 201, body: { status: "approved" } });
    expect((await call("POST", "/edits", { target: "piece:kyrie-i", field: "mode", value: "VIII" })).body["error"]).toMatch(/already/);
    expect((await call("POST", "/edits", { target: "vespers:2026-09-27/II", field: "tone", value: "I.g" })).status).toBe(422);
    expect((await call("POST", "/edits", { target: "piece:kyrie-i", field: "chant", value: "x" })).status).toBe(422);
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
      { target: "piece:kyrie-i", field: "mode", value: "VII", note: "Liber", source: `reader#${reader}`, editor_email: "ed@example.org" },
      { target: "piece:dominica-i-adventus", field: "title", value: "Dominica prima Adventus", note: "", source: "editor", editor_email: "ed@example.org" },
    ]);
    expect(statusOf(reader)).toBe("queued");
    expect((await call("POST", "/publish", {})).body["error"]).toMatch(/still being opened/);
    const queue = (await call("GET", "/queue")).body;
    expect((queue["batches"] as { items: unknown[] }[])[0]!.items).toHaveLength(2);
  });

  it("should put everything back when GitHub does not answer", async () => {
    await call("POST", "/edits", { target: "piece:kyrie-i", field: "mode", value: "VII" });
    failDispatch = true;
    const result = await call("POST", "/publish", {});
    expect(result.status).toBe(502);
    expect(result.body["error"]).toMatch(/^Nothing was published: GitHub is down/);
    expect(db.sqlite.prepare("SELECT status, batch_id FROM corrections").get()).toMatchObject({ status: "approved", batch_id: null });
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
    expect((await call("POST", "/publish", {})).body["error"]).toBe("PR #42 is open, waiting for the owner. Publish again once it is merged or closed.");
    await webhook("pull_request", { action: "closed", pull_request: { number: 42, merged: true, merge_commit_sha: "abc1234def",
                                                                      head: { ref: `corrections/${batch}` } } });
    expect(db.sqlite.prepare("SELECT status, commit_sha, pr_number FROM corrections WHERE id = ?").get(id))
      .toMatchObject({ status: "accepted", commit_sha: "abc1234def", pr_number: 42 });
  });

  it("should return a batch to review when its PR is closed unmerged, and to approved when its run fails", async () => {
    const first = await published();
    await webhook("pull_request", { action: "closed", pull_request: { number: 7, merged: false, head: { ref: `corrections/${first.batch}` } } });
    expect(db.sqlite.prepare("SELECT status, reason FROM corrections WHERE id = ?").get(first.id))
      .toMatchObject({ status: "pending", reason: "PR #7 was closed without merging" });
    const second = await published();
    await webhook("workflow_run", { action: "completed", workflow_run: { name: "corrections-batch", conclusion: "failure",
      display_title: `corrections ${second.batch}`, html_url: "https://github.com/x/actions/runs/1" } });
    expect(db.sqlite.prepare("SELECT status, reason FROM corrections WHERE id = ?").get(second.id))
      .toMatchObject({ status: "approved", reason: "Publishing failed; see https://github.com/x/actions/runs/1 on GitHub" });
  });

  it("should ignore pull requests that are not correction batches", async () => {
    const { body } = await webhook("pull_request", { action: "opened", pull_request: { number: 3, head: { ref: "feature/x" } } });
    expect(body).toEqual({ ok: true, ignored: true });
  });
});

describe("GitHub", () => {
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
