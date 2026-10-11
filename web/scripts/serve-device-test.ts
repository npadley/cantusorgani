// A small static server for trying the export editor on a real device (an iPad on the same Wi-Fi).
//
//   pnpm build:e2e          (once: builds dist-e2e/, the fixture-manifest build)
//   pnpm serve:device       (then open the printed address on the iPad)
//
// It serves dist-e2e/ at the site root, as `wrangler pages dev dist-e2e` does for the e2e specs, and fills in what
// that build does not contain, so that Kyrie IX is a typeset part and the editor can lay it out:
//   /systems/<ref>                the asset base the build was made with (PUBLIC_ASSET_BASE=/systems): the system
//                                 images, typeset pictures and typeset PDFs. Proxied, read-only, to the production
//                                 asset base, and only for the allowlisted prefixes below.
//   /__fixtures__/kyrie-ix.mei    the fixture manifest's MEI, from the repository.
// Nothing else is proxied: this is not an open proxy.
//
// Remote asset base, first that is set: PUBLIC_ASSET_BASE_REMOTE; PUBLIC_ASSET_BASE from web/.env (read the way
// with-public-env.ts reads it, skipped when 1Password does not serve the pipe in time); the `PUBLIC_ASSET_BASE`
// in wrangler.toml (not a secret). A relative value such as "/systems" is ignored: it is the local build's base.
//
// Why not just localhost: an iPad reaches this machine by its LAN address, and Safari treats http://<lan-ip> as an
// insecure context. Workers, WASM and Blob downloads all work there; crypto.subtle (used to verify the music and
// font digests) does not, and the editor carries a small JavaScript SHA-256 for exactly this case.
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { publicEntries } from "../src/lib/publicEnv.ts";

const WEB = fileURLToPath(new URL("..", import.meta.url));
export const DEFAULT_PORT = 4330;
/** The only paths proxied to the asset base, after the leading `/systems/` is removed. */
export const PROXY_ALLOW = /^(systems|typeset|mei)\/[A-Za-z0-9._@\-/]+$/;
const FIXTURE_MEI = "/__fixtures__/kyrie-ix.mei";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".wasm": "application/wasm", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".mei": "application/xml; charset=utf-8", ".map": "application/json",
};

export interface DeviceServerOptions {
  /** Directory of the built site (dist-e2e). */
  readonly root: string;
  /** Production asset base, e.g. https://images.cantusorgani.org (no trailing slash). */
  readonly remote: string;
  /** The fixture MEI served at /__fixtures__/kyrie-ix.mei. */
  readonly fixtureMei: string;
  readonly fetchImpl?: typeof fetch;
}

function send(res: ServerResponse, status: number, body: string | Uint8Array, type = "text/plain; charset=utf-8", extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(body);
}

/** Resolve a URL path inside root, or null when it would leave it. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const file = resolve(join(root, normalize(decoded)));
  return file === root || file.startsWith(root + sep) ? file : null;
}

export function createDeviceServer(options: DeviceServerOptions): Server {
  const root = resolve(options.root);
  const remote = options.remote.replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  async function proxy(rest: string, res: ServerResponse): Promise<void> {
    if (!PROXY_ALLOW.test(rest) || rest.split("/").some((s) => s === "..")) { send(res, 404, "not found"); return; }
    try {
      const upstream = await doFetch(`${remote}/${rest}`, { method: "GET", redirect: "error" });
      const body = new Uint8Array(await upstream.arrayBuffer());
      send(res, upstream.status, body, upstream.headers.get("content-type") ?? MIME[extname(rest)] ?? "application/octet-stream");
    } catch {
      send(res, 502, "the asset server could not be reached");
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") { send(res, 405, "read-only", "text/plain", { allow: "GET, HEAD" }); return; }
    const url = new URL(req.url ?? "/", "http://device.local");
    if (url.pathname === FIXTURE_MEI) { send(res, 200, options.fixtureMei, MIME[".mei"]!); return; }
    if (url.pathname.startsWith("/systems/")) { await proxy(url.pathname.slice("/systems/".length), res); return; }
    let file = resolveInside(root, url.pathname);
    if (file === null) { send(res, 400, "bad path"); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) || !statSync(file).isFile()) {
      const notFound = join(root, "404.html");
      send(res, 404, existsSync(notFound) ? await readFile(notFound) : "not found", MIME[".html"]);
      return;
    }
    const body = req.method === "HEAD" ? "" : await readFile(file);
    send(res, 200, body, MIME[extname(file)] ?? "application/octet-stream");
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, "server error"); else res.end(); });
  });
}

/** The production asset base, or null when none can be found. */
export async function findRemoteBase(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const absolute = (v: string | undefined): string | null => (v !== undefined && /^https?:\/\//.test(v) ? v.replace(/\/$/, "") : null);
  const fromEnv = absolute(env["PUBLIC_ASSET_BASE_REMOTE"]);
  if (fromEnv !== null) return fromEnv;
  const envFile = join(WEB, ".env");
  if (existsSync(envFile)) {
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000).unref());
      const entries = publicEntries(await Promise.race([readFile(envFile, "utf8"), timeout]));
      const fromFile = absolute(entries["PUBLIC_ASSET_BASE"]);
      if (fromFile !== null) return fromFile;
    } catch { /* 1Password did not serve the pipe: fall through */ }
  }
  const toml = join(WEB, "wrangler.toml");
  if (existsSync(toml)) return absolute(/^\s*PUBLIC_ASSET_BASE\s*=\s*"([^"]+)"/m.exec(readFileSync(toml, "utf8"))?.[1]);
  return null;
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

async function main(): Promise<void> {
  const root = resolve(WEB, "dist-e2e");
  if (!existsSync(join(root, "kyriale", "ix", "index.html"))) {
    console.error("dist-e2e/ is missing or incomplete. Build it first:  pnpm build:e2e");
    process.exit(1);
  }
  const remote = await findRemoteBase();
  if (remote === null) {
    console.error("No production asset base found. Set PUBLIC_ASSET_BASE_REMOTE=https://... (the images host), then run again.");
    process.exit(1);
  }
  const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
  const fixtureMei = readFileSync(join(WEB, "src", "lib", "export-layout", "__fixtures__", "kyrie-ix.mei"), "utf8");
  const server = createDeviceServer({ root, remote, fixtureMei });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Device-test server: serving dist-e2e/, assets proxied from ${remote}`);
    console.log("Open Kyrie IX on the iPad (same Wi-Fi):");
    const addresses = lanAddresses();
    for (const a of addresses.length > 0 ? addresses : ["localhost"]) console.log(`  http://${a}:${port}/kyriale/ix/`);
    console.log("Ctrl-C stops it.");
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) await main();
