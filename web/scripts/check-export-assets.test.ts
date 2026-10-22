import { describe, expect, it, vi } from 'vitest';
import { classifyResult, collectStems, checkAsset } from './check-export-assets';
describe('collectStems', () => {
  it('splits stems, decodes attributes, deduplicates and keeps referring pages', () => {
    expect([...collectStems([
      { path: '/one/', html: `<i data-stems="https://x/a, /local,https://x/b?a=1&amp;b=2"></i><i data-stems='https://x/a,, '></i>` },
      { path: '/two/', html: '<i data-stems="https://x/a"></i><i data-other="https://x/no"></i>' },
    ])]).toEqual([
      ['https://x/a', ['/one/', '/two/']], ['/local', ['/one/']], ['https://x/b?a=1&b=2', ['/one/']],
    ]);
  });
});
describe('classifyResult', () => {
  it('requires exactly 200 and a nonempty CORS header', () => {
    expect(classifyResult(new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } }))).toBeNull();
    expect(classifyResult(new Response(null, { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }))).toBe('HTTP 404');
    expect(classifyResult(new Response(null, { status: 204 }))).toBe('HTTP 204');
    expect(classifyResult(new Response())).toBe('missing access-control-allow-origin');
    expect(classifyResult(new Response(null, { headers: { 'access-control-allow-origin': '' } }))).toBe('missing access-control-allow-origin');
  });
});
it('uses the export URL, HEAD and Origin, allowing three attempts', async () => {
  const f = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { headers: { 'access-control-allow-origin': '*' } }));
  await expect(checkAsset('https://x/scan', f, async () => {})).resolves.toBeNull();
  expect(f).toHaveBeenCalledTimes(3);
  expect(f).toHaveBeenLastCalledWith('https://x/scan@2x.png?export=1', {
    method: 'HEAD', headers: { Origin: 'https://cantusorgani.org' },
  });
});
it('reports final failures without retrying 4xx', async () => {
  const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
  await expect(checkAsset('https://x/scan', f, async () => {})).resolves.toBe('HTTP 404');
  expect(f).toHaveBeenCalledTimes(1);
  f.mockReset().mockResolvedValue(new Response(null, { status: 520 }));
  await expect(checkAsset('https://x/scan', f, async () => {})).resolves.toBe('HTTP 520');
  expect(f).toHaveBeenCalledTimes(3);
  f.mockReset().mockRejectedValue(new TypeError('offline'));
  await expect(checkAsset('https://x/scan', f, async () => {})).resolves.toBe('offline');
  expect(f).toHaveBeenCalledTimes(3);
});
