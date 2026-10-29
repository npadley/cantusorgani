import { expect, test } from "@playwright/test";

const NAV = 'nav[aria-label="Previous and next piece"]';

test("a piece links its neighbours in printed order and back to its day", async ({ page }) => {
  await page.goto("/piece/dominica-ii-adventus/");
  const nav = page.locator(NAV);
  await expect(nav.getByRole("link", { name: /^Previous: Dominica I Adventus/ })).toHaveAttribute("href", "/piece/dominica-i-adventus/");
  await expect(nav.getByRole("link", { name: /^Back to / })).toHaveAttribute("href", "/day/tempora/Adv2-0/");
  await expect(nav.getByRole("link", { name: /^Next: / })).toBeVisible();
  await expect(page.getByRole("heading", { name: "More for this day" })).toBeVisible();
});

test("a Kyriale Mass links the next Mass at its own address", async ({ page }) => {
  await page.goto("/kyriale/i/");
  await expect(page.locator(NAV).getByRole("link", { name: /^Next: / })).toHaveAttribute("href", "/kyriale/ii/");
});

test("a day page ends with more days of its season", async ({ page }) => {
  await page.goto("/day/tempora/Adv1-0/");
  const more = page.getByRole("region", { name: "More for this season" });
  await expect(more.getByRole("link").first()).toHaveAttribute("href", /^\/day\/tempora\/Adv1-/);
  await expect(more.locator('a[href="/day/tempora/Adv1-0/"]')).toHaveCount(0);
});

test("neither list reaches the printed page", async ({ page }) => {
  await page.goto("/piece/dominica-ii-adventus/");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(NAV)).toBeHidden();
  await expect(page.locator(".more-for")).toBeHidden();
});
