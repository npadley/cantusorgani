/**
 * The admin screen's cryptography, on WebCrypto only (Cloudflare's runtime and
 * Node both provide it): RS256 JWTs (Cloudflare Access sign-in, and the GitHub
 * App), and HMAC-SHA256 (GitHub's webhook signature).
 */

const encoder = new TextEncoder();

/** A fresh ArrayBuffer holding exactly these bytes, as WebCrypto's types ask. */
function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function derLength(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { body.set(p, at); at += p.length; }
  const length = derLength(body.length);
  const out = new Uint8Array(1 + length.length + body.length);
  out[0] = tag; out.set(length, 1); out.set(body, 1 + length.length);
  return out;
}

/** GitHub issues App keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto reads
 * PKCS#8 only. Wraps the one in the other; a PKCS#8 key passes through. */
export function pemToPkcs8(pem: string): Uint8Array {
  const match = /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/.exec(pem.trim());
  if (!match || !match[2]) throw new Error("not a PEM private key");
  const body = Uint8Array.from(atob(match[2].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  if (!match[1]) return body;
  const rsaEncryption = Uint8Array.of(0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
  return der(0x30, Uint8Array.of(0x02, 0x01, 0x00), der(0x30, rsaEncryption), der(0x04, body));
}

export async function importSigningKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", buffer(pemToPkcs8(pem)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
                                 false, ["sign"]);
}

export async function signJwt(payload: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const head = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${head}.${body}`));
  return `${head}.${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export interface Jwk { readonly kid?: string; readonly kty: string; readonly n?: string; readonly e?: string; readonly alg?: string }

export interface VerifiedJwt { readonly header: Record<string, unknown>; readonly payload: Record<string, unknown> }

/** Checks an RS256 JWT's signature against the key its `kid` names. Claims are
 * the caller's to check. Throws on anything malformed or unsigned. */
export async function verifyJwt(token: string, keys: readonly Jwk[]): Promise<VerifiedJwt> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h))) as Record<string, unknown>;
  if (header["alg"] !== "RS256") throw new Error("unexpected algorithm");
  const jwk = keys.find((k) => k.kid === header["kid"] && k.kty === "RSA");
  if (!jwk || !jwk.n || !jwk.e) throw new Error("unknown signing key");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
                                            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, buffer(base64UrlDecode(s)), encoder.encode(`${h}.${p}`));
  if (!ok) throw new Error("bad signature");
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(p))) as Record<string, unknown>;
  return { header, payload };
}

/** GitHub's X-Hub-Signature-256 ("sha256=<hex>") over the raw body, compared in
 * constant time. False for a missing secret: the check fails closed. */
export async function verifyHmac(secret: string | undefined, body: string, signature: string | null): Promise<boolean> {
  if (!secret || !signature || !signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" },
                                            false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = signature.slice("sha256=".length).toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
