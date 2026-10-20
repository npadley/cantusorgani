// K8: chant in the PDF, through the real site pages, the real editor, the layout and PDF workers, and the verifier.
//
//   pnpm build:e2e && pnpm test:e2e:export        (dist-e2e/ has the fixture manifest and the test pages)
//
// Kyrie IX (its chant is GregoBase #2976) at Letter and iPad mini, and the page whose linked chant is the longest
// (K0 found it: pages.json), where the chant must split between lines. Each download goes to the verifier, which now
// counts four-line chant staves apart from the five-line staves. The site's "Show the chant" preference is set, so the
// editor starts with Chant on (DL D26). Scans and typeset pictures are stand-ins, as in export-nonreflow.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import type { Page } from "@playwright/test";

import { verifyExportPdf } from "../scripts/verify-export-pdf";
import type { CanonicalExpectation } from "../scripts/verify-export-pdf";

const OUT = resolve(process.cwd(), "..", "build", "chant");
const FIXTURES = "src/lib/export-layout/__fixtures__";
const MEI = readFileSync(`${FIXTURES}/kyrie-ix.mei`, "utf8");
const MEI_URL = "/__fixtures__/kyrie-ix.mei";
const PAGES = JSON.parse(readFileSync(`${FIXTURES}/chant/pages.json`, "utf8")) as { kyrie: string; longest: string };
const urlOf = (distPath: string): string => `/${distPath.replace(/index\.html$/, "")}`;
/** Medium music: the chant staff space equals the accompaniment's, 2 x 9 / 10 mm (CS 4.2). */
const MEDIUM_SPACE_MM = 1.8;

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
function png(width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) { const row = Buffer.alloc(width + 1, 255); row[0] = 0; rows.push(row); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

async function prepare(page: Page, chantDisplay: "show" | "link"): Promise<void> {
  const probe = await page.request.get("/e2e/export-layout-worker/");
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1 (use pnpm build:e2e)");
  page.on("pageerror", (e) => { throw new Error(`pageerror: ${e.message}`); });
  // Any test that counts analytics must replace the real count.js first.
  await page.route("**/gc.zgo.at/**", (route) => route.fulfill({ body: "", contentType: "application/javascript" }));
  const scan = png(1700, 420);
  // A fixed (pre-typeset) part, such as the Gradual here, is a LilyPond PDF: stand in with a one-page letter PDF.
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawRectangle({ x: 72, y: 600, width: 468, height: 100, borderWidth: 2 });
  const letter = Buffer.from(await doc.save());
  await page.route("**/typeset/**/*.pdf", (route) => route.fulfill({ contentType: "application/pdf", body: letter }));
  await page.route("**/*@2x.png", (route) => route.fulfill({ contentType: "image/png", body: scan }));
  await page.route("**/typeset/**/*.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  await page.route(`**${MEI_URL}`, (route) => route.fulfill({ contentType: "application/xml", body: MEI }));
  await page.addInitScript((value) => { try { localStorage.setItem("chant-display", value); } catch { /* storage may be blocked */ } }, chantDisplay);
}

/** Tick only the parts the filter wants. */
async function tick(page: Page, wanted: (label: string | null) => boolean): Promise<void> {
  await page.locator("details.parts").evaluate((d) => { (d as HTMLDetailsElement).open = true; });
  for (const box of await page.locator('input[name="export-part"]').all()) {
    if (wanted(await box.getAttribute("data-label")) !== (await box.isChecked())) await box.locator("xpath=..").click();
  }
  await page.locator("details.parts").evaluate((d) => { (d as HTMLDetailsElement).open = false; });
}

const radio = (page: Page, name: string, value: string) => page.locator(`dialog.cx input[name="${name}"][value="${value}"]`).locator("xpath=..");
const chantHolders = (page: Page) => page.locator("dialog.cx .cx-svg:not(:has(g.system))");

async function openEditor(page: Page): Promise<void> {
  await page.locator("#export-customize").click();
  await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
  await expect(page.locator('dialog.cx [data-cx="download"]')).toBeEnabled({ timeout: 120_000 });
}

async function pickPage(page: Page, size: "letter" | "ipad-mini" | "ipad-11"): Promise<void> {
  const settings = page.locator('dialog.cx [data-cx="settings-btn"]');
  if (await settings.isVisible()) await settings.click();
  if (size !== "letter") {
    await radio(page, "cx-tier", "ipad").click();
    await radio(page, "cx-ipad", size).click();
  }
  if (await settings.isVisible()) await page.locator('dialog.cx [data-cx="panel-done"]').click();
  await expect(page.locator("dialog.cx .cx-plabel").first()).toContainText(size === "letter" ? "Letter" : size === "ipad-mini" ? "iPad mini" : "11-inch iPad", { timeout: 120_000 });
  await expect(page.locator('dialog.cx [data-cx="download"]')).toBeEnabled({ timeout: 120_000 });
}

/** What the canonical layout draws, read from the preview: 5-line staves, chant staves per page, and the text. */
async function expectation(page: Page): Promise<CanonicalExpectation> {
  const pages = await page.evaluate(() => {
    const out: { widthMm: number; heightMm: number; staves: number[][]; text: string[]; chantLines: number }[] = [];
    for (const wrap of document.querySelectorAll<HTMLElement>("dialog.cx .cx-pg")) {
      const frame = wrap.querySelector<HTMLElement>(".cx-page")!;
      const sheet = wrap.querySelector<HTMLElement>(".cx-sheet")!.getBoundingClientRect();
      const heightMm = Number(frame.dataset["heightMm"]);
      const staves: number[][] = [];
      for (const system of wrap.querySelectorAll(".cx-svg g.system")) {
        for (const staff of system.querySelector("g.measure")!.querySelectorAll(":scope > g.staff")) {
          const ys = [...staff.querySelectorAll(":scope > path")].map((l) => { const r = l.getBoundingClientRect(); return ((r.top + r.height / 2 - sheet.top) / sheet.height) * heightMm; });
          if (ys.length === 5) staves.push(ys.sort((a, b) => a - b));
        }
      }
      const text = [...wrap.querySelectorAll(".cx-svg text")].map((t) => t.textContent ?? "");
      text.push(...[...wrap.querySelectorAll(".cx-text text")].map((t) => t.textContent ?? ""));
      const chantLines = [...wrap.querySelectorAll(".cx-svg")].filter((h) => h.querySelector("g.system") === null).length;
      out.push({ widthMm: Number(frame.dataset["widthMm"]), heightMm, staves, text, chantLines });
    }
    return out;
  });
  return { staffHeightMm: 7.2, chantStaffSpaceMm: MEDIUM_SPACE_MM, pages };
}

async function download(page: Page): Promise<{ bytes: Uint8Array; filename: string }> {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.locator('dialog.cx [data-cx="download"]').click()]);
  return { bytes: new Uint8Array(readFileSync(await file.path())), filename: file.suggestedFilename() };
}

test.setTimeout(240_000);
test.describe("chant in the PDF", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const size of ["letter", "ipad-mini"] as const) {
    test(`Kyrie IX with chant at ${size}: chant under the heading, accompaniment below, verified`, async ({ page }) => {
      await prepare(page, "show");
      await page.goto(urlOf(PAGES.kyrie), { waitUntil: "networkidle" });
      await tick(page, (label) => label === "Kyrie");
      await openEditor(page);
      // P2: the site preference is on, so the editor starts with Chant before each part.
      await expect(page.locator('dialog.cx input[name="cx-chant"][value="before"]')).toBeChecked();
      await expect(chantHolders(page).first()).toBeAttached({ timeout: 120_000 });
      await pickPage(page, size);
      await expect(chantHolders(page).first()).toBeAttached();

      const want = await expectation(page);
      expect(want.pages.some((p) => p.chantLines > 0)).toBe(true);
      expect(want.pages.some((p) => p.staves.length > 0)).toBe(true);
      const { bytes, filename } = await download(page);
      const report = await verifyExportPdf(bytes, want);
      expect(report.problems).toEqual([]);
      expect(report.pages.flatMap((p) => p.chantStaves).length).toBe(want.pages.reduce((n, p) => n + p.chantLines, 0));
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/kyrie-ix-${size}.pdf`, bytes);
      expect(filename).toMatch(/\.pdf$/);
    });
  }

  for (const size of ["letter", "ipad-mini"] as const) {
    test(`the longest linked chant at ${size} splits between lines and the page count matches the result line`, async ({ page }) => {
      await prepare(page, "show");
      await page.goto(urlOf(PAGES.longest), { waitUntil: "networkidle" });
      await tick(page, (label) => label?.startsWith("Tract") === true);
      await openEditor(page);
      await expect(chantHolders(page).first()).toBeAttached({ timeout: 120_000 });
      await pickPage(page, size);

      const want = await expectation(page);
      const total = want.pages.reduce((n, p) => n + p.chantLines, 0);
      expect(total).toBeGreaterThan(10);
      if (size === "ipad-mini") expect(want.pages.filter((p) => p.chantLines > 0).length).toBeGreaterThanOrEqual(2);
      // The result line counts every page, chant pages included.
      const line = (await page.locator('dialog.cx [data-cx="result"]').textContent()) ?? "";
      const counted = [...line.matchAll(/(\d+) pages?/g)].reduce((n, m) => n + Number(m[1]), 0);
      expect(counted).toBe(want.pages.length);

      const { bytes } = await download(page);
      const report = await verifyExportPdf(bytes, want);
      expect(report.problems).toEqual([]);
      expect(report.pageCount).toBe(want.pages.length);
      expect(report.pages.flatMap((p) => p.chantStaves).length).toBe(total);
      writeFileSync(`${OUT}/longest-${size}.pdf`, bytes);
    });
  }

  // K9 preparation: the PDFs the user reviews (a Gradual, a Tract and a short piece, Letter and 11-inch iPad, chant on).
  const REVIEW = [
    { name: "gradual", path: PAGES.longest, wanted: (l: string | null) => l?.startsWith("Gradual") === true },
    { name: "tract", path: PAGES.longest, wanted: (l: string | null) => l?.startsWith("Tract") === true },
    { name: "kyrie-ix", path: PAGES.kyrie, wanted: (l: string | null) => l === "Kyrie" },
  ] as const;
  for (const r of REVIEW) for (const size of ["letter", "ipad-11"] as const) {
    test(`review PDF: ${r.name} at ${size} with chant (build/chant/)`, async ({ page }) => {
      await prepare(page, "show");
      await page.goto(urlOf(r.path), { waitUntil: "networkidle" });
      await tick(page, r.wanted);
      await openEditor(page);
      await expect(chantHolders(page).first()).toBeAttached({ timeout: 120_000 });
      await pickPage(page, size);
      const want = await expectation(page);
      const { bytes } = await download(page);
      expect((await verifyExportPdf(bytes, want)).problems).toEqual([]);
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/review-${r.name}-${size}.pdf`, bytes);
    });
  }

  test("chant only: no five-line staves, the (chant) filename, and parts without chant left out", async ({ page }) => {
    await prepare(page, "link");
    await page.goto(urlOf(PAGES.kyrie), { waitUntil: "networkidle" });
    await tick(page, (label) => label === "Kyrie");
    await openEditor(page);
    await expect(page.locator('dialog.cx input[name="cx-chant"][value="off"]')).toBeChecked();
    const settings = page.locator('dialog.cx [data-cx="settings-btn"]');
    if (await settings.isVisible()) await settings.click();
    await radio(page, "cx-chant", "only").click();
    if (await settings.isVisible()) await page.locator('dialog.cx [data-cx="panel-done"]').click();
    await expect(chantHolders(page).first()).toBeAttached({ timeout: 120_000 });
    await expect(page.locator('dialog.cx [data-cx="download"]')).toBeEnabled({ timeout: 120_000 });
    const want = await expectation(page);
    expect(want.pages.every((p) => p.staves.length === 0 && p.chantLines > 0)).toBe(true);
    const { bytes, filename } = await download(page);
    expect(filename).toMatch(/ \(chant\)\.pdf$/);
    const report = await verifyExportPdf(bytes, want);
    expect(report.problems).toEqual([]);
    expect(report.pages.every((p) => p.staves.length === 0)).toBe(true);
  });
});
