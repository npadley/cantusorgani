import { expect, test } from "@playwright/test";

for (const path of ["/about/", "/404.html", "/good-friday/"]) {
  test(`${path} woodcut is responsive, lazy, themed and absent from print`, async ({ page }) => {
    await page.goto(path);
    const art = page.locator("img.woodcut");
    await expect(art).toHaveCount(1);
    await expect(art).toHaveAttribute("loading", "lazy");
    await expect(art).toHaveAttribute("decoding", "async");
    await expect(art).toHaveAttribute("srcset", /(?:360w.*720w|600w.*1200w)/);
    await expect(art).toHaveAttribute("width", /\d+/);
    await expect(art).toHaveAttribute("height", /\d+/);
    await expect(art).toHaveAttribute("alt", path === "/about/" ? /Dürer/ : "");
    await expect(art).not.toHaveAttribute("role");
    await expect(art).not.toHaveAttribute("aria-label");
    await page.evaluate(() => { document.documentElement.dataset.scanPolarity = "inverted"; });
    await expect(art).toHaveCSS("filter", "invert(1)");
    await page.emulateMedia({ media: "print" });
    await expect(art).toBeHidden();
  });
}

test("Gregory accompanies live no-match states and disappears on clearing", async ({ page }) => {
  for (const [path, input] of [["/search/", "#q"], ["/hymns/", "#hymn-filter"]]) {
    await page.goto(path);
    await expect(page.locator("img.woodcut")).toHaveCount(0);
    await page.locator(input).fill("zzzznothingmatcheszzzz");
    const art = page.locator("img.woodcut");
    await expect(art).toBeVisible();
    await expect(art).toHaveAttribute("alt", "");
    await expect(art).not.toHaveAttribute("role");
    await expect(art).not.toHaveAttribute("aria-label");
    await expect(art).toHaveAttribute("loading", "lazy");
    await expect(art).toHaveAttribute("decoding", "async");
    await expect(art).toHaveAttribute("srcset", /360w.*720w/);
    await page.emulateMedia({ media: "print" });
    await expect(art).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await page.locator(input).fill("");
    await expect(page.locator("img.woodcut")).toHaveCount(0);
  }
});

test("chalice follows empty selection into the Choose parts sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/piece/dominica-i-adventus/");
  await expect(page.locator("img.woodcut")).toHaveCount(0);
  await page.locator("[data-choose-parts]").click();
  const sheet = page.locator("#choose-parts-sheet");
  await sheet.locator("[data-clear]").click();
  const art = sheet.locator("img.woodcut");
  await expect(art).toBeVisible();
  await expect(art).toHaveAttribute("alt", "");
  await expect(art).not.toHaveAttribute("role");
  await expect(art).not.toHaveAttribute("aria-label");
  await expect(sheet.locator("[data-selection-art]")).not.toContainText("Tick at least one part");
  await expect(page.locator("#export-btn")).toBeDisabled();
  await expect(page.locator("#export-btn")).toContainText("Tick at least one part");
  await expect(art).toHaveAttribute("loading", "lazy");
  await expect(art).toHaveAttribute("decoding", "async");
  await expect(art).toHaveAttribute("srcset", /360w.*720w/);
  await page.emulateMedia({ media: "print" });
  await expect(art).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await sheet.locator("[data-select-all]").click();
  await expect(page.locator("img.woodcut")).toHaveCount(0);
});

test("a single-part rail shows the chalice when its inline selection is cleared", async ({ page }) => {
  await page.goto("/piece/varia-ad-regias-agni-dapes/");
  await expect(page.locator('[name="export-part"]')).toHaveCount(1);
  await page.locator("[data-inline-part]").uncheck();
  await expect(page.locator(".service-rail img.woodcut")).toBeVisible();
  await page.locator("[data-inline-part]").check();
  await expect(page.locator("img.woodcut")).toHaveCount(0);
});

for (const width of [320, 390]) {
  for (const [path, textSelector] of [
    ["/good-friday/", ".woodcut-moment .notice"],
    ["/404.html", ".woodcut-moment > div"],
    ["/about/", ".prose > .lede"],
  ]) {
    test(`${path} keeps art beside the text at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(path);
      const art = await page.locator("img.woodcut").boundingBox();
      const text = await page.locator(textSelector).evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getClientRects()[0];
        return rect ? { x: rect.x, y: rect.y, width: rect.width } : null;
      });
      expect(art).not.toBeNull();
      expect(text).not.toBeNull();
      expect(art!.width).toBeLessThanOrEqual(path === "/about/" ? 144 : 96);
      expect(text!.y).toBeLessThan(art!.y + art!.height);
      expect(art!.x + art!.width <= text!.x || text!.x + text!.width <= art!.x).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}
