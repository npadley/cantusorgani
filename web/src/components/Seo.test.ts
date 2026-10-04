import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { expect, it } from "vitest";
import Layout from "./Layout.astro";

it("gives a piece one production canonical URL and matching search and social metadata", async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Layout, { props: { title: "Advent", description: "Gregorian chant organ accompaniment." },
    request: new Request("https://preview.pages.dev/piece/dominica-i-adventus/?view=scans#introit") });
  expect(html).toContain('rel="canonical" href="https://cantusorgani.org/piece/dominica-i-adventus/"');
  expect(html).toContain('property="og:url" content="https://cantusorgani.org/piece/dominica-i-adventus/"');
  expect(html).toContain('name="twitter:card"');
  expect(html).toContain('type="application/ld+json"');
});
it("keeps dated Vespers canonical to their own date", async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Layout, { props: { title: "Vespers" },
    request: new Request("https://cantusorgani.org/vespers/2026-11-29/") });
  expect(html).toContain('rel="canonical" href="https://cantusorgani.org/vespers/2026-11-29/"');
  expect(html).toContain('name="description"');
});
it("keeps utility pages out of indexing", async () => {
  const container = await AstroContainer.create();
  for (const path of ["/search/", "/admin/", "/corrections/"]) {
    const html = await container.renderToString(Layout, { props: { title: "Utility" }, request: new Request(`https://cantusorgani.org${path}`) });
    expect(html).toMatch(/name="robots" content="noindex/);
  }
});
