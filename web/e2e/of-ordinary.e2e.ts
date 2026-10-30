import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { pageTexts } from "../scripts/verify-export-pdf";

for (const [key, suggestion] of [["easter", "I"], ["ot-8", "XI"]] as const) {
  test(`${key} suggests Missa ${suggestion}`, async ({ page }) => {
    await page.goto(`/ordinary-form/${key}/`);
    await expect(page.getByLabel("Mass setting", { exact: true })).toHaveValue(suggestion);
    await expect(page.locator("section.ordinary:not([hidden])")).toHaveAttribute("data-ordinary-option", suggestion);
  });
}

test("the chosen Mass replaces the suggestion and survives a reload", async ({ page }) => {
  await page.goto("/ordinary-form/easter/?cycle=A&date=2026-04-05");
  await page.getByLabel("Mass setting", { exact: true }).selectOption("XVII");
  await expect(page).toHaveURL(/mass=XVII/);
  await expect(page.locator("section.ordinary:not([hidden])")).toHaveCount(1);
  await expect(page.locator('section.ordinary[data-ordinary-option="XVII"]')).toBeVisible();
  await expect(page.locator('input[name="export-part"][data-ordinary-option="XVII"]:checked:not(:disabled)')).not.toHaveCount(0);
  await expect(page.locator('input[name="export-part"][data-ordinary-option]:not([data-ordinary-option="XVII"]):not(:disabled)')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Mass setting", { exact: true })).toHaveValue("XVII");
});

test("calendar buttons lead to the occasion and to repeated Sunday music", async ({ page }) => {
  for (const [date, key] of [["2026-04-05", "easter"], ["2026-06-08", "ot-10"]] as const) {
    await page.goto(`/calendar/ordinary-form/?date=${date}`);
    const button = page.getByRole("link", { name: "Read and choose this day's music", exact: true });
    await expect(button).toHaveAttribute("href", new RegExp(`/ordinary-form/${key}/\\?.*date=${date}`));
    await expect(button).toHaveClass("accompaniments");
  }
});

test("without JavaScript the suggested Mass is visible", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/ordinary-form/easter/");
  await expect(page.locator("section.ordinary:not([hidden])")).toHaveAttribute("data-ordinary-option", "I");
  await context.close();
});

test("hidden Mass candidates do not request music", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", request => requested.push(request.url()));
  await page.goto("/ordinary-form/easter/", { waitUntil: "networkidle" });
  expect(await page.locator('img[loading="eager"]').count()).toBeLessThanOrEqual(3);
  const hidden = await page.locator("section.ordinary[hidden]").evaluateAll(sections => {
    const urls = [];
    for (const section of sections) {
      for (const node of section.querySelectorAll("[src], [srcset]")) {
        const src = node.getAttribute("src");
        if (src) urls.push(new URL(src, location.href).href);
        for (const candidate of (node.getAttribute("srcset") ?? "").split(",")) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url) urls.push(new URL(url, location.href).href);
        }
      }
    }
    return urls;
  });
  expect(requested.filter(url => hidden.includes(url))).toEqual([]);
});

// Scans are tiny local stand-ins; the real worker still assembles the PDF.
test("Quick export contains the selected Mass after the Proper", async ({ page }) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=", "base64");
  await page.context().route(/\.(png|webp)(\?.*)?$/, route => route.fulfill({
    contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: png,
  }));
  await page.context().route(/\/typeset\/.*\.pdf(\?.*)?$/, route => route.abort());
  await page.goto("/ordinary-form/easter/?cycle=A&season=easter");
  await page.getByLabel("Mass setting", { exact: true }).selectOption("XVII");
  const scans = page.getByRole("button", { name: "Show the scans", exact: true });
  if (await scans.count()) await scans.click();
  const expected = await page.locator('input[name="export-part"]:checked:not(:disabled)').evaluateAll(boxes =>
    boxes.map(box => box.getAttribute("data-label") ?? ""));
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-btn").click()]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("PDF download has no stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toContain("Missa XVII");
  const text = (await pageTexts(bytes)).flat().join(" ").replace(/\s+/g, " ");
  let offset = 0;
  for (const label of expected) {
    const index = text.indexOf(label, offset);
    expect(index, label).toBeGreaterThanOrEqual(offset);
    offset = index + label.length;
  }
});
