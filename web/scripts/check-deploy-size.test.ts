import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDeploySize, reportDeploySize } from './check-deploy-size';

const dirs: string[] = [];
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-size-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('checkDeploySize', () => {
  it('counts nested assets including hidden files, with Wrangler exclusions scoped correctly', () => {
    const dist = fixture({
      'index.html': 'hello', 'nested/a.json': '{}', '.well-known/test': 'x',
      '_worker.js/index.js': 'ignored', '_redirects': '/old /new 301', '_headers': 'config',
      '_routes.json': '{}', 'functions/api.js': 'ignored', '.wrangler/cache': 'ignored',
      '.DS_Store': 'ignored', 'nested/.DS_Store': 'ignored', 'nested/node_modules/x': 'ignored',
      'node_modules/x': 'ignored', '.git/config': 'ignored', 'nested/.git/config': 'ignored',
      'nested/_headers': 'asset', 'nested/_worker.js': 'asset', 'nested/functions/x': 'asset',
    });
    const result = checkDeploySize(dist);
    expect(result.files).toBe(6);
    expect(result.largest).toEqual({ path: 'index.html', bytes: 5 });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.summary).toContain('files 6/20000, static redirects 1/2000, dynamic 0/100, largest file index.html (5 bytes');
  });

  it('excludes a root _worker.js file as well as a worker directory', () => {
    expect(checkDeploySize(fixture({ '_worker.js': 'worker' })).files).toBe(0);
  });

  it('counts files by kind, with directory kinds taking precedence', () => {
    const result = checkDeploySize(fixture({
      'index.html': 'page', 'pagefind/index.json': '{}', 'chant/score.json': '{}',
      '_astro/app.js': 'bundle', 'assets/music.woff2': 'font', 'assets/woodcut.webp': 'image',
      'misc/data.bin': 'other',
    }));
    expect(result.kinds).toEqual({
      HTML: 1, Pagefind: 1, 'Chant JSON': 1, Bundles: 1, Fonts: 1, Images: 1, Other: 1,
    });
    expect(Object.values(result.kinds).reduce((total, count) => total + count, 0)).toBe(result.files);
  });

  it('warns at the file warning threshold and fails at the failure threshold', () => {
    const dist = fixture({ a: '', b: '' });
    const limits = { fileWarn: 2, fileFail: 3 };
    expect(checkDeploySize(dist, limits).warnings).toHaveLength(1);
    expect(checkDeploySize(dist, limits).errors).toEqual([]);
    writeFileSync(join(dist, 'c'), '');
    expect(checkDeploySize(dist, limits).errors).toHaveLength(1);
  });

  it('ignores blank/comment lines and counts splats and placeholders in the source as dynamic', () => {
    const result = checkDeploySize(fixture({ '_redirects': '\n # comment\r\n\t\n/a /b 301\n/c /d 302\n/blog/* /:splat 200\n/:id /item 301\n/x /:target 302\n' }));
    expect(result.staticRedirects).toBe(3);
    expect(result.dynamicRedirects).toBe(2);
  });

  it('classifies a rule by its source path only, as Pages does', () => {
    const result = checkDeploySize(fixture({ '_redirects': '/old /new/:name 301\n/docs/a https://example.org/*/b 301\n/docs/:page /d 301' }));
    expect(result.staticRedirects).toBe(2);
    expect(result.dynamicRedirects).toBe(1);
  });

  it('does not classify URL schemes or ports as placeholders', () => {
    const result = checkDeploySize(fixture({ '_redirects': '/a https://example.com:8080/b 301' }));
    expect(result.staticRedirects).toBe(1);
    expect(result.dynamicRedirects).toBe(0);
  });

  it('warns at the static threshold and fails only above redirect limits', () => {
    const dist = fixture({ '_redirects': '/a /b 301\n/c /d 301\n/* /:splat 200' });
    const limits = { staticWarn: 2, staticLimit: 2, dynamicLimit: 1 };
    expect(checkDeploySize(dist, limits).warnings).toHaveLength(1);
    expect(checkDeploySize(dist, limits).errors).toEqual([]);
    writeFileSync(join(dist, '_redirects'), '/a /b\n/c /d\n/e /f\n/* /:splat\n/:id /x');
    expect(checkDeploySize(dist, limits).errors).toHaveLength(2);
  });

  it('fails only above the per-file byte limit and names each oversized asset', () => {
    const dist = fixture({ a: '1234', 'nested/b': '12345', c: '123456', '_headers': 'ignored config' });
    const result = checkDeploySize(dist, { maxFileBytes: 4 });
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join(' ')).toContain('nested/b');
    expect(result.largest).toEqual({ path: 'c', bytes: 6 });
  });

  it('handles an empty build and rejects a missing build', () => {
    expect(checkDeploySize(fixture({})).summary).toContain('largest file none');
    expect(() => checkDeploySize(join(fixture({}), 'missing'))).toThrow();
  });
});

it('emits GitHub annotations and appends the summary, including on failure', () => {
  const dist = fixture({ a: '12345' });
  const summaryFile = join(tmpdir(), `deploy-size-summary-${Date.now()}.md`);
  dirs.push(summaryFile);
  writeFileSync(summaryFile, 'Earlier step\n');
  const result = checkDeploySize(dist, { fileWarn: 1, maxFileBytes: 4 });
  const log = vi.fn<(line: string) => void>();
  reportDeploySize(result, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile }, log);
  expect(log).toHaveBeenCalledWith(result.summary);
  expect(log.mock.calls.some(([line]) => line.startsWith('::warning::'))).toBe(true);
  expect(log.mock.calls.some(([line]) => line.startsWith('::error::'))).toBe(true);
  expect(readFileSync(summaryFile, 'utf8')).toBe(`Earlier step\n${result.summary}\n\n| Kind | Files |\n|---|---:|\n| HTML | 0 |\n| Pagefind | 0 |\n| Chant JSON | 0 |\n| Bundles | 0 |\n| Fonts | 0 |\n| Images | 0 |\n| Other | 1 |\n| Total | 1 |\n`);
});

it('prints the by-kind counts to the log', () => {
  const result = checkDeploySize(fixture({ 'index.html': 'page' }));
  const log = vi.fn<(line: string) => void>();
  reportDeploySize(result, {}, log);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('by kind HTML 1, Pagefind 0'));
});
