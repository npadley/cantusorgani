// D23: Customize export on pages with nothing (or little) that reflows. The editor places fixed typeset pages and scan
// systems as they are, onto the chosen page, and Verovio is never fetched when nothing in the selection reflows.
//
//   pnpm build:e2e && E2E_DIST=dist-e2e pnpm exec playwright test e2e/export-nonreflow.e2e.ts
//
// The image and PDF assets the real pages fetch (system scans, typeset pictures, typeset PDFs) are served by stand-ins
// built here, so no network is needed: a scan is a synthetic PNG, a typeset PDF a one-page letter PDF.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { imageBoxes } from "../scripts/verify-export-pdf";

const OUT = resolve(process.cwd(), "..", "build", "b11");
const MEI = readFileSync("src/lib/export-layout/__fixtures__/kyrie-ix.mei", "utf8");
const MEI_URL = "/__fixtures__/kyrie-ix.mei";
const PAGES = { scan: "/piece/cantus-ad-libitum-kyrie-iii/", fixed: "/kyriale/i/", mixed: "/kyriale/ix/" } as const;
const SIZES = {
  "ipad-11": { label: "11-inch iPad", width: 157.8, height: 227.1, margin: 4 },
  "ipad-mini": { label: "iPad mini", width: 115.9, height: 176.6, margin: 4 },
} as const;
const IPAD11 = SIZES["ipad-11"];
/** What a request for the engraver looks like: its chunk, or any WebAssembly. */
const VEROVIO = /verovioToolkit|\.wasm/i;

// ---- stand-in assets ----
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
/** A greyscale PNG, white with a black frame: stands in for a scanned system. */
function png(width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width + 1, 255);
    row[0] = 0;
    if (y < 3 || y >= height - 3) row.fill(0, 1);
    else { row[1] = 0; row[width] = 0; }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
async function typesetPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 72, y: 600, width: 468, height: 100, borderWidth: 2 });
  return Buffer.from(await pdf.save());
}

async function serveAssets(page: Page): Promise<string[]> {
  const requested: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.hostname === "localhost") requested.push(u.pathname); });
  const scan = png(1700, 420);
  const letter = await typesetPdf();
  await page.route("**/*@2x.png", (route) => route.fulfill({ contentType: "image/png", body: scan }));
  await page.route("**/typeset/**/*.pdf", (route) => route.fulfill({ contentType: "application/pdf", body: letter }));
  await page.route("**/typeset/**/*.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  await page.route(`**${MEI_URL}`, (route) => route.fulfill({ contentType: "application/xml", body: MEI }));
  return requested;
}

const radio = (page: Page, name: string, value: string) => page.locator(`dialog.cx input[name="${name}"][value="${value}"]`).locator("xpath=..");

async function openAndPickIpad(page: Page, preset: keyof typeof SIZES = "ipad-11"): Promise<void> {
  await page.locator("#export-customize").click();
  await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
  const download = page.locator('dialog.cx [data-cx="download"]');
  await expect(download).toBeEnabled({ timeout: 120_000 });
  const settings = page.locator('dialog.cx [data-cx="settings-btn"]');
  if (await settings.isVisible()) await settings.click();
  await radio(page, "cx-tier", "ipad").click();
  await radio(page, "cx-ipad", preset).click();
  if (await settings.isVisible()) await page.locator('dialog.cx [data-cx="panel-done"]').click();
  await expect(page.locator("dialog.cx .cx-plabel").first()).toContainText(`${SIZES[preset].label}, portrait`, { timeout: 120_000 });
  await expect(download).toBeEnabled({ timeout: 120_000 });
}

async function downloadPdf(page: Page): Promise<{ bytes: Uint8Array; filename: string }> {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.locator('dialog.cx [data-cx="download"]').click()]);
  return { bytes: new Uint8Array(readFileSync(await file.path())), filename: file.suggestedFilename() };
}

test.describe("Customize export where nothing reflows", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.beforeEach(async ({ page }) => {
    const probe = await page.request.get("/e2e/export-layout-worker/");
    test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1 (use pnpm build:e2e)");
    page.on("pageerror", (e) => { throw new Error(`pageerror: ${e.message}`); });
  });

  for (const preset of ["ipad-11", "ipad-mini"] as const) test(`a scan-only page at the ${SIZES[preset].label} size: scans packed by system, inside the margins, and no Verovio`, async ({ page }) => {
    const size = SIZES[preset];
    test.setTimeout(240_000);
    const requested = await serveAssets(page);
    await page.goto(PAGES.scan, { waitUntil: "networkidle" });
    await expect(page.locator("#export-customize")).toBeVisible();
    const before = requested.length;
    await openAndPickIpad(page, preset);

    // The editor says plainly what applies: no music size, no line breaks, no break editing; page, margins and systems per page do.
    await expect(page.locator('dialog.cx [data-cx="nomusic"]')).toBeVisible();
    await expect(page.locator('dialog.cx [data-cx="music-field"]')).toBeHidden();
    await expect(page.locator('dialog.cx [data-cx="lines-field"]')).toBeHidden();
    await expect(page.locator('dialog.cx [data-cx="yours-field"]')).toBeHidden();
    await expect(page.locator('dialog.cx [data-cx="partlist"]')).toContainText("Page size, margins and systems per page apply");
    await expect(page.locator('dialog.cx [data-cx="cap-minus"]')).toBeEnabled();

    // The preview: scan images only, every one inside the margin guide of its page.
    const frames = page.locator("dialog.cx .cx-pg");
    const pageCount = await frames.count();
    expect(pageCount).toBeGreaterThanOrEqual(1);
    const inside = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("dialog.cx .cx-pagebox")].map((box) => {
      const g = box.querySelector(".cx-guide")!.getBoundingClientRect();
      const imgs = [...box.querySelectorAll("img.cx-scanimg")].map((i) => i.getBoundingClientRect());
      return { n: imgs.length, outside: imgs.filter((r) => r.left < g.left - 1 || r.right > g.right + 1 || r.top < g.top - 1 || r.bottom > g.bottom + 1).length };
    }));
    for (const p of inside) { expect(p.n).toBeGreaterThan(0); expect(p.outside).toBe(0); }
    expect(inside.reduce((n, p) => n + p.n, 0)).toBe(4); // the piece's four systems

    // The PDF: page count, MediaBox, and every image inside the content box.
    const { bytes, filename } = await downloadPdf(page);
    expect(filename).toContain(`(${size.label}).pdf`);
    const placed = await imageBoxes(bytes);
    expect(placed).toHaveLength(pageCount);
    let images = 0;
    for (const p of placed) {
      expect(Math.abs(p.pageWidthMm - size.width)).toBeLessThan(0.2);
      expect(Math.abs(p.pageHeightMm - size.height)).toBeLessThan(0.2);
      for (const b of p.boxes) {
        images++;
        expect(b.xMm).toBeGreaterThanOrEqual(size.margin - 0.1);
        expect(b.yMm).toBeGreaterThanOrEqual(size.margin - 0.1);
        expect(b.xMm + b.widthMm).toBeLessThanOrEqual(size.width - size.margin + 0.1);
        expect(b.yMm + b.heightMm).toBeLessThanOrEqual(size.height - size.margin + 0.1);
      }
    }
    expect(images).toBe(4);
    // Nothing reflowed, so no engraver.
    expect(requested.slice(before).filter((u) => VEROVIO.test(u))).toEqual([]);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/scan-only-editor-${preset}-1280.png` });
    writeFileSync(`${OUT}/scan-only-${preset}.pdf`, bytes);
  });

  test("a fixed-only page (Missa I): the LilyPond pages are placed scaled onto the iPad page, no Verovio", async ({ page }) => {
    test.setTimeout(240_000);
    const requested = await serveAssets(page);
    await page.goto(PAGES.fixed, { waitUntil: "networkidle" });
    const before = requested.length;
    await openAndPickIpad(page);
    await expect(page.locator('dialog.cx [data-cx="nomusic"]')).toBeVisible();
    await expect(page.locator('dialog.cx [data-cx="cap-value"]')).toHaveText("Not used for these parts");
    await expect(page.locator('dialog.cx [data-cx="cap-minus"]')).toBeDisabled();
    await expect(page.locator('dialog.cx [data-cx="cap-plus"]')).toBeDisabled();
    await expect(page.locator('dialog.cx [data-cx="partlist"]')).toContainText("Fitted to your paper");
    const fixedPages = await page.locator("dialog.cx .cx-pg[data-kind=fixed]").count();
    expect(fixedPages).toBeGreaterThanOrEqual(6);
    expect(await page.locator("dialog.cx .cx-pg").count()).toBe(fixedPages);
    const { bytes } = await downloadPdf(page);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(fixedPages);
    const box = doc.getPage(0).getMediaBox();
    expect(Math.abs(box.width - (IPAD11.width * 72) / 25.4)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.height - (IPAD11.height * 72) / 25.4)).toBeLessThanOrEqual(0.5);
    expect(requested.slice(before).filter((u) => VEROVIO.test(u))).toEqual([]);
  });

  test("a mixed selection (a fixed part and a scan part) lays out and exports, still without Verovio", async ({ page }) => {
    test.setTimeout(240_000);
    const requested = await serveAssets(page);
    await page.goto(PAGES.fixed, { waitUntil: "networkidle" });
    // The reader looks at the scans of the Kyrie, so it is exported as scans; the rest stay typeset (fixed).
    await page.evaluate(() => { document.querySelector<HTMLElement>("[data-typeset-key]")!.dataset["show"] = "scan"; });
    const before = requested.length;
    await openAndPickIpad(page);
    await expect(page.locator('dialog.cx [data-cx="partlist"]')).toContainText("Page size, margins and systems per page apply"); // the scan part
    await expect(page.locator('dialog.cx [data-cx="partlist"]')).toContainText("Fitted to your paper"); // the fixed parts
    await expect(page.locator('dialog.cx [data-cx="cap-minus"]')).toBeEnabled(); // the scan part can be capped
    expect(await page.locator("dialog.cx .cx-pg[data-kind=scan]").count()).toBeGreaterThan(0);
    expect(await page.locator("dialog.cx .cx-pg[data-kind=fixed]").count()).toBeGreaterThan(0);
    const total = await page.locator("dialog.cx .cx-pg").count();
    const { bytes } = await downloadPdf(page);
    expect((await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()).toBe(total);
    expect(requested.slice(before).filter((u) => VEROVIO.test(u))).toEqual([]);
  });

  test("Customize export counts one custom download, and Verovio does load for a part that reflows", async ({ page }) => {
    test.setTimeout(240_000);
    // The real count.js would replace the stub below (and send a real hit), so it never loads here.
    await page.route("**/gc.zgo.at/**", (route) => route.fulfill({ body: "", contentType: "application/javascript" }));
    await page.addInitScript(() => {
      (window as unknown as { __gc: unknown[] }).__gc = [];
      (window as unknown as { goatcounter: { count(e: unknown): void } }).goatcounter = { count: (e) => (window as unknown as { __gc: unknown[] }).__gc.push(e) };
    });
    const requested = await serveAssets(page);
    await page.goto(PAGES.scan, { waitUntil: "networkidle" });
    await openAndPickIpad(page);
    await downloadPdf(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __gc: unknown[] }).__gc.length)).toBe(1);
    expect((await page.evaluate(() => (window as unknown as { __gc: { path: string }[] }).__gc))[0]!.path).toBe("export/custom");
    expect(requested.filter((u) => VEROVIO.test(u))).toEqual([]);

    // Kyrie IX (an approved conversion in this build) reflows, and then the engraver is fetched.
    await page.goto(PAGES.mixed, { waitUntil: "networkidle" });
    test.skip((await page.locator("#export-customize").count()) === 0, "no button");
    const before = requested.length;
    await page.locator("details.parts").evaluate((d) => { (d as HTMLDetailsElement).open = true; });
    for (const box of await page.locator('input[name="export-part"]').all()) {
      if ((await box.getAttribute("data-label") === "Kyrie") !== (await box.isChecked())) await box.locator("xpath=..").click();
    }
    await page.locator("#export-customize").click();
    await expect(page.locator("dialog.cx .cx-page").first()).toBeVisible({ timeout: 120_000 });
    expect(requested.slice(before).some((u) => VEROVIO.test(u))).toBe(true);
  });

  test("pictures for the review: the scan-only editor at 390 and the PDF's first page drawn by pdf.js (build/b11/)", async ({ page }) => {
    test.setTimeout(240_000);
    await serveAssets(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PAGES.scan, { waitUntil: "networkidle" });
    await openAndPickIpad(page);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/scan-only-editor-390.png` });
    const { bytes } = await downloadPdf(page);
    await page.goto("/e2e/export-layout-worker/");
    await expect(page.locator("#state")).toHaveAttribute("data-state", "ready");
    const dataUrl = await page.evaluate((b64) => (window as unknown as { __renderPdfPage(b: string, n: number, s: number): Promise<string> }).__renderPdfPage(b64, 1, 2), Buffer.from(bytes).toString("base64"));
    writeFileSync(`${OUT}/scan-only-pdf-page1.png`, Buffer.from(dataUrl.split(",")[1]!, "base64"));
  });
});
