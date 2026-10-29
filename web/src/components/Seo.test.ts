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
