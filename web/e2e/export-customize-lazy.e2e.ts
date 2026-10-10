// B9: the layout editor must cost nothing until "Customize export" is clicked.
//
// Pages: `/` (no export bar), `/kyriale/ix/` (Kyrie IX has an approved conversion), `/kyriale/i/` (none).
// The Kyrie IX button only exists in a build with the fixture manifest:
//   PUBLIC_MEI_MANIFEST=fixture PUBLIC_ASSET_BASE=/systems pnpm exec astro build
// (the production manifest has no approved conversions yet, so a production build has no button anywhere).
// Add E2E_TEST_PAGES=1 to the same build to run the other export specs against it.
//
// B9_PHASE=before|after writes the request lists to <repo>/build/b9/requests-<phase>-<name>.txt.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const FIXTURES = "src/lib/export-layout/__fixtures__";
const OUT = resolve(process.cwd(), "..", "build", "b9");
const PHASE = process.env["B9_PHASE"] ?? "after";
const VARIANT = process.env["B9_VARIANT"] ?? "fixture";
const PAGES = [
  { name: "home", path: "/" },
  { name: "kyriale-ix", path: "/kyriale/ix/" },
  { name: "kyriale-i", path: "/kyriale/i/" },
] as const;

/** Anything the editor loads: Verovio, the layout and PDF workers and adapters, pdf.js, the bundled export fonts. */
const HEAVY = /verovio|export-layout|exportLayout|pdf\.worker|pdfjs|\/fonts\/export\/|LiberationSerif/i;

/** Every same-origin request path, and the bytes of the JavaScript among them. */
function watch(page: Page): { urls: Set<string>; jsBytes: () => Promise<number> } {
  const urls = new Set<string>();
  const bodies: Promise<number>[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.hostname === "localhost") urls.add(`${r.resourceType()} ${u.pathname}`);
  });
  page.on("response", (res) => {
    if (res.request().resourceType() === "script") bodies.push(res.body().then((b) => b.length, () => 0));
  });
  return { urls, jsBytes: async () => (await Promise.all(bodies)).reduce((a, b) => a + b, 0) };
}

test("record the request lists", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  for (const p of PAGES) {
    const fresh = await page.context().newPage();
    const w = watch(fresh);
    await fresh.goto(p.path, { waitUntil: "networkidle" });
    writeFileSync(`${OUT}/requests-${PHASE}-${VARIANT}-${p.name}.txt`, `${[...w.urls].sort().join("\n")}\n`);
    writeFileSync(`${OUT}/jsbytes-${PHASE}-${VARIANT}-${p.name}.txt`, `${await w.jsBytes()}\n`);
    await fresh.close();
  }
  expect(true).toBe(true);
});

const MEI_URL = "/__fixtures__/kyrie-ix.mei"; // the fixture manifest's meiUrl for Kyrie IX
const heavy = (urls: Iterable<string>): string[] => [...urls].filter((u) => HEAVY.test(u));

/** The page has the button only in a build with the fixture manifest; elsewhere these tests have nothing to say. */
async function kyrie(page: Page): Promise<{ urls: Set<string>; jsBytes: () => Promise<number> }> {
  await page.route(`**${MEI_URL}`, (route) => route.fulfill({ contentType: "application/xml", body: readFileSync(`${FIXTURES}/kyrie-ix.mei`) }));
  // The typeset pictures are not served by the local preview, and a part whose picture fails to load is exported as
  // scans. Serve a stand-in so Kyrie stays a typeset part, as it is on the live site.
  await page.route("**/systems/typeset/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  const w = watch(page);
  await page.goto("/kyriale/ix/", { waitUntil: "networkidle" });
  test.skip((await page.locator("#export-customize").count()) === 0, "built without PUBLIC_MEI_MANIFEST=fixture");
  return w;
}
/** Tick only Kyrie, so every part in the editor is the approved conversion. */
async function tick(page: Page, wanted: (label: string | null) => boolean): Promise<void> {
  await page.locator("details.parts").evaluate((d) => { (d as HTMLDetailsElement).open = true; });
  for (const box of await page.locator('input[name="export-part"]').all()) {
    if (wanted(await box.getAttribute("data-label")) !== (await box.isChecked())) await box.locator("xpath=..").click();
  }
  await page.locator("details.parts").evaluate((d) => { (d as HTMLDetailsElement).open = false; });
}
const onlyKyrie = (page: Page): Promise<void> => tick(page, (label) => label === "Kyrie");

test.describe("Customize export is lazy", () => {
  for (const p of PAGES) {
    test(`${p.path} loads no editor code before Customize is clicked`, async ({ page }) => {
      const w = watch(page);
      await page.goto(p.path, { waitUntil: "networkidle" });
      expect(heavy(w.urls)).toEqual([]);
      // Nor any worker or wasm at all.
      expect([...w.urls].filter((u) => /\.wasm|worker/i.test(u))).toEqual([]);
    });
  }

  test("the Kyrie IX page offers the button, and clicking it opens the editor and only then loads the layout worker", async ({ page }) => {
    const w = await kyrie(page);
    expect(heavy(w.urls)).toEqual([]);
    const button = page.locator("#export-customize");
    await expect(button).toHaveText("Customize export");
    await expect(button).toBeEnabled();
    await onlyKyrie(page);
    expect(heavy(w.urls)).toEqual([]);
    const before = new Set(w.urls);

    const workerLoaded = page.waitForEvent("worker");
    await button.click();
    await workerLoaded;
    await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("cx-title");
    await expect(page.locator("#cx-sel")).toHaveText("Missa IX");
    await expect(page.locator("dialog.cx .cx-page").first()).toBeVisible({ timeout: 120_000 });
    expect(await page.locator("#export-customize").getAttribute("aria-busy")).toBeNull();
    expect(await button.textContent()).toBe("Customize export");
    const added = [...w.urls].filter((u) => !before.has(u));
    expect(added.some((u) => /worker/i.test(u) || /export-layout/i.test(u))).toBe(true);
    expect(await page.locator('dialog.cx [data-cx="download"]').isEnabled()).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.cx")).not.toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("export-customize");
  });

  test("a page without a conversion has no button and no editor markup", async ({ page }) => {
    await page.goto("/kyriale/i/", { waitUntil: "networkidle" });
    await expect(page.locator("#export-btn")).toBeVisible();
    await expect(page.locator("#export-customize")).toHaveCount(0);
    await expect(page.locator("template[data-cx-template]")).toHaveCount(0);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("#export-customize")).toHaveCount(0);
  });

  test("the button follows the quick export's disabled rule", async ({ page }) => {
    await kyrie(page);
    const button = page.locator("#export-customize");
    await expect(button).toBeEnabled();
    await tick(page, () => false);
    await expect(page.locator("#export-btn")).toBeDisabled();
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("Customize export");
  });

  test("a #customize-export fragment in the URL is stripped and does not open the editor", async ({ page }) => {
    await page.route(`**${MEI_URL}`, (route) => route.fulfill({ body: "" }));
    await page.goto("/kyriale/ix/#customize-export", { waitUntil: "networkidle" });
    test.skip((await page.locator("#export-customize").count()) === 0, "built without PUBLIC_MEI_MANIFEST=fixture");
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    await expect(page.locator("dialog.cx")).toHaveCount(0);
  });

  test("a custom download is counted once, with the settings and nothing personal", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __gc: unknown[] }).__gc = [];
      (window as unknown as { goatcounter: { count(e: unknown): void } }).goatcounter = { count: (e) => (window as unknown as { __gc: unknown[] }).__gc.push(e) };
    });
    await kyrie(page);
    await onlyKyrie(page);
    await page.locator("#export-customize").click();
    const download = page.locator('dialog.cx [data-cx="download"]');
    await expect(download).toBeEnabled({ timeout: 120_000 });
    await page.locator('dialog.cx input[name="cx-tier"][value="ipad"]').locator("xpath=..").click();
    await expect(download).toHaveText(/Download PDF · \d+ pages?/, { timeout: 120_000 });
    await expect(download).toBeEnabled({ timeout: 120_000 });
    const [saved] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), download.click()]);
    expect(saved.suggestedFilename()).toBe("Missa IX (11-inch iPad).pdf");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __gc: unknown[] }).__gc.length)).toBe(1);
    const events = await page.evaluate(() => (window as unknown as { __gc: { path: string; title: string; event: boolean }[] }).__gc);
    expect(events[0]).toEqual({ path: "export/custom", title: "linePolicy=original, maxSystems=auto, orientation=portrait, page=ipad-11, staff=medium", event: true });
  });
});

test("screenshots of the export bar (build/b10a/), only where the button exists", async ({ page }) => {
  const shots = resolve(process.cwd(), "..", "build", "b10a");
  mkdirSync(shots, { recursive: true });
  await page.route("**/systems/typeset/**", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }));
  await page.goto("/kyriale/ix/", { waitUntil: "networkidle" });
  test.skip((await page.locator("#export-customize").count()) === 0, "built without PUBLIC_MEI_MANIFEST=fixture: no button to show");
  for (const [name, path, size] of [
    ["kyriale-ix-1280", "/kyriale/ix/", { width: 1280, height: 800 }],
    ["kyriale-ix-390", "/kyriale/ix/", { width: 390, height: 844 }],
    ["kyriale-i-1280", "/kyriale/i/", { width: 1280, height: 800 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.goto(path, { waitUntil: "networkidle" });
    // Kyrie IX shows the button, Missa I does not; the shot must show exactly that.
    await expect(page.locator("#export-customize")).toHaveCount(name.startsWith("kyriale-ix") ? 1 : 0);
    await page.locator(".export").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/export-bar-${name}.png` });
  }
});
