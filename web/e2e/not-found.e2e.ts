import { expect, test } from "@playwright/test";

test("unknown URLs return a real 404 with useful recovery links", async ({ page }) => {
  const response = await page.goto("/asdkjahsdfasg/missing-score/");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Music not found", exact: true })).toBeVisible();
  await expect(page.locator('main a[href="/search/"]')).toBeVisible();
  await expect(page.locator('main a[href="/calendar/"]')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
