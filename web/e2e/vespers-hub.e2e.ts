import { expect, test } from "@playwright/test";
import { hubHref, lineupHref, occasions, sungOn } from "../src/lib/vespers";

test.describe("Recurring Vespers without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const group of occasions()) {
    test(`${group.office}: all evenings remain ordered and resolve`, async ({ page, request }) => {
      expect((await page.goto(hubHref(group.office)))?.status()).toBe(200);
      await page.getByText(`Every date (${group.days.length})`, { exact: true }).click();
      const dates = page.locator("details li[data-date]");
      expect(await dates.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-date"))))
        .toEqual(group.days.map(sungOn));
      expect(await dates.locator("a").evaluateAll(nodes => nodes.map(node => node.getAttribute("href"))))
        .toEqual(group.days.map(lineupHref));
      await expect(dates.first()).toBeVisible();
      await expect(page.locator("[data-next-evening]")).toBeHidden();
      await expect(page.locator(".service-rail, .lineup")).toHaveCount(0);
      for (const day of group.days) {
        const dated = await request.get(lineupHref(day));
        expect(dated.status(), lineupHref(day)).toBe(200);
        expect(await dated.text()).toContain(`rel="canonical" href="https://cantusorgani.org${lineupHref(day)}"`);
      }
    });
  }
});

test("chooses the next evening by local sung date, including I Vespers", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-12-24T12:00:00") });
  await page.goto("/vespers/sancti/12-25/");
  await expect(page.locator("[data-next-link] a")).toHaveAttribute("href", "/vespers/2026-12-25/i/");
  await expect(page.locator("[data-console-label]")).toHaveText("I Vespers · 2026-12-24");
  await expect(page.locator("[data-coming] li").first()).toHaveAttribute("data-date", "2026-12-24");
});

test("keeps the archive after the published window ends", async ({ page }) => {
  await page.clock.install({ time: new Date("2032-01-01T12:00:00") });
  await page.goto("/vespers/tempora/Epi5-0/");
  await expect(page.locator("[data-next-evening]")).toBeHidden();
  await expect(page.locator("[data-coming]")).toBeHidden();
  await page.getByText(/^Every date/).click();
  await expect(page.locator("details li[data-date]").first()).toBeVisible();
});

test("the hub is linked from the day, dated service and Vesperale", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-29T12:00:00") });
  for (const path of ["/day/sancti/12-25m3/", "/vespers/2026-12-25/i/", "/vespers/"]) {
    await page.goto(path);
    await expect(page.locator('a[href="/vespers/sancti/12-25/"]').first()).toBeVisible();
  }
  await page.goto("/vespers/2026-12-25/i/");
  await expect(page.getByText(/^Every date/)).toBeVisible();
  await expect(page.locator("[data-coming] li").first()).toBeVisible();
});
