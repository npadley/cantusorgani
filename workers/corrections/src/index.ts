/**
 * Corrections intake for cantusorgani.org.
 *
 * A public, unauthenticated write endpoint, so every guard here is load-bearing:
 * Turnstile, an Origin allowlist, a durable rate limit, boundary validation, and
 * a kill switch that pauses intake without a redeploy.
 */

import { parseCorrection } from "./schema";
import { toPublicRows } from "./status";
import type { StoredRow } from "./status";

export interface Env {
  readonly DB: D1Database;
  readonly TURNSTILE_SECRET: string;
  /** Kill switch. Intake can be paused without a redeploy. */
  readonly CORRECTIONS_ENABLED: string;
  readonly ALLOWED_ORIGIN: string;
}

const RATE_LIMIT = 5;
const WINDOW_SECONDS = 3600;
const MAX_BODY_BYTES = 8 * 1024;
const PAGE_SIZE = 100;
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileOutcome {
  readonly success?: boolean;
  readonly "error-codes"?: readonly string[];
  readonly hostname?: string;
}
interface CountRow { readonly n: number }

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

/** Security headers on every response. */
const HARDENING: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...headers, ...HARDENING } });
}

/** Hashed so the raw IP is never stored: rate limiting needs identity, not an address. */
async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`cantusorgani:${ip}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Counted in D1, not KV. KV is eventually consistent and get-then-put is not
 * atomic, so a concurrent burst all reads the same value and all passes; KV also
 * caps writes at roughly 1/s per key, dropping exactly the increments an
 * attacker generates. D1 counts the rows that actually landed.
 */
async function underLimit(env: Env, submitterHash: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM corrections " +
      "WHERE submitter_hash = ?1 AND created_at > datetime('now', ?2)",
  )
    .bind(submitterHash, `-${WINDOW_SECONDS} seconds`)
    .first<CountRow>();
  return (row?.n ?? 0) < RATE_LIMIT;
}

async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  const response = await fetch(TURNSTILE_VERIFY, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  if (!response.ok) {
    console.warn(`turnstile: siteverify answered HTTP ${response.status}`);
    return false;
  }
  const outcome = (await response.json()) as TurnstileOutcome;
  if (outcome.success !== true) {
    // Cloudflare's reason (e.g. invalid-input-secret, timeout-or-duplicate) and
    // the hostname the widget ran on: never the secret or the token.
    console.warn(`turnstile: failed: ${(outcome["error-codes"] ?? []).join(", ") || "no reason given"}; ` +
                 `hostname ${outcome.hostname ?? "unknown"}`);
  }
  return outcome.success === true;
}

async function handleGet(env: Env, cors: Record<string, string>): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, piece_id, target, field, proposed, note, status, created_at, resolved_by, duplicate_of, commit_sha " +
      "FROM corrections ORDER BY created_at DESC LIMIT ?1",
  )
    .bind(PAGE_SIZE)
    .all<StoredRow>();
  // Structural fields only. The submitter's note is deliberately absent.
  return json({ corrections: toPublicRows(results ?? []) }, 200, cors);
}

async function handlePost(request: Request, env: Env, cors: Record<string, string>,
                          ip: string): Promise<Response> {
  if (env.CORRECTIONS_ENABLED !== "true") {
    return json({ error: "Corrections are paused." }, 503, cors);
  }
  if (request.headers.get("Origin") !== env.ALLOWED_ORIGIN) {
    return json({ error: "Forbidden origin." }, 403, cors);
  }
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return json({ error: "Expected application/json." }, 415, cors);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return json({ error: "Request body too large." }, 413, cors);
  }

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return json({ error: "Expected a JSON object." }, 400, cors);
  }

  const token = (body as Record<string, unknown>)["turnstileToken"];
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return json({ error: "Missing Turnstile token." }, 400, cors);
  }
  if (!(await verifyTurnstile(env, token, ip))) {
    return json({ error: "Challenge failed." }, 403, cors);
  }

  const submitterHash = await hashIp(ip);
  if (!(await underLimit(env, submitterHash))) {
    return json(
      { error: `Rate limit exceeded: at most ${RATE_LIMIT} corrections per hour.` },
      429,
      cors,
    );
  }

  const parsed = parseCorrection(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400, cors);

  const { pieceId, field, proposedValue, note, target } = parsed.value;
  try {
    await env.DB.prepare(
      "INSERT INTO corrections (piece_id, field, proposed, note, submitter_hash, target) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(pieceId, field, proposedValue, note, submitterHash, target)
      .run();
  } catch (error) {
    // The unique index makes a repeat submission a no-op rather than queue spam.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return json({ ok: true, duplicate: true }, 200, cors);
    }
    throw error;
  }

  return json({ ok: true }, 201, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env.ALLOWED_ORIGIN);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    // Pages and the Worker are different origins, so a JSON POST preflights.
    // Answering OPTIONS with 405 would make every submission fail before it is
    // ever sent.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, ...HARDENING } });
    }
    if (request.method === "GET") {
      return handleGet(env, cors);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, cors);
    }
    return handlePost(request, env, cors, ip);
  },
} satisfies ExportedHandler<Env>;
