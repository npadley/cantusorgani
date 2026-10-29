import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const PAGES = ["/piece/dominica-i-adventus/", "/day/tempora/Adv1-0/", "/day/sancti/05-26/", "/vespers/2026-11-29/", "/search/"];
const MUSIC = /\/(?:typeset\/[^?]+\.svg|(?:systems\/)?noh\d+\/[^?]+\.(?:webp|png))(?:\?|$)/;
// TODO: measure gzip baselines (piece/day/Vespers/search) on the coordinator's
// browser run: Chromium cannot launch in this sandbox. Then gate piece and
// Vespers at baseline × 1.10, and day at the piece limit.
for (const path of PAGES) for (const preference of [null, "scans"] as const) {
  test(`${path} music budget (${preference ?? "default"})`, async ({ page }, info) => {
    await page.addInitScript((saved) => {
      localStorage.removeItem("typeset-view");
      if (saved) localStorage.setItem("typeset-view", saved);
    }, preference);
    const requests: string[] = [];
    const bytes: Promise<{ kind: string; bytes: number }>[] = [];
    const start = Date.now();
    let firstMusicMs: number | undefined;
    let measured = false;
    page.on("request", (request) => {
      if (!MUSIC.test(request.url())) return;
      firstMusicMs ??= Date.now() - start;
      requests.push(request.url());
    });
    page.on("response", (response) => {
      const kind = response.request().resourceType();
      if (measured || firstMusicMs !== undefined || !["document", "stylesheet", "script", "font"].includes(kind)) return;
      // Playwright decodes response bodies: gzip consistently for comparison.
      bytes.push(response.body().then((body) => ({ kind, bytes: gzipSync(body).length })).catch(() => ({ kind, bytes: 0 })));
    });
    await page.goto(path, { waitUntil: "networkidle" });
    const totals: Record<string, number> = {};
    for (const item of await Promise.all(bytes)) totals[item.kind] = (totals[item.kind] ?? 0) + item.bytes;
    measured = true;
    const eagerImages = await page.locator('img[loading="eager"]').count();
    const highPriorityImages = await page.locator('img[fetchpriority="high"]').count();
    expect(eagerImages, "eager images per page").toBeLessThanOrEqual(3);
    expect(highPriorityImages, "high fetchpriority images per page").toBeLessThanOrEqual(1);
    info.annotations.push({
      type: "before-first-music",
      description: JSON.stringify({ musicRequests: requests.length, gzipBytes: totals, firstMusicMs }),
    });
    const hidden = await page.locator("[data-typeset]").evaluateAll((segments, saved) => {
      const urls: string[] = [];
      let eagerTypeset = 0;
      for (const seg of segments) {
        const copy = seg.querySelector(saved === "scans" ? ".typeset" : ".scans");
        // The server cannot know the saved scan preference. Its at most three
        // eager typeset images can fetch even while hidden; exempt only those
        // pictures (including their responsive sources), never lazy typeset.
        if (saved === "scans" && copy?.querySelector('img[loading="eager"]')) {
          eagerTypeset++;
          continue;
        }
        for (const node of copy?.querySelectorAll("[src], [srcset]") ?? []) {
          const src = node.getAttribute("src");
          if (src) urls.push(new URL(src, location.href).href);
          for (const candidate of (node.getAttribute("srcset") ?? "").split(",")) {
            const url = candidate.trim().split(/\s+/)[0];
            if (url) urls.push(new URL(url, location.href).href);
          }
        }
      }
      return { urls, eagerTypeset };
    }, preference);
    expect(hidden.eagerTypeset, "eager hidden typeset exceptions").toBeLessThanOrEqual(3);
    const assertHidden = (): void => { expect(requests.filter((url) => hidden.urls.includes(url)), "hidden representation requests").toEqual([]); };
    assertHidden();
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
        scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForLoadState("networkidle");
    assertHidden();
    const customize = page.locator("#export-customize");
    if (await customize.count()) {
      await customize.click();
      await expect(page.locator("dialog.cx")).toBeVisible();
      await expect(page.locator('dialog.cx [data-cx="download"]')).toBeEnabled({ timeout: 120_000 });
      await page.waitForLoadState("networkidle");
    } else info.annotations.push({ type: "Customize export", description: "This page has no export control." });
  });
}

test("empty-state woodcuts make no request before the reader needs them", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/art/v1/")) requests.push(request.url());
  });
  for (const path of ["/search/", "/hymns/", "/piece/dominica-i-adventus/"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    expect(requests).toEqual([]);
  }
  await page.goto("/hymns/");
  await page.locator("#hymn-filter").fill("zzzznothingmatcheszzzz");
  const art = page.locator("img.woodcut");
  await art.scrollIntoViewIfNeeded();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.every(url => url.includes("detail-gregory-"))).toBe(true);
});
