// Check Cloudflare Pages upload limits after building: node scripts/check-deploy-size.ts [dist]
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILE_LIMIT = 20_000;
export const FILE_WARN = 15_000;
export const FILE_FAIL = 19_000;
export const STATIC_REDIRECT_WARN = 1_500;
export const STATIC_REDIRECT_LIMIT = 2_000;
export const DYNAMIC_REDIRECT_LIMIT = 100;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

interface Limits {
  fileWarn: number; fileFail: number;
  staticWarn: number; staticLimit: number; dynamicLimit: number; maxFileBytes: number;
}
interface Asset { path: string; bytes: number }
export type FileKinds = Record<'HTML' | 'Pagefind' | 'Chant JSON' | 'Bundles' | 'Fonts' | 'Images' | 'Other', number>;
interface Result {
  files: number; staticRedirects: number; dynamicRedirects: number;
  largest: Asset | null; warnings: string[]; errors: string[]; summary: string;
  kinds: FileKinds;
}

const FILE_KIND_ORDER: (keyof FileKinds)[] = ['HTML', 'Pagefind', 'Chant JSON', 'Bundles', 'Fonts', 'Images', 'Other'];

export function checkDeploySize(dist: string, overrides: Partial<Limits> = {}): Result {
  const limits: Limits = {
    fileWarn: FILE_WARN, fileFail: FILE_FAIL, staticWarn: STATIC_REDIRECT_WARN,
    staticLimit: STATIC_REDIRECT_LIMIT, dynamicLimit: DYNAMIC_REDIRECT_LIMIT,
    maxFileBytes: MAX_FILE_BYTES, ...overrides,
  };
  const result: Result = { files: 0, staticRedirects: 0, dynamicRedirects: 0,
    largest: null, warnings: [], errors: [], summary: '',
    kinds: { HTML: 0, Pagefind: 0, 'Chant JSON': 0, Bundles: 0, Fonts: 0, Images: 0, Other: 0 } };
  // Matches Pages validate's IGNORE_LIST in wrangler-dist/cli.js. Root worker
  // files/directories and config are deployed separately, not as static assets.
  const rootIgnored = new Set(['_worker.js', '_redirects', '_headers', '_routes.json', 'functions', '.wrangler']);
  const everywhereIgnored = new Set(['.DS_Store', 'node_modules', '.git']);
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (everywhereIgnored.has(entry.name) || (dir === dist && rootIgnored.has(entry.name))) continue;
      const path = join(dir, entry.name);
      // Wrangler uses stat (following symlinks), rather than lstat, too.
      const stat = statSync(path);
      if (stat.isDirectory()) { walk(path); continue; }
      const asset = { path: relative(dist, path).split('\\').join('/'), bytes: stat.size };
      result.files++;
      const lowerPath = asset.path.toLowerCase();
      const kind: keyof FileKinds = lowerPath.startsWith('pagefind/') ? 'Pagefind'
          : lowerPath.startsWith('chant/') && lowerPath.endsWith('.json') ? 'Chant JSON'
            : lowerPath.startsWith('_astro/') ? 'Bundles'
              : lowerPath.endsWith('.html') ? 'HTML'
                : /\.woff2?$/.test(lowerPath) ? 'Fonts'
                  : /\.(webp|png|jpe?g|svg|avif|gif)$/.test(lowerPath) ? 'Images' : 'Other';
      result.kinds[kind]++;
      if (result.largest === null || asset.bytes > result.largest.bytes) result.largest = asset;
      if (asset.bytes > limits.maxFileBytes) {
        result.errors.push(`${asset.path}: ${asset.bytes} bytes exceeds the per-file limit of ${limits.maxFileBytes} bytes (25 MiB by default).`);
      }
    }
  }
  walk(dist);
  const redirects = join(dist, '_redirects');
  if (existsSync(redirects)) {
    for (const line of readFileSync(redirects, 'utf8').split(/\r?\n/)) {
      const rule = line.trim();
      if (!rule || rule.startsWith('#')) continue;
      // Pages treats a rule as dynamic when its source has a splat or placeholder.
      const source = rule.split(/\s+/)[0] ?? '';
      if (/\*|:[A-Za-z_][\w-]*/.test(source)) result.dynamicRedirects++;
      else result.staticRedirects++;
    }
  }
  if (result.files >= limits.fileFail) result.errors.push(`Files ${result.files} reached the safety threshold ${limits.fileFail} (${FILE_LIMIT} Pages limit).`);
  else if (result.files >= limits.fileWarn) result.warnings.push(`Files ${result.files} reached the warning threshold ${limits.fileWarn}; plan capacity before ${limits.fileFail}.`);
  if (result.staticRedirects > limits.staticLimit) result.errors.push(`Static redirects ${result.staticRedirects} exceed ${limits.staticLimit}.`);
  else if (result.staticRedirects >= limits.staticWarn) result.warnings.push(`Static redirects ${result.staticRedirects} reached the warning threshold ${limits.staticWarn}.`);
  if (result.dynamicRedirects > limits.dynamicLimit) result.errors.push(`Dynamic redirects ${result.dynamicRedirects} exceed ${limits.dynamicLimit}.`);
  const largest = result.largest;
  result.summary = `check-deploy-size: files ${result.files}/${FILE_LIMIT}, static redirects ${result.staticRedirects}/${limits.staticLimit}, dynamic ${result.dynamicRedirects}/${limits.dynamicLimit}, largest file ${largest ? `${largest.path} (${largest.bytes} bytes, ${(largest.bytes / 1024 / 1024).toFixed(2)} MiB)` : 'none'}; per-file limit ${limits.maxFileBytes} bytes (25 MiB by default)`;
  return result;
}

function escapeAnnotation(message: string): string {
  return message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function reportDeploySize(result: Result, env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.log): void {
  log(result.summary);
  log(`check-deploy-size: by kind ${FILE_KIND_ORDER.map((kind) => `${kind} ${result.kinds[kind]}`).join(', ')}, Total ${result.files}`);
  for (const [level, messages] of [['warning', result.warnings], ['error', result.errors]] as const) {
    for (const message of messages) log(env.GITHUB_ACTIONS === 'true' ? `::${level}::${escapeAnnotation(message)}` : `${level}: ${message}`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = FILE_KIND_ORDER.map((kind) => `| ${kind} | ${result.kinds[kind]} |`).join('\n');
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${result.summary}\n\n| Kind | Files |\n|---|---:|\n${rows}\n| Total | ${result.files} |\n`);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = checkDeploySize(process.argv[2] ?? 'dist');
    reportDeploySize(result);
    if (result.errors.length > 0) process.exitCode = 1;
  } catch (error: unknown) {
    const message = `check-deploy-size: ${error instanceof Error ? error.message : String(error)}`;
    console.error(process.env.GITHUB_ACTIONS === 'true' ? `::error::${escapeAnnotation(message)}` : message);
    process.exitCode = 1;
  }
}
