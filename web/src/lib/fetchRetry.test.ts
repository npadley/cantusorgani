import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from './fetchRetry';
import { httpPdfFetcher, httpPngFetcher } from './pdf';
import { createAssetLoader } from './export-layout/workerDeps';
import { createFetchLoader } from '../scripts/exportPagePreview';
vi.mock('../scripts/lazyStyles', () => ({ loadStylesheet: () => Promise.resolve() }));

const delay = vi.fn(async (_ms: number) => {});

describe('fetchWithRetry', () => {
  it.each(['503', 'network'])('retries %s once after 400 ms', async (failure) => {
    delay.mockClear();
    const f = vi.fn<typeof fetch>();
    if (failure === 'network') f.mockRejectedValueOnce(new TypeError('offline'));
    else f.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const ok = new Response('ok');
    f.mockResolvedValueOnce(ok);
    await expect(fetchWithRetry(f, '/a', delay)).resolves.toBe(ok);
    expect(f.mock.calls).toEqual([['/a'], ['/a']]);
    expect(delay).toHaveBeenCalledExactlyOnceWith(400);
  });
  it('returns 404 without retrying', async () => {
    delay.mockClear();
    const response = new Response(null, { status: 404 });
    const f = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(fetchWithRetry(f, '/a', delay)).resolves.toBe(response);
    expect(f).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
  it('returns the final 5xx and preserves the final network rejection', async () => {
    const response = new Response(null, { status: 520 });
    const f = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(fetchWithRetry(f, '/a', delay)).resolves.toBe(response);
    expect(f).toHaveBeenCalledTimes(2);
    const error = new TypeError('offline');
    f.mockReset().mockRejectedValue(error);
    await expect(fetchWithRetry(f, '/a', delay)).rejects.toBe(error);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

const url = '/asset';
const loaders = [
  { name: 'worker', load: (f: typeof fetch, d: (ms: number) => Promise<void>) => createAssetLoader(f, d).bytes(url, null), error: 'ASSET_MISSING: /asset' },
  { name: 'preview', load: (f: typeof fetch, d: (ms: number) => Promise<void>) => createFetchLoader(f, d).bytes(url, null), error: 'ASSET_MISSING: /asset' },
  { name: 'PNG', load: (f: typeof fetch, d: (ms: number) => Promise<void>) => httpPngFetcher('', f, d)(url), error: 'Could not fetch system /asset (520). Nothing was downloaded.' },
  { name: 'PDF', load: (f: typeof fetch, d: (ms: number) => Promise<void>) => httpPdfFetcher(url, f, d), error: 'typeset PDF 520' },
];
describe.each(loaders)('$name retry integration', ({ load, error }) => {
  it.each(['503', 'network'])('survives one %s failure', async (failure) => {
    const f = vi.fn<typeof fetch>();
    if (failure === 'network') f.mockRejectedValueOnce(new TypeError('offline'));
    else f.mockResolvedValueOnce(new Response(null, { status: 503 }));
    f.mockResolvedValueOnce(new Response('ok'));
    expect((await load(f, delay)).byteLength).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('does not retry 404', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    await expect(load(f, delay)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('keeps the existing error after two 5xx responses', async () => {
    const f = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 520 }));
    await expect(load(f, delay)).rejects.toThrow(error);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
it('preview shares in-flight retries and evicts a failed load', async () => {
  const f = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 503 }));
  const loader = createFetchLoader(f, delay);
  const first = loader.bytes(url, null);
  expect(loader.bytes(url, null)).toBe(first);
  await expect(first).rejects.toThrow('ASSET_MISSING: /asset');
  f.mockResolvedValueOnce(new Response('ok'));
  expect((await loader.bytes(url, null)).byteLength).toBe(2);
  expect(f).toHaveBeenCalledTimes(3);
});
