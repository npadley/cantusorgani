import { expect, test } from "@playwright/test";

import { starts } from "./data";

// The public site as a reader meets it: the links that lead to a correction,
// the Corrections form's answers, and the pieces of the page that run scripts.

test.describe("Report links", () => {
  test("should open the Corrections form on a part, with its current values", async ({ page }) => {
    await page.goto("/piece/dominica-i-adventus/");
    await page.locator(".part-head", { hasText: "Gradual" }).getByRole("link", { name: /^Report/ }).click();
    await expect(page).toHaveURL(/target=part%3Adominica-i-adventus%2Fgradual/);
    await expect(page.locator("#target-fixed")).toContainText("Dominica I Adventus (noh1) · Gradual");
    await expect(page.locator("#piece-row")).toBeHidden();
    await expect(page.locator("#field option")).toHaveText(["Where it starts", "Its chant (GregoBase id)"]);
    await expect(page.locator("#field-now")).toHaveText(`Now: ${starts("dominica-i-adventus")["gradual"]}`);
  });

  test("should link each antiphon of a Vespers page, and list the coming evenings", async ({ page }) => {
    await page.goto("/vespers/2026-11-29/");
    await expect(page.locator(".lineup .report-links")).toHaveCount(6);
    await page.goto("/vespers/");
    await expect(page.locator("[data-coming] li").first()).toBeVisible();
  });

  test("should offer Suggest a chant only for movements a Mass has", async ({ page }) => {
    await page.goto("/kyriale/xvi/");
    await expect(page.getByRole("link", { name: "Suggest a chant for the Ite missa est" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Suggest a chant for the Gloria/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Suggest a chant for the Ite missa est" }).click();
    await expect(page.locator("#target-fixed")).toContainText("Ite missa est chant");
    await expect(page.locator("#field-now")).toHaveText("Now: none");
  });
});

test.describe("The Corrections form", () => {
  test("should show the chosen field's current value, and grey out Mode for a Proper", async ({ page }) => {
    await page.goto("/corrections/?target=piece:dominica-i-adventus");
    await page.locator("#field").selectOption("title");
    await expect(page.locator("#field-now")).toHaveText("Now: Dominica I Adventus");
    await expect(page.locator('#field option[value="mode"]')).toBeDisabled();
  });

  test("should say when it cannot find the item it was sent to", async ({ page }) => {
    await page.goto("/corrections/?target=part:nowhere/introit");
    await expect(page.locator("#form-status")).toHaveText("We couldn't find that item; choose it below.");
    await expect(page.locator("#piece-row")).toBeVisible();
  });
});

test.describe("At the organ", () => {
  test("should draw the chant above each part when the switch is on", async ({ page }) => {
    await page.goto("/piece/dominica-i-adventus/");
    await page.locator("[data-chant-toggle]").check();
    const first = page.locator(".chant-notation").first();
    await first.scrollIntoViewIfNeeded();
    await expect(first.locator("svg")).toBeVisible({ timeout: 15_000 });
  });

  test("should invert the scans for a dark loft, and remember it", async ({ page }) => {
    await page.goto("/piece/dominica-i-adventus/");
    await page.getByRole("button", { name: "Invert" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-scan-polarity", "inverted");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-scan-polarity", "inverted");
  });
});
