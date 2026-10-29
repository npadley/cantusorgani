import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { expect, it } from "vitest";
import Layout from "./Layout.astro";
import Hub from "../pages/vespers/[flex]/[name].astro";
import { hubHref, lineupHref, occasions, sungOn } from "../lib/vespers";

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

it("gives recurring hubs and dated I Vespers separate self-canonicals", async () => {
  const container = await AstroContainer.create();
  for (const path of ["/vespers/tempora/Epi5-0/", "/vespers/2026-11-01/i/"]) {
    const html = await container.renderToString(Layout, { props: { title: "Vespers", description: "Published evenings." },
      request: new Request(`https://preview.pages.dev${path}?date=2026-11-01`) });
    expect(html).toContain(`rel="canonical" href="https://cantusorgani.org${path}"`);
    expect(html).toContain(`property="og:url" content="https://cantusorgani.org${path}"`);
    expect(html).toContain('name="twitter:description" content="Published evenings."');
    expect(html).toContain(`"url":"https://cantusorgani.org${path}"`);
    expect(html).not.toContain('name="robots"');
  }
});

it("renders every hub as a music-free archive with its own metadata and a day link", async () => {
  const container = await AstroContainer.create();
  for (const occasion of occasions()) {
    const html = await container.renderToString(Hub, { props: { occasion },
      request: new Request(`https://preview.pages.dev${hubHref(occasion.office)}`) });
    expect(html).toContain(`rel="canonical" href="https://cantusorgani.org${hubHref(occasion.office)}"`);
    expect(html).toContain(`Every date (${occasion.days.length})`);
    expect(html).toContain('href="/day/');
    expect(html).toContain('id="partial-coverage"');
    expect(html).toContain('data-next-evening hidden');
    expect(html).not.toContain('class="service-rail');
    expect(html).not.toContain('class="lineup');
    for (const day of occasion.days) {
      expect(html).toContain(`href="${lineupHref(day)}"`);
      expect(html).toContain(`data-date="${sungOn(day)}"`);
    }
  }
});
