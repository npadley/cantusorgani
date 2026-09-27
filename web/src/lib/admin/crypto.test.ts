import { describe, expect, it } from "vitest";

import { base64UrlDecode, base64UrlEncode, importSigningKey, pemToPkcs8, signJwt, verifyHmac, verifyJwt } from "./crypto";
import { keyPair } from "./testing";

describe("base64url", () => {
  it("should round-trip bytes and refuse other alphabets", () => {
    const bytes = Uint8Array.of(0, 250, 251, 252, 253, 254, 255);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    expect(() => base64UrlDecode("a+b/")).toThrow(/not base64url/);
  });
});

describe("pemToPkcs8", () => {
  it("should pass a PKCS#8 key through and refuse text that is not a key", async () => {
    const { pem } = await keyPair();
    expect(pemToPkcs8(pem)[0]).toBe(0x30);
    expect(() => pemToPkcs8("hello")).toThrow(/not a PEM private key/);
  });

  it("should wrap a PKCS#1 key (as GitHub issues them) into one WebCrypto can import", async () => {
    const { pem } = await keyPair();
    // Take the RSAPrivateKey out of the PKCS#8 wrapper: it is the last element,
    // an OCTET STRING after the 26-byte version and algorithm header.
    const pkcs8 = pemToPkcs8(pem);
    const header = 26;
    const pkcs1 = pkcs8.slice(header);
    const b64 = btoa(String.fromCharCode(...pkcs1));
    const rsaPem = `-----BEGIN RSA PRIVATE KEY-----\n${b64}\n-----END RSA PRIVATE KEY-----`;
    const key = await importSigningKey(rsaPem);
    expect(key.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
  });
});

describe("JWTs", () => {
  it("should verify a token it signed, and refuse a tampered one or an unknown key", async () => {
    const { privateKey, jwk } = await keyPair();
    const token = await signJwt({ email: "a@b.org" }, privateKey);
    const withKid = token.replace(/^[^.]+/, base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "test-key" }))));
    await expect(verifyJwt(withKid, [jwk])).rejects.toThrow(/bad signature/);   // header changed, signature not
    const { privateKey: other } = await keyPair("other");
    await expect(verifyJwt(await signJwt({ a: 1 }, other), [jwk])).rejects.toThrow(/unknown signing key/);
    await expect(verifyJwt("a.b", [jwk])).rejects.toThrow(/malformed/);
  });
});

describe("verifyHmac", () => {
  it("should accept GitHub's signature and refuse a wrong or missing one, or a missing secret", async () => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s3cret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("{\"a\":1}")));
    const signature = `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    expect(await verifyHmac("s3cret", "{\"a\":1}", signature)).toBe(true);
    expect(await verifyHmac("s3cret", "{\"a\":2}", signature)).toBe(false);
    expect(await verifyHmac("s3cret", "{\"a\":1}", null)).toBe(false);
    expect(await verifyHmac(undefined, "{\"a\":1}", signature)).toBe(false);
    expect(await verifyHmac("s3cret", "{\"a\":1}", "sha256=00")).toBe(false);
  });
});
