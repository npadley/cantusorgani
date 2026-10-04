import { expect, it } from "vitest";
import { canonicalUrl, indexablePath, sitemapXml } from "./seo";

it("normalizes bookmarked, parameterized and preview URLs to production", () => {
  expect(canonicalUrl("https://preview.pages.dev/piece/advent?view=scans#introit")).toBe("https://cantusorgani.org/piece/advent/");
  expect(canonicalUrl("/")).toBe("https://cantusorgani.org/");
});
it("includes music and correction history but excludes utilities", () => {
  for (const path of ["/", "/piece/advent/", "/vespers/2026-11-29/", "/corrections/log/"]) expect(indexablePath(path)).toBe(true);
  for (const path of ["/admin/", "/admin/edit/", "/api/example/", "/search/", "/corrections/", "/404.html", "/404/"]) expect(indexablePath(path)).toBe(false);
});
it("writes escaped, unique sitemap URLs without invented change dates", () => {
  const xml = sitemapXml(["https://cantusorgani.org/b/", "https://cantusorgani.org/a/?x=1&y=2", "https://cantusorgani.org/b/"]);
  expect(xml.match(/<url>/g)).toHaveLength(2);
  expect(xml).toContain("?x=1&amp;y=2");
  expect(xml.indexOf("/a/")).toBeLessThan(xml.indexOf("/b/"));
  expect(xml).not.toContain("lastmod");
});
