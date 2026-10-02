import { previewStore } from "./typesetPreview";
import type { PreviewPayload } from "./typesetPreview";
/**
 * The admin API behind /admin/api/*, and GitHub's webhook.
 *
 * Every request is authenticated (auth.ts). Every change is a POST from the
 * site's own origin, rate-limited per editor, and written to admin_log with who
 * made it. A status change names the status it expects, so when two editors act
 * on one row the second is told who got there first (409).
 */
import { typesetApi } from "./typesetApi";
import type { SourceRepository } from "./typesetApi";
import { authenticate } from "./auth";
import type { AuthEnv, Editor } from "./auth";
import { verifyHmac } from "./crypto";
import { closePullRequest, dispatchBatch, githubConfigured, newBatchId } from "./github";
import type { Batch, GithubEnv } from "./github";
import type { ReviewIndex } from "./reviews";
import { d1Store } from "./store";
import type { D1Like, Row, Store } from "./store";
import { FIELDS_OF, checkValue, describeTarget, isField, plannedOrder, readerField, sectionsSummary } from "./targets";
import type { Kind, PlannedStart, Targets } from "./targets";

export interface AdminEnv extends AuthEnv, GithubEnv {
  readonly DB: D1Like;
  readonly PUBLIC_ASSET_BASE?: string;
  readonly ASSETS?: { fetch(input: Request | string): Promise<Response> };
  readonly GITHUB_WEBHOOK_SECRET?: string;
}

export interface Deps {
  readonly source?: SourceRepository;
  readonly previewDispatch?: (payload:PreviewPayload) => Promise<void>;
  readonly store: Store;
  readonly targets: () => Promise<Targets>;
  /** What can be reviewed, and what each review confirms (/admin/review.json). */
  readonly reviews: () => Promise<ReviewIndex>;
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
/** A value is short text, but a list of sections (the Sections screen) is longer. */
const VALUE_MAX = 200;
const SECTIONS_MAX = 6_000;
/** GitHub refuses a dispatch payload much over 64 KB: Publish sends what fits. */
const DISPATCH_MAX = 60_000;
const RATE = 120;                 // actions per editor per minute
const BATCH_MAX = 100;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: HARDENING });
}

function problem(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status);
}

/** A file built with the site, read through the static assets binding. */
async function builtJson<T>(request: Request, env: AdminEnv, path: string): Promise<T> {
  const url = new URL(path, request.url).toString();
  const r = await (env.ASSETS ? env.ASSETS.fetch(url) : fetch(url));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export function defaultDeps(request: Request, env: AdminEnv): Deps {
  let cached: Promise<Targets> | null = null;
  let reviews: Promise<ReviewIndex> | null = null;
  return {
    store: d1Store(env.DB),
    targets: () => (cached ??= builtJson<Targets>(request, env, "/corrections/targets.json")),
    reviews: () => (reviews ??= builtJson<ReviewIndex>(request, env, "/admin/review.json")),
    dispatch: (batch) => dispatchBatch(env, batch),
    authenticate: (req) => authenticate(req, env),
  };
}

/** A row as the admin screen shows it: its target and field in the admin's
 * vocabulary, and whether it can be approved as it stands. */
export interface QueueItem extends Row {
  readonly resolvedTarget: string | null;
  readonly resolvedField: string | null;
  readonly kind: Kind | null;
  readonly label: string | null;
  /** The fields this target can correct, and their current values. */
  readonly fields: readonly string[];
  readonly values: Readonly<Record<string, string>>;
  readonly current: string | null;
  readonly problem: string | null;
}

/** A review ("looks right") as the queue shows it: what was reviewed, in words. */
function describeReview(row: Row, index: ReviewIndex | null): QueueItem {
  const target = row.target ?? "";
  return { ...row, resolvedTarget: target, resolvedField: "reviewed", kind: null,
           label: index?.items[target]?.label ?? target, fields: [], values: {}, current: null, problem: null };
}

function describeRow(row: Row, targets: Targets, index: ReviewIndex | null = null): QueueItem {
  if (row.field === "source") {
    const file = row.target?.slice(8) ?? "";
    return { ...row,resolvedTarget:row.target,resolvedField:"source",kind:"typeset",label:targets.typeset?.[file]?.label ?? file,
      fields:[],values:{},current:null,problem:null };
  }
  if (row.field === "issue") {
    const file = row.target?.slice(8) ?? "";
    const t = targets.typeset?.[file];
    const stale = t?.hash && t.hash !== row.seen;
    return { ...row, resolvedTarget: row.target, resolvedField: "issue", kind: "typeset", label: t?.label ?? file,
      fields: [], values: {}, current: t?.hash ?? null,
      problem: `${stale ? "This report describes an older drawing. " : ""}Open the source editor to fix this music report. Reported drawing: ${row.seen ?? "unknown"}.` };
  }
  if (row.field === "reviewed") return describeReview(row, index);
  if (row.field === "sections") return describeSections(row, targets);
  const info = describeTarget(targets, row.target ?? row.piece_id);
  const named = info && isField(info.kind, row.field) ? row.field : readerField(row.field);
  const field = info && named && isField(info.kind, named) ? named : null;
  let issue: string | null = null;
  if (!info) issue = "This piece or item no longer exists.";
  else if (!field) issue = row.field === "chant" && info.kind === "piece"
    ? "A piece's chant pairing is corrected on its parts (Introit, Gradual…), not the piece."
    : `“${row.field}” is not a field this screen can correct.`;
  return {
    ...row,
    resolvedTarget: info?.target ?? null,
    resolvedField: field,
    kind: info?.kind ?? null,
    label: info?.label ?? null,
    fields: info ? FIELDS_OF[info.kind] : [],
    values: info?.values ?? {},
    current: info && field ? info.values[field] ?? "" : null,
    problem: issue,
  };
}

/** A list of sections (an editor's, from the Sections screen), or a reader's
 * report that a part is missing or mislabelled: that is fixed on the Sections
 * screen, so it cannot be approved as it stands. */
function describeSections(row: Row, targets: Targets): QueueItem {
  const slug = (row.target ?? "").startsWith("sections:") ? (row.target ?? "").slice("sections:".length) : row.piece_id;
  const info = describeTarget(targets, `sections:${slug}`);
  const report = row.source === "reader";
  return {
    ...row, resolvedTarget: info?.target ?? null, resolvedField: info ? "sections" : null, kind: info ? "sections" : null,
    label: info?.label ?? null, fields: [], values: info ? { sections: sectionsSummary(info.values["sections"]) } : {},
    current: info ? sectionsSummary(info.values["sections"]) : null,
    problem: !info ? "This piece no longer exists."
      : report ? "Fix it on the Sections screen, link this report to your fix. It resolves when the fix publishes." : null,
  };
}

async function body(request: Request, maxBody = MAX_BODY): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return problem(415, "Expected application/json.");
  }
  const text = await request.text();
  if (text.length > maxBody) return problem(413, "Request body too large.");
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

/** Every part start waiting to be published (approved, or in an open batch). */
async function plannedStarts(store: Store): Promise<PlannedStart[]> {
  // Oldest first, so a later correction of the same part wins.
  return (await store.list(["approved", "queued"], 500)).slice().sort((a, b) => a.id - b.id)
    .filter((r) => r.field === "start_system" && r.target !== null)
    .map((r) => ({ target: r.target as string, value: r.proposed }));
}

/** A part's new start may pass a neighbour that is still to be moved: it is
 * approved, with a warning, and Publish waits until the plan is in order. */
async function orderWarning(store: Store, targets: Targets, field: string): Promise<Record<string, unknown>> {
  if (field !== "start_system") return {};
  const found = plannedOrder(targets, await plannedStarts(store));
  return found ? { warning: `${found.message} Publishing waits until then.`,
                   fix: { target: found.target, name: found.name } } : {};
}

async function conflict(store: Store, id: number, row: Row | null): Promise<Response> {
  if (!row) return problem(404, "No such correction.");
  const last = await store.lastActor(id);
  const who = last ? `${last.email} (${last.action}, ${last.at} UTC)` : "someone else";
  return problem(409, `Already ${row.status} by ${who}.`, { status: row.status });
}

/** A failure no handler expected, as an answer the admin screen can show:
 * never the error's own text, which can name tables and columns. A database
 * whose migrations lag the code (a column or table the code needs is missing)
 * says so, with the fix; the owner applies them before merging such a change
 * (docs/ADMIN-SETUP.md, section 6). */
function serverError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error("admin API:", message);
  if (/no such (column|table)/i.test(message)) {
    return problem(503, "The corrections database needs its latest migration. The owner applies it with " +
      "`pnpm migrate:remote` in workers/corrections (see docs/ADMIN-SETUP.md); then reload this page.");
  }
  return problem(500, "Something went wrong on the server. Try again; if it keeps happening, tell the owner.");
}

export async function handleAdmin(request: Request, env: AdminEnv, deps: Deps = defaultDeps(request, env)): Promise<Response> {
  try {
    return await route(request, env, deps);
  } catch (error) {
    return serverError(error);
  }
}

async function route(request: Request, env: AdminEnv, deps: Deps): Promise<Response> {
  const auth = await deps.authenticate(request);
  if (!auth.ok) return problem(auth.status, auth.error);
  const editor = auth.editor;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/admin\/api/, "").replace(/\/$/, "") || "/";
  const store = deps.store;

  if (request.method === "GET") {
    if (path === "/typeset/source") return typesetApi(request,env,deps,editor,path);
    if (path === "/me") return json({ email: editor.email, owner: editor.owner, publishing: githubConfigured(env) });
    if (path === "/queue") return queue(deps);
    if (path === "/history") {
      const [targets, index] = await Promise.all([deps.targets(), reviewIndex(deps)]);
      const rows = await store.list(["accepted", "rejected", "duplicate"], 100);
      return json({ items: rows.map((r) => describeRow(r, targets, index)) });
    }
    if (path === "/review-state") return reviewState(store);
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
  const input = await body(request, path.startsWith("/typeset/") ? 6 * 61440 + 2048 : MAX_BODY);
  if (input instanceof Response) return input;

  if (path.startsWith("/typeset/")) return typesetApi(request,env,deps,editor,path,input);
  const rowAction = /^\/rows\/(\d{1,9})\/(approve|reject|duplicate|unapprove|resolve)$/.exec(path);
  if (rowAction) return actOnRow(deps, editor, Number(rowAction[1]), rowAction[2] as RowVerb, input);
  if (path === "/edits") return createEdit(deps, editor, input);
  if (path === "/reviews") return createReview(deps, editor, input);
  if (path === "/skips") return skipReview(deps, editor, input);
  if (path === "/skips/remove") return unskipReview(deps, editor, input);
  if (path === "/publish") return publish(deps, env, editor);
  return problem(404, "Not found.");
}

/** The review index, or null when it cannot be read: the queue still works,
 * with a review's target in place of its words. */
async function reviewIndex(deps: Deps): Promise<ReviewIndex | null> {
  try {
    return await deps.reviews();
  } catch {
    return null;
  }
}

async function queue(deps: Deps): Promise<Response> {
  const [targets, index] = await Promise.all([deps.targets(), reviewIndex(deps)]);
  const rows = await deps.store.list(["pending", "approved", "queued"], 500);
  const items = rows.map((r) => describeRow(r, targets, index));
  const batches = new Map<string, { batch: string; pr: number | null; items: QueueItem[] }>();
  for (const item of items.filter((i) => i.status === "queued" && i.batch_id)) {
    const b = batches.get(item.batch_id as string) ?? { batch: item.batch_id as string, pr: item.pr_number, items: [] };
    b.items.push(item);
    batches.set(b.batch, b);
  }
  return json({
    pending: items.filter((i) => i.status === "pending" && !i.resolved_by),
    approved: items.filter((i) => i.status === "approved"),
    batches: [...batches.values()],
    lastReviewed: await deps.store.lastReviewed(),
  });
}

type RowVerb = "approve" | "reject" | "duplicate" | "unapprove" | "resolve";

async function actOnRow(deps: Deps, editor: Editor, id: number, verb: RowVerb, input: Record<string, unknown>): Promise<Response> {
  const store = deps.store;
  const row = await store.get(id);
  if (!row) return problem(404, "No such correction.");
  const from = verb === "unapprove" ? "approved" : "pending";
  if (row.status !== from) return conflict(store, id, row);

  if (verb === "resolve") {
    const fixId = input["correctionId"];
    const fix = typeof fixId === "number" && Number.isSafeInteger(fixId) && fixId > 0 ? await store.get(fixId) : null;
    const same = row.field === "sections" && fix?.field === "sections" && fix.target === `sections:${row.piece_id}` ||
      row.field === "issue" && fix?.field === "source" && fix.target === row.target;
    if (row.source !== "reader" || !fix || fix.source !== "editor" || !same || !["approved", "queued"].includes(fix.status)) {
      return problem(422, "Link this report to an approved correction for the same piece or music file.");
    }
    if (!await store.resolveReport(id, fix.id, editor.email)) return conflict(store, id, await store.get(id));
    await store.log(editor.email, "resolve", id, `linked correction #${fix.id}`);
    return json({ ok: true, status: "pending", resolvedBy: fix.id });
  }
  if (row.resolved_by) return problem(409, "This report is waiting for its linked correction to publish. Withdraw that correction to reopen it.");
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
    const moved = await store.withdraw(id);
    if (!moved) return conflict(store, id, await store.get(id));
    await store.log(editor.email, "unapprove", id, "");
    return json({ ok: true });
  }
  // approve, with the field and value as the editor leaves them: a reader may
  // have filed a mode correction under Title.
  const targets = await deps.targets();
  const item = describeRow(row, targets);
  if (row.field === "issue") return problem(422, "Music reports are resolved by a published source correction.");
  if (row.field === "sections") return problem(422, item.problem ?? "A list of sections is saved on the Sections screen.");
  const info = item.resolvedTarget ? describeTarget(targets, item.resolvedTarget) : null;
  if (!info) return problem(422, item.problem ?? "This piece or item no longer exists.");
  const asked = text(input["field"], 40);
  if (asked && !isField(info.kind, asked)) return problem(422, `“${asked}” is not a field this screen can correct.`);
  const field = asked || item.resolvedField;
  if (!field) return problem(422, item.problem ?? "Choose which field this corrects.");
  const proposed = text(input["value"], 200) || row.proposed;
  const checked = checkValue(targets, info, field, proposed);
  if (!checked.ok) return problem(422, checked.error);
  const moved = await store.move(id, "pending", "approved", {
    target: info.target, field, proposed: checked.value, editor_email: editor.email,
  });
  if (!moved) return conflict(store, id, await store.get(id));
  const changed = [field !== item.resolvedField ? `reader filed it under ${row.field}` : "",
                   checked.value !== row.proposed ? `reader proposed: ${row.proposed}` : ""].filter(Boolean).join("; ");
  await store.log(editor.email, "approve", id, changed);
  return json({ ok: true, status: "approved", field, value: checked.value, ...(await orderWarning(store, targets, field)) });
}

async function createEdit(deps: Deps, editor: Editor, input: Record<string, unknown>): Promise<Response> {
  const targets = await deps.targets();
  const target = text(input["target"], 160);
  const field = text(input["field"], 40);
  const info = target.includes(":") ? describeTarget(targets, target) : null;
  if (!info) return problem(422, "Choose what to correct: a piece, one of its parts, a Vespers item or a typeset file.");
  if (!isField(info.kind, field)) return problem(422, `“${field}” is not a field this screen can correct for a ${info.kind}.`);
  const checked = checkValue(targets, info, field, text(input["value"], field === "sections" ? SECTIONS_MAX : VALUE_MAX));
  if (!checked.ok) return problem(422, checked.error);
  if (field === "match" && checked.value.includes(":")) {
    // A part shows one transcription: a batch choosing one part twice is refused whole.
    const twice = (await deps.store.list(["approved", "queued"], 1000))
      .find((r) => r.field === "match" && r.proposed === checked.value && r.target !== info.target);
    if (twice) {
      return problem(409, `${twice.target?.slice("typeset:".length) ?? "Another file"} is already chosen as ${checked.value} ` +
        `(by ${twice.editor_email ?? "another editor"}); withdraw that first on the Corrections page.`);
    }
  }
  const note = text(input["note"], 200);
  const id = await deps.store.insertEdit({ target: info.target, pieceId: info.slug ?? info.kind, field,
                                           proposed: checked.value, note, email: editor.email });
  await deps.store.log(editor.email, "edit", id, `${info.target} ${field}: ${info.values[field] ?? ""} -> ${checked.value}`);
  return json({ ok: true, id, status: "approved", ...(await orderWarning(deps.store, targets, field)) }, 201);
}

/** The oldest approved rows whose values fit in one dispatch; the rest wait for
 * the next Publish. */
export function fitting(rows: readonly Row[], max = DISPATCH_MAX): Row[] {
  const out: Row[] = [];
  let size = 0;
  for (const r of rows) {
    size += r.proposed.length + r.note.length + 300;
    if (size > max && out.length > 0) break;
    out.push(r);
  }
  return out;
}

async function publish(deps: Deps, env: AdminEnv, editor: Editor): Promise<Response> {
  if (!githubConfigured(env)) return problem(503, "Publishing is not configured yet (the GitHub App is missing).");
  const store = deps.store;
  const open = await store.list(["queued"], 1);
  if (open.length > 0) {
    const pr = open[0]?.pr_number;
    return problem(409, pr ? `PR #${pr} is open: it merges itself when its checks pass, unless it waits for the owner. Publish again once it is merged or closed.`
      : "A batch is still being opened as a pull request. Try again in a minute.");
  }
  const approved = fitting((await store.list(["approved"], BATCH_MAX)).slice().reverse());
  if (approved.length === 0) return problem(400, "Nothing is approved yet.");
  const disorder = plannedOrder(await deps.targets(), await plannedStarts(store));
  if (disorder) {
    return problem(422, `${disorder.message} Nothing was published.`, { fix: { target: disorder.target, name: disorder.name } });
  }
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
        target: r.target ?? `piece:${r.piece_id}`, field: r.field, value: r.proposed,
        // Reader notes are private review context, never part of a public PR
        // or corrections.yml. Editor-authored reasons are deliberately public.
        note: r.source === "reader" ? "" : r.note.slice(0, 200),
        source: r.source === "reader" ? `reader#${r.id}` : "editor", editor_email: r.editor_email ?? editor.email,
        ...(r.field === "reviewed" && r.seen ? { seen: r.seen } : {}),
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

// ------------------------------------------------------------ reviews ---

const TARGET_MAX = 160;
const SEEN_MAX = 80;
const NOTE_MAX = 300;

/** Reviews and typeset matches waiting to be published, and skipped items,
 * for the Review pages: what an editor has already acted on is marked at once. */
async function reviewState(store: Store): Promise<Response> {
  const rows = await store.list(["approved", "queued"], 1000);
  const brief = (r: Row) => ({ id: r.id, target: r.target, status: r.status, editor_email: r.editor_email });
  return json({
    reviews: rows.filter((r) => r.field === "reviewed").map(brief),
    choices: rows.filter((r) => r.field === "match" && (r.target ?? "").startsWith("typeset:"))
      .map((r) => ({ ...brief(r), value: r.proposed })),
    skips: await store.skips(),
  });
}

/** The item a review or skip names, from the list built with the site. */
async function reviewable(deps: Deps, input: Record<string, unknown>)
  : Promise<{ target: string; item: ReviewIndex["items"][string] } | Response> {
  const target = text(input["target"], TARGET_MAX);
  if (!target) return problem(400, "Say which item.");
  let index: ReviewIndex;
  try {
    index = await deps.reviews();
  } catch {
    return problem(503, "The review list could not be read. Try again in a minute.");
  }
  const item = index.items[target];
  if (!item) return problem(404, "That item is not on the review list any more (reviewed, or changed by a rebuild). Reload the page.");
  return { target, item };
}

async function createReview(deps: Deps, editor: Editor, input: Record<string, unknown>): Promise<Response> {
  const found = await reviewable(deps, input);
  if (found instanceof Response) return found;
  if (found.item.review === false) {
    return problem(422, "This typeset file is still to be matched or fixed; say which part it is, or skip it with a note.");
  }
  const seen = text(input["seen"], SEEN_MAX);
  if (seen !== found.item.fingerprint) {
    return problem(409, "It has changed since this page was built. Reload the page and look again.");
  }
  const store = deps.store;
  const already = (await store.list(["approved", "queued"], 1000))
    .find((r) => r.field === "reviewed" && r.target === found.target);
  if (already) return problem(409, `Already marked as looking right by ${already.editor_email ?? "another editor"}.`);
  const note = text(input["note"], NOTE_MAX);
  const id = await store.insertEdit({ target: found.target, pieceId: found.item.piece ?? "review", field: "reviewed",
                                      proposed: "yes", note, email: editor.email, seen });
  await store.unskip(found.target);
  await store.log(editor.email, "review", id, `${found.target}: looks right`);
  return json({ ok: true, id, status: "approved" }, 201);
}

async function skipReview(deps: Deps, editor: Editor, input: Record<string, unknown>): Promise<Response> {
  const found = await reviewable(deps, input);
  if (found instanceof Response) return found;
  const note = text(input["note"], NOTE_MAX);
  if (!note) return problem(400, "Say briefly why it is skipped, for the next editor.");
  await deps.store.skip(found.target, note, editor.email);
  await deps.store.log(editor.email, "skip", null, `${found.target}: ${note}`);
  return json({ ok: true });
}

async function unskipReview(deps: Deps, editor: Editor, input: Record<string, unknown>): Promise<Response> {
  const target = text(input["target"], TARGET_MAX);
  if (!target) return problem(400, "Say which item.");
  if (!(await deps.store.unskip(target))) return problem(404, "That item is not skipped.");
  await deps.store.log(editor.email, "unskip", null, target);
  return json({ ok: true });
}

// ------------------------------------------------------------ webhook ---

interface PullRequestEvent {
  action?: string;
  pull_request?: { number?: number; merged?: boolean; merge_commit_sha?: string | null; head?: { ref?: string } };
}
interface WorkflowRunEvent {
  action?: string;
  workflow_run?: { name?: string; conclusion?: string | null; display_title?: string; html_url?: string;
                   head_branch?: string | null; pull_requests?: { number?: number }[] };
}

const BATCH_BRANCH = /^corrections\/(b-[0-9a-z-]{6,40})$/;
const BATCH_TITLE = /^corrections (b-[0-9a-z-]{6,40})$/;

/** GitHub tells the admin screen what became of each batch: its pull request
 * opened, merged or closed, its workflow run failed, or the site's checks
 * failed on it (which closes the pull request: a batch merges itself only when
 * they pass). Signed with the webhook secret; anything unsigned is refused. */
export async function handleWebhook(request: Request, env: AdminEnv, store: Store = d1Store(env.DB),
                                    close: (pr: number, why: string) => Promise<void> = (pr, why) => closePullRequest(env, pr, why)): Promise<Response> {
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
    const preview = /^typeset-preview ([a-f0-9]{64})$/.exec(run?.display_title ?? "")?.[1];
    if (preview && run?.name === "typeset-preview") return json({ok:true,updated:await previewStore(env.DB).releasePreview(preview)});
    const batch = BATCH_TITLE.exec(run?.display_title ?? "")?.[1];
    if (batch && run?.name === "corrections-batch" && run.conclusion !== "success") {
      const reason = `Publishing failed; see ${run.html_url ?? "the corrections-batch run"} on GitHub`;
      const n = await store.unqueueBatch(batch, "approved", reason.slice(0, 300));
      await store.log("github", "publish-failed", null, `${batch}: ${n} back to approved`);
      return json({ ok: true, updated: n });
    }
    const checked = BATCH_BRANCH.exec(run?.head_branch ?? "")?.[1];
    if (checked && run?.name === "site" && (run.conclusion === "failure" || run.conclusion === "timed_out")) {
      const rows = (await store.list(["queued"], BATCH_MAX)).filter((r) => r.batch_id === checked);
      if (rows.length === 0) return json({ ok: true, ignored: true });   // already merged, closed or returned
      const pr = rows[0]?.pr_number ?? run.pull_requests?.[0]?.number ?? null;
      const reason = `The site's checks failed; see ${run.html_url ?? "the site run"} on GitHub`.slice(0, 300);
      const n = await store.unqueueBatch(checked, "approved", reason);
      await store.log("github", "checks-failed", null, `${checked}: ${n} back to approved`);
      if (pr) {
        try {
          await close(pr, `${reason}. The corrections are back on the admin screen under Approved; fix them there and publish again.`);
        } catch (error) {
          await store.log("github", "close-failed", null, `${checked}: PR #${pr}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      return json({ ok: true, updated: n });
    }
  }
  return json({ ok: true, ignored: true });
}
