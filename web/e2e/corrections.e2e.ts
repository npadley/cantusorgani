import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const ENDPOINT = /^https:\/\/api\.cantusorgani\.org\/?$/;
const reports = [
  { id: 1, pieceId: "dominica-i-adventus", target: "part:dominica-i-adventus/introit", field: "gregobaseId", proposedValue: "none", status: "pending", createdAt: "2026-10-02", note: "private source" },
  { id: 2, pieceId: "dominica-i-adventus", target: "part:dominica-i-adventus/gradual", field: "gregobaseId", proposedValue: "none", status: "pending", createdAt: "2026-10-02", note: "private source" },
];

async function queue(page: Page, rows: unknown[]) {
  // Only external intake is stubbed. The built form, catalogue labels and
  // browser rendering run unchanged; no live report is sent.
  await page.route(ENDPOINT, (route) => route.fulfill({ json: { corrections: rows } }));
  await page.route("**/turnstile/**", (route) => route.fulfill({ body: "", contentType: "application/javascript" }));
}

test.describe("Corrections compatibility", () => {
  test("a Kyriale Mass can report a missing section", async ({ page }) => {
    await queue(page, []);
    await page.goto("/corrections/");
    await page.locator("#pieceId").selectOption("ordinarium-missae-i");
    await expect(page.locator('#field option[value="sections"]')).toBeEnabled();
    await page.locator("#field").selectOption("sections");
    await page.locator("#proposedValue").fill("system 12: the Ite is missing");
    await page.locator("#note").fill("Checked in the printed Mass");
    // A deterministic widget token for the intercepted request.
    await page.locator("#correction-form").evaluate((form) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "cf-turnstile-response";
      input.value = "test-token";
      form.append(input);
    });
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 201, json: { ok: true } }));
    const request = page.waitForRequest((r) => ENDPOINT.test(r.url()) && r.method() === "POST");
    await page.locator("#submit").click();
    expect((await request).postDataJSON()).toMatchObject({ pieceId: "ordinarium-missae-i", field: "sections",
      proposedValue: "system 12: the Ite is missing", note: "Checked in the printed Mass" });
    await expect(page.locator("#form-status")).toContainText("in the queue for review");
  });

  test("distinguishes resolved reports and duplicates, with safe publication links", async ({ page }) => {
    const sha = "a".repeat(40);
    await queue(page, [{ ...reports[0], status: "resolved", resolvedBy: 9, commitSha: sha },
      { ...reports[1], status: "duplicate", duplicateOf: 1, commitSha: "javascript:alert(1)" }]);
    await page.goto("/corrections/");
    await expect(page.locator("#queue-list")).toContainText("resolved · fix #9");
    await expect(page.locator("#queue-list")).toContainText("duplicate · report #1");
    await expect(page.getByRole("link", { name: "Published change" })).toHaveAttribute("href", `https://github.com/npadley/cantusorgani/commit/${sha}`);
    await expect(page.locator("#queue-list a")).toHaveCount(1);
    await expect(page.locator("#queue-list")).not.toContainText("private source");
  });

  test("equal-valued reports identify their different sections", async ({ page }) => {
    await queue(page, reports);
    await page.goto("/corrections/");
    const rows = page.locator("#queue-list tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("Dominica I Adventus (noh1) · Introit");
    await expect(rows.nth(2)).toContainText("Dominica I Adventus (noh1) · Gradual");
    await expect(page.locator("#queue-list")).not.toContainText("private source");
  });

  test("shows retired targets as text and never renders submitted markup or notes", async ({ page }) => {
    const target = 'part:retired/other:<img src=x onerror="window.queueXss=true">';
    await queue(page, [{ ...reports[0], target, proposedValue: "<svg onload=alert(1)>" }]);
    await page.goto("/corrections/");
    await expect(page.locator("#queue-list")).toContainText(target);
    await expect(page.locator("#queue-list")).toContainText("<svg onload=alert(1)>");
    await expect(page.locator("#queue-list img, #queue-list svg")).toHaveCount(0);
    await expect(page.locator("#queue-list")).not.toContainText("private source");
  });

  test("keeps the queue available when catalogue label lookup fails", async ({ page }) => {
    await queue(page, reports);
    await page.route("**/corrections/targets.json", (route) => route.fulfill({ status: 503, body: "unavailable" }));
    await page.goto("/corrections/");
    await expect(page.locator("#queue-list tr")).toHaveCount(3);
    await expect(page.locator("#queue-list")).toContainText("part:dominica-i-adventus/introit");
  });

  test("shows reports while catalogue labels are still loading", async ({ page }) => {
    await queue(page, reports);
    // Leave this request unresolved to prove label loading cannot hold up
    // the report table. Browser teardown cancels the intercepted request.
    await page.route("**/corrections/targets.json", () => {});
    await page.goto("/corrections/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#queue-list tr")).toHaveCount(3);
    await expect(page.locator("#queue-list")).toContainText("part:dominica-i-adventus/introit");
  });
});
