// Read-only release check: node scripts/check-r2-headers.ts [asset base URL]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPngUrl } from '../src/lib/export-layout/selection.ts';
import { fetchWithRetry } from '../src/lib/fetchRetry.ts';

const ORIGIN = 'https://cantusorgani.org';
interface RecordedResponse { status: number; headers: Record<string, string> }
interface Sample { url: string; exportAsset: boolean }
interface Catalogue { pieces: { system_assets?: string[] }[] }
interface Manifest { parts: { meiUrl: string }[] }

/** Validate recorded HEAD responses without network or filesystem access. */
export function classifyR2Response(response: RecordedResponse, exportAsset: boolean): string[] {
  const errors: string[] = [];
  const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value.trim()]));
  if (response.status !== 200) errors.push(`HTTP ${response.status}`);
  const directives = (headers['cache-control'] ?? '').split(',').map((part) => part.trim());
  const ages = directives.filter((part) => /^max-age\s*=/i.test(part));
  const age = ages.length === 1 ? /^max-age\s*=\s*"?(\d+)"?$/i.exec(ages[0]!) : null;
  if (!age || Number(age[1]) < 86400 || directives.some((part) => /^(no-store|no-cache|private)(\s*=|$)/i.test(part))) {
    errors.push('cache-control must allow caching with max-age >= 86400');
  }
  if (exportAsset && !['*', ORIGIN].includes(headers['access-control-allow-origin'] ?? '')) {
    errors.push(`access-control-allow-origin must be * or ${ORIGIN}`);
  }
  return errors;
}

/** Use the same hashed scan stems and MEI paths as the site. */
export function sampleAssets(base: string, catalogue: Catalogue, manifest: Manifest): Sample[] {
  const stem = catalogue.pieces.find((piece) => piece.system_assets?.length)?.system_assets?.[0];
  const mei = manifest.parts.find((part) => part.meiUrl.endsWith('/score.mei'))?.meiUrl;
  if (!stem || !mei) throw new Error('catalogue scan stem or manifest MEI sample is missing');
  const root = base.replace(/\/$/, '') + '/';
  const scan = new URL(stem.replace(/^\//, ''), root).href;
  const score = new URL(mei.replace(/^\//, ''), root).href;
  return [
    { url: `${scan}.webp`, exportAsset: false },
    { url: scanPngUrl(scan), exportAsset: true },
    { url: score, exportAsset: true },
    { url: new URL('boundaries.json', score).href, exportAsset: true },
  ];
}

async function main(base: string): Promise<void> {
  const catalogue = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8')) as Catalogue;
  const manifest = JSON.parse(readFileSync(new URL('../../data/typeset/mei/manifest.json', import.meta.url), 'utf8')) as Manifest;
  const samples = sampleAssets(base, catalogue, manifest);
  let failed = 0;
  for (const sample of samples) {
    try {
      const response = await fetchWithRetry((url) => fetch(url, {
        method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000),
        headers: sample.exportAsset ? { Origin: ORIGIN } : {},
      }), sample.url, undefined, 3);
      const errors = classifyR2Response({ status: response.status, headers: Object.fromEntries(response.headers) }, sample.exportAsset);
      if (errors.length > 0) failed++;
      console.log(`${errors.length > 0 ? 'FAIL' : 'OK'} ${sample.url}: HTTP ${response.status}; cache-control=${response.headers.get('cache-control') ?? '(missing)'}; access-control-allow-origin=${response.headers.get('access-control-allow-origin') ?? '(missing)'}${errors.length > 0 ? `; ${errors.join('; ')}` : ''}`);
    } catch (error: unknown) {
      failed++;
      console.error(`FAIL ${sample.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`check-r2-headers: ${samples.length} assets, ${samples.length - failed} ok, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv[2] ?? 'https://images.cantusorgani.org').catch((error: unknown) => {
    console.error(`check-r2-headers: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
