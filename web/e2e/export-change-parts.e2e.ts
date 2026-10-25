// PR 10: Change parts suspends and resumes the real editor on the service rail and phone/tablet sheet.
//   pnpm build:e2e && E2E_DIST=dist-e2e pnpm exec playwright test e2e/export-change-parts.e2e.ts
// Local scan/PDF stand-ins and the fixture Kyrie IX MEI; layout and PDF workers remain real.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function scanPng(): Buffer {
  const width = 1700, height = 420;
  const rows = Array.from({ length: height }, () => { const row = Buffer.alloc(width + 1, 255); row[0] = 0; return row; });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
async function serveAssets(page: Page, baseURL: string): Promise<void> {
  const png = scanPng();
  const headers = { "access-control-allow-origin": "*" };
  const pdfs = new Map<string, Buffer>();
  const mei = readFileSync("src/lib/export-layout/__fixtures__/kyrie-ix.mei");
  // Context routes also cover requests from the PDF/layout workers.
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/__fixtures__/kyrie-ix.mei")
      return route.fulfill({ contentType: "application/xml", body: mei });
    if (url.pathname.includes("/typeset/") && url.pathname.endsWith(".pdf")) {
      let body = pdfs.get(url.pathname);
      if (!body) {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        pdf.addPage([612, 792]).drawText(`TYPESET ${url.pathname}`, { x: 36, y: 700, size: 8, font });
        body = Buffer.from(await pdf.save());
        pdfs.set(url.pathname, body);
      }
      return route.fulfill({ contentType: "application/pdf", headers, body });
    }
    if (url.pathname.endsWith("@2x.png") || (url.pathname.includes("/systems/") && url.pathname.endsWith(".webp")))
      return route.fulfill({ contentType: "image/png", headers, body: png });
    if (url.pathname.includes("/typeset/") && url.pathname.endsWith(".svg"))
      return route.fulfill({ contentType: "image/svg+xml", headers, body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    return route.continue();
  });
}

const PAGES = ["/kyriale/ix/", "/piece/dominica-i-adventus/"] as const;
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 800 }];
const editor = (page: Page) => page.locator("dialog.cx");
const control = (page: Page, name: string) => editor(page).locator(`[data-cx="${name}"]`);
const boxes = (page: Page) => page.locator('input[name="export-part"]');
const sheet = (page: Page) => page.locator("#choose-parts-sheet");
const names = (page: Page) => control(page, "partlist").locator(".cx-pn");

async function ready(page: Page): Promise<void> {
  await expect(control(page, "download")).toBeEnabled({ timeout: 120_000 });
  await expect(editor(page).locator(".cx-page").first()).toBeVisible();
  await expect(editor(page).locator("[data-cx-updating]")).toBeHidden();
}
async function settings(page: Page): Promise<void> {
  const button = control(page, "settings-btn");
  if (await button.isVisible() && await button.getAttribute("aria-expanded") !== "true") await button.click();
}
async function openEditor(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("#export-customize").click();
  await expect(editor(page)).toHaveAttribute("open", "");
  await expect(page.locator("#cx-title")).toBeFocused();
  await ready(page);
}
async function changeParts(page: Page, narrow: boolean): Promise<void> {
  // Change parts moved above the preview, outside the settings sheet.
  const done = control(page, "panel-done");
  if (await done.isVisible()) await done.click();
  await control(page, "change-parts").click();
  await expect(editor(page)).not.toHaveAttribute("open", "");
  await expect(page.locator("[data-return-customize]")).toBeVisible();
  if (narrow) {
    await expect(sheet(page)).toBeVisible();
    expect(await sheet(page).evaluate(el => el.matches(":modal"))).toBe(true);
    expect(await sheet(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(sheet(page).locator('input[name="export-part"]').first()).toBeFocused();
  } else {
    await expect(page.locator('[data-part-list] input[name="export-part"]').first()).toBeFocused();
  }
}
async function returnToEditor(page: Page, narrow: boolean, valid = true): Promise<void> {
  // The modal sheet's Done is the narrow-screen Return to Customize action.
  if (narrow) await sheet(page).getByRole("button", { name: "Done", exact: true }).click();
  else await page.getByRole("button", { name: "Return to Customize", exact: true }).click();
  await expect(editor(page)).toHaveAttribute("open", "");
  await expect(page.locator("#cx-title")).toBeFocused();
  if (narrow) await expect(sheet(page)).not.toBeVisible();
  await expect(editor(page)).not.toHaveAttribute("data-panel", "open");
  if (valid) await ready(page);
}
const pageErrors = new WeakMap<Page, string[]>();

const historyLength = (page: Page) => page.evaluate(() => history.length);

for (const viewport of VIEWPORTS) test.describe(`Change parts at ${viewport.width}×${viewport.height}`, () => {
  test.use({ viewport });
  test.setTimeout(300_000);
  const narrow = viewport.width < 992;
  async function finishBreaks(page: Page): Promise<void> {
    if (viewport.width < 640) await control(page, "break-done").click();
    else {
      await settings(page);
      await control(page, "break-mode").click();
    }
  }
  test.beforeEach(async ({ page, baseURL }) => {
    const probe = await page.request.get("/e2e/export-layout-worker/");
    test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1 (use pnpm build:e2e)");
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on("pageerror", e => { errors.push(e.message); });
    await page.addInitScript(() => { localStorage.clear(); });
    await serveAssets(page, baseURL!);
  });

  test.afterEach(async ({ page }) => {
    expect(pageErrors.get(page) ?? [], "uncaught page errors").toEqual([]);
  });

  for (const url of PAGES) {
    test(`${url} unchanged selection keeps settings, Undo, focus, both scroll positions and history`, async ({ page }) => {
      await openEditor(page, url);
      // Margins apply to both fixed Advent pages and the reflowing Kyrie.
      await settings(page);
      const margin = control(page, "margin");
      const initial = await margin.inputValue();
      // Settings changes are not undoable on their own; Reset layout is. So: +1, Reset (undo holds +1), then +2.
      await control(page, "margin-plus").click();
      await expect(margin).toHaveValue(String(Number(initial) + 1));
      // On a phone the settings sheet covers Reset layout: close it first, as a reader would.
      const done = control(page, "panel-done");
      if (await done.isVisible()) await done.click();
      await editor(page).getByRole("button", { name: "Reset layout" }).click();
      await expect(margin).toHaveValue(initial);
      await settings(page);
      await control(page, "margin-plus").click();
      await control(page, "margin-plus").click();
      await expect(margin).toHaveValue(String(Number(initial) + 2));
      await ready(page);
      const beforeParts = await names(page).allTextContents();
      // Give both scroll checks a non-zero position, then record the actual clamped values.
      await page.evaluate(() => window.scrollTo(0, 400));
      const preview = editor(page).locator(".cx-preview");
      await preview.evaluate(el => { el.scrollTop = 180; });
      const previewY = await preview.evaluate(el => el.scrollTop);
      expect(previewY).toBeGreaterThan(0);
      const readingY = await page.evaluate(() => scrollY);
      expect(readingY).toBeGreaterThan(0);
      // Opening Customize owns one history entry; Change parts must reuse it throughout.
      const length = await historyLength(page);
      await changeParts(page, narrow);
      expect(await historyLength(page)).toBe(length);
      expect(await page.evaluate(() => scrollY)).toBe(readingY);
      await returnToEditor(page, narrow);
      expect(await historyLength(page)).toBe(length);
      expect(await page.evaluate(() => scrollY)).toBe(readingY);
      await expect.poll(() => preview.evaluate(el => el.scrollTop)).toBe(previewY);
      await expect(margin).toHaveValue(String(Number(initial) + 2));
      await expect(names(page)).toHaveText(beforeParts);
      // The undo stack survived the round trip: Ctrl/Cmd+Z (focus outside a text field) undoes the Reset.
      await page.locator("#cx-title").focus();
      await page.keyboard.press("ControlOrMeta+z");
      await expect(margin).toHaveValue(String(Number(initial) + 1));
      await ready(page);
    });

    test(`${url} changed selection refreshes In this PDF; empty return disables Download with its reason`, async ({ page }) => {
      await openEditor(page, url);
      const labels = await boxes(page).evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).dataset["label"]!));
      const length = await historyLength(page);
      await changeParts(page, narrow);
      await boxes(page).nth(1).uncheck();
      await expect(page.locator("#selection-status")).toContainText(`${labels.length - 1} of ${labels.length} parts`);
      await returnToEditor(page, narrow);
      await expect(names(page)).toHaveText(labels.filter((_, i) => i !== 1));
      await expect(page.locator("#selection-status")).toContainText(`${labels.length - 1} of ${labels.length} parts`);
      await expect(page.locator("#export-status")).toHaveText("");
      expect(await historyLength(page)).toBe(length);
      await changeParts(page, narrow);
      for (const box of await boxes(page).all()) await box.uncheck();
      await returnToEditor(page, narrow, false);
      await expect(control(page, "download")).toBeDisabled();
      await expect(control(page, "download")).toHaveAttribute("title", "Tick at least one part to export.");
      await expect(editor(page).locator(".cx-notices .notice")).toHaveText("Tick at least one part to export.");
      await expect(names(page)).toHaveCount(0);
      expect(await historyLength(page)).toBe(length);
      // Catalogue inventory: no piece/Kyriale selection reaches the 300-system limit
      // (the largest piece has 154 systems). Cover the real empty refusal without inventing page data.
    });

    test(`${url} Back closes the selector without navigating; Return reuses the forward entry`, async ({ page }) => {
      await openEditor(page, url);
      const length = await historyLength(page);
      await changeParts(page, narrow);
      const choosingURL = page.url();
      await page.goBack();
      if (narrow) await expect(sheet(page)).not.toBeVisible();
      await expect(editor(page)).not.toHaveAttribute("open", "");
      await expect(page.locator("[data-return-customize]")).toBeFocused();
      expect(page.url()).toBe(choosingURL);
      expect(await historyLength(page)).toBe(length);
      // Back has closed the sheet, so the rail/bar's Return button is now reachable at every width.
      await page.getByRole("button", { name: "Return to Customize", exact: true }).click();
      await expect(editor(page)).toHaveAttribute("open", "");
      await expect(page.locator("#cx-title")).toBeFocused();
      await ready(page);
      expect(await historyLength(page)).toBe(length);
      expect(new URL(page.url()).pathname).toBe(url);
    });
  }

  test("Customize export resumes the suspended editor after leaving the selector", async ({ page }) => {
    await openEditor(page, PAGES[0]);
    await changeParts(page, narrow);
    await page.goBack();
    await expect(page.locator("[data-return-customize]")).toBeFocused();
    await page.locator("#export-customize").click();
    await expect(editor(page)).toHaveAttribute("open", "");
    await ready(page);
  });

  test("Kyrie page break survives removing another part, then is dropped with a stale-break notice when Kyrie is removed", async ({ page }) => {
    await openEditor(page, PAGES[0]);
    const labels = await boxes(page).evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).dataset["label"]!));
    const kyrieIndex = labels.findIndex(label => /^Kyrie/.test(label));
    expect(kyrieIndex).toBeGreaterThanOrEqual(0);
    const kyrieLabel = labels[kyrieIndex]!;
    await settings(page);
    await control(page, "break-mode").click();
    const handles = editor(page).locator('.cx-bp:not([hidden])[data-kind="none"]');
    await expect.poll(() => handles.count()).toBeGreaterThan(3);
    const boundary = (await handles.nth(3).getAttribute("data-boundary"))!;
    await handles.nth(3).focus();
    await page.keyboard.press("Enter");
    await editor(page).getByRole("button", { name: "Start new page here", exact: true }).focus();
    await page.keyboard.press("Enter");
    const handle = editor(page).locator(`.cx-bp[data-boundary="${boundary}"]`);
    await expect(handle).toHaveAttribute("data-kind", "page", { timeout: 120_000 });
    await expect(handle).toHaveAttribute("aria-label", /Now: your new page\.$/);
    await ready(page);
    await finishBreaks(page);
    await changeParts(page, narrow);
    const otherIndex = labels.findIndex((_, i) => i !== kyrieIndex);
    await boxes(page).nth(otherIndex).uncheck();
    await returnToEditor(page, narrow);
    await expect(control(page, "break-count")).toHaveText("1 of your breaks");
    await settings(page);
    await control(page, "break-mode").click();
    await expect(handle).toHaveAttribute("data-kind", "page");
    await expect(handle).toHaveAttribute("aria-label", /Now: your new page\.$/);
    await finishBreaks(page);
    await changeParts(page, narrow);
    await boxes(page).nth(kyrieIndex).uncheck();
    await returnToEditor(page, narrow);
    await settings(page);
    await expect(control(page, "break-count")).toBeHidden();
    await expect(handle).toHaveCount(0);
    await expect(names(page)).not.toContainText([kyrieLabel]);
    await expect(control(page, "stale")).toBeVisible();
    await expect(control(page, "stale").locator("p")).toHaveText(`Breaks for ${kyrieLabel} are not in this PDF. Tick a part again to get them back.`);
  });
});
