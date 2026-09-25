import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/index";

/**
 * The fetch handler against a fake D1 and a stubbed Turnstile endpoint.
 *
 * Both are external dependencies, so both are faked at their boundary; the
 * handler's own logic runs unmodified. The fake records every SQL statement and
 * its bound values, so these tests assert on what would actually reach the
 * database -- including that no submitted text is ever interpolated into SQL.
 */

interface Statement { sql: string; params: unknown[] }

class FakeD1 {
  statements: Statement[] = [];
  recentCount = 0;
  rows: Record<string, unknown>[] = [];
  insertError: Error | null = null;

  prepare(sql: string) {
    const statement: Statement = { sql, params: [] };
    const bound = {
      bind: (...params: unknown[]) => {
        statement.params = params;
        this.statements.push(statement);
        return bound;
      },
      first: async <T>() => ({ n: this.recentCount }) as T,
      all: async <T>() => ({ results: this.rows as T[] }),
      run: async () => {
        if (this.insertError) throw this.insertError;
        return { success: true };
      },
    };
    return bound;
  }

  inserts(): Statement[] {
    return this.statements.filter((s) => s.sql.startsWith("INSERT"));
  }
}

const ORIGIN = "https://cantusorgani.org";

function makeEnv(db: FakeD1, overrides: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as D1Database,
    TURNSTILE_SECRET: "test-secret",
    CORRECTIONS_ENABLED: "true",
    ALLOWED_ORIGIN: ORIGIN,
    ...overrides,
  };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pieceId: "ordinarium-missae-i",
    field: "mode",
    proposedValue: "VIII",
    note: "Liber Usualis",
    turnstileToken: "token-from-widget",
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://api.cantusorgani.org/", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "content-type": "application/json",
      "CF-Connecting-IP": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function stubTurnstile(result: { ok?: boolean; success?: boolean }) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: result.success ?? true }), {
      status: result.ok === false ? 500 : 200,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("corrections worker", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = new FakeD1();
    stubTurnstile({ success: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("preflight and methods", () => {
    it("should answer OPTIONS with 204 and the allowed origin", async () => {
      const response = await worker.fetch(
        new Request("https://api.cantusorgani.org/", { method: "OPTIONS" }),
        makeEnv(db),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    });

    it("should refuse methods other than GET, POST and OPTIONS", async () => {
      const response = await worker.fetch(
        new Request("https://api.cantusorgani.org/", { method: "PUT" }),
        makeEnv(db),
      );
      expect(response.status).toBe(405);
    });

    it("should send security headers on every response", async () => {
      for (const method of ["GET", "PUT", "OPTIONS"]) {
        const response = await worker.fetch(
          new Request("https://api.cantusorgani.org/", { method }), makeEnv(db));
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
      }
    });
  });

  describe("public queue", () => {
    it("should publish structural fields only, never the note", async () => {
      db.rows = [{
        id: 1, piece_id: "ordinarium-missae-i", field: "mode", proposed: "VIII",
        note: "private remark", status: "pending", created_at: "2026-09-08 03:02:58",
      }];
      const response = await worker.fetch(
        new Request("https://api.cantusorgani.org/"), makeEnv(db));
      const body = await response.json() as { corrections: Record<string, unknown>[] };
      expect(response.status).toBe(200);
      expect(body.corrections).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain("private remark");
    });

    it("should drop stored rows that fail revalidation on the way out", async () => {
      db.rows = [{
        id: 2, piece_id: "ordinarium-missae-i", field: "mode", proposed: "<script>",
        note: "", status: "pending", created_at: "2026-09-08 03:02:58",
      }];
      const response = await worker.fetch(
        new Request("https://api.cantusorgani.org/"), makeEnv(db));
      const body = await response.json() as { corrections: unknown[] };
      expect(body.corrections).toEqual([]);
    });
  });

  describe("submission guards", () => {
    it("should return 503 when intake is paused, before any other check", async () => {
      const response = await worker.fetch(post(validBody()), makeEnv(db, { CORRECTIONS_ENABLED: "false" }));
      expect(response.status).toBe(503);
      expect(db.statements).toHaveLength(0);
    });

    it("should reject a foreign origin", async () => {
      const response = await worker.fetch(post(validBody(), { Origin: "https://evil.example" }), makeEnv(db));
      expect(response.status).toBe(403);
    });

    it("should reject a non-JSON content type", async () => {
      const response = await worker.fetch(post("x", { "content-type": "text/plain" }), makeEnv(db));
      expect(response.status).toBe(415);
    });

    it("should reject a declared body larger than the limit", async () => {
      const response = await worker.fetch(post(validBody(), { "content-length": "999999" }), makeEnv(db));
      expect(response.status).toBe(413);
    });

    it("should reject malformed JSON", async () => {
      const response = await worker.fetch(post("{not json"), makeEnv(db));
      expect(response.status).toBe(400);
    });

    it("should reject a missing Turnstile token without calling Cloudflare", async () => {
      const fetchMock = stubTurnstile({ success: true });
      const response = await worker.fetch(post(validBody({ turnstileToken: undefined })), makeEnv(db));
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("should reject a token Turnstile does not confirm, and write nothing", async () => {
      stubTurnstile({ success: false });
      const response = await worker.fetch(post(validBody()), makeEnv(db));
      expect(response.status).toBe(403);
      expect(db.inserts()).toHaveLength(0);
    });

    it("should treat a Turnstile outage as a failed challenge", async () => {
      stubTurnstile({ ok: false });
      const response = await worker.fetch(post(validBody()), makeEnv(db));
      expect(response.status).toBe(403);
    });

    it("should send the secret and client IP to Turnstile", async () => {
      const fetchMock = stubTurnstile({ success: true });
      await worker.fetch(post(validBody()), makeEnv(db));
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const sent = JSON.parse(String(init.body)) as Record<string, string>;
      expect(sent["secret"]).toBe("test-secret");
      expect(sent["remoteip"]).toBe("203.0.113.7");
    });

    it("should rate-limit at five submissions per hour, and insert nothing", async () => {
      db.recentCount = 5;
      const response = await worker.fetch(post(validBody()), makeEnv(db));
      expect(response.status).toBe(429);
      expect(db.inserts()).toHaveLength(0);
    });

    it("should reject a correction that fails boundary validation", async () => {
      const response = await worker.fetch(post(validBody({ proposedValue: "IX" })), makeEnv(db));
      expect(response.status).toBe(400);
      expect(db.inserts()).toHaveLength(0);
    });
  });

  describe("edge inputs", () => {
    it("should reject a JSON body that is not an object", async () => {
      const response = await worker.fetch(post("null"), makeEnv(db));
      expect(response.status).toBe(400);
    });

    it("should still rate-limit a client with no connecting IP header", async () => {
      db.recentCount = 5;
      const request = new Request("https://api.cantusorgani.org/", {
        method: "POST",
        headers: { Origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(validBody()),
      });
      const response = await worker.fetch(request, makeEnv(db));
      expect(response.status).toBe(429);
    });

    it("should return an empty queue when the database yields no result set", async () => {
      db.rows = undefined as unknown as Record<string, unknown>[];
      const response = await worker.fetch(new Request("https://api.cantusorgani.org/"), makeEnv(db));
      expect(await response.json()).toEqual({ corrections: [] });
    });
  });

  describe("accepted submission", () => {
    it("should insert with bound parameters and return 201", async () => {
      const response = await worker.fetch(post(validBody()), makeEnv(db));
      expect(response.status).toBe(201);
      const [insert] = db.inserts();
      expect(insert?.params.slice(0, 4)).toEqual(
        ["ordinarium-missae-i", "mode", "VIII", "Liber Usualis"]);
    });

    it("should never interpolate submitted text into SQL", async () => {
      await worker.fetch(post(validBody({ note: "'; DROP TABLE corrections; --" })), makeEnv(db));
      for (const statement of db.statements) {
        expect(statement.sql).not.toContain("DROP TABLE");
        expect(statement.sql).not.toContain("VIII");
      }
    });

    it("should store a hash of the IP, never the address itself", async () => {
      await worker.fetch(post(validBody()), makeEnv(db));
      const hash = db.inserts()[0]?.params[4];
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(db.statements)).not.toContain("203.0.113.7");
    });

    it("should treat a duplicate pending correction as a no-op success", async () => {
      db.insertError = new Error("D1_ERROR: UNIQUE constraint failed: corrections.piece_id");
      const response = await worker.fetch(post(validBody()), makeEnv(db));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, duplicate: true });
    });

    it("should let any other database error propagate rather than report success", async () => {
      db.insertError = new Error("D1_ERROR: disk I/O error");
      await expect(worker.fetch(post(validBody()), makeEnv(db))).rejects.toThrow("disk I/O");
    });
  });
});
