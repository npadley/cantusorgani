import { expect, test } from "@playwright/test";

import { starts } from "./data";

// The admin screen, signed in as the test editor, against the reports seeded
// from e2e/seed.sql. Serial: each step leaves the queue as the next expects.

test.describe.serial("The corrections queue", () => {
  test("should show who is signed in, the seeded reports, and that publishing is not set up", async ({ page }) => {
    await page.goto("/admin/");
    await expect(page.locator("#who")).toHaveText("Admin · signed in as editor@example.org (owner)");
    await expect(page.locator("#pending-h")).toHaveText("To review (3)");
    await expect(page.locator("#pending article", { hasText: "III (noh5)" }).locator(".scan figcaption").first())
      .toContainText("First system (noh5/");
    await expect(page.locator("#batch-bar")).toBeHidden();
  });

  test("should accept a report filed under the wrong field as the right one", async ({ page }) => {
    await page.goto("/admin/");
    const item = page.locator("#pending article", { hasText: "III (noh5)" });
    await item.locator("select").selectOption("mode");
    await expect(item.locator("[id^=field-note]")).toHaveText("The reader filed this under “title”.");
    await item.locator("input[id^=value-]").fill("1");
    await item.getByRole("button", { name: "Accept" }).click();
    await expect(page.locator("#approved")).toContainText("III (noh5) · Mode");
    await expect(page.locator("#approved")).toContainText("→ I");
    // Focus moves on to the next report, not back to the top of the page.
    await expect(page.locator(":focus")).toHaveAttribute("id", /^item-\d+$/);
    await expect(page.locator("#batch-text")).toHaveText("1 change ready · publishing is not set up yet");
    await expect(page.getByRole("button", { name: "Publish changes" })).toBeDisabled();
  });

  test("should ask why before rejecting", async ({ page }) => {
    await page.goto("/admin/");
    const item = page.locator("#pending article", { hasText: "Dominica II Adventus" });
    await item.getByRole("button", { name: "Reject", exact: true }).click();
    await item.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(page.locator("#status")).toHaveText("Say briefly why it is rejected.");
    await item.getByLabel("Why? (kept in the log)").fill("The book prints Dominica II Adventus");
    await item.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(page.locator("#pending-h")).toHaveText("To review (1)");
  });

  test("should explain an invalid value beside the report, on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin/");
    const item = page.locator("#pending article", { hasText: "IV (noh5)" });
    await item.locator("input[id^=value-]").fill("IX");
    await item.getByRole("button", { name: "Accept" }).click();
    const error = item.locator(".item-error");
    await expect(error).toContainText("expected I to VIII");
    await error.scrollIntoViewIfNeeded();
    await expect(error).toBeInViewport();
    const box = await item.boundingBox();
    expect(box?.width ?? 999).toBeLessThanOrEqual(375);
  });

  test("should list the history of what was decided", async ({ page }) => {
    await page.goto("/admin/");
    await page.getByRole("button", { name: "Show the last 100" }).click();
    await expect(page.locator(".history-table")).toContainText("The book prints Dominica II Adventus");
  });
});

test.describe("Making a correction", () => {
  test("should explain a part's start, refuse one outside the piece, and approve one in order", async ({ page }) => {
    const s = starts("dominica-i-adventus");
    const inOrder = s["introit"]! + 1 === s["gradual"] ? s["introit"]! + 2 : s["introit"]! + 1;
    await page.goto("/admin/edit/?target=part:dominica-i-adventus/gradual");
    await expect(page.locator("#target-label")).toHaveText("Dominica I Adventus (noh1) · Gradual");
    await expect(page.locator("#part")).toHaveValue("part:dominica-i-adventus/gradual");
    await expect(page.locator("#current")).toHaveText(String(s["gradual"]));
    await expect(page.locator("#field-note")).toContainText("A part runs from the system it starts on until the next part " +
      `starts: this one starts after the Introit (system ${s["introit"]}) and before the Alleluia (system ${s["alleluia"]}). ` +
      "To move it past the Alleluia, move the Alleluia too, in either order, before publishing.");
    await page.locator("#value").fill(String(s.systems + 2));
    await page.getByRole("button", { name: "Approve this correction" }).click();
    await expect(page.locator("#status")).toContainText(`outside the piece, which has ${s.systems} systems`);
    await page.locator("#value").fill(String(inOrder));
    // The system it starts on now, and the one proposed, from the scans.
    await expect(page.locator("#scans figcaption")).toContainText([`Starts now: system ${s["gradual"]}`, `Would start: system ${inOrder}`]);
    await expect(page.locator("#scans img")).toHaveCount(2);
    await page.getByRole("button", { name: "Approve this correction" }).click();
    await expect(page.locator("#status")).toContainText("Approved.");
    await expect(page.locator("#status .notice")).toHaveCount(0);
  });

  test("should approve a part moved past its neighbour with a warning, until the neighbour moves too", async ({ page }) => {
    const s = starts("dominica-i-adventus");
    await page.goto("/admin/edit/?target=part:dominica-i-adventus/gradual");
    await page.locator("#value").fill(String(s["alleluia"]));
    await page.getByRole("button", { name: "Approve this correction" }).click();
    await expect(page.locator("#status .notice")).toContainText("move the Alleluia too.");
    await expect(page.locator("#status .notice")).toContainText("Publishing waits until then.");
    // The link opens the part to move, even one the piece page hides.
    await page.locator("#status .notice").getByRole("link", { name: "Move the Alleluia" }).click();
    await expect(page.locator("#target-label")).toHaveText("Dominica I Adventus (noh1) · Alleluia");
    await page.locator("#value").fill(String(s["alleluia"]! + 1));
    await page.getByRole("button", { name: "Approve this correction" }).click();
    await expect(page.locator("#status")).toContainText("Approved.");
    await expect(page.locator("#status .notice")).toHaveCount(0);
  });

  test("should switch from a piece to one of its parts", async ({ page }) => {
    await page.goto("/admin/edit/?target=piece:dominica-i-adventus");
    await expect(page.locator("#field option")).toHaveText(["Title", "Incipit", "Mode", "Genre", "Printed pages", "Systems (first-last)"]);
    await page.locator("#part").selectOption("part:dominica-i-adventus/introit");
    await expect(page.locator("#field option")).toHaveText(["Starts on system", "Chant (GregoBase id)"]);
    await expect(page.locator("#target-label")).toHaveText("Dominica I Adventus (noh1) · Introit");
  });
});

test.describe("Parts to check", () => {
  test("should list suspect part starts, each opening its edit page with the explanation", async ({ page }) => {
    await page.goto("/admin/");
    await page.getByRole("link", { name: "Parts to check" }).click();
    await expect(page.locator("h1")).toHaveText("Parts to check");
    const first = page.locator(".suspects ul a").first();
    await expect(first).toHaveAttribute("href", /^\/admin\/edit\/\?target=part%3A/);
    await first.click();
    await expect(page.locator("#field option:checked")).toHaveText("Starts on system");
    await expect(page.locator("#field-note")).toContainText("A part runs from the system it starts on until the next part starts");
  });
});
