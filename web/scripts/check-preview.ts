// Check a deployed Pages preview: node scripts/check-preview.ts <url>
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RecordedResponse {
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

const PUBLIC_PATHS = ['/', '/kyriale/i/', '/piece/dominica-i-adventus/', '/corrections/'];
const MISSING_PATH = '/__preview-check-missing__/';
const REDIRECTS: Record<string, string> = {
  // A hand-maintained rule from public/_redirects.
  '/piece/noh1-p156/': '/piece/feria-iv-cinerum/',
};
const KYRIALE_REDIRECT = '/piece/ordinarium-missae-i/';
const PATHS = [...PUBLIC_PATHS, MISSING_PATH, KYRIALE_REDIRECT, ...Object.keys(REDIRECTS), '/admin/'];

function parsedUrl(value: string, base?: string): URL | undefined {
  try { return new URL(value, base); } catch { return undefined; }
}

/** Validate recorded responses without fetching, logging or changing the records. */
export function checkPreviewResponses(origin: string, responses: readonly RecordedResponse[]): string[] {
  const errors: string[] = [];
  for (const path of PATHS) {
    const response = responses.find(record => record.path === path);
    if (!response) { errors.push(`${path}: missing response`); continue; }
    const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
    const location = parsedUrl(headers.location ?? '', origin);
    const redirectTarget = REDIRECTS[path];
    if (redirectTarget !== undefined) {
      if (![301, 308].includes(response.status) || location?.href !== new URL(redirectTarget, origin).href) {
        errors.push(`${path}: expected 301/308 to ${redirectTarget}`);
      }
      continue;
    }
    if (path === KYRIALE_REDIRECT) {
      const target = new URL('/kyriale/i/', origin).href;
      if ([301, 308].includes(response.status) && location?.href === target) continue;
      const refresh = response.body.match(/<meta\b[^>]*>/gi)?.map(tag => {
        const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(([, key, , value]) => [key!.toLowerCase(), value!]));
        return attributes['http-equiv']?.toLowerCase() === 'refresh' ? attributes.content ?? '' : '';
      }).find(Boolean);
      const destination = refresh?.match(/(?:^|;)\s*url\s*=\s*['"]?([^;'"\s]+)['"]?\s*$/i)?.[1];
      const canonicals = [...response.body.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
        const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(([, key, , value]) => [key!.toLowerCase(), value!]));
        return attributes.rel?.toLowerCase().split(/\s+/).includes('canonical') ? [attributes.href ?? ''] : [];
      });
      if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(headers['content-type'] ?? '') ||
          parsedUrl(destination ?? '', origin)?.href !== target ||
          (canonicals.length > 0 && (canonicals.length !== 1 || canonicals[0] !== 'https://cantusorgani.org/kyriale/i/'))) {
        errors.push(`${path}: expected 301/308 to /kyriale/i/ or a 200 meta refresh to /kyriale/i/`);
      }
      continue;
    }
    if (path === '/admin/') {
      if (![301, 302, 303, 307, 308].includes(response.status) || location?.protocol !== 'https:' ||
          !location.hostname.endsWith('.cloudflareaccess.com')) {
        errors.push(`${path}: expected a redirect to cloudflareaccess.com`);
      }
      continue;
    }
    const expectedStatus = path === MISSING_PATH ? 404 : 200;
    if (response.status !== expectedStatus) errors.push(`${path}: expected HTTP ${expectedStatus}, got ${response.status}`);
    if (!/^text\/html(?:;|$)/i.test(headers['content-type'] ?? '')) errors.push(`${path}: expected HTML`);
    if (!/(?:^|[\s,])noindex(?:$|[\s,])/i.test(headers['x-robots-tag'] ?? '')) errors.push(`${path}: expected X-Robots-Tag noindex`);
    // A custom 404 may omit a canonical; ordinary pages must supply one.
    const canonicals = [...response.body.matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
      const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(([, key, , value]) => [key!.toLowerCase(), value!]));
      return attributes.rel?.toLowerCase().split(/\s+/).includes('canonical') ? [attributes.href ?? ''] : [];
    });
    if ((path !== MISSING_PATH && canonicals.length !== 1) || canonicals.some(href => parsedUrl(href)?.origin !== 'https://cantusorgani.org')) {
      errors.push(`${path}: expected a canonical on https://cantusorgani.org`);
    }
    if (path === '/corrections/' && !response.body.includes('Corrections are not configured in this build.')) {
      errors.push(`${path}: expected the not configured notice`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const url = parsedUrl(process.argv[2] ?? '');
  if (!url || url.protocol !== 'https:' || !url.hostname.endsWith('.cantusorgani.pages.dev') || url.username || url.password || url.port) {
    throw new Error('usage: node scripts/check-preview.ts https://<preview>.cantusorgani.pages.dev');
  }
  const responses = await Promise.all(PATHS.map(async path => {
    // Keep the first response: following redirects would hide broken rules or Access.
    const response = await fetch(new URL(path, url.origin), { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return { path, status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
  }));
  const errors = checkPreviewResponses(url.origin, responses);
  for (const error of errors) console.error(`check-preview: ${error}`);
  if (errors.length) process.exitCode = 1;
  else console.log(`check-preview: ${responses.length} paths passed on ${url.origin}`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(`check-preview: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
