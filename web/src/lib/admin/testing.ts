/**
 * Test support for the admin code: a D1 stand-in on Node's built-in SQLite
 * (D1's own engine), with the corrections Worker's real migrations applied, and
 * an RSA key pair for signing tokens. Used by tests only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

import { base64UrlEncode } from "./crypto";
import type { Jwk } from "./crypto";
import type { D1Like, D1StatementLike } from "./store";
import type { TargetPiece, Targets } from "./targets";

const MIGRATIONS = resolve(__dirname, "../../../../workers/corrections/migrations");

function statement(db: DatabaseSync, sql: string, values: SQLInputValue[] = []): D1StatementLike {
  return {
    bind: (...next: unknown[]) => statement(db, sql, next as SQLInputValue[]),
    all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
  };
}

const ALL_MIGRATIONS = ["0001_create_corrections.sql", "0002_admin_workflow.sql", "0003_reviews.sql", "0004_target_deduplication.sql", "0005_report_resolution.sql", "0006_typeset_reports.sql", "0007_typeset_drafts.sql", "0008_typeset_previews.sql"];

/** A fresh corrections database, migrated like the live one; `upTo` stops
 * after that many migrations (a live database not yet migrated). */
export function testDb(upTo = ALL_MIGRATIONS.length): { d1: D1Like; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ALL_MIGRATIONS.slice(0, upTo)) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS, name), "utf8"));
  }
  let batchTail: Promise<unknown> = Promise.resolve();
  return { d1: { prepare: (sql: string) => statement(sqlite, sql),
    async batch<T>(statements: D1StatementLike[]) {
      const previous = batchTail;
      let release!: () => void;
      batchTail = new Promise<void>((resolve) => { release=resolve; });
      await previous;
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) {
          const result = await s.all<T>();
          const n = sqlite.prepare("SELECT changes() AS n").get() as { n: number };
          results.push({ ...result, meta: { changes: n.n } });
        }
        sqlite.exec("COMMIT"); return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      finally { release(); }
    },
  }, sqlite };
}

/** A reader's report, inserted the way the Worker inserts it. */
export function readerReport(sqlite: DatabaseSync, pieceId: string, field: string, proposed: string, note = ""): number {
  const row = sqlite.prepare(
    "INSERT INTO corrections (piece_id, field, proposed, note, submitter_hash) VALUES (?, ?, ?, ?, 'h') RETURNING id",
  ).get(pieceId, field, proposed, note) as { id: number };
  return row.id;
}

export function piece(slug: string, extra: Partial<TargetPiece> = {}): TargetPiece {
  return { id: `noh5-${slug}`, slug, volume: "noh5", label: slug, href: `/piece/${slug}/`, title: "Lux et origo",
           incipit: "Kyrie", mode: "VIII", genre: "kyrie", printed_pages: [1, 2], stem: null, aspect: null, ...extra };
}

export function targets(...pieces: TargetPiece[]): Targets {
  return { pieces: Object.fromEntries(pieces.map((p) => [p.slug, p])), genres: ["kyrie", "proper"] };
}

export interface KeyPair { readonly privateKey: CryptoKey; readonly jwk: Jwk; readonly pem: string }

/** An RSA key pair: the private key as a CryptoKey and as PKCS#8 PEM, the
 * public key as a JWK with a kid. */
export async function keyPair(kid = "test-key"): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n");
  return { privateKey: pair.privateKey, jwk: { kid, kty: "RSA", n: pub.n as string, e: pub.e as string },
           pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` };
}

export { base64UrlEncode };
