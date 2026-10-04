import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import Layout from "./Layout.astro";

for (const colorScheme of ["light", "dark"] as const) {
  it(`switches the whole page from the ${colorScheme} system theme and remembers it`, async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Layout, { props: { title: "Music" },
      slots: { default: '<img class="typeset-music"><img class="system">' } });
    const css = await readFile(new URL("../styles/tokens.css", import.meta.url), "utf8") +
      (await readFile(new URL("../styles/base.css", import.meta.url), "utf8")).replace(/@import[^;]+;/g, "");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ colorScheme });
      await page.route("**/*", route => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: "text/html", body: html.replace('</head>', `<style>${css}</style></head>`) })
        : route.abort());
      await page.goto("https://cantusorgani.test/");
      const colors = () => page.evaluate(() => ({
        background: getComputedStyle(document.body).backgroundColor,
        ink: getComputedStyle(document.body).color,
        score: getComputedStyle(document.querySelector('.typeset-music')!).filter,
        scan: getComputedStyle(document.querySelector('.system')!).filter,
      }));
      const initial = await colors();
      expect(await page.locator('#polarity').getAttribute('aria-pressed')).toBe(String(colorScheme === 'dark'));
      await page.locator('#polarity').click();
      const flipped = await colors();
      expect(flipped.background).not.toBe(initial.background);
      expect(flipped.ink).not.toBe(initial.ink);
      expect(flipped.score).toBe(colorScheme === 'light' ? 'invert(1)' : 'none');
      expect(flipped.scan).toBe(flipped.score);
      await page.reload();
      expect(await colors()).toEqual(flipped);
      await page.emulateMedia({ media: 'print' });
      expect((await colors()).background).toBe('rgb(255, 255, 255)');
      expect((await colors()).score).toBe('none');
      await page.emulateMedia({ media: 'screen' });
      await page.locator('#polarity').click();
      expect(await colors()).toEqual(initial);
    } finally { await browser.close(); }
  }, 30000);
}
