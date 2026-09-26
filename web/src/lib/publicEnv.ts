/**
 * The PUBLIC_ variables of a .env file, and nothing else.
 *
 * web/.env is mounted from 1Password as a named pipe, which Vite does not read
 * (it loads only regular files). scripts/with-public-env.ts reads it instead and
 * hands Astro the PUBLIC_ variables through the process environment. The same
 * file holds the pipeline's R2 keys; they are dropped here and never reach the
 * build.
 */

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

function unquote(raw: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(raw);
  if (quoted) return quoted[2] ?? "";
  // An unquoted value ends at a comment.
  return raw.replace(/\s+#.*$/, "");
}

export function publicEntries(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    const [, name, raw] = match;
    if (name === undefined || raw === undefined || !name.startsWith("PUBLIC_")) continue;
    out[name] = unquote(raw);
  }
  return out;
}
