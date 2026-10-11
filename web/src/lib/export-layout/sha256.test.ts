import { createHash, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Bytes, sha256Js, toHex } from './sha256';

const node = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('sha256Js', () => {
  it('should match node for the empty input and the standard vectors', () => {
    expect(toHex(sha256Js(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256Js(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('should match node at every padding boundary and for large inputs', () => {
    for (let n = 0; n <= 200; n++) {
      const data = new Uint8Array(randomBytes(n));
      expect(toHex(sha256Js(data)), `length ${n}`).toBe(node(data));
    }
    for (const n of [4096, 65_537, 1_000_003]) {
      const data = new Uint8Array(randomBytes(n));
      expect(toHex(sha256Js(data)), `length ${n}`).toBe(node(data));
    }
  });
});

describe('sha256Bytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('should give the same digest with and without crypto.subtle (an insecure context has none)', async () => {
    const data = new Uint8Array(randomBytes(5000));
    const withSubtle = toHex(await sha256Bytes(data));
    vi.stubGlobal('crypto', { subtle: undefined });
    const without = toHex(await sha256Bytes(data));
    expect(without).toBe(withSubtle);
    expect(without).toBe(node(data));
  });
});
