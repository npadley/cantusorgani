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

test("counts results, loads another slice and focuses its first link", async ({ page }) => {
  await page.goto("/search/");
  const input = page.getByRole("searchbox");
  await input.fill("Alleluia");
  await expect(page.locator("#results > p")).toContainText("Showing 25 of");
  await expect(page.locator("#results li")).toHaveCount(25);
  await expect(input).toBeFocused();
  await expect(page.locator("#search-status")).toHaveText(/\d+ results for “Alleluia”\./);
  await page.getByRole("button", { name: "Show 25 more", exact: true }).click();
  const next = page.locator("#results li").nth(25);
  await expect(next).toBeVisible();
  await expect(next.locator("a")).toBeFocused();
  await expect(page.locator("#results > p")).not.toContainText("Showing 25 of");
});
