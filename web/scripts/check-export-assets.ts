// Check the scan PNGs named by a built site's export controls.
//
//   node scripts/check-export-assets.ts [dist]
//
// Run after publishing assets and before a release; not part of pnpm build.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPngUrl } from '../src/lib/export-layout/selection.ts';
import { fetchWithRetry, waitForRetry } from '../src/lib/fetchRetry.ts';
import type { FetchDelay } from '../src/lib/fetchRetry.ts';

interface BuiltPage { path: string; html: string }

function decodeAttribute(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity: string, code: string) => {
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity;
    const point = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

/** Deduplicate stems while retaining every page that exports them. */
export function collectStems(pages: readonly BuiltPage[]): Map<string, string[]> {
  const stems = new Map<string, string[]>();
  for (const page of pages) {
    for (const match of page.html.matchAll(/\sdata-stems\s*=\s*(["'])(.*?)\1/gs)) {
      for (const stem of decodeAttribute(match[2]!).split(',').map((s) => s.trim()).filter(Boolean)) {
        const paths = stems.get(stem) ?? [];
        if (!paths.includes(page.path)) paths.push(page.path);
        stems.set(stem, paths);
      }
    }
  }
  return stems;
}

/** Null means the asset can be used by the browser's export fetch. */
export function classifyResult(response: Response): string | null {
  if (response.status !== 200) return `HTTP ${response.status}`;
  if (!response.headers.get('access-control-allow-origin')?.trim()) return 'missing access-control-allow-origin';
  return null;
}

export async function checkAsset(stem: string, fetchFn: typeof fetch = fetch, delay: FetchDelay = waitForRetry): Promise<string | null> {
  try {
    const response = await fetchWithRetry((url) => fetchFn(url, {
      method: 'HEAD', headers: { Origin: 'https://cantusorgani.org' },
    }), scanPngUrl(stem), delay, 3);
    return classifyResult(response);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main(dist: string): Promise<void> {
  const pages: BuiltPage[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === 'index.html') {
        pages.push({ path: '/' + relative(dist, file).replace(/index\.html$/, ''), html: readFileSync(file, 'utf8') });
      }
    }
  }
  walk(dist);
  const stems = [...collectStems(pages)].filter(([stem]) => /^https?:\/\//i.test(stem));
  if (stems.length === 0) {
    console.log(`check-export-assets: ${pages.length} pages, 0 stems, 0 ok, 0 failed; skipped (no HTTP scan stems; local-image build)`);
    return;
  }
  let next = 0;
  let failed = 0;
  await Promise.all(Array.from({ length: Math.min(16, stems.length) }, async () => {
    while (next < stems.length) {
      const [stem, paths] = stems[next++]!;
      const problem = await checkAsset(stem);
      if (problem !== null) {
        failed++;
        console.error(`${stem}: ${problem}\n  pages: ${paths.join(', ')}`);
      }
    }
  }));
  console.log(`check-export-assets: ${pages.length} pages, ${stems.length} stems, ${stems.length - failed} ok, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv[2] ?? 'dist').catch((error: unknown) => {
    console.error(`check-export-assets: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
