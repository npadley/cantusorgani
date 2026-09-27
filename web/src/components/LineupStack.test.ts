import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { lineupFor, sections } from "../lib/vespers";
import type { LineupDay } from "../lib/vespers";
import LineupStack from "./LineupStack.astro";

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
    expect(html).toContain("as printed for Advent II, p. 54");
    expect(html).toContain("Continue every verse to this formula in I g");
  });

  it("should show a note, not a warning, for what is sung unaccompanied", async () => {
    const html = await render(DAY);
    expect(html).toMatch(/class="note[^"]*"[^>]*>The collect of the Sunday, as at Mass\./);
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
