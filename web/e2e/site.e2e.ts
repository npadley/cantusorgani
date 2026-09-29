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

// Typeset music, served here by a stand-in for R2: the tests are about the
// page's behaviour, not the drawing (pipeline/typeset tests the drawing).
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" width="539" height="120" viewBox="0 0 539 120">' +
  '<rect x="0" y="50" width="539" height="2"/></svg>';

test.describe("Typeset music", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/typeset/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/svg+xml", body: DRAWING }));
  });

  test("should show a Mass's movements typeset, credited and marked not yet proofread", async ({ page }) => {
    await page.goto("/kyriale/ix/");
    const segments = page.locator("[data-typeset]");
    await expect(segments).toHaveCount(4);
    await expect(segments.first().locator("img.typeset-music")).toBeVisible();
    await expect(segments.first().locator("img.typeset-music")).toHaveAttribute("alt", "Kyrie: the music, typeset");
    await expect(segments.first().locator(".typeset-note")).toContainText("Typeset, not yet proofread");
    await expect(segments.first().locator(".scans")).toBeHidden();
    await expect(page.getByRole("button", { name: "Show the scans" })).toBeVisible();
  });

  test("should swap the whole page to the scans, and remember it", async ({ page }) => {
    await page.goto("/kyriale/ix/");
    await page.getByRole("button", { name: "Show the scans" }).click();
    const first = page.locator("[data-typeset]").first();
    await expect(first.locator(".scans")).toBeVisible();
    await expect(first.locator(".typeset")).toBeHidden();
    await page.reload();
    await expect(page.locator("[data-typeset]").first().locator(".scans")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show the typeset music" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Show the typeset music" }).click();
    await expect(page.locator("[data-typeset]").first().locator("img.typeset-music")).toBeVisible();
  });

  test("should swap one part to its scan with its own switch", async ({ page }) => {
    await page.goto("/kyriale/ix/");
    const [kyrie, gloria] = [page.locator("[data-typeset]").nth(0), page.locator("[data-typeset]").nth(1)];
    await gloria.getByRole("button", { name: "Show the scan" }).click();
    await expect(gloria.locator(".scans")).toBeVisible();
    await expect(gloria.getByRole("button", { name: "Show the typeset music" })).toHaveAttribute("aria-expanded", "true");
    await expect(kyrie.locator(".scans")).toBeHidden();
  });

  test("should fall back to the scans when the drawing cannot be loaded", async ({ page }) => {
    await page.unroute("**/typeset/**");
    await page.route("**/typeset/**", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/kyriale/ix/");
    const first = page.locator("[data-typeset]").first();
    await expect(first.locator(".scans")).toBeVisible();
    await expect(first.locator(".typeset-note")).toContainText("could not be loaded; the scan is shown");
    await expect(first.getByRole("button", { name: "Show the scan" })).toBeHidden();
  });

  test("should credit the transcriptions on the About page", async ({ page }) => {
    await page.goto("/about/#typeset");
    await expect(page.locator("#typeset")).toHaveText("Typeset music");
    await expect(page.locator("main")).toContainText("Joe Egan");
    await expect(page.getByRole("link", { name: "nova-organi-harmonia" }).first())
      .toHaveAttribute("href", "https://github.com/joeegan2202/nova-organi-harmonia");
  });
});

test.describe("A Proper's sections", () => {
  // The Ember Saturday of Advent, from its reviewed list (data/sections/noh1.yml).
  const SECTIONS = ["Introit", "Gradual 1", "Gradual 2", "Gradual 3", "Gradual 4", "Benedictus es", "Tract",
                    "Offertory", "Communion"];

  test("should link, head and export every section of a Mass with four Graduals and a hymn", async ({ page }) => {
    await page.goto("/piece/sabbato-temporum-adventus/");
    await expect(page.locator("nav.movements a")).toHaveText(SECTIONS);
    await expect(page.locator("#gradual-2")).toHaveText("Gradual 2 · 2. Grad. I · In sole posuit");
    await expect(page.locator("#hymn")).toHaveText("Benedictus es · Hymn. VIII");
    await page.locator("nav.movements a", { hasText: "Benedictus es" }).click();
    await expect(page).toHaveURL(/#hymn$/);
    const parts = page.locator("input[name=export-part]");
    await expect(parts).toHaveCount(SECTIONS.length);
    for (const box of await parts.all()) await expect(box).toBeChecked();
  });
});
