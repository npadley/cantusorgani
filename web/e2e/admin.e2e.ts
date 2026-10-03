import { expect, test } from "@playwright/test";

import { starts } from "./data";

// The admin screen, signed in as the test editor, against the reports seeded
// from e2e/seed.sql. Serial: each step leaves the queue as the next expects.

test.describe.serial("The corrections queue", () => {
  test("should show who is signed in, the seeded reports, and that publishing is not set up", async ({ page }) => {
    await page.goto("/admin/");
    await expect(page.locator("#who")).toHaveText("Admin · signed in as editor@example.org (owner)");
    await expect(page.locator("#pending-h")).toHaveText("Readers' reports (3)");
    await expect(page.locator("#pending article", { hasText: "III (noh5)" }).locator(".scan figcaption").first())
      .toContainText("First system (vol. 5, scan p.");
    await expect(page.locator("#batch-text")).toHaveText("Nothing waiting to publish");
    await expect(page.getByRole("button", { name: "Publish changes" })).toBeDisabled();
  });

  test("should show what is waiting, counted the same as on Review and in the navigation", async ({ page }) => {
    await page.goto("/admin/");
    const fixCell = page.locator("[data-sum=fix]");
    await expect(fixCell).toHaveText(/^\d+ left|^None$/);
    await expect(page.locator("[data-sum=reports]")).toHaveText("3 to answer");
    const count = async (sel: string) => Number(/^(\d+) left/.exec((await page.locator(sel).textContent()) ?? "")?.[1] ?? 0);
    const fix = await count("[data-sum=fix]");
    const check = await count("[data-sum=check]");
    await expect(page.locator("[data-nav-count=review]")).toHaveText(`(${fix + check})`);
    await expect(page.locator("[data-sum=proofreading]")).toHaveText(/^[\d,]+ of [\d,]+ proofread/);
    await page.getByRole("link", { name: "Open the checks" }).click();
    await expect(page).toHaveURL(/\/admin\/review\/\?group=check$/);
    await expect(page.getByLabel(/^Check against the scan/)).toBeChecked();
    await expect(page.locator("[data-count=check]")).toHaveText(String(check));
    await expect(page.locator("[data-count=fix]")).toHaveText(String(fix));
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
    await expect(page.locator("#pending-h")).toHaveText("Readers' reports (1)");
    // Undo puts it back to be answered; then reject it for good.
    await page.locator("#admin-notice").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#pending-h")).toHaveText("Readers' reports (2)");
    const again = page.locator("#pending article", { hasText: "Dominica II Adventus" });
    await again.getByRole("button", { name: "Reject", exact: true }).click();
    await again.getByLabel("Why? (kept in the log)").fill("The book prints Dominica II Adventus");
    await again.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(page.locator("#pending-h")).toHaveText("Readers' reports (1)");
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
    // Once the page has loaded the part: it fills in the current start then, over anything typed before.
    await expect(page.locator("#current")).toHaveText(String(s["gradual"]));
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
  test("should list suspect part starts on Review, each opening its edit page with the explanation", async ({ page }) => {
    // The old Parts to check page redirects to the same items on Review.
    await page.goto("/admin/parts/");
    await expect(page).toHaveURL(/\/admin\/review\/\?kind=part_to_check$/);
    await expect(page.getByLabel("Kind")).toHaveValue("part_to_check");
    const item = page.locator("#items article:visible").first();
    await expect(item.getByRole("link", { name: "Edit the sections" })).toHaveAttribute("href", /^\/admin\/sections\/\?piece=/);
    const first = item.getByRole("link", { name: "Correct" });
    await expect(first).toHaveAttribute("href", /^\/admin\/edit\/\?target=part%3A/);
    await first.click();
    await expect(page.locator("#field option:checked")).toHaveText("Starts on system");
    await expect(page.locator("#field-note")).toContainText("A part runs from the system it starts on until the next part starts");
  });
});

test.describe("Sections", () => {
  test("should list a piece's sections beside its scans, add one at a system, and approve the whole list", async ({ page }) => {
    await page.goto("/admin/sections/?piece=sabbato-temporum-adventus");
    await expect(page.locator("h1")).toContainText("Sections: Sabbato Temporum Adventus");
    const rows = page.locator("#rows > li");
    await expect(rows).toHaveCount(9);
    await expect(rows.nth(2).locator("strong")).toHaveText("3. Gradual 2");
    await expect(page.locator("#system-16 .starts")).toContainText("Gradual 2 starts here");
    // Nothing changed yet: nothing to approve, and the footer says so.
    await expect(page.locator("#save")).toBeDisabled();
    await expect(page.locator("#changes")).toContainText("No changes yet");

    await page.locator("#system-3").getByRole("button", { name: "Start a section here" }).click();
    await expect(rows).toHaveCount(10);
    await expect(page.locator("#row-1-kind")).toBeFocused();
    await page.locator("#row-1-kind").selectOption("other");
    await page.locator("#row-1-label").fill("Oratio");
    await page.locator("#save").click();
    await expect(page.locator("#status")).toContainText("Approved. It is waiting on the Admin page");

    await page.goto("/admin/");
    await expect(page.locator("#approved")).toContainText("Sabbato Temporum Adventus (noh1) · sections · Sections");
    await expect(page.locator("#approved")).toContainText("Section at system 3");
    await page.locator("#approved article", { hasText: "· sections" }).getByRole("button", { name: "Withdraw" }).click();
  });

  test("should refuse a list out of order, naming the section, with the edit page linking here", async ({ page }) => {
    await page.goto("/admin/sections/?piece=sabbato-temporum-adventus");
    await expect(page.locator("#rows > li")).toHaveCount(9);
    await page.locator("#row-1-system").fill("1");
    await page.locator("#save").click();
    await expect(page.locator("#status")).toContainText("Section 2 starts on system 1, not after the section before");
    await expect(page.locator("#row-1-kind")).toBeFocused();
    await page.locator("#reset").click();
    await expect(page.locator("#row-1-system")).toHaveValue("7");

    await page.goto("/admin/edit/?target=piece:sabbato-temporum-adventus");
    await page.getByRole("link", { name: "edit its whole list of sections" }).click();
    await expect(page).toHaveURL(/\/admin\/sections\/\?piece=sabbato-temporum-adventus$/);
  });
});

test.describe("Review, by kind", () => {
  test("should count what is waiting of each kind, and show one kind alone when it is chosen", async ({ page }) => {
    await page.goto("/admin/review/");
    const kinds = page.locator("#breakdown button");
    // Only the kinds of the group shown, each with a count that adds up to the group's.
    await expect(kinds.first()).toBeVisible();
    const counts = (await kinds.allTextContents()).map((t) => Number(/\((\d+)\)$/.exec(t)?.[1] ?? 0));
    const total = Number((await page.locator("[data-count=fix]").textContent()) ?? "0");
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);

    // Whichever kinds are waiting today: the review queue empties as work is done.
    const chosen = kinds.first();
    const text = (await chosen.textContent()) ?? "";
    const label = text.replace(/ \(\d+\)$/, "");
    const n = Number(/\((\d+)\)$/.exec(text)?.[1] ?? 0);
    await chosen.click();
    await expect(chosen).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Kind")).not.toHaveValue("");
    await expect(page.locator("#shown")).toHaveText(`${n} shown`);
    await expect(page.locator("#items article:visible").first()).toHaveAttribute("data-label", label);

    // Another group has other kinds: the choice is dropped, not left showing nothing.
    await page.getByLabel(/^Check against the scan/).check();
    await expect(page.getByLabel("Kind")).toHaveValue("");
    await expect(kinds.first()).toBeVisible();
    await expect(page.locator("#items article:visible").first()).toBeVisible();
  });
});

test.describe.serial("Reviewing", () => {
  test("should mark an item as looking right, send it with the next publish, and keep it done after a reload", async ({ page }) => {
    await page.goto("/admin/");
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Review" }).click();
    await expect(page.locator("h1")).toHaveText("Review");
    await page.getByLabel(/^Check against the scan/).check();
    const before = Number((await page.locator("[data-count=check]").textContent()) ?? "0");
    const item = page.locator("#items article:visible").first();
    const heading = (await item.locator("h3").textContent()) ?? "";
    // Two items can share a heading: find this one by its target.
    const target = (await item.getAttribute("data-review-target")) ?? "";
    const self = page.locator(`#items article[data-review-target="${target}"]`);
    await expect(item.locator(".scan img").first()).toBeVisible();
    // The confirming button says what it confirms: "Not printed here" for a part not found.
    await expect(item.locator("[data-act=looks-right]")).toHaveText("Not printed here");
    await item.locator("[data-act=looks-right]").click();
    await expect(page.locator("#status")).toHaveText(`${heading}: marked as looking right.`);
    await expect(page.locator("[data-count=check]")).toHaveText(String(before - 1));
    // Done items are hidden unless asked for; focus moved on to the next one.
    // It stays in view, dimmed, for ten seconds (with Undo), then the filter hides it.
    await expect(self.locator(".review-state")).toContainText("Undo");
    await expect(self).toBeHidden({ timeout: 15_000 });
    await expect(page.locator(":focus")).toHaveAttribute("id", /^h-review/);
    await page.reload();
    await page.getByLabel(/^Check against the scan/).check();
    await page.getByLabel("Show what is already done").check();
    await expect(self.locator(".review-state")).toContainText("Looks right · marked by editor@example.org");
    await page.goto("/admin/");
    await expect(page.locator("#approved")).toContainText("Looks right · marked by editor@example.org");
  });

  test("should ask why before skipping, and let the skip be taken back", async ({ page }) => {
    await page.goto("/admin/review/");
    const item = page.locator("#items article:visible").first();
    const target = (await item.getAttribute("data-review-target")) ?? "";
    await item.getByRole("button", { name: "Skip with a note…" }).click();
    await item.getByRole("button", { name: "Save the skip" }).click();
    await expect(page.locator("#status")).toHaveText("Say briefly why it is skipped, for the next editor.");
    await item.getByLabel("Why skip it? (for the next editor)").fill("The scan is too faint to tell");
    await item.getByRole("button", { name: "Save the skip" }).click();
    await page.reload();
    await page.getByLabel("Show what is already done").check();
    const again = page.locator(`#items article[data-review-target="${target}"]`);
    await expect(again.locator(".review-state")).toContainText("Skipped by editor@example.org: “The scan is too faint to tell”");
    await again.getByRole("button", { name: "Undo the skip" }).click();
    await expect(page.locator("#status")).toHaveText("Skip taken back.");
    await expect(again.locator("[data-act=looks-right]")).toBeVisible();
  });

  test("should mark a part to check as looking right", async ({ page }) => {
    await page.goto("/admin/review/?kind=part_to_check");
    const target = (await page.locator("#items article:visible").first().getAttribute("data-review-target")) ?? "";
    const part = page.locator(`#items article[data-review-target="${target}"]`);
    await part.getByRole("button", { name: "Starts here: right" }).click();
    await expect(part.locator(".review-state")).toContainText("Looks right · marked by you");
    await expect(part.locator("[data-act=looks-right]")).toBeHidden();
    // Undo, from the notice at the foot of the window: the item is back as it was.
    await page.locator("#admin-notice").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#status")).toContainText("undone");
    await expect(part.locator("[data-act=looks-right]")).toBeVisible();
  });

  test("should list what the site can't act on apart, folded, with nothing to press", async ({ page }) => {
    await page.goto("/admin/review/");
    const info = page.locator("section.info");
    await expect(info.locator("h2")).toHaveText(/^Things the site can't act on \(\d+\)$/);
    await expect(info.locator("details").first()).not.toHaveAttribute("open", "");
    await expect(info.locator("button")).toHaveCount(0);
    await expect(info.locator("img")).toHaveCount(0);
    await expect(page.getByLabel(/^For information/)).toHaveCount(0);
  });

  test("should open a correction from Review and come back to the next item", async ({ page }) => {
    await page.goto("/admin/review/?kind=part_to_check");
    const items = page.locator("#items article:visible");
    const first = (await items.first().getAttribute("data-review-target")) ?? "";
    const second = (await items.nth(1).getAttribute("data-review-target")) ?? "";
    await items.first().getByRole("link", { name: "Correct" }).click();
    await expect(page.getByRole("link", { name: "← Back to Review" })).toBeVisible();
    // Nothing changed yet: nothing to approve.
    await expect(page.getByRole("button", { name: "Approve this correction" })).toBeDisabled();
    await expect(page.locator("#save-hint")).toHaveText("Change the value above to approve it.");
    await expect(page).toHaveURL(new RegExp(`&item=${encodeURIComponent(first).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    // After approving, the status offers "Back to Review: the next item", which opens Review like this.
    await page.goto(`/admin/review/?after=${encodeURIComponent(first)}`);
    await expect(page.locator(":focus")).toHaveAttribute("id", `h-${second.replace(/[^a-z0-9]/gi, "-")}`);
  });
});

// The typeset drawings come from R2; a stand-in serves them here.
const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" width="539" height="120" viewBox="0 0 539 120">' +
  '<rect x="0" y="50" width="539" height="2"/></svg>';

/** The page has marked what editors have already done (its counts are final). */
async function ready(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("#filters[data-ready]")).toBeAttached();
}

test.describe.serial("Typeset music", () => {
  test.beforeEach(async ({ page }) => {
    // Only R2's typeset/<hash>/ files: not this page, /admin/typeset/.
    await page.route((url) => url.pathname.startsWith("/typeset/"), (route) =>
      route.fulfill({ status: 200, contentType: "image/svg+xml", body: DRAWING }));
  });

  test("should choose which part a file is, count it done, and keep it after a reload", async ({ page }) => {
    await page.goto("/admin/");
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Typeset music" }).click();
    await expect(page.locator("h1")).toHaveText("Typeset music");
    await ready(page);
    const before = Number((await page.locator("[data-count=matches]").textContent()) ?? "0");
    const item = page.locator("[data-queue-list=matches] article:visible").first();
    const target = (await item.getAttribute("data-review-target")) ?? "";
    await expect(item.locator(".drawing img")).toBeVisible();
    const first = item.locator(".candidates li").first();
    const label = (await first.locator("strong").textContent()) ?? "";
    await first.getByRole("button", { name: "This part" }).click();
    await expect(page.locator("#status")).toContainText(`: ${label}.`);
    await expect(page.locator("[data-count=matches]")).toHaveText(String(before - 1));
    await expect(page.locator(`article[data-review-target="${target}"]`)).toBeHidden({ timeout: 15_000 });
    await page.reload();
    await ready(page);
    await page.getByLabel("Show what is already done").check();
    await expect(page.locator(`article[data-review-target="${target}"] .review-state`))
      .toContainText(`Chosen: ${label} · by editor@example.org`);
    await page.goto("/admin/");
    await expect(page.locator("#approved")).toContainText(target.slice("typeset:".length));
  });

  test("should settle a file as not in the catalogue", async ({ page }) => {
    await page.goto("/admin/typeset/");
    await ready(page);
    const target = (await page.locator("[data-queue-list=matches] article:visible").first()
      .getAttribute("data-review-target")) ?? "";
    const item = page.locator(`article[data-review-target="${target}"]`);
    await item.getByRole("button", { name: "Not in the catalogue" }).click();
    await page.getByLabel("Show what is already done").check();
    await expect(item.locator(".review-state")).toContainText("Chosen: not in the catalogue · by you");
  });

  test("should find another part by its name, and open a tall drawing whole", async ({ page }) => {
    await page.goto("/admin/typeset/");
    await ready(page);
    const target = (await page.locator("[data-queue-list=matches] article:visible:not([data-done])").first()
      .getAttribute("data-review-target")) ?? "";
    const item = page.locator(`article[data-review-target="${target}"]`);
    const whole = item.getByRole("button", { name: "Show the whole drawing" });
    await whole.click();
    await expect(item.getByRole("button", { name: "Show only the first lines" })).toHaveAttribute("aria-expanded", "true");
    await item.getByText("Another part…").click();
    const search = item.locator("input[data-typed]");
    await search.fill("Dominica II Adv");
    await item.getByRole("button", { name: "Choose it" }).click();
    await expect(page.locator("#status")).toHaveText("Type part of the piece's name and choose one of the suggestions.");
    // Focusing the search loads the suggestions: every part, in words. (A part no other test chooses:
    // one already chosen for another file, and not yet published, is refused.)
    await expect(page.locator("#part-choices option").first()).toBeAttached();
    const suggestion = (await page.locator("#part-choices option", { hasText: "" })
      .evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).find((v) => v.startsWith("Dominica II Adventus (noh1) · Gradual")))) ?? "";
    expect(suggestion).not.toBe("");
    await search.fill(suggestion);
    await item.getByRole("button", { name: "Choose it" }).click();
    await expect(item.locator(".review-state")).toContainText(`Chosen: `);
    await page.locator("#admin-notice").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#status")).toContainText("choice undone");
  });

  test("should show a broken file's error with its line marked", async ({ page }) => {
    await page.goto("/admin/typeset/");
    await ready(page);
    await page.getByRole("radio", { name: /^Errors/ }).check();
    const item = page.locator("[data-queue-list=errors] article:visible").first();
    await expect(item.locator(".error")).toContainText(/Line \d+/);
    await expect(item.locator(".source .at")).toHaveCount(1);
    await expect(item.getByRole("button", { name: "This part" })).toHaveCount(0);
  });

  test("should proofread a part against its scan, and keep one with a problem listed", async ({ page }) => {
    await page.goto("/admin/typeset/");
    await ready(page);
    await page.getByRole("radio", { name: /^Proofreading/ }).check();
    const before = Number((await page.locator("[data-count=proofreading]").textContent()) ?? "0");
    const proofed = (await page.locator("[data-queue-list=proofreading] article:visible").first()
      .getAttribute("data-review-target")) ?? "";
    const item = page.locator(`article[data-review-target="${proofed}"]`);
    const heading = (await item.locator("h3").textContent()) ?? "";
    await expect(item.locator(".scan img").first()).toBeVisible();
    await item.getByRole("button", { name: "Proofread" }).click();
    await expect(page.locator("#status")).toHaveText(`${heading}: marked as proofread.`);
    await expect(page.locator("[data-count=proofreading]")).toHaveText(String(before - 1));
    // The part just proofread stays in view for a while: take the next one still to do.
    const target = (await page.locator("[data-queue-list=proofreading] article:visible:not([data-done])").first()
      .getAttribute("data-review-target")) ?? "";
    const next = page.locator(`article[data-review-target="${target}"]`);
    await next.getByRole("button", { name: "Problem…" }).click();
    await next.getByLabel("What is wrong? (it stays on this list, with your note)").fill("Bar 3: the alto is a step low");
    await next.getByRole("button", { name: "Save the problem note" }).click();
    await page.reload();
    await ready(page);
    await page.getByRole("radio", { name: /^Proofreading/ }).check();
    const again = page.locator(`article[data-review-target="${target}"]`);
    await expect(again).toBeVisible();
    await expect(again.locator(".review-state")).toContainText("Problem by editor@example.org: “Bar 3: the alto is a step low”");
  });
});
