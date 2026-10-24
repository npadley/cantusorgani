import { describe, expect, it } from 'vitest';
import { classifyR2Response, sampleAssets } from './check-r2-headers.ts';

// Recorded-response fixtures: no requests are made by these tests.
const cached = { status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable' } };
const exported = { ...cached, headers: { ...cached.headers, 'access-control-allow-origin': '*' } };

describe('classifyR2Response', () => {
  it('accepts long-lived scans without requiring CORS for display', () => {
    expect(classifyR2Response(cached, false)).toEqual([]);
  });
  it.each(['*', 'https://cantusorgani.org'])('accepts export CORS for %s', (origin) => {
    expect(classifyR2Response({ ...exported, headers: { ...cached.headers, 'access-control-allow-origin': origin } }, true)).toEqual([]);
  });
  it('accepts a one-day lifetime and case-insensitive header names', () => {
    expect(classifyR2Response({ status: 200, headers: { 'Cache-Control': 'public, MAX-AGE="86400"', 'Access-Control-Allow-Origin': '*' } }, true)).toEqual([]);
  });
  it.each([204, 301, 404, 503])('rejects HTTP %i', (status) => {
    expect(classifyR2Response({ ...exported, status }, true)).toContain(`HTTP ${status}`);
  });
  it.each(['', 'public', 'max-age=86399', 's-maxage=31536000', 'max-age=86400oops', 'max-age=-1', 'max-age=86400, max-age=0', 'max-age=86400, no-store', 'max-age=86400, private', 'max-age=86400, no-cache'])('rejects unusable caching: %s', (cache) => {
    expect(classifyR2Response({ status: 200, headers: { 'cache-control': cache } }, false)).not.toEqual([]);
  });
  it.each(['', 'https://preview.pages.dev', 'https://cantusorgani.org.evil.example', '*, https://cantusorgani.org', 'null'])('rejects unusable export CORS: %s', (origin) => {
    expect(classifyR2Response({ ...exported, headers: { ...cached.headers, 'access-control-allow-origin': origin } }, true)).toContain('access-control-allow-origin must be * or https://cantusorgani.org');
  });
  it('reports both cache and CORS failures', () => {
    expect(classifyR2Response({ status: 200, headers: {} }, true)).toHaveLength(2);
  });
});

it('samples hashed catalogue scans and the manifest MEI without changing export URLs', () => {
  expect(sampleAssets('https://images.example', {
    pieces: [{ system_assets: ['systems/noh1/0029/000-3160d54d7980'] }],
  }, { parts: [{ meiUrl: '/mei/abc/score.mei' }] })).toEqual([
    { url: 'https://images.example/systems/noh1/0029/000-3160d54d7980.webp', exportAsset: false },
    { url: 'https://images.example/systems/noh1/0029/000-3160d54d7980@2x.png?export=1', exportAsset: true },
    { url: 'https://images.example/mei/abc/score.mei', exportAsset: true },
    { url: 'https://images.example/mei/abc/boundaries.json', exportAsset: true },
  ]);
});

it('fails rather than silently skipping missing sample keys', () => {
  expect(() => sampleAssets('https://images.example', { pieces: [] }, { parts: [] })).toThrow();
});
