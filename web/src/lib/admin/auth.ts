/**
 * Who is making an admin request.
 *
 * Cloudflare Access sits in front of /admin/* and signs each request it lets
 * through (the Cf-Access-Jwt-Assertion header). The admin code checks that
 * signature itself, and the address against its own EDITORS list, so a
 * mistaken Access rule alone cannot let anyone in.
 */
import { verifyJwt } from "./crypto";
import type { Jwk } from "./crypto";

export interface AuthEnv {
  /** e.g. "cantusorgani.cloudflareaccess.com" */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag. */
  readonly ACCESS_AUD?: string;
  /** Comma-separated addresses allowed in; the first is the owner. */
  readonly EDITORS?: string;
  /** Local development only: sign in as this address on localhost. */
  readonly ADMIN_DEV_EMAIL?: string;
}

export interface Editor { readonly email: string; readonly owner: boolean }

export type AuthResult =
  | { readonly ok: true; readonly editor: Editor }
  | { readonly ok: false; readonly status: 401 | 403 | 503; readonly error: string };

export function editorsOf(env: AuthEnv): readonly string[] {
  return (env.EDITORS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
}

type CertFetcher = (url: string) => Promise<readonly Jwk[]>;

let certCache: { url: string; keys: readonly Jwk[]; until: number } | null = null;

async function accessCerts(url: string): Promise<readonly Jwk[]> {
  if (certCache && certCache.url === url && certCache.until > Date.now()) return certCache.keys;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Access certs: HTTP ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  certCache = { url, keys, until: Date.now() + 10 * 60_000 };
  return keys;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function authenticate(request: Request, env: AuthEnv, certs: CertFetcher = accessCerts,
                                   now: number = Date.now()): Promise<AuthResult> {
  const editors = editorsOf(env);
  const url = new URL(request.url);
  // `wrangler pages dev` has no Access in front of it. Only on a local host,
  // and only when the local .dev.vars names an address that is also an editor.
  const dev = env.ADMIN_DEV_EMAIL?.trim().toLowerCase();
  if (dev && LOCAL.has(url.hostname)) {
    return editors.includes(dev) ? { ok: true, editor: { email: dev, owner: editors[0] === dev } }
      : { ok: false, status: 403, error: `${dev} is not in EDITORS.` };
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || editors.length === 0) {
    return { ok: false, status: 503, error: "The admin screen is not configured yet (Access or EDITORS missing)." };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401, error: "Your session ended. Sign in again." };
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await verifyJwt(token, await certs(`${issuer}/cdn-cgi/access/certs`)));
  } catch {
    return { ok: false, status: 401, error: "Your session ended. Sign in again." };
  }
  const aud = payload["aud"];
  const audiences = Array.isArray(aud) ? aud : [aud];
  const exp = Number(payload["exp"]);
  if (!audiences.includes(env.ACCESS_AUD) || payload["iss"] !== issuer || !(exp * 1000 > now)) {
    return { ok: false, status: 401, error: "Your session ended. Sign in again." };
  }
  const email = String(payload["email"] ?? "").toLowerCase();
  if (!editors.includes(email)) {
    return { ok: false, status: 403, error: `${email || "This account"} is not an editor of this site.` };
  }
  return { ok: true, editor: { email, owner: editors[0] === email } };
}
