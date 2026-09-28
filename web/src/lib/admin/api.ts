/**
 * The admin API behind /admin/api/*, and GitHub's webhook.
 *
 * Every request is authenticated (auth.ts). Every change is a POST from the
 * site's own origin, rate-limited per editor, and written to admin_log with who
 * made it. A status change names the status it expects, so when two editors act
 * on one row the second is told who got there first (409).
 */
import { authenticate } from "./auth";
import type { AuthEnv, Editor } from "./auth";
import { verifyHmac } from "./crypto";
import { dispatchBatch, githubConfigured, newBatchId } from "./github";
import type { Batch, GithubEnv } from "./github";
import { d1Store } from "./store";
import type { D1Like, Row, Store } from "./store";
import { checkValue, currentValue, findPiece, isPieceField, readerField } from "./targets";
import type { PieceField, Targets } from "./targets";

export interface AdminEnv extends AuthEnv, GithubEnv {
  readonly DB: D1Like;
  readonly ASSETS?: { fetch(input: Request | string): Promise<Response> };
  readonly GITHUB_WEBHOOK_SECRET?: string;
}

export interface Deps {
  readonly store: Store;
  readonly targets: () => Promise<Targets>;
  readonly dispatch: (batch: Batch) => Promise<void>;
  readonly authenticate: (request: Request) => ReturnType<typeof authenticate>;
}

const HARDENING = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-robots-tag": "noindex",
};
const MAX_BODY = 8_000;
const RATE = 120;                 // actions per editor per minute
const BATCH_MAX = 100;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: HARDENING });
}

function problem(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status);
}

export function defaultDeps(request: Request, env: AdminEnv): Deps {
  let cached: Promise<Targets> | null = null;
  return {
    store: d1Store(env.DB),
    targets: () => (cached ??= (env.ASSETS ? env.ASSETS.fetch(new URL("/admin/targets.json", request.url).toString())
      : fetch(new URL("/admin/targets.json", request.url))).then(async (r) => {
      if (!r.ok) throw new Error(`targets.json: HTTP ${r.status}`);
      return (await r.json()) as Targets;
    })),
    dispatch: (batch) => dispatchBatch(env, batch),
    authenticate: (req) => authenticate(req, env),
  };
}

/** A row as the admin screen shows it: its target and field in the admin's
 * vocabulary, and whether it can be approved as it stands. */
export interface QueueItem extends Row {
  readonly resolvedTarget: string | null;
  readonly resolvedField: PieceField | null;
  readonly current: string | null;
  readonly problem: string | null;
}

function describeRow(row: Row, targets: Targets): QueueItem {
  const piece = findPiece(targets, row.target ?? row.piece_id);
  const field = isPieceField(row.field) ? row.field : readerField(row.field);
  let issue: string | null = null;
  if (!piece) issue = "This piece or item no longer exists.";
  else if (!field) issue = row.field === "chant"
    ? "Chant pairings are fixed at the source, not here (docs/EDITING.md, Proper parts)."
    : `“${row.field}” is not a field this screen can correct.`;
  return {
    ...row,
    resolvedTarget: piece ? `piece:${piece.slug}` : null,
    resolvedField: field,
    current: piece && field ? currentValue(piece, field) : null,
    problem: issue,
  };
}

async function body(request: Request): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return problem(415, "Expected application/json.");
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return problem(413, "Request body too large.");
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return problem(400, "Expected a JSON object.");
    return parsed as Record<string, unknown>;
  } catch {
    return problem(400, "Expected a JSON object.");
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function conflict(store: Store, id: number, row: Row | null): Promise<Response> {
  if (!row) return problem(404, "No such correction.");
  const last = await store.lastActor(id);
  const who = last ? `${last.email} (${last.action}, ${last.at} UTC)` : "someone else";
  return problem(409, `Already ${row.status} by ${who}.`, { status: row.status });
}

export async function handleAdmin(request: Request, env: AdminEnv, deps: Deps = defaultDeps(request, env)): Promise<Response> {
  const auth = await deps.authenticate(request);
  if (!auth.ok) return problem(auth.status, auth.error);
  const editor = auth.editor;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin\/api/, "").replace(/\/$/, "") || "/";
  const store = deps.store;

  if (request.method === "GET") {
    if (path === "/me") return json({ email: editor.email, owner: editor.owner, publishing: githubConfigured(env) });
    if (path === "/queue") return queue(deps);
    if (path === "/history") {
      const targets = await deps.targets();
      const rows = await store.list(["accepted", "rejected", "duplicate"], 100);
      return json({ items: rows.map((r) => describeRow(r, targets)) });
    }
    return problem(404, "Not found.");
  }
  if (request.method !== "POST") return problem(405, "Method not allowed.");

  // Cross-site requests carry the editor's Access cookie too; only the admin
  // screen itself, on this origin, may change anything.
  const origin = request.headers.get("Origin");
  if (origin !== url.origin) return problem(403, "Forbidden origin.");
  if ((await store.actionsSince(editor.email, 60)) >= RATE) {
    return problem(429, `Too many changes: at most ${RATE} a minute. Wait a moment and try again.`);
  }
  const input = await body(request);
  if (input instanceof Response) return input;

  const rowAction = /^\/rows\/(\d{1,9})\/(approve|reject|duplicate|unapprove)$/.exec(path);
  if (rowAction) return actOnRow(deps, editor, Number(rowAction[1]), rowAction[2] as RowVerb, input);
  if (path === "/edits") return createEdit(deps, editor, input);
  if (path === "/publish") return publish(deps, env, editor);
  return problem(404, "Not found.");
}

async function queue(deps: Deps): Promise<Response> {
  const targets = await deps.targets();
  const rows = await deps.store.list(["pending", "approved", "queued"], 500);
  const items = rows.map((r) => describeRow(r, targets));
  const batches = new Map<string, { batch: string; pr: number | null; items: QueueItem[] }>();
  for (const item of items.filter((i) => i.status === "queued" && i.batch_id)) {
    const b = batches.get(item.batch_id as string) ?? { batch: item.batch_id as string, pr: item.pr_number, items: [] };
    b.items.push(item);
    batches.set(b.batch, b);
  }
  return json({
    pending: items.filter((i) => i.status === "pending"),
    approved: items.filter((i) => i.status === "approved"),
    batches: [...batches.values()],
    lastReviewed: await deps.store.lastReviewed(),
  });
}

type RowVerb = "approve" | "reject" | "duplicate" | "unapprove";

async function actOnRow(deps: Deps, editor: Editor, id: number, verb: RowVerb, input: Record<string, unknown>): Promise<Response> {
  const store = deps.store;
  const row = await store.get(id);
  if (!row) return problem(404, "No such correction.");
  const from = verb === "unapprove" ? "approved" : "pending";
  if (row.status !== from) return conflict(store, id, row);

  if (verb === "reject" || verb === "duplicate") {
    const reason = text(input["reason"], 300);
    if (verb === "reject" && !reason) return problem(400, "Say briefly why it is rejected.");
    const moved = await store.move(id, "pending", verb === "reject" ? "rejected" : "duplicate",
                                   { reason: reason || null, editor_email: editor.email });
    if (!moved) return conflict(store, id, await store.get(id));
    await store.log(editor.email, verb, id, reason);
    return json({ ok: true, status: verb === "reject" ? "rejected" : "duplicate" });
  }
  if (verb === "unapprove") {
    const moved = await store.move(id, "approved", row.source === "editor" ? "rejected" : "pending",
                                   row.source === "editor" ? { reason: "withdrawn before publishing" } : {});
    if (!moved) return conflict(store, id, await store.get(id));
    await store.log(editor.email, "unapprove", id, "");
    return json({ ok: true });
  }
  // approve, with the field and value as the editor leaves them: a reader may
  // have filed a mode correction under Title.
  const targets = await deps.targets();
  const item = describeRow(row, targets);
  const piece = item.resolvedTarget ? findPiece(targets, item.resolvedTarget) : null;
  if (!piece || !item.resolvedTarget) return problem(422, item.problem ?? "This piece or item no longer exists.");
  const asked = text(input["field"], 40);
  if (asked && !isPieceField(asked)) return problem(422, `“${asked}” is not a field this screen can correct.`);
  const field: PieceField | null = asked && isPieceField(asked) ? asked : item.resolvedField;
  if (!field) return problem(422, item.problem ?? "Choose which field this corrects.");
  const proposed = text(input["value"], 200) || row.proposed;
  const checked = checkValue(targets, piece, field, proposed);
  if (!checked.ok) return problem(422, checked.error);
  const moved = await store.move(id, "pending", "approved", {
    target: item.resolvedTarget, field, proposed: checked.value, editor_email: editor.email,
  });
  if (!moved) return conflict(store, id, await store.get(id));
  const changed = [field !== item.resolvedField ? `reader filed it under ${row.field}` : "",
                   checked.value !== row.proposed ? `reader proposed: ${row.proposed}` : ""].filter(Boolean).join("; ");
  await store.log(editor.email, "approve", id, changed);
  return json({ ok: true, status: "approved", field, value: checked.value });
}

async function createEdit(deps: Deps, editor: Editor, input: Record<string, unknown>): Promise<Response> {
  const targets = await deps.targets();
  const target = text(input["target"], 120);
  const field = text(input["field"], 40);
  const piece = findPiece(targets, target);
  if (!target.startsWith("piece:") || !piece) {
    return problem(422, "Choose a piece: this screen corrects pieces (Vespers items come later).");
  }
  if (!isPieceField(field)) return problem(422, `“${field}” is not a field this screen can correct.`);
  const checked = checkValue(targets, piece, field, text(input["value"], 200));
  if (!checked.ok) return problem(422, checked.error);
  const note = text(input["note"], 200);
  const id = await deps.store.insertEdit({ target: `piece:${piece.slug}`, pieceId: piece.slug, field,
                                           proposed: checked.value, note, email: editor.email });
  await deps.store.log(editor.email, "edit", id, `${field}: ${currentValue(piece, field)} -> ${checked.value}`);
  return json({ ok: true, id, status: "approved" }, 201);
}

async function publish(deps: Deps, env: AdminEnv, editor: Editor): Promise<Response> {
  if (!githubConfigured(env)) return problem(503, "Publishing is not configured yet (the GitHub App is missing).");
  const store = deps.store;
  const open = await store.list(["queued"], 1);
  if (open.length > 0) {
    const pr = open[0]?.pr_number;
    return problem(409, pr ? `PR #${pr} is open, waiting for the owner. Publish again once it is merged or closed.`
      : "A batch is still being opened as a pull request. Try again in a minute.");
  }
  const approved = (await store.list(["approved"], BATCH_MAX)).slice().reverse();
  if (approved.length === 0) return problem(400, "Nothing is approved yet.");
  const batch = newBatchId();
  const queued = await store.queueBatch(batch, approved.map((r) => r.id));
  if (queued !== approved.length) {
    await store.unqueueBatch(batch, "approved", null);
    return problem(409, "The list changed while publishing (another editor?). Reload and try again.");
  }
  try {
    await deps.dispatch({
      batch,
      entries: approved.map((r) => ({
        target: r.target ?? `piece:${r.piece_id}`, field: r.field, value: r.proposed, note: r.note.slice(0, 200),
        source: r.source === "reader" ? `reader#${r.id}` : "editor", editor_email: r.editor_email ?? editor.email,
      })),
    });
  } catch (error) {
    await store.unqueueBatch(batch, "approved", null);
    const why = error instanceof Error ? error.message : "GitHub did not answer";
    return problem(502, `Nothing was published: ${why}. Try again.`);
  }
  await store.log(editor.email, "publish", null, `${batch}: ${approved.length} correction(s)`);
  return json({ ok: true, batch, count: approved.length });
}

// ------------------------------------------------------------ webhook ---

interface PullRequestEvent {
  action?: string;
  pull_request?: { number?: number; merged?: boolean; merge_commit_sha?: string | null; head?: { ref?: string } };
}
interface WorkflowRunEvent {
  action?: string;
  workflow_run?: { name?: string; conclusion?: string | null; display_title?: string; html_url?: string };
}

const BATCH_BRANCH = /^corrections\/(b-[0-9a-z-]{6,40})$/;
const BATCH_TITLE = /^corrections (b-[0-9a-z-]{6,40})$/;

/** GitHub tells the admin screen what became of each batch: its pull request
 * opened, merged or closed, or its workflow run failed. Signed with the
 * webhook secret; anything unsigned is refused. */
export async function handleWebhook(request: Request, env: AdminEnv, store: Store = d1Store(env.DB)): Promise<Response> {
  if (request.method !== "POST") return problem(405, "Method not allowed.");
  const raw = await request.text();
  if (raw.length > 2_000_000) return problem(413, "Request body too large.");
  if (!(await verifyHmac(env.GITHUB_WEBHOOK_SECRET, raw, request.headers.get("X-Hub-Signature-256")))) {
    return problem(401, "Bad signature.");
  }
  const event = request.headers.get("X-GitHub-Event");
  const payload = JSON.parse(raw) as PullRequestEvent & WorkflowRunEvent;
  if (event === "pull_request") {
    const pr = payload.pull_request;
    const batch = BATCH_BRANCH.exec(pr?.head?.ref ?? "")?.[1];
    if (!batch || !pr?.number) return json({ ok: true, ignored: true });
    if (payload.action === "opened" || payload.action === "reopened") {
      return json({ ok: true, updated: await store.setPullRequest(batch, pr.number) });
    }
    if (payload.action === "closed") {
      if (pr.merged && pr.merge_commit_sha && /^[0-9a-f]{7,40}$/.test(pr.merge_commit_sha)) {
        const n = await store.acceptBatch(batch, pr.merge_commit_sha);
        await store.log("github", "merged", null, `${batch}: PR #${pr.number}, ${n} accepted`);
        return json({ ok: true, updated: n });
      }
      const n = await store.unqueueBatch(batch, "pending", `PR #${pr.number} was closed without merging`);
      await store.log("github", "closed", null, `${batch}: PR #${pr.number}, ${n} back to the queue`);
      return json({ ok: true, updated: n });
    }
  }
  if (event === "workflow_run" && payload.action === "completed") {
    const run = payload.workflow_run;
    const batch = BATCH_TITLE.exec(run?.display_title ?? "")?.[1];
    if (batch && run?.name === "corrections-batch" && run.conclusion !== "success") {
      const reason = `Publishing failed; see ${run.html_url ?? "the corrections-batch run"} on GitHub`;
      const n = await store.unqueueBatch(batch, "approved", reason.slice(0, 300));
      await store.log("github", "publish-failed", null, `${batch}: ${n} back to approved`);
      return json({ ok: true, updated: n });
    }
  }
  return json({ ok: true, ignored: true });
}
