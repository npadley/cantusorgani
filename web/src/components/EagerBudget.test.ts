import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { allPieces, pieceBySlug } from "../lib/catalog";
import { hasTypeset } from "../lib/typeset";
import SystemStack from "./SystemStack.astro";

describe("the page-wide eager music budget", () => {
  it.each(["typeset first", "scans first", "scans only"])("shares three eager images and one high priority: %s", async (order) => {
    const container = await AstroContainer.create();
    const locals: App.Locals = {};
    // Render both stacks with the same page locals, as a multi-piece page does.
    const typeset = pieceBySlug("dominica-i-adventus")!;
    const scans = allPieces().find((piece) => piece.systems.length >= 4 && !hasTypeset(piece))!;
    const pieces = order === "typeset first" ? [typeset, scans]
      : order === "scans first" ? [scans, typeset] : [scans, scans];
    const html = (await Promise.all(pieces.map((piece, i) => container.renderToString(SystemStack, {
      props: { piece, id: `music-${i}` }, locals,
    })))).join("");
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    const eager = images.filter((tag) => tag.includes('loading="eager"'));
    expect(eager.length).toBeGreaterThan(0);
    expect(eager.length).toBeLessThanOrEqual(3);
    expect(images.filter((tag) => tag.includes('fetchpriority="high"'))).toHaveLength(1);
    expect(eager[0]).toContain('fetchpriority="high"');
  });
});
