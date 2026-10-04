import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

function check(change?: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "cantus-seo-"));
  const page = (path: string, tags: string) => { mkdirSync(join(dir, path), { recursive: true }); writeFileSync(join(dir, path, "index.html"), `<head>${tags}</head>`); };
  const tags = '<link rel="canonical" href="https://cantusorgani.org/"><meta name="description" content="Music"><meta property="og:url" content="https://cantusorgani.org/"><meta property="og:image" content="https://cantusorgani.org/social-card.png">';
  page("", tags);
  page("search", '<meta name="robots" content="noindex, follow">');
  page("alias", '<meta http-equiv="refresh" content="0;url=/">');
  writeFileSync(join(dir, "robots.txt"), 'User-agent: *\nAllow: /\nSitemap: https://cantusorgani.org/sitemap.xml\n');
  for (const file of ["llms.txt", "social-card.png", "_headers"]) writeFileSync(join(dir, file), "fixture");
  try {
    change?.(dir);
    const result = spawnSync(process.execPath, ["scripts/build-discovery.ts", dir], { cwd: process.cwd(), encoding: "utf8" });
    return { status: result.status, stderr: result.stderr, xml: result.status === 0 ? readFileSync(join(dir, "sitemap.xml"), "utf8") : "" };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
it("generates only canonical public pages, excluding redirects and noindex utilities", () => {
  const result = check();
  expect(result.status, result.stderr).toBe(0);
  expect(result.xml.match(/<loc>/g)).toHaveLength(1);
  expect(result.xml).toContain('<loc>https://cantusorgani.org/</loc>');
});
it("fails the build when public metadata disappears", () => {
  const result = check(dir => writeFileSync(join(dir, "index.html"), '<head></head>'));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('expected exactly one canonical');
});
it("fails the build when utilities become indexable", () => {
  const result = check(dir => writeFileSync(join(dir, "search/index.html"), '<head></head>'));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('utility page must have noindex');
});
it("fails the build when crawler policy blocks the public site", () => {
  const result = check(dir => writeFileSync(join(dir, "robots.txt"), 'Disallow: /\nSitemap: https://cantusorgani.org/sitemap.xml'));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('public crawling is blocked');
});
it("does not advertise an HTML page whose route is configured as a permanent redirect", () => {
  const result = check(dir => {
    mkdirSync(join(dir, "old"));
    const html = readFileSync(join(dir, "index.html"), "utf8").replaceAll('https://cantusorgani.org/"', 'https://cantusorgani.org/old/"');
    writeFileSync(join(dir, "old/index.html"), html);
    writeFileSync(join(dir, "_redirects"), '/old/ / 301\n');
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.xml).not.toContain('/old/');
});
