import { beforeAll, describe, expect, it } from "vitest";

import { authenticate, editorsOf } from "./auth";
import { signJwt } from "./crypto";
import { keyPair } from "./testing";
import type { KeyPair } from "./testing";

const ENV = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud-123",
              EDITORS: "Owner@Example.org, ed@example.org" };
const NOW = 1_800_000_000_000;
let keys: KeyPair;

beforeAll(async () => { keys = await keyPair(); });

async function token(claims: Record<string, unknown>): Promise<string> {
  const payload = { aud: ["aud-123"], iss: "https://team.cloudflareaccess.com", exp: NOW / 1000 + 600,
                    email: "ed@example.org", ...claims };
  const signed = await signJwt(payload, keys.privateKey);
  // signJwt writes no kid; Access does. Re-sign with the header Access uses.
  const header = btoa(JSON.stringify({ alg: "RS256", kid: "test-key" })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body = signed.split(".")[1] as string;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

function request(jwt?: string, host = "https://cantusorgani.org"): Request {
  return new Request(`${host}/admin/api/me`, { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} });
}

const certs = async () => [keys.jwk];

describe("editorsOf", () => {
  it("should read the list, lower-cased, skipping anything that is not an address", () => {
    expect(editorsOf({ EDITORS: " A@b.org, nope ,c@d.org" })).toEqual(["a@b.org", "c@d.org"]);
    expect(editorsOf({})).toEqual([]);
  });
});

describe("authenticate", () => {
  it("should let an editor in with a valid Access token, and mark the first listed as owner", async () => {
    const ed = await authenticate(request(await token({})), ENV, certs, NOW);
    expect(ed).toEqual({ ok: true, editor: { email: "ed@example.org", owner: false } });
    const owner = await authenticate(request(await token({ email: "owner@example.org" })), ENV, certs, NOW);
    expect(owner.ok && owner.editor.owner).toBe(true);
  });

  it("should refuse a signed-in account that is not an editor with 403", async () => {
    const result = await authenticate(request(await token({ email: "stranger@example.org" })), ENV, certs, NOW);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("should treat a missing, expired, mis-addressed or badly signed token as a session to renew (401)", async () => {
    const bad = [undefined, await token({ exp: NOW / 1000 - 1 }), await token({ aud: ["other"] }),
                 await token({ iss: "https://evil.cloudflareaccess.com" }), `${await token({})}x`];
    for (const jwt of bad) {
      expect(await authenticate(request(jwt), ENV, certs, NOW)).toMatchObject({ ok: false, status: 401 });
    }
  });

  it("should answer 503 until Access and the editors are configured", async () => {
    expect(await authenticate(request(await token({})), { ...ENV, ACCESS_AUD: "" }, certs, NOW))
      .toMatchObject({ ok: false, status: 503 });
    expect(await authenticate(request(await token({})), { ...ENV, EDITORS: "" }, certs, NOW))
      .toMatchObject({ ok: false, status: 503 });
  });

  it("should allow the local development address on localhost only, and only if it is an editor", async () => {
    const dev = { ...ENV, ADMIN_DEV_EMAIL: "ed@example.org" };
    expect(await authenticate(request(undefined, "http://localhost:8788"), dev, certs, NOW)).toMatchObject({ ok: true });
    expect(await authenticate(request(undefined, "https://cantusorgani.org"), dev, certs, NOW))
      .toMatchObject({ ok: false, status: 401 });
    expect(await authenticate(request(undefined, "http://127.0.0.1:8788"), { ...dev, ADMIN_DEV_EMAIL: "x@y.org" }, certs, NOW))
      .toMatchObject({ ok: false, status: 403 });
  });
});
