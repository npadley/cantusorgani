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

it("keeps home discovery links after the calendars and before the books", async () => {
  const { default: Home } = await import("../pages/index.astro");
  const container = await AstroContainer.create();
  const html = await container.renderToString(Home, { request: new Request("https://preview.pages.dev/") });
  expect(html).toContain('aria-label="Find more music"');
  const discovery = html.slice(html.indexOf('aria-label="Find more music"'), html.indexOf("The books"));
  for (const href of ["/search/", "/hymns/", "/kyriale/"]) expect(discovery).toContain(`href="${href}"`);
  expect(html.indexOf('class="calendar-links"')).toBeLessThan(html.indexOf('aria-label="Find more music"'));
  const { allPieces, hymnIndex } = await import("../lib/catalog");
  const { divisionsWithContent } = await import("../lib/indexes");
  const books = html.slice(html.indexOf('id="books"'));
  expect(books).toContain('href="/hymns/"');
  expect(books).toContain(`${hymnIndex().length} settings`);
  for (const book of divisionsWithContent(allPieces())) {
    expect(books).toContain(`href="/${book.slug}/"`);
    expect(books).toContain(`${book.count} ${book.count === 1 ? "piece" : "pieces"}`);
  }
});

it("gives Collections public metadata, real book counts and an honest contribute entrance", async () => {
  const { default: Collections } = await import("../pages/collections.astro");
  const { allPieces } = await import("../lib/catalog");
  const { divisionsWithContent } = await import("../lib/indexes");
  const container = await AstroContainer.create();
  const html = await container.renderToString(Collections, { request: new Request("https://preview.pages.dev/collections/?view=scans#contribute") });
  expect(html).toContain('rel="canonical" href="https://cantusorgani.org/collections/"');
  expect(html).toContain('property="og:url" content="https://cantusorgani.org/collections/"');
  expect(html).toContain('name="description"');
  expect(html).toContain('name="twitter:card"');
  expect(html).toContain('type="application/ld+json"');
  expect(html).not.toContain('name="robots"');
  expect(html).toContain('href="/collections/"');
  expect(html).toContain("Mechelen: H. Dessain, 1942");
  const books = html.slice(html.indexOf('id="books"'), html.indexOf('id="contribute"'));
  let previous = -1;
  for (const book of divisionsWithContent(allPieces())) {
    const position = books.indexOf(`href="/${book.slug}/"`);
    expect(position).toBeGreaterThan(previous);
    previous = position;
    expect(books).toContain(`${book.count} ${book.count === 1 ? "piece" : "pieces"}`);
  }
  expect(html).toContain("Submissions are not open yet.");
  expect(html).not.toMatch(/<form[ >]|Illustrative|Another accompaniment collection/);
});
