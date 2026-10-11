// C2c: the in-browser timing page runs the whole measurement (one run per condition) and reports it.
//   pnpm build:e2e && E2E_DIST=dist-e2e pnpm exec playwright test e2e/export-timing.e2e.ts
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MEI = readFileSync("src/lib/export-layout/__fixtures__/kyrie-ix.mei", "utf8");
const OUT = resolve(process.cwd(), "..", "build", "c2c");
const IDS = ["letter-p-orig", "ipad11-p-auto", "letter-p-large-auto", "multi-3x", "multi-6x"];

test("the timing page fills the table for all five conditions with ?runs=1, and offers the text by hand", async ({ page }) => {
  test.setTimeout(300_000);
  const probe = await page.request.get("/e2e/export-timing/");
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1 (use pnpm build:e2e)");
  await page.route("**/__fixtures__/kyrie-ix.mei", (route) => route.fulfill({ contentType: "application/xml", body: MEI }));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/e2e/export-timing/?runs=1");
  await expect(page.locator("#runs-note")).toContainText("1 run per condition");
  await expect(page.locator("#share")).toBeHidden();
  await page.getByRole("button", { name: "Run timings" }).click();
  await expect(page.locator("#progress")).toContainText("Running", { timeout: 20_000 });
  await expect(page.locator("#progress")).toContainText("Done.", { timeout: 280_000 });

  const sections = page.locator("section[data-condition]");
  await expect(sections).toHaveCount(5);
  expect(await sections.evaluateAll((els) => els.map((e) => e.getAttribute("data-condition")))).toEqual(IDS);
  expect(await sections.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))).toEqual(IDS.map(() => "ok"));
  await expect(page.locator("#results .bad")).toHaveCount(0);
  for (const id of IDS) {
    const rows = page.locator(`section[data-condition="${id}"] tr[data-metric]`);
    await expect(rows).toHaveCount(7);
    // p50 of the cold layout is a number, with the desktop p50 beside it.
    const cold = rows.filter({ has: page.locator("td", { hasText: "Cold" }) }).first().locator("td");
    expect(Number((await cold.nth(1).textContent())!.trim())).toBeGreaterThan(0);
    expect(Number((await cold.nth(4).textContent())!.trim())).toBeGreaterThan(0);
    expect(Number((await cold.nth(5).textContent())!.trim())).toBeGreaterThan(0);
  }
  // Memory is "not available" where the browser has no API (never estimated); desktop shows its own figure.
  await expect(page.locator('tr[data-metric="memoryUserAgentSpecificBytes"]').first()).toBeVisible();
  await expect(page.locator("#device")).toContainText("User agent:");
  await expect(page.locator("#device")).toContainText("Cores:");
  await expect(page.locator("#device")).toContainText("Screen:");
  await expect(page.locator("#device")).toContainText("warm-cache cold");
  await expect(page.locator("#device")).toContainText("commit ee567a3");

  // Copy: the clipboard is unavailable here (no permission), so the by-hand text opens, holding valid JSON.
  await expect(page.locator("#share")).toBeVisible();
  await page.getByRole("button", { name: "Copy results" }).click();
  await expect(page.locator("#manual")).toHaveAttribute("open", "");
  await expect(page.locator("#copy-status")).toContainText("clipboard is not available");
  const report = JSON.parse(await page.locator("#json").inputValue()) as { runsPerCondition: number; device: { userAgent: string }; conditions: { id: string; succeeded: number; failed: number; stats: { coldMs: { p50: number } } }[]; desktopBaseline: { commit: string } };
  expect(report.runsPerCondition).toBe(1);
  expect(report.conditions.map((c) => [c.id, c.succeeded, c.failed])).toEqual(IDS.map((id) => [id, 1, 0]));
  expect(report.conditions.every((c) => c.stats.coldMs.p50 > 0)).toBe(true);
  expect(report.desktopBaseline.commit).toBe("ee567a3");
  expect(await page.locator("#markdown").inputValue()).toContain("### multi-6x:");
  expect(errors).toEqual([]);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/timing-runs1.png`, fullPage: true });
});
