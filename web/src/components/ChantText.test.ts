import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { expect, it } from "vitest";
import { pieceBySlug } from "../lib/catalog";
import SystemStack from "./SystemStack.astro";

async function render(slug: string) {
  const container = await AstroContainer.create();
  return container.renderToString(SystemStack, { props: { piece: pieceBySlug(slug)! } });
}

it("makes the Advent Proper's chant words available in collapsed Latin disclosures with sources", async () => {
  const html = await render("dominica-i-adventus");
  expect(html).toMatch(/<details[^>]*class="chant-text"/);
  expect(html).not.toContain('class="search-chant-text"');
  expect(html).toMatch(/<p[^>]*lang="la"[^>]*>[^<]*conf[úu]nd[ée]ntur/i);
  expect(html).toContain("Text source:");
  expect(html).toContain("GregoBase");
  expect(html).not.toMatch(/<details[^>]*class="chant-text"[^>]*open/);
});

it("shows transcription lyrics for a Credo without GABC, credited to the transcription", async () => {
  const html = await render("alii-cantus-ad-libitum-credo-v");
  expect(html).toMatch(/<details[^>]*class="chant-text"/);
  expect(html).toContain("resurrectiónem mortuórum");
  expect(html).toContain("Volunteer transcription");
});

it("includes readable antiphon text in dated Vespers, without duplicating repeated antiphons", async () => {
  const { default: LineupStack } = await import("./LineupStack.astro");
  const { lineupFor } = await import("../lib/vespers");
  const container = await AstroContainer.create();
  const day = lineupFor("2026-11-29")!;
  const html = await container.renderToString(LineupStack, { props: { day } });
  expect((html.match(/IN illa die stillábunt montes dulcédinem/g) ?? []).length).toBe(1);
  expect(html).toMatch(/<details[^>]*class="chant-text"/);
  expect(html).toMatch(/<p[^>]*lang="la"/);
});
