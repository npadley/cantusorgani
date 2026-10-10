// Real-browser tests of the export preview pane (B8a): the real layout worker lays out the real
// Kyrie IX, and src/scripts/exportPagePreview.ts draws the resulting CanonicalPage[].
//
// Needs the gated test page:
//   E2E_TEST_PAGES=1 PUBLIC_ASSET_BASE=/systems pnpm exec astro build
// A normal build does not emit it and these tests skip.
//
// Screenshots go to <repo>/build/b8a/ (never committed).
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const FIXTURES = "src/lib/export-layout/__fixtures__";
const PAGE = "/e2e/export-layout-worker/";
const MEI_URL = "/__e2e__/kyrie-ix.mei";
const FIXED_URL = "/__e2e__/fixed-credo.pdf";
const SCAN_STEM = "/__e2e__/scan-gloria";
const SHOTS = resolve(process.cwd(), "..", "build", "b8a");
// 1x1 black PNG, served for the scan test.
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

interface Manifest { readonly parts: readonly Record<string, unknown>[] }
const entry = (JSON.parse(readFileSync(`${FIXTURES}/manifest.fixture.json`, "utf8")) as Manifest).parts[0] as Record<string, unknown>;

const meiPart = {
  id: "kyrie:0", kind: "mei", label: "Kyrie IX",
  heading: { label: "Kyrie IX", rubric: "Lord, have mercy", rubricTranslation: null, credit: "Nova Organi Harmonia" },
  sourceSystemCount: 5, sourceRevision: entry["renderHash"], target: entry["target"], renderHash: entry["renderHash"],
  conversion: { ...entry, meiUrl: MEI_URL },
};
const fixedPart = {
  id: "credo:1", kind: "fixed", label: "Credo", heading: null, sourceSystemCount: 3, sourceRevision: "f".repeat(32),
  target: "movement:ordinarium-missae-ix/credo", renderHash: "f".repeat(32), letterPdf: FIXED_URL, a4Pdf: FIXED_URL,
};
const LETTER = { version: 2, page: "letter", customSize: null, orientation: "portrait", marginMm: 12, staff: "medium", lyrics: "medium", spacing: "normal", maxSystems: null, linePolicy: "original" };
const IPAD11 = { ...LETTER, page: "ipad-11", marginMm: 4, linePolicy: "automatic" };
const PART_LABELS = { "kyrie:0": "Kyrie IX", "credo:1": "Credo" };

interface PageInfo { kind: string; widthMm: number; heightMm: number; unusedFraction: number; partId: string; systemCount: number | null; ids: string[] }
interface Summary { pages: PageInfo[]; digest: string; json: string }

interface Harness {
  __layoutWorker: { messages: { type: string; token: number; result?: { digests: { result: string }; pages: { kind: string; widthMm: number; heightMm: number; unusedFraction: number; partId: string; systemCount: number | null; svg?: { ids: string[] } }[] } }[]; post(m: unknown): void };
  __preview: { root: HTMLElement; renderPreview(root: HTMLElement, result: unknown, opts: unknown): void; setZoom(root: HTMLElement, n: number): number; setView(root: HTMLElement, v: string): void; destroyPreview(root: HTMLElement): void };
}

test.setTimeout(180_000);
let token = 0;

async function open(page: Page): Promise<void> {
  const probe = await page.request.get(PAGE);
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1");
  token = 0;
  await page.route(`**${MEI_URL}`, (route) => route.fulfill({ contentType: "application/xml", body: readFileSync(`${FIXTURES}/kyrie-ix.mei`) }));
  await page.goto(PAGE);
  await expect(page.locator("#state")).toHaveAttribute("data-state", "ready");
}

/** Lay out through the real worker and return the token of the result. */
async function layout(page: Page, parts: readonly unknown[], settings: unknown): Promise<number> {
  const t = ++token;
  await page.evaluate(([tok, p, s]) => {
    (window as unknown as Harness).__layoutWorker.post({ type: "layout", request: { token: tok, title: "Kyrie", parts: p, settings: s, overrides: {} } });
  }, [t, parts, settings] as const);
  await expect.poll(() => page.evaluate((tok) => (window as unknown as Harness).__layoutWorker.messages.some((m) => m.token === tok && (m.type === "result" || m.type === "error")), t), { timeout: 90_000 }).toBe(true);
  const type = await page.evaluate((tok) => (window as unknown as Harness).__layoutWorker.messages.find((m) => m.token === tok && (m.type === "result" || m.type === "error"))?.type, t);
  expect(type).toBe("result");
  return t;
}

/** Draw the worker's result number `tok` (the live object, not a copy) into the preview. */
async function show(page: Page, tok: number, opts: Record<string, unknown> = {}): Promise<Summary> {
  return page.evaluate(([n, o]) => {
    const h = window as unknown as Harness;
    const result = h.__layoutWorker.messages.find((m) => m.token === n && m.type === "result")!.result!;
    h.__preview.renderPreview(h.__preview.root, result, { partLabels: o["partLabels"], ...o });
    return {
      pages: result.pages.map((p) => ({ kind: p.kind, widthMm: p.widthMm, heightMm: p.heightMm, unusedFraction: p.unusedFraction, partId: p.partId, systemCount: p.systemCount, ids: p.svg?.ids ?? [] })),
      digest: result.digests.result,
      json: JSON.stringify(result),
    };
  }, [tok, opts] as const);
}

async function frames(page: Page): Promise<{ w: number; h: number }[]> {
  return page.locator(".cx-page").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
}

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`preview at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("renders the real Kyrie as page frames with the right shape, labels and font", async ({ page }) => {
      await open(page);
      const tok = await layout(page, [meiPart], { ...IPAD11, maxSystems: 2 });
      const summary = await show(page, tok, { partLabels: PART_LABELS });
      const n = summary.pages.length;
      expect(n).toBeGreaterThanOrEqual(2);

      const pageEls = page.locator(".cx-page");
      await expect(pageEls).toHaveCount(n);
      const boxes = await frames(page);
      summary.pages.forEach((p, i) => {
        const ratio = boxes[i]!.w / boxes[i]!.h;
        expect(Math.abs(ratio / (p.widthMm / p.heightMm) - 1), `page ${i + 1} aspect`).toBeLessThan(0.01);
      });
      // 100% is fit width: nothing needs horizontal scrolling.
      expect(await page.locator("[data-cx-pages]").evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);

      // Labels sit outside the page; the part name only on the part's first page.
      const labels = page.locator(".cx-plabel");
      await expect(labels).toHaveCount(n);
      for (let i = 0; i < n; i++) {
        await expect(labels.nth(i)).toContainText(`Page ${i + 1} of ${n} · 11-inch iPad, portrait`);
        await expect(labels.nth(i).locator("span").last()).toHaveText(i === 0 ? "Kyrie IX" : "");
        await expect(pageEls.nth(i)).toHaveAttribute("aria-label", `Page ${i + 1} of ${n}: Kyrie IX, ${summary.pages[i]!.systemCount} system${summary.pages[i]!.systemCount === 1 ? "" : "s"}`);
        await expect(pageEls.nth(i)).toHaveAttribute("role", "img");
        expect(await labels.nth(i).evaluate((l, f) => !f.contains(l), await pageEls.nth(i).elementHandle())).toBe(true);
      }

      // Paper, ink, frame: white sheet, black ink, 1px border, no shadow.
      const style = await pageEls.first().evaluate((e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, ink: s.color, border: s.borderTopWidth, shadow: s.boxShadow, radius: s.borderTopLeftRadius }; });
      expect(style).toEqual({ bg: "rgb(255, 255, 255)", ink: "rgb(0, 0, 0)", border: "1px", shadow: "none", radius: "0px" });

      // Margin guide: dashed, aria-hidden, inset at the margin, never part of the page content.
      const guide = pageEls.first().locator(".cx-guide");
      await expect(guide).toHaveAttribute("aria-hidden", "true");
      expect(await guide.evaluate((g) => getComputedStyle(g).borderTopStyle)).toBe("dashed");
      const inset = await pageEls.first().evaluate((f) => { const g = f.querySelector(".cx-guide")!.getBoundingClientRect(); const r = f.getBoundingClientRect(); return { left: (g.left - r.left) / r.width, top: (g.top - r.top) / r.height }; });
      expect(inset.left).toBeCloseTo(4 / 157.8, 2);
      expect(inset.top).toBeCloseTo(4 / 227.1, 2);

      // Generated SVG: inside an aria-hidden holder, and only ids the sanitizer reported.
      expect(await pageEls.first().locator("[aria-hidden='true'] .cx-svg").count()).toBe(1);
      const rendered = await pageEls.nth(0).locator(".cx-svg").evaluate((h) => [...h.querySelectorAll("[id]")].map((e) => e.id));
      expect(rendered.length).toBeGreaterThan(0);
      for (const id of rendered) expect(summary.pages[0]!.ids, id).toContain(id);
      // Heading text is drawn (the PDF draws it too).
      await expect(pageEls.first().locator(".cx-line-heading")).toHaveText("Kyrie IX");

      // Lyrics are set in the bundled Liberation Serif, and the face actually loaded.
      const fonts = await page.evaluate(async () => {
        const text = document.querySelector(".cx-svg text")!;
        await document.fonts.load('16px "Liberation Serif"');
        return { family: getComputedStyle(text).fontFamily, loaded: document.fonts.check('16px "Liberation Serif"') };
      });
      expect(fonts.family).toContain("Liberation Serif");
      expect(fonts.loaded).toBe(true);

      mkdirSync(SHOTS, { recursive: true });
      await page.locator("[data-cx-preview]").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/ipad11-cap2-${vp.name}.png` });
      const letter = await layout(page, [meiPart], LETTER);
      await show(page, letter, { partLabels: PART_LABELS });
      await expect(page.locator(".cx-plabel").first()).toContainText("Letter, portrait");
      await page.screenshot({ path: `${SHOTS}/letter-${vp.name}.png` });
    });

    test("shows the blank-page note exactly where a page is over 25% unused and another follows", async ({ page }) => {
      await open(page);
      // ipad11-p-auto alone is 4+2 systems, so its only mostly-blank page is the last (no note). A cap of 2 per page
      // leaves non-final pages mostly blank, and the final one still has none.
      const tok = await layout(page, [meiPart], { ...IPAD11, maxSystems: 2 });
      const summary = await show(page, tok, { partLabels: PART_LABELS });
      const n = summary.pages.length;
      const expected = summary.pages.map((p, i) => p.unusedFraction > 0.25 && i + 1 < n && summary.pages[i + 1]!.partId === p.partId);
      expect(expected.some(Boolean), "a cap of 2 should leave a non-final page mostly blank").toBe(true);
      expect(summary.pages[n - 1]!.unusedFraction).toBeGreaterThan(0.25);
      expect(expected[n - 1]).toBe(false);
      const notes = page.locator("[data-cx-blank]");
      await expect(notes).toHaveCount(expected.filter(Boolean).length);
      for (let i = 0; i < n; i++) {
        const wrap = page.locator(`.cx-pg[data-page="${i + 1}"]`);
        await expect(wrap.locator("[data-cx-blank]")).toHaveCount(expected[i] ? 1 : 0);
        if (expected[i]) await expect(wrap.locator("[data-cx-blank]")).toHaveText(`The rest of page ${i + 1} is blank: the next system doesn't fit.`);
        await expect(wrap.locator(".cx-plabel")).toContainText("11-inch iPad, portrait");
      }
      const boxes = await frames(page);
      summary.pages.forEach((p, i) => expect(Math.abs(boxes[i]!.w / boxes[i]!.h / (p.widthMm / p.heightMm) - 1)).toBeLessThan(0.01));
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/ipad11-${vp.name}.png` });
    });
  });
}

test.describe("preview behaviour", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Continuous view crops at the same scale, adds the reading notice and separators, and leaves the result alone", async ({ page }) => {
    await open(page);
    const tok = await layout(page, [meiPart], IPAD11);
    const before = await show(page, tok, { partLabels: PART_LABELS });
    const n = before.pages.length;
    const pagesView = await frames(page);

    await page.locator(".cx-vo", { hasText: "Continuous" }).click();
    await expect(page.locator("[data-cx-preview]")).toHaveAttribute("data-view", "continuous");
    await expect(page.locator(".notice")).toHaveText("Reading view: page breaks are hidden here. The PDF uses the pages shown in Pages view.");
    await expect(page.locator(".cx-plabel")).toHaveCount(0);
    await expect(page.locator("[data-cx-blank]")).toHaveCount(0);
    await expect(page.locator(".cx-guide")).toHaveCount(0);
    await expect(page.locator(".cx-div")).toHaveCount(n - 1);
    for (let i = 1; i < n; i++) await expect(page.locator(`.cx-pg[data-page="${i + 1}"] .cx-div`)).toHaveText(`Page ${i + 1} begins`);
    const cont = await frames(page);
    expect(cont).toHaveLength(n);
    cont.forEach((c, i) => {
      expect(c.w).toBeCloseTo(pagesView[i]!.w, 0); // same scale
      expect(c.h).toBeLessThanOrEqual(pagesView[i]!.h + 0.5);
    });
    expect(cont.some((c, i) => c.h < pagesView[i]!.h - 4), "at least one page is cropped").toBe(true);
    expect(await page.locator(".cx-page").first().evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe("0px");

    const after = await page.evaluate((tok2) => {
      const r = (window as unknown as Harness).__layoutWorker.messages.find((m) => m.token === tok2 && m.type === "result")!.result!;
      return { digest: r.digests.result, json: JSON.stringify(r) };
    }, tok);
    expect(after.digest).toBe(before.digest);
    expect(after.json).toBe(before.json);

    await page.locator(".cx-vo", { hasText: "Pages" }).click();
    await expect(page.locator(".cx-plabel")).toHaveCount(n);
    mkdirSync(SHOTS, { recursive: true });
    await page.locator(".cx-vo", { hasText: "Continuous" }).click();
    await page.screenshot({ path: `${SHOTS}/continuous-1280.png` });
  });

  test("zoom changes size only, in the specified steps", async ({ page }) => {
    await open(page);
    const tok = await layout(page, [meiPart], LETTER);
    const before = await show(page, tok, { partLabels: PART_LABELS });
    const fit = await frames(page);
    const svgBefore = await page.locator(".cx-svg").first().evaluate((e) => e.innerHTML.length);
    const output = page.locator("[data-cx-zoom-value]");
    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    const zoomIn = page.getByRole("button", { name: "Zoom in" });

    await expect(output).toHaveText("100%");
    const seen: string[] = ["100%"];
    for (const [button, step] of [[zoomOut, "75%"], [zoomOut, "50%"], [zoomIn, "75%"], [zoomIn, "100%"], [zoomIn, "125%"], [zoomIn, "150%"], [zoomIn, "200%"], [zoomIn, "300%"]] as const) {
      await button.click();
      await expect(output).toHaveText(step);
      seen.push(step);
      const f = await frames(page);
      expect(f).toHaveLength(fit.length);
      const scale = Number.parseInt(step, 10) / 100;
      f.forEach((b, i) => {
        expect(b.w).toBeCloseTo(fit[i]!.w * scale, 0);
        expect(Math.abs(b.w / b.h / (fit[i]!.w / fit[i]!.h) - 1)).toBeLessThan(0.01);
      });
    }
    await expect(zoomIn).toBeDisabled();
    await page.getByRole("button", { name: "Fit width" }).click();
    await expect(output).toHaveText("100%");
    expect((await frames(page))[0]!.w).toBeCloseTo(fit[0]!.w, 0);

    // Size only: the same DOM subtree, result and digest.
    expect(await page.locator(".cx-svg").first().evaluate((e) => e.innerHTML.length)).toBe(svgBefore);
    const digest = await page.evaluate((t2) => (window as unknown as Harness).__layoutWorker.messages.find((m) => m.token === t2 && m.type === "result")!.result!.digests.result, tok);
    expect(digest).toBe(before.digest);
    // Pinch zoom stays available: no touch-action override on the pane.
    expect(await page.locator("[data-cx-pages]").evaluate((e) => getComputedStyle(e).touchAction)).toBe("auto");
    expect(seen).toEqual(["100%", "75%", "50%", "75%", "100%", "125%", "150%", "200%", "300%"]);

    mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => { const h = window as unknown as Harness; h.__preview.setZoom(h.__preview.root, 50); });
    await page.screenshot({ path: `${SHOTS}/zoom50-1280.png` });
  });

  test("keeps showing the previous result at full opacity while updating", async ({ page }) => {
    await open(page);
    const first = await layout(page, [meiPart], LETTER);
    await show(page, first, { partLabels: PART_LABELS });
    const count = await page.locator(".cx-page").count();
    await page.evaluate(() => {
      const h = window as unknown as Harness;
      const m = h.__layoutWorker.messages.find((x) => x.type === "result")!;
      h.__preview.renderPreview(h.__preview.root, null, { previous: m.result, updating: true, partLabels: { "kyrie:0": "Kyrie IX" } });
    });
    await expect(page.locator(".cx-page")).toHaveCount(count);
    await expect(page.locator("[data-cx-updating]")).toBeVisible();
    await expect(page.locator("[data-cx-updating]")).toHaveText("Updating preview…");
    const opacity = await page.locator("[data-cx-pages]").evaluate((e) => [e, ...e.querySelectorAll("*")].every((n) => getComputedStyle(n).opacity === "1"));
    expect(opacity).toBe(true);
    await page.evaluate(() => { const h = window as unknown as Harness; h.__preview.renderPreview(h.__preview.root, (h.__layoutWorker.messages.find((x) => x.type === "result")!.result), { updating: false }); });
    await expect(page.locator("[data-cx-updating]")).toBeHidden();
  });

  test("draws scan pages as images at their rectangles with alt text", async ({ page }) => {
    await open(page);
    await page.route(`**${SCAN_STEM}*@2x.png`, (route) => route.fulfill({ contentType: "image/png", body: PNG_1X1 }));
    const rect = { xMm: 20, yMm: 30, widthMm: 100, heightMm: 40 };
    await page.evaluate(([stem, r]) => {
      const h = window as unknown as Harness;
      const printable = { xMm: 12, yMm: 12, widthMm: 191.9, heightMm: 255.4 };
      const result = {
        token: 1, partIds: ["gloria:0"], digests: {}, effectiveBreaks: [], diagnostics: [], complete: true,
        pages: [{
          kind: "scan", index: 0, widthMm: 215.9, heightMm: 279.4, partId: "gloria:0", printable, content: printable,
          heading: null, footer: null, unusedFraction: 0.5, systemCount: 2,
          images: [{ stem: `${stem}-1`, rect: r, pxWidth: 1, pxHeight: 1 }, { stem: `${stem}-2`, rect: { ...r, yMm: 80 }, pxWidth: 1, pxHeight: 1 }],
        }],
      };
      h.__preview.renderPreview(h.__preview.root, result, { partLabels: { "gloria:0": "Gloria" } });
    }, [SCAN_STEM, rect] as const);
    const imgs = page.locator(".cx-page img");
    await expect(imgs).toHaveCount(2);
    await expect(page.locator(".cx-page")).toHaveAttribute("aria-label", "Page 1 of 1: Gloria, 2 systems");
    await expect(imgs.first()).toHaveAttribute("src", `${SCAN_STEM}-1@2x.png`);
    expect(await imgs.first().getAttribute("alt")).toMatch(/^Original scan of Gloria, system 1 of 2/);
    const geo = await page.locator(".cx-page").evaluate((f) => {
      const r = f.getBoundingClientRect(); const i = f.querySelector("img")!.getBoundingClientRect();
      return { x: (i.left - r.left) / r.width, y: (i.top - r.top) / r.height, w: i.width / r.width };
    });
    expect(geo.x).toBeCloseTo(20 / 215.9, 2);
    expect(geo.y).toBeCloseTo(30 / 279.4, 2);
    expect(geo.w).toBeCloseTo(100 / 215.9, 2);
  });

  test("renders a fixed typeset page lazily as an img from a blob URL and revokes it when replaced", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`); });
    page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
    await open(page);

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    const sheet = pdf.addPage([612, 792]);
    sheet.drawText("Credo (fixed layout)", { x: 72, y: 700, size: 24, font });
    const pdfBytes = Buffer.from(await pdf.save());
    await page.route(`**${FIXED_URL}`, (route) => route.fulfill({ contentType: "application/pdf", body: pdfBytes }));

    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    // A failed draw surfaces as a console error naming the code, so the problems filter below catches it.
    await page.evaluate(() => { (window as unknown as Harness).__preview.root.addEventListener("cx-preview-error", (e) => { console.error("PREVIEW-ERROR " + JSON.stringify((e as CustomEvent).detail)); }); });
    const tok = await layout(page, [fixedPart], LETTER);
    // Laying out alone must not load pdf.js; only drawing a fixed page does.
    expect(requested.filter((u) => /pdf\.worker|pdfjs/.test(u))).toEqual([]);

    const summary = await show(page, tok, { partLabels: PART_LABELS });
    expect(summary.pages.map((p) => p.kind)).toEqual(["fixed"]);
    const img = page.locator(".cx-fixed img");
    await expect(img).toHaveCount(1, { timeout: 60_000 });
    await expect(page.locator(".cx-fixed")).toHaveAttribute("data-state", "ready");
    const src = await img.getAttribute("src");
    expect(src).toMatch(/^blob:/);
    const natural = await img.evaluate((i) => new Promise<{ w: number; h: number }>((res) => {
      const el = i as HTMLImageElement;
      const done = (): void => res({ w: el.naturalWidth, h: el.naturalHeight });
      if (el.complete) done(); else el.addEventListener("load", done, { once: true });
    }));
    expect(natural.w).toBeGreaterThan(0);
    expect(natural.h).toBeGreaterThan(0);
    // The image is the page: letter aspect, within 1%.
    expect(Math.abs(natural.w / natural.h / (215.9 / 279.4) - 1)).toBeLessThan(0.01);
    expect(requested.some((u) => /pdf\.worker/.test(u)), "pdf.js worker was requested").toBe(true);

    await expect(page.locator(".cx-plabel")).toContainText("Page 1 of 1 · Letter, portrait");
    await expect(page.locator(".cx-plabel .sub")).toHaveText("Fixed typeset layout");
    await expect(page.locator(".cx-page")).toHaveAttribute("aria-label", "Page 1 of 1: Credo, fixed typeset layout");
    await expect(page.locator("[data-cx-blank]")).toHaveCount(0);

    // Not blank: the drawn page has dark ink on it.
    const inked = await img.evaluate((i) => {
      const el = i as HTMLImageElement; const c = document.createElement("canvas"); c.width = el.naturalWidth; c.height = el.naturalHeight;
      const ctx = c.getContext("2d")!; ctx.drawImage(el, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height).data.some((v, k) => k % 4 === 0 && v < 100);
    });
    expect(inked).toBe(true);

    // Same page redrawn (view toggle) reuses the blob; a different result revokes it.
    await page.locator(".cx-vo", { hasText: "Continuous" }).click();
    expect(await page.locator(".cx-fixed img").getAttribute("src")).toBe(src);
    const revoked = await page.evaluate(async (url) => {
      const h = window as unknown as Harness;
      h.__preview.setView(h.__preview.root, "pages");
      h.__preview.renderPreview(h.__preview.root, { token: 9, partIds: [], digests: {}, effectiveBreaks: [], diagnostics: [], complete: true, pages: [] }, {});
      try { await fetch(url!); return false; } catch { return true; }
    }, src);
    expect(revoked).toBe(true);
    console.log(`fixed-preview browser problems: ${JSON.stringify(problems)}`);
    expect(problems.filter((p) => /pdf|worker|PREVIEW-ERROR/i.test(p))).toEqual([]);

    mkdirSync(SHOTS, { recursive: true });
    await page.evaluate((t3) => { const h = window as unknown as Harness; const m = h.__layoutWorker.messages.find((x) => x.token === t3 && x.type === "result")!; h.__preview.renderPreview(h.__preview.root, m.result, { partLabels: { "credo:1": "Credo" } }); }, tok);
    await expect(page.locator(".cx-fixed img")).toHaveCount(1, { timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/fixed-1280.png` });
  });
});
