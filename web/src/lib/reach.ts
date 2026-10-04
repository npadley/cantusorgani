/**
 * Can a reader get to every page? Checked on the built site (dist/), by
 * following links from the home page the way a reader would.
 *
 * A page that works when its URL is typed but that no link leads to is a page
 * nobody finds: the full Vespers pages were built that way once. This check
 * fails the build instead.
 */

/** A built page: its URL path ("/piece/x/") and its HTML. */
export interface BuiltPage { readonly path: string; readonly html: string }

export interface ReachReport {
  /** Pages no chain of links from the start reaches. */
  readonly orphans: readonly string[];
  /** Internal links to nothing: [from, to]. */
  readonly broken: readonly (readonly [string, string])[];
  readonly reached: number;
}

/** Built pages that are reached some other way than by a link. */
export const NOT_LINKED: readonly RegExp[] = [/^\/404(?:\/|\.html)$/];

/** A redirect page (an old or duplicate address) needs no link to it. */
export function isRedirect(html: string): boolean {
  return /<meta\s[^>]*http-equiv\s*=\s*["']?refresh/i.test(html);
}

const HREF = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** The dist file for a URL path. */
export function fileFor(path: string): string {
  return path.endsWith("/") ? `${path}index.html` : path;
}

/** A dist-relative HTML file as the URL path it serves. */
export function pathFor(file: string): string {
  const clean = `/${file.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  if (clean === "/index.html") return "/";
  if (clean.endsWith("/index.html")) return clean.slice(0, -"index.html".length);
  return clean;
}

/** Internal links in a page, resolved against it: no hash, no query, never
 * another site. */
export function linksIn(html: string, from: string): readonly string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(HREF)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
    const url = new URL(raw, `https://site.invalid${from}`);
    out.add(decodeURIComponent(url.pathname));
  }
  return [...out];
}

/** Breadth-first from `start` over the built pages. `files` holds every
 * other file in dist (PDFs, vendored scripts) a link may point at. */
export function reach(pages: readonly BuiltPage[], files: ReadonlySet<string>, start = "/"): ReachReport {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const seen = new Set<string>([start]);
  const broken: (readonly [string, string])[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const from = queue.shift() as string;
    const page = byPath.get(from);
    if (!page) continue;
    for (const to of linksIn(page.html, from)) {
      const target = byPath.has(to) ? to : byPath.has(`${to}/`) ? `${to}/` : null;
      if (target === null) {
        if (!files.has(to)) broken.push([from, to]);
        continue;
      }
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  const orphans = pages.filter((p) => !seen.has(p.path) && !isRedirect(p.html)).map((p) => p.path)
    .filter((p) => !NOT_LINKED.some((re) => re.test(p))).sort();
  return { orphans, broken, reached: seen.size };
}

/** Every Vespers page must be listed on the Vespers index itself, not only
 * reachable by a long way round. */
export function missingFrom(index: BuiltPage | undefined, pages: readonly BuiltPage[], prefix: RegExp): readonly string[] {
  const listed = new Set(index ? linksIn(index.html, index.path) : []);
  return pages.map((p) => p.path).filter((p) => prefix.test(p) && !listed.has(p)).sort();
}

/** The report as lines a person can act on; empty when all is well. */
export function describe(report: ReachReport, unlisted: readonly string[]): readonly string[] {
  const lines: string[] = [];
  const few = <T,>(xs: readonly T[]) => xs.slice(0, 20);
  if (report.orphans.length) {
    lines.push(`${report.orphans.length} page(s) no link leads to (a reader cannot find them):`,
      ...few(report.orphans).map((p) => `  ${p}`),
      "  Fix: link each from the page a reader would come from (its day, its book section or its index).");
  }
  if (report.broken.length) {
    lines.push(`${report.broken.length} link(s) to pages that do not exist:`,
      ...few(report.broken).map(([from, to]) => `  ${from} -> ${to}`),
      "  Fix: correct the link, or build the page it points at.");
  }
  if (unlisted.length) {
    lines.push(`${unlisted.length} Vespers page(s) missing from /vespers/:`,
      ...few(unlisted).map((p) => `  ${p}`),
      "  Fix: VespersDates on /vespers/ should list every page from allLineups().");
  }
  return lines;
}
