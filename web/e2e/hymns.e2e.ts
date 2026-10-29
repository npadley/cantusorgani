import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

test("the home box reaches complete VII hymns and existing embedded hymn anchors", async ({ page }) => {
  await page.goto("/");
  await page.locator('a[href="/hymns/"]').first().click();
  await expect(page.locator('ul.hymns a[href^="/piece/varia-"]')).toHaveCount(69);
  await expect(page.locator('ul.hymns a[href*="varia-en-ut-superba"]')).toHaveCount(0);
  await page.locator('ul.hymns a[href="/piece/vesperae-corporis-christi/#hymn"]').click();
  await expect(page.locator("#hymn")).toBeVisible();
  await expect(page.locator('a[href="/piece/varia-pange-lingua-gloriosi-corporis/"]')).toBeVisible();
});

test("related VII settings appear on day and both dated office pages", async ({ page }) => {
  for (const route of ["/day/tempora/Adv1-0/", "/vespers/2026-11-29/", "/vespers/2026-12-08/i/"]) {
    await page.goto(route);
    await expect(page.locator('a[href^="/piece/varia-"]').first()).toBeVisible();
    // Related settings are navigation, never additions to the office/Mass export payload.
    for (const stems of await page.locator("input[name=export-part]").evaluateAll(
      (inputs) => inputs.map((i) => (i as HTMLElement).dataset.stems ?? ""))) {
      expect(stems).not.toContain("systems/noh7/");
    }
  }
});

test("VII reference-only antiphons link to their containing scores", async ({ page }) => {
  await page.goto("/piece/varia-exsurge-domine/");
  await expect(page.locator('a[href="/piece/varia-in-litaniis-maioribus-et-minoribus/"]')).toBeVisible();
  await expect(page.locator("#music img")).toHaveCount(0);
});

test("verified hymn chants render beside both standalone and embedded scores", async ({ page }) => {
  await page.goto("/piece/varia-creator-alme-siderum/");
  await page.locator("[data-chant-toggle]").check();
  await page.locator('.chant-notation[data-chant-id="2134"]').first().scrollIntoViewIfNeeded();
  await expect(page.locator('.chant-notation[data-chant-id="2134"] svg').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('a[href="https://gregobase.selapa.net/chant.php?id=2134"]').first()).toBeVisible();
  await page.goto("/piece/vesperae-dominicae-i-iv-adventus/");
  await page.locator("[data-chant-toggle]").check();
  await page.locator('.chant-notation[data-chant-id="2134"]').first().scrollIntoViewIfNeeded();
  await expect(page.locator('.chant-notation[data-chant-id="2134"] svg').first()).toBeVisible({ timeout: 15_000 });
});

test("uncertain hymn links carry a review label and publish no notation", async ({ page }) => {
  await page.goto("/piece/varia-auctor-beate-saeculi/");
  await expect(page.getByText("pairing needs review.", { exact: false })).toBeVisible();
  await expect(page.locator('.chant-notation')).toHaveCount(0);
  await page.goto("/piece/varia-o-amator-castitatis-s-rumoldi/");
  await expect(page.getByText("No matching chant found in GregoBase.")).toBeVisible();
  await expect(page.locator('.chant-notation')).toHaveCount(0);
});

test("a VII hymn loads its published scans and exports a readable PDF", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/piece/varia-creator-alme-siderum/");
  const image = page.locator("#music img").first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-btn").click()]);
  const pdf = await PDFDocument.load(await readFile(await download.path()));
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  await expect(page.locator("#export-status")).toContainText("PDF ready");
});

test("filters hymns and clears no matches with focus returned to the field", async ({ page }) => {
  await page.goto("/hymns/");
  const input = page.getByRole("searchbox", { name: "Filter hymns" });
  await expect(input).toBeVisible();
  const total = await page.locator("ul.hymns li:visible").count();
  expect(total).toBeGreaterThan(0);
  await input.fill("creator");
  await expect(page.locator("[data-hymn-count]")).toContainText("of");
  const visible = page.locator("ul.hymns li:visible");
  expect(await visible.count()).toBeGreaterThan(0);
  for (const item of await visible.all()) await expect(item).toContainText(/creator/i);
  await input.fill("zzzz");
  await expect(page.getByText("No hymns match ‘zzzz’.", { exact: true })).toBeVisible();
  await expect(visible).toHaveCount(0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(visible).toHaveCount(total);
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await input.fill("creator");
  await input.press("Escape");
  await expect(visible).toHaveCount(total);
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
});

test("shows the complete hymn list without JavaScript and hides the filter", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/hymns/");
    const items = page.locator("ul.hymns li");
    const total = await items.count();
    expect(total).toBeGreaterThan(0);
    await expect(page.locator("ul.hymns li:visible")).toHaveCount(total);
    await expect(page.getByRole("searchbox", { name: "Filter hymns", includeHidden: true })).toBeHidden();
  } finally {
    await context.close();
  }
});
