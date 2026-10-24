import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { expect, it } from "vitest";
import { pieceBySlug } from "../lib/catalog";
import SystemStack from "./SystemStack.astro";
import TypesetSwitch from "./TypesetSwitch.astro";

it("renders the page-wide switch as a plain action button", async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(TypesetSwitch, { props: { show: true } });
  const button = html.match(/<button\b[^>]*>[^<]*<\/button>/)?.[0];
  expect(button).toContain("Show the scans");
  expect(button).not.toContain("aria-pressed");
});

it("names each per-part action with its visible label and hidden part name", async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SystemStack, {
    props: { piece: pieceBySlug("dominica-i-adventus")! }, locals: {},
  });
  const buttons = html.match(/<button\b[^>]*class="link show-scan"[^>]*>[\s\S]*?<\/button>/g) ?? [];
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(button).not.toContain("aria-expanded");
    expect(button).toMatch(/>Show the scan<span class="sr-only"[^>]*> of the [^<]+<\/span><\/button>/);
  }
  expect(buttons[0]).toContain("of the Introit");
});
