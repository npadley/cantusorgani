import { expect, test } from "@playwright/test";

test("EF leads with dated music and keeps the day canonical free of queries", async ({ page }) => {
  await page.goto("/calendar/?date=2026-11-29");
  const first = page.locator("#result .observance").first();
  const music = first.getByRole("link", { name: "Read and choose this day's music", exact: true });
  await expect(music).toHaveAttribute("href", /\/\?date=2026-11-29$/);
  await expect(first.locator("a").first()).toHaveText("Read and choose this day's music");
  await music.click();
  await expect(page).toHaveURL(/\/day\/.*\/\?date=2026-11-29/);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBeTruthy();
  expect(new URL(canonical!).search).toBe("");
});

for (const path of ["/calendar/", "/calendar/ordinary-form/"]) {
  test(`${path} announces one sentence once per step`, async ({ page }) => {
    await page.goto(`${path}?date=2026-11-29`);
    const widget = page.locator("[data-calendar-root]");
    await expect(widget.locator("#result .date-heading")).toContainText("29 November 2026");
    const status = widget.getByRole("status");
    await expect(status).toBeEmpty();
    await expect(widget.locator('[role="status"], [aria-live]')).toHaveCount(1);
    await expect(widget.locator("#result")).not.toHaveAttribute("aria-live");
    const messages: string[] = [];
    await page.exposeFunction("recordCalendarStatus", (text: string) => { messages.push(text); });
    await status.evaluate(node => {
      const observer = new MutationObserver(() => {
        const record = Reflect.get(window, "recordCalendarStatus") as (text: string) => Promise<void>;
        void record(node.textContent ?? "");
      });
      observer.observe(node, { childList: true, characterData: true, subtree: true });
    });
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(status).toHaveText(/^Monday, 30 November 2026: .+\.$/);
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain("30 November 2026");
    // Let a second render, if one was scheduled, finish before asserting the total.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(messages).toHaveLength(1);
  });

  test(`${path} retains its noscript message`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${path}?date=2026-11-29`);
    await expect(page.getByText("The calendar needs JavaScript to look up a date.", { exact: true })).toBeVisible();
    await context.close();
  });
}

test("OF accompaniment links keep the date and effective transfers", async ({ page }) => {
  await page.goto("/calendar/ordinary-form/?date=2026-04-05&epiphany=jan6&ascension=sunday&corpusChristi=thursday");
  await expect(page.getByRole("link", { name: "View accompaniments for this occasion", exact: true }))
    .toHaveAttribute("href", "/ordinary-form/easter/?cycle=A&season=easter&date=2026-04-05&epiphany=jan6&ascension=sunday&corpusChristi=thursday");
});
