// The device-test setup, checked the way the iPad will meet it: the fixture build served by scripts/serve-device-test.ts,
// reached by its LAN address (an insecure context, unlike localhost), from an iPad Pro 11 viewport.
//
//   pnpm build:e2e
//   E2E_WEBKIT=1 pnpm exec playwright test e2e/export-device.e2e.ts --project=ipad-lan   (WebKit, needs `playwright install webkit`)
//   pnpm exec playwright test e2e/export-device.e2e.ts --project=ipad-lan                (Chromium, same checks)
//
// The production asset host is replaced by a local stand-in, so the run needs no network and tests the proxy's allowlist.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { createDeviceServer, lanAddresses } from "../scripts/serve-device-test";

const WEB = resolve(import.meta.dirname, "..");
const MEI = readFileSync(resolve(WEB, "src/lib/export-layout/__fixtures__/kyrie-ix.mei"), "utf8");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

async function listen(server: ReturnType<typeof createServer>, host: string): Promise<number> {
  await new Promise<void>((ok) => server.listen(0, host, ok));
  return (server.address() as AddressInfo).port;
}

test("Kyrie IX on the device server: Customize export, iPad preset, a valid PDF", async ({ page, browserName }) => {
  test.setTimeout(240_000);
  test.skip(!process.env["E2E_DIST"]?.includes("dist-e2e") && !process.env["DEVICE_TEST"], "uses dist-e2e: run with E2E_DIST=dist-e2e");
  const lan = lanAddresses()[0];
  test.skip(lan === undefined, "no LAN interface to reach the server by");

  // The stand-in asset host: typeset pictures and nothing else.
  const requested: string[] = [];
  const remote = createServer((req, res) => {
    requested.push(req.url ?? "");
    if (/^\/typeset\/[0-9a-f]+\/wide\.svg$/.test(req.url ?? "")) { res.writeHead(200, { "content-type": "image/svg+xml" }); res.end(SVG); }
    else { res.writeHead(404); res.end(); }
  });
  const remotePort = await listen(remote, "127.0.0.1");
  const device = createDeviceServer({ root: resolve(WEB, "dist-e2e"), remote: `http://127.0.0.1:${remotePort}`, fixtureMei: MEI });
  const port = await listen(device, "0.0.0.0");
  const base = `http://${lan}:${port}`;
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`${base}/kyriale/ix/`, { waitUntil: "networkidle" });
    const env = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: typeof crypto.subtle, offscreen: typeof OffscreenCanvas, worker: typeof Worker, wasm: typeof WebAssembly }));
    console.log(`[device] ${browserName} at ${base}: ${JSON.stringify(env)}`);
    expect(env.secure, "a LAN address is an insecure context, as it will be on the iPad").toBe(false);

    const button = page.locator("#export-customize");
    await expect(button).toBeVisible();
    // Only Kyrie, so the editor holds just the approved conversion.
    await page.locator("details.parts").evaluate((d) => { (d as HTMLDetailsElement).open = true; });
    for (const box of await page.locator('input[name="export-part"]').all()) {
      if ((await box.getAttribute("data-label") === "Kyrie") !== (await box.isChecked())) await box.locator("xpath=..").click();
    }
    await page.locator("details.parts").evaluate((d) => { (d as HTMLDetailsElement).open = false; });
    await button.click();
    await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
    const download = page.locator('dialog.cx [data-cx="download"]');
    await expect(download, JSON.stringify(problems)).toBeEnabled({ timeout: 150_000 });

    // The narrow layout of an iPad Pro 11 in portrait: choose the iPad preset in the Settings panel.
    const settings = page.locator('dialog.cx [data-cx="settings-btn"]');
    if (await settings.isVisible()) await settings.click();
    await page.locator('dialog.cx input[name="cx-tier"][value="ipad"]').locator("xpath=..").click();
    if (await settings.isVisible()) await page.locator('dialog.cx [data-cx="panel-done"]').click();
    await expect(page.locator("dialog.cx .cx-plabel").first()).toContainText("11-inch iPad, portrait", { timeout: 120_000 });
    await expect(download).toBeEnabled({ timeout: 150_000 });
    await expect(download).toHaveText(/Download PDF · \d+ pages?/);

    const [file] = await Promise.all([page.waitForEvent("download", { timeout: 150_000 }), download.click()]);
    expect(file.suggestedFilename()).toBe("Missa IX (11-inch iPad).pdf");
    const bytes = readFileSync(await file.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const box = doc.getPage(0).getMediaBox();
    expect(Math.abs(box.width - (157.8 * 72) / 25.4)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.height - (227.1 * 72) / 25.4)).toBeLessThanOrEqual(0.5);
    expect(problems).toEqual([]);
    // The proxy fetched the typeset picture, and only that.
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((u) => u.startsWith("/typeset/") || u.startsWith("/systems/"))).toBe(true);
  } finally {
    device.close();
    remote.close();
  }
});

test("the device server proxies only the allowlisted asset prefixes, read-only", async () => {
  const seen: string[] = [];
  const remote = createServer((req, res) => { seen.push(`${req.method} ${req.url}`); res.writeHead(200, { "content-type": "text/plain" }); res.end("remote"); });
  const remotePort = await listen(remote, "127.0.0.1");
  const device = createDeviceServer({ root: resolve(WEB, "dist-e2e"), remote: `http://127.0.0.1:${remotePort}`, fixtureMei: MEI });
  const port = await listen(device, "127.0.0.1");
  try {
    const get = (path: string, method = "GET") => fetch(`http://127.0.0.1:${port}${path}`, { method });
    expect((await get("/systems/typeset/abc123/wide.svg")).status).toBe(200);
    expect((await get("/systems/systems/noh5/0099/000-8d535eb1ae80.webp")).status).toBe(200);
    for (const bad of ["/systems/admin/secret", "/systems/typeset/../../etc/passwd", "/systems/typeset/a b", "/systems/%2e%2e/x", "/systems/", "/systems/http://evil.example/x"]) {
      expect((await get(bad)).status, bad).toBe(404);
    }
    expect((await get("/systems/typeset/abc/wide.svg", "POST")).status).toBe(405);
    expect((await get("/../../../etc/passwd")).status).not.toBe(200);
    expect((await get("/%2e%2e/%2e%2e/etc/passwd")).status).not.toBe(200);
    expect(await (await get("/__fixtures__/kyrie-ix.mei")).text()).toBe(MEI);
    expect((await get("/kyriale/ix/")).headers.get("content-type")).toContain("text/html");
    expect(seen.every((s) => s.startsWith("GET /typeset/abc123") || s.startsWith("GET /systems/noh5"))).toBe(true);
  } finally {
    device.close();
    remote.close();
  }
});
