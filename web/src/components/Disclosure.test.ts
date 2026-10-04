import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { pieceBySlug } from "../lib/catalog";
import ExportBar from "./ExportBar.astro";
import SystemStack from "./SystemStack.astro";

it("shows right/down cues and supports keyboard expansion for chant text and Choose parts", async () => {
  const container = await AstroContainer.create();
  const piece = pieceBySlug("dominica-i-adventus")!;
  const html = await container.renderToString(ExportBar, { props: { pieces: [piece], title: piece.title } }) +
    await container.renderToString(SystemStack, { props: { piece } });
  const css = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8") +
    (await readFile(new URL("../styles/base.css", import.meta.url), "utf8")).replace(/@import[^;]+;/g, "");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.route('**/*', route => route.abort());
    await page.setContent(`<style>${css}</style>${html}`);
    for (const selector of ['.parts', '.chant-text']) {
      const details = page.locator(selector).first();
      const cue = details.locator('.disclosure-cue');
      expect(await cue.evaluate(el => getComputedStyle(el).transform)).toBe('none');
      await details.locator('summary').focus();
      await page.keyboard.press('Enter');
      expect(await details.evaluate(el => (el as HTMLDetailsElement).open)).toBe(true);
      expect(await cue.evaluate(el => getComputedStyle(el).transform)).toBe('matrix(0, 1, -1, 0, 0, 0)');
      await details.locator('summary').click();
      expect(await details.evaluate(el => (el as HTMLDetailsElement).open)).toBe(false);
    }
  } finally { await browser.close(); }
}, 30000);
