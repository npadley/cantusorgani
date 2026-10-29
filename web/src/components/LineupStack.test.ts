import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { exportLineup, lineupFor, sections } from "../lib/vespers";
import type { LineupDay } from "../lib/vespers";
import LineupStack from "./LineupStack.astro";
import VespersPage from "./VespersPage.astro";
import GoodFridayPage from "../pages/good-friday/index.astro";

async function render(day: LineupDay): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(LineupStack, { props: { day } });
}

const DAY = lineupFor("2026-11-08") as LineupDay;

describe("LineupStack", () => {
  it("should print every section in sung order with the tone in its heading", async () => {
    const html = await render(DAY);
    const headings = [...html.matchAll(/<h2[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(headings).toEqual(sections(DAY).map((s) => s.anchor));
    expect(html).toContain("1. Dixit Dominus — VII c2");
    expect(html).toContain("Antiphon (repeated)");
  });

  it("should draw every system at one scale across sources", async () => {
    const html = await render(DAY);
    const widths = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(100);
    expect(Math.max(...widths)).toBe(100);
    expect(widths.every((w) => w > 0 && w <= 100)).toBe(true);
  });

  it("should say where the tone-bank Magnificat comes from and how to continue", async () => {
    const html = await render(DAY);
    expect(html).toMatch(/<details class="provenance[^>]*>[\s\S]*?<summary[^>]*>[\s\S]*?Source of this formula[\s\S]*?<\/summary>[\s\S]*?as printed for Advent II, p. 54[\s\S]*?<\/details>/);
    expect(html).toContain("Continue every verse to this formula in I g");
  });

  it("offers an inline PDF choice for each accompanied item without hiding the music", async () => {
    const html = await render(DAY);
    const systems = [...html.matchAll(/data-ref="([^"]+)"/g)].map(match => match[1]);
    expect(systems.length).toBeGreaterThan(100);
    expect(html.match(/data-inline-part=/g)?.length).toBe(exportLineup(DAY).length);
    expect(html).toMatch(/aria-label="In PDF: [^"]+" checked/);
  });

  it("should show a note, not a warning, for what is sung unaccompanied", async () => {
    const html = await render(DAY);
    expect(html).toMatch(/class="note[^"]*"[^>]*>The collect of the day, as at Mass\./);
    expect(html).not.toContain('class="notice"');
  });

  it("should give chant links and notation for the first antiphon only, never the repeat", async () => {
    const html = await render(DAY);
    expect(html.match(/data-chant-id="2767"/g)?.length).toBe(1);
    expect(html).toMatch(/Chant<span class="sr-only"[^>]*> for Antiphon: Dixit Dominus Domino meo/);
  });

  it("should name the item in a slice's error message and read tones in full", async () => {
    const html = await render(DAY);
    expect(html).toContain('data-item="Psalm 109"');
    expect(html).toContain("tone 7, ending c 2");
  });
});


describe("Vespers and Good Friday readers", () => {
  it("keeps dated Vespers controls in the rail, with the actual sources and sung anchors", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(VespersPage, { props: { day: DAY } });
    expect(html).toContain('class="reader-layout"');
    expect(html).toContain('class="service-rail no-print"');
    expect(html).toContain('day-marker--green');
    expect(html).toMatch(/<h2[^>]*>Order of Vespers<\/h2>/);
    expect(html).toContain('data-chant-toggle');
    expect(html).toContain('id="source-noh8"');
    for (const section of sections(DAY)) expect(html).toContain(`id="${section.anchor}"`);
  });

  it("credits Good Friday chants in a source block without offering accompaniment export", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(GoodFridayPage);
    expect(html).toMatch(/<section class="source-block[^>]*>[\s\S]*?GregoBase[\s\S]*?CC0[\s\S]*?no accompaniment[\s\S]*?<\/section>/);
    expect(html).toContain('id="chants"');
    expect(html).not.toContain('id="export-btn"');
  });
});
