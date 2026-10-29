import { expect, test } from "@playwright/test";

test.describe("Recurring Vespers without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("sample hubs keep all evenings ordered and resolving", async ({ page, request }) => {
    test.setTimeout(60_000);
    expect((await page.goto("/vespers/"))?.status()).toBe(200);
    const hubs = await page.locator('a[href^="/vespers/"]').evaluateAll(nodes =>
      [...new Set(nodes.map(node => node.getAttribute("href") ?? ""))]
        .filter(href => /^\/vespers\/[a-z]+\/[A-Za-z0-9-]+\/$/.test(href)));
    expect(hubs.length).toBeGreaterThan(0);
    const sample = new Set([hubs[0]!, hubs[hubs.length - 1]!,
      "/vespers/sancti/12-25/", "/vespers/sancti/08-15/", "/vespers/tempora/Epi5-0/"]);
    for (const hub of sample) {
      expect(hubs).toContain(hub);
      expect((await page.goto(hub))?.status()).toBe(200);
      const dates = page.locator("details li[data-date]");
      const evenings = await dates.evaluateAll(nodes => nodes.map(node => ({
        date: node.getAttribute("data-date") ?? "",
        href: node.querySelector("a")?.getAttribute("href") ?? "",
      })));
      expect(evenings.length).toBeGreaterThan(0);
      for (const evening of evenings) {
        expect(evening.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(evening.href).toMatch(/^\/vespers\/\d{4}-\d{2}-\d{2}\/(?:i\/)?$/);
      }
      const sungDates = evenings.map(evening => evening.date);
      expect(sungDates).toEqual([...sungDates].sort());
      await page.getByText(`Every date (${evenings.length})`, { exact: true }).click();
      await expect(dates.first()).toBeVisible();
      await expect(page.locator("[data-next-evening]")).toBeHidden();
      await expect(page.locator(".service-rail, .lineup")).toHaveCount(0);
      await expect(page.locator("[data-console]")).not.toHaveAttribute("lang", "la");
      await expect(page.getByRole("region", { name: "The Magnificat", exact: true })).not.toContainText("Transfiguration");
      for (const { href } of evenings) {
        const dated = await request.get(href);
        expect(dated.status(), href).toBe(200);
        expect(await dated.text()).toContain(`rel="canonical" href="https://cantusorgani.org${href}"`);
      }
    }
  });
});

test("chooses the next evening by local sung date, including I Vespers", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-12-24T12:00:00") });
  await page.goto("/vespers/sancti/12-25/");
  await expect(page.locator("[data-next-link] a")).toHaveAttribute("href", "/vespers/2026-12-24/");
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
  for (const path of ["/day/sancti/12-25m3/", "/vespers/2026-12-24/"]) {
    await page.goto(path);
    await expect(page.locator('a[href="/vespers/sancti/12-25/"]').first()).toBeVisible();
  }
  await page.goto("/vespers/");
  await expect(page.locator('a[href^="/vespers/sancti/"], a[href^="/vespers/tempora/"]').first()).toBeVisible();
  await page.goto("/vespers/2026-12-24/");
  await expect(page.getByText(/^Every date/)).toBeVisible();
  await expect(page.locator("[data-coming] li").first()).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".vespers-dates")).toBeHidden();
});


test("Advent and green-Sunday hubs explain their Magnificat accompaniment", async ({ page }) => {
  await page.goto("/vespers/tempora/Adv1-0/");
  const note = page.getByRole("region", { name: "The Magnificat", exact: true });
  await expect(note).toContainText("The Magnificat in VIII G is printed in NOH VIII (Advent I, p. 53); each dated page includes it.");
  await expect(note).not.toHaveAttribute("lang", "la");
  await expect(note.locator("[lang=la], img, svg, audio")).toHaveCount(0);
  await expect(note.getByRole("link")).toHaveCount(1);
  await expect(note.getByRole("link", { name: "Browse the Vesperale in printed order" })).toHaveAttribute("href", "/vespers/");

  await page.goto("/vespers/tempora/Epi5-0/");
  await expect(note).toContainText("NOH VIII prints no Magnificat in I g, only the antiphon. Each dated page sets it to Psalm 109 in I g (Advent II, p. 54), the formula in the same tone.");
  await expect(page.locator(".service-rail, .lineup")).toHaveCount(0);
});
