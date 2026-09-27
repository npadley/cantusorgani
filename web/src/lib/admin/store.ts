/**
 * The corrections table (workers/corrections, migration 0002) as the admin
 * screen reads and changes it. Every statement is parameterised; every status
 * change names the status it expects, so two editors acting on one row at once
 * cannot both succeed.
 */

/** The part of Cloudflare's D1 binding the admin code uses. */
export interface D1Like {
  prepare(sql: string): D1StatementLike;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T>(): Promise<{ results?: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export const ROW_STATUSES = ["pending", "approved", "queued", "accepted", "rejected", "duplicate"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export interface Row {
  readonly id: number;
  readonly piece_id: string;
  readonly target: string | null;
  readonly field: string;
  readonly proposed: string;
  readonly note: string;
  readonly status: RowStatus;
  readonly source: "reader" | "editor";
  readonly commit_sha: string | null;
  readonly editor_email: string | null;
  readonly reason: string | null;
  readonly batch_id: string | null;
  readonly pr_number: number | null;
  readonly created_at: string;
  readonly updated_at: string | null;
}

const COLUMNS = "id, piece_id, target, field, proposed, note, status, source, commit_sha, editor_email, " +
  "reason, batch_id, pr_number, created_at, updated_at";

/** The only columns move() may set: identifiers are never taken from input. */
const SETTABLE = new Set(["target", "field", "proposed", "editor_email", "reason"]);

export interface Store {
  list(statuses: readonly RowStatus[], limit: number): Promise<readonly Row[]>;
  get(id: number): Promise<Row | null>;
  /** Moves a row from one status to another, and sets the given columns; false
   * when the row was no longer in `from` (someone else acted first). */
  move(id: number, from: RowStatus, to: RowStatus, set: Partial<Pick<Row, "target" | "field" | "proposed" |
    "editor_email" | "reason">>): Promise<boolean>;
  insertEdit(edit: { target: string; pieceId: string; field: string; proposed: string; note: string; email: string }): Promise<number>;
  queueBatch(batchId: string, ids: readonly number[]): Promise<number>;
  unqueueBatch(batchId: string, to: RowStatus, reason: string | null): Promise<number>;
  setPullRequest(batchId: string, pr: number): Promise<number>;
  acceptBatch(batchId: string, commitSha: string): Promise<number>;
  log(email: string, action: string, correctionId: number | null, detail: string): Promise<void>;
  lastActor(id: number): Promise<{ email: string; action: string; at: string } | null>;
  actionsSince(email: string, seconds: number): Promise<number>;
  lastReviewed(): Promise<string | null>;
}

export function d1Store(db: D1Like): Store {
  return {
    async list(statuses, limit) {
      const marks = statuses.map((_, i) => `?${i + 1}`).join(", ");
      const { results } = await db.prepare(
        `SELECT ${COLUMNS} FROM corrections WHERE status IN (${marks}) ORDER BY created_at DESC, id DESC LIMIT ?${statuses.length + 1}`,
      ).bind(...statuses, limit).all<Row>();
      return results ?? [];
    },
    async get(id) {
      return db.prepare(`SELECT ${COLUMNS} FROM corrections WHERE id = ?1`).bind(id).first<Row>();
    },
    async move(id, from, to, set) {
      const names = Object.keys(set) as (keyof typeof set)[];
      if (names.some((n) => !SETTABLE.has(n))) throw new Error("move: not a settable column");
      const assignments = names.map((n, i) => `${n} = ?${i + 4}`);
      const sql = `UPDATE corrections SET status = ?1, updated_at = datetime('now')` +
        (assignments.length ? `, ${assignments.join(", ")}` : "") + " WHERE id = ?2 AND status = ?3";
      const result = await db.prepare(sql).bind(to, id, from, ...names.map((n) => set[n] ?? null)).run();
      return (result.meta?.changes ?? 0) === 1;
    },
    async insertEdit(edit) {
      const row = await db.prepare(
        "INSERT INTO corrections (piece_id, target, field, proposed, note, status, source, editor_email, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, 'approved', 'editor', ?6, datetime('now')) RETURNING id",
      ).bind(edit.pieceId, edit.target, edit.field, edit.proposed, edit.note, edit.email).first<{ id: number }>();
      return row?.id ?? 0;
    },
    async queueBatch(batchId, ids) {
      const marks = ids.map((_, i) => `?${i + 2}`).join(", ");
      const result = await db.prepare(
        `UPDATE corrections SET status = 'queued', batch_id = ?1, updated_at = datetime('now') ` +
        `WHERE status = 'approved' AND id IN (${marks})`,
      ).bind(batchId, ...ids).run();
      return result.meta?.changes ?? 0;
    },
    async unqueueBatch(batchId, to, reason) {
      const result = await db.prepare(
        "UPDATE corrections SET status = ?2, reason = ?3, batch_id = NULL, pr_number = NULL, " +
        "updated_at = datetime('now') WHERE batch_id = ?1 AND status = 'queued'",
      ).bind(batchId, to, reason).run();
      return result.meta?.changes ?? 0;
    },
    async setPullRequest(batchId, pr) {
      const result = await db.prepare(
        "UPDATE corrections SET pr_number = ?2, updated_at = datetime('now') WHERE batch_id = ?1 AND status = 'queued'",
      ).bind(batchId, pr).run();
      return result.meta?.changes ?? 0;
    },
    async acceptBatch(batchId, commitSha) {
      const result = await db.prepare(
        "UPDATE corrections SET status = 'accepted', commit_sha = ?2, updated_at = datetime('now') " +
        "WHERE batch_id = ?1 AND status = 'queued'",
      ).bind(batchId, commitSha).run();
      return result.meta?.changes ?? 0;
    },
    async log(email, action, correctionId, detail) {
      await db.prepare("INSERT INTO admin_log (email, action, correction_id, detail) VALUES (?1, ?2, ?3, ?4)")
        .bind(email, action, correctionId, detail.slice(0, 500)).run();
    },
    async lastActor(id) {
      return db.prepare("SELECT email, action, at FROM admin_log WHERE correction_id = ?1 ORDER BY id DESC LIMIT 1")
        .bind(id).first<{ email: string; action: string; at: string }>();
    },
    async actionsSince(email, seconds) {
      const row = await db.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE email = ?1 AND at > datetime('now', ?2)")
        .bind(email, `-${seconds} seconds`).first<{ n: number }>();
      return row?.n ?? 0;
    },
    async lastReviewed() {
      const row = await db.prepare("SELECT MAX(at) AS at FROM admin_log").first<{ at: string | null }>();
      return row?.at ?? null;
    },
  };
}
