/** Shared production identity and indexing policy for HTML and discovery files. */
export const SITE_ORIGIN = "https://cantusorgani.org";
export const SITE_DESCRIPTION = "Gregorian chant organ accompaniments from Nova Organi Harmonia, with Mass and Vespers music for the 1962 Roman calendar.";

export function canonicalUrl(path: string): string {
  const url = new URL(path, SITE_ORIGIN);
  const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${SITE_ORIGIN}${pathname}`;
}

export function indexablePath(path: string): boolean {
  return !/^\/(?:admin|api|search)(?:\/|$)/.test(path) && path !== "/corrections/" && !/^\/404(?:\/|\.html)?$/.test(path);
}

export const xmlEscape = (value: string): string => value.replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

export function sitemapXml(urls: readonly string[]): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...new Set(urls)].sort().map(url => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n") + '\n</urlset>\n';
}
