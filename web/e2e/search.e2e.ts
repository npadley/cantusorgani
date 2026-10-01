import { expect, test } from "@playwright/test";

test("finds chant lyrics beyond the incipit and shows their highlighted excerpt", async ({ page }) => {
  await page.goto("/search/");
  await page.getByRole("searchbox").fill("irri");
  const result = page.locator('#results a[href="/piece/dominica-i-adventus/"]');
  await expect(result).toBeVisible();
  await expect(result.locator(".excerpt")).toContainText(/irr[íi]deant/i);
  await expect(result.locator("mark")).toContainText(/irr[íi]deant/i);
});

test("finds a Credo's inner verse from its typeset source and still searches titles", async ({ page }) => {
  await page.goto("/search/");
  await page.getByRole("searchbox").fill("baptisma");
  const result = page.locator('#results a[href="/piece/alii-cantus-ad-libitum-credo-v/"]');
  await expect(result).toBeVisible();
  await expect(result.locator(".excerpt")).toContainText(/bapt[íi]sma/i);
  await expect(result.locator("mark")).toContainText(/bapt[íi]sma/i);
  await page.getByRole("searchbox").fill("Credo VI");
  await expect(page.locator('#results a[href="/piece/alii-cantus-ad-libitum-credo-vi/"]')).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await expect(page.locator("#results li")).toHaveCount(0);
  await expect(page.locator("#fallback")).toBeVisible();
});
