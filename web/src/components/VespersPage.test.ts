import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { lineupFor, lineupTitle, loadLineup } from "../lib/vespers";
import VespersPage from "./VespersPage.astro";

const days = [lineupFor("2026-11-08")!, [...loadLineup().firstVespers.values()][0]!];

describe("dated Vespers heading", () => {
  it.each(days)("keeps one body day marker, the full rail title and a labelled order nav ($vespers)", async (day) => {
    const html = await (await AstroContainer.create()).renderToString(VespersPage, {
      props: { day }, request: new Request(`https://cantusorgani.org/vespers/${day.date}/`),
    });
    expect(html.match(/class="day-marker day-marker--/g)).toHaveLength(1);
    expect(html).toMatch(/<p class="day-colour ui small"[^>]*>/);
    const railTitle = html.match(/<p class="rail-title"[^>]*>([^<]+)<\/p>/)?.[1];
    expect(railTitle).toContain(`${day.vespers} Vespers — ${lineupTitle(day)}, `);
    if (day.eveningOf) expect(railTitle).toContain("sung on the evening of");
    expect(html).toMatch(/<h2 id="order-of-vespers-heading"[^>]*>Order of Vespers<\/h2>/);
    expect(html).toMatch(/<nav[^>]*aria-labelledby="order-of-vespers-heading"/);
    expect(html).not.toContain('aria-label="Order of Vespers"');
  });
});
