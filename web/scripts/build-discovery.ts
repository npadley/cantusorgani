// Generate the sitemap from rendered pages, checking metadata before publishing.
// node scripts/build-discovery.ts [dist]
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { canonicalUrl, indexablePath, SITE_ORIGIN, sitemapXml } from "../src/lib/seo.ts";
import { pathFor } from "../src/lib/reach.ts";

const dist = process.argv[2] ?? "dist";
const redirectsFile = join(dist, "_redirects");
const redirectedPaths = new Set(existsSync(redirectsFile)
  ? readFileSync(redirectsFile, "utf8").split("\n").filter(line => !line.trim().startsWith("#"))
    .flatMap(line => {
      const [from, , status] = line.trim().split(/\s+/);
      return from?.startsWith("/") && /^3\d\d$/.test(status ?? "") ? [from] : [];
    }) : []);
const urls: string[] = [];
const errors: string[] = [];
function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
}
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!name.endsWith(".html")) continue;
    const path = pathFor(relative(dist, full));
    if (redirectedPaths.has(path)) continue;
    const html = readFileSync(full, "utf8");
    const meta = html.match(/<meta\b[^>]*>/gi) ?? [];
    if (meta.some(tag => attribute(tag, "http-equiv")?.toLowerCase() === "refresh")) continue;
    const robots = meta.find(tag => attribute(tag, "name") === "robots");
    const noindex = /\bnoindex\b/.test(robots ? attribute(robots, "content") ?? "" : "");
    if (!indexablePath(path)) {
      if (!noindex) errors.push(`${path}: utility page must have noindex`);
      continue;
    }
    if (noindex) { errors.push(`${path}: public page unexpectedly has noindex`); continue; }
    const links = html.match(/<link\b[^>]*>/gi) ?? [];
    const canonicals = links.filter(tag => attribute(tag, "rel") === "canonical");
    const expected = canonicalUrl(path);
    if (canonicals.length !== 1 || attribute(canonicals[0]!, "href") !== expected) errors.push(`${path}: expected exactly one canonical ${expected}`);
    if (!meta.some(tag => attribute(tag, "name") === "description" && attribute(tag, "content")?.trim())) errors.push(`${path}: missing description`);
    for (const [property, value] of [["og:url", expected], ["og:image", `${SITE_ORIGIN}/social-card.png`]]) {
      if (!meta.some(tag => attribute(tag, "property") === property && attribute(tag, "content") === value)) errors.push(`${path}: missing or incorrect ${property}`);
    }
    urls.push(expected);
  }
}
walk(dist);
const robots = readFileSync(join(dist, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)) errors.push("robots.txt: missing production sitemap");
if (/Disallow:\s*\/\s*$/m.test(robots)) errors.push("robots.txt: public crawling is blocked");
for (const file of ["llms.txt", "social-card.png", "_headers"]) {
  if (!statSync(join(dist, file)).isFile()) errors.push(`missing ${file}`);
}
if (urls.length === 0) errors.push("no indexable pages found");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
writeFileSync(join(dist, "sitemap.xml"), sitemapXml(urls));
console.log(`discovery: ${urls.length} canonical URLs; metadata and crawler checks passed`);
