// Real-browser tests of the export editor dialog (B8b), with the real layout and PDF workers.
//
// Needs the gated test page:
//   E2E_TEST_PAGES=1 PUBLIC_ASSET_BASE=/systems pnpm exec astro build
// A normal build does not emit it and these tests skip. Screenshots go to <repo>/build/b8b/.
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const FIXTURES = "src/lib/export-layout/__fixtures__";
const PAGE = "/e2e/export-layout-worker/";
const MEI_URL = "/__e2e__/kyrie-ix.mei";
const SHOTS = resolve(process.cwd(), "..", "build", "b8b");
const SENTINEL = "SENTINEL-detail-b8b-7c2e";

interface Manifest { readonly parts: readonly Record<string, unknown>[] }
const entry = (JSON.parse(readFileSync(`${FIXTURES}/manifest.fixture.json`, "utf8")) as Manifest).parts[0] as Record<string, unknown>;
const meiPart = {
  id: "kyrie:0", kind: "mei", label: "Kyrie IX",
  heading: { label: "Kyrie IX", rubric: "Lord, have mercy", rubricTranslation: null, credit: "Nova Organi Harmonia" },
  sourceSystemCount: 5, sourceRevision: entry["renderHash"], target: entry["target"], renderHash: entry["renderHash"],
  conversion: { ...entry, meiUrl: MEI_URL },
};

interface Summary {
  phase: string; canDownload: boolean; canUndo: boolean; token: number; requestToken: number;
  settings: { page: string; staff: string; lyrics: string; orientation: string; marginMm: number; maxSystems: number | null; linePolicy: string; customSize: { widthMm: number; heightMm: number } | null };
  pages: { widthMm: number; heightMm: number; systemCount: number | null }[];
}
interface Handle { controller: { subscribe(l: (s: unknown) => void): () => void }; dialog: HTMLDialogElement }
interface Win {
  __openEditor(parts: unknown[], title: string): Promise<Handle>;
  __editor?: Handle;
  __editorFaults: { error: unknown };
}

test.setTimeout(240_000);

async function openEditor(page: Page): Promise<void> {
  const probe = await page.request.get(PAGE);
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1");
  await page.route(`**${MEI_URL}`, (route) => route.fulfill({ contentType: "application/xml", body: readFileSync(`${FIXTURES}/kyrie-ix.mei`) }));
  await page.goto(PAGE);
  await expect(page.locator("#state")).toHaveAttribute("data-state", "ready");
  await launch(page);
  await ready(page);
}

async function launch(page: Page): Promise<void> {
  await page.locator("#export-customize").focus();
  await page.evaluate(async (part) => {
    const w = window as unknown as Win;
    w.__editor = await w.__openEditor([part], "Missa IX · Kyrie");
  }, meiPart);
}

/** The preview inside the dialog has drawn pages and the controller is ready. */
async function ready(page: Page): Promise<void> {
  await expect.poll(async () => (await summary(page)).canDownload, { timeout: 120_000 }).toBe(true);
  await expect(page.locator("dialog.cx .cx-page").first()).toBeVisible();
}

async function summary(page: Page): Promise<Summary> {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    let out: Summary | null = null;
    w.__editor!.controller.subscribe((s) => {
      const st = s as { phase: string; canDownload: boolean; canUndo: boolean; requestToken: number; settings: Summary["settings"]; result: { token: number; pages: Summary["pages"] } | null };
      out = {
        phase: st.phase, canDownload: st.canDownload, canUndo: st.canUndo, requestToken: st.requestToken, token: st.result?.token ?? -1, settings: st.settings,
        pages: (st.result?.pages ?? []).map((p) => ({ widthMm: p.widthMm, heightMm: p.heightMm, systemCount: p.systemCount })),
      };
    })();
    return out!;
  });
}

const input = (page: Page, name: string, value: string) => page.locator(`dialog.cx input[name="${name}"][value="${value}"]`);
/** Click the visible span of a segmented option (the radio itself is visually hidden). */
async function choose(page: Page, name: string, value: string): Promise<void> {
  await input(page, name, value).locator("xpath=..").click();
}
async function settle(page: Page, afterToken: number): Promise<Summary> {
  await expect.poll(async () => { const s = await summary(page); return s.canDownload && s.token > afterToken; }, { timeout: 120_000 }).toBe(true);
  return summary(page);
}

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`editor at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    const narrow = vp.width < 992;

    test("opens as a modal dialog, focuses the title, and closes by Esc, Close and browser Back, returning focus", async ({ page }) => {
      await openEditor(page);
      const dialog = page.locator("dialog.cx");
      await expect(dialog).toHaveAttribute("open", "");
      expect(await dialog.evaluate((d) => (d as HTMLDialogElement).matches(":modal"))).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("cx-title");
      await expect(page.locator("#cx-title")).toHaveText("Customize export");
      await expect(page.locator("#cx-sel")).toHaveText("Missa IX · Kyrie");
      expect(new URL(page.url()).hash).toBe("#customize-export");

      await page.keyboard.press("Escape");
      await expect(dialog).not.toHaveAttribute("open", "");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("export-customize");
      await expect.poll(() => new URL(page.url()).hash).toBe("");

      await launch(page);
      await expect(dialog).toHaveAttribute("open", "");
      await page.getByRole("button", { name: "Close" }).click();
      await expect(dialog).not.toHaveAttribute("open", "");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("export-customize");
      await expect.poll(() => new URL(page.url()).hash).toBe("");

      await launch(page);
      await expect(dialog).toHaveAttribute("open", "");
      await page.goBack();
      await expect(dialog).not.toHaveAttribute("open", "");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("export-customize");
      expect(new URL(page.url()).pathname).toBe(PAGE);
    });

    test("every interactive target is at least 44 px", async ({ page }) => {
      await openEditor(page);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const sel = "dialog.cx button, dialog.cx .seg-o > span, dialog.cx input.cx-num, dialog.cx input[type=number], dialog.cx summary, dialog.cx a";
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName} ${el.className} ${el.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      expect(small).toEqual([]);
    });

    if (narrow) {
      test("shows the first page without scrolling, and the Settings panel opens, closes by Esc then Done, and returns focus", async ({ page }) => {
        await openEditor(page);
        const first = page.locator("dialog.cx .cx-page").first();
        const box = (await first.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + 80).toBeLessThan(vp.height); // the page's top edge is on screen
        await expect(page.locator("dialog.cx .cx-fit")).toBeVisible();
        const strip = (await page.locator("dialog.cx .cx-fit").boundingBox())!;
        expect(strip.height).toBeLessThanOrEqual(vp.width === 768 ? 120 : 170);
        await expect(page.locator("dialog.cx [data-cx=settings]")).toBeHidden();
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/editor-${vp.name}.png` });

        const btn = page.locator("dialog.cx [data-cx=settings-btn]");
        await btn.click();
        const panel = page.locator("dialog.cx [data-cx=settings]");
        await expect(panel).toBeVisible();
        await expect(btn).toHaveAttribute("aria-expanded", "true");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-cx"))).toBe("settings");
        await expect(page.locator('dialog.cx input[name="cx-tier"]').first()).toBeVisible();
        const pb = (await panel.boundingBox())!;
        if (vp.width >= 640) {
          expect(pb.x + pb.width).toBeGreaterThanOrEqual(vp.width - 1);
          const pv = (await page.locator("dialog.cx .cx-preview").boundingBox())!;
          expect(pv.x + pv.width).toBeLessThanOrEqual(pb.x + 1); // preview stays visible beside the panel
        } else {
          expect(pb.y + pb.height).toBeGreaterThanOrEqual(vp.height - 1); // bottom sheet
          expect(pb.height).toBeLessThanOrEqual(vp.height * 0.85 + 1);
        }
        await page.screenshot({ path: `${SHOTS}/panel-${vp.name}.png` });

        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-cx"))).toBe("settings-btn");
        await btn.click();
        await expect(panel).toBeVisible();
        await page.getByRole("button", { name: "Done" }).click();
        await expect(panel).toBeHidden();
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-cx"))).toBe("settings-btn");
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog.cx")).not.toHaveAttribute("open", "");
      });
    } else {
      test("lays out two columns with FIT first and the page controls always visible", async ({ page }) => {
        await openEditor(page);
        await expect(page.locator("dialog.cx [data-cx=settings-btn]")).toBeHidden();
        const fit = (await page.locator("dialog.cx .cx-fit").boundingBox())!;
        const prev = (await page.locator("dialog.cx .cx-preview").boundingBox())!;
        expect(fit.width).toBeCloseTo(320, 0);
        expect(prev.x).toBeGreaterThanOrEqual(fit.x + fit.width - 1);
        await expect(page.locator('dialog.cx input[name="cx-tier"]').first()).toBeAttached();
        await expect(page.getByText("Choose where systems break")).toBeVisible();
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/editor-${vp.name}.png` });
      });
    }
  });
}

test.describe("editor controls", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Music size Large reflows with a 9.6 mm staff, and the iPad preset sets 157.8 x 227.1 mm and a 4 mm margin", async ({ page }) => {
    await openEditor(page);
    const s0 = await summary(page);
    expect(s0.settings.staff).toBe("medium");
    await choose(page, "cx-staff", "large");
    const s1 = await settle(page, s0.token);
    expect(s1.settings.staff).toBe("large");
    // Measure the staff on the drawn page: height of one g.staff in mm.
    const staffMm = await page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>("dialog.cx .cx-page")!;
      const pageW = Number(frame.dataset["widthMm"]);
      // The five staff lines are the direct <path> children of g.staff (notes live in a nested layer).
      const lines = [...frame.querySelector(".cx-svg g.staff")!.querySelectorAll(":scope > path")].map((l) => l.getBoundingClientRect());
      const span = Math.max(...lines.map((l) => l.bottom)) - Math.min(...lines.map((l) => l.top));
      return (span / frame.getBoundingClientRect().width) * pageW;
    });
    expect(Math.abs(staffMm - 9.6)).toBeLessThan(0.5);

    await choose(page, "cx-tier", "ipad");
    const s2 = await settle(page, s1.token);
    expect(s2.settings.page).toBe("ipad-11");
    expect(s2.settings.marginMm).toBe(4);
    for (const p of s2.pages) { expect(p.widthMm).toBeCloseTo(157.8, 1); expect(p.heightMm).toBeCloseTo(227.1, 1); }
    await expect(page.locator("dialog.cx .cx-plabel").first()).toContainText("11-inch iPad, portrait");
    await expect(page.locator('dialog.cx [data-cx="margin"]')).toHaveValue("4");
    await expect(page.locator("dialog.cx #cx-status")).toBeAttached();
  });

  test("the Systems stepper reads As many as fit (now N), lowers the cap, and returns to As many as fit", async ({ page }) => {
    await openEditor(page);
    await choose(page, "cx-tier", "ipad");
    const s = await settle(page, (await summary(page)).token);
    const now = Math.max(...s.pages.map((p) => p.systemCount ?? 0));
    const value = page.locator('dialog.cx [data-cx="cap-value"]');
    const minus = page.locator('dialog.cx [data-cx="cap-minus"]');
    const plus = page.locator('dialog.cx [data-cx="cap-plus"]');
    await expect(value).toHaveText(`As many as fit (now ${now})`);
    await expect(plus).toBeDisabled();
    await expect(plus).toHaveAttribute("aria-label", "Already as many as fit");
    await expect(minus).toHaveAttribute("aria-label", "Fewer systems per page");

    await minus.click();
    await expect(value).toHaveText(String(now - 1));
    const s2 = await settle(page, s.token);
    expect(s2.settings.maxSystems).toBe(now - 1);
    expect(Math.max(...s2.pages.map((p) => p.systemCount ?? 0))).toBeLessThanOrEqual(now - 1);
    await expect(plus).toBeEnabled();
    await expect(plus).toHaveAttribute("aria-label", "More systems per page");
    await plus.click(); // back to the natural fit
    await expect(value).toHaveText(String(now));
    await plus.click(); // past it: As many as fit
    const s3 = await settle(page, s2.token);
    expect(s3.settings.maxSystems).toBeNull();
    await expect(value).toHaveText(`As many as fit (now ${now})`);
  });

  test("Custom size validates inline and keeps the last valid layout", async ({ page }) => {
    await openEditor(page);
    await choose(page, "cx-tier", "custom");
    const s1 = await settle(page, (await summary(page)).token);
    expect(s1.settings.page).toBe("custom");
    const w = page.locator('dialog.cx [data-cx="custom-w"]');
    const h = page.locator('dialog.cx [data-cx="custom-h"]');
    const err = page.locator('dialog.cx [data-cx="custom-error"]');
    await expect(w).toHaveValue("215.9");
    await expect(h).toHaveValue("279.4");
    await expect(page.locator('dialog.cx [data-cx="page-help"]')).toHaveText("90–450 mm (3.5–17.7 in) each side.");

    await w.fill("50");
    await w.press("Tab");
    await expect(err).toBeVisible();
    await expect(err).toHaveText("Use a width between 90 and 450 mm (3.5–17.7 in).");
    await expect(w).toHaveAttribute("aria-invalid", "true");
    await w.fill("abc");
    await w.press("Tab");
    await expect(err).toHaveText("Enter a number.");
    await w.fill("90");
    await w.press("Tab");
    await expect(err).toHaveText("The long side can be at most three times the short side.");
    const kept = await summary(page);
    expect(kept.settings.customSize).toEqual(s1.settings.customSize);
    expect(kept.token).toBe(s1.token);
    expect(kept.pages[0]!.widthMm).toBeCloseTo(215.9, 1);
    await expect(page.locator("dialog.cx .cx-page").first()).toBeVisible();

    await w.fill("160");
    await h.fill("230");
    await h.press("Tab");
    await expect(err).toBeHidden();
    const s2 = await settle(page, s1.token);
    expect(s2.settings.customSize).toEqual({ widthMm: 160, heightMm: 230 });
    expect(s2.pages[0]!.widthMm).toBeCloseTo(160, 1);
    expect(s2.pages[0]!.heightMm).toBeCloseTo(230, 1);

    await choose(page, "cx-unit", "in");
    await expect(w).toHaveValue("6.3");
    await expect(h).toHaveValue("9.06");
  });

  test("Reset keeps page and orientation but restores the rest; Undo brings the settings back", async ({ page }) => {
    await openEditor(page);
    await choose(page, "cx-tier", "ipad");
    await settle(page, (await summary(page)).token);
    await choose(page, "cx-orient", "landscape");
    await choose(page, "cx-staff", "large");
    const s1 = await settle(page, (await summary(page)).token);
    expect(s1.settings).toMatchObject({ page: "ipad-11", orientation: "landscape", staff: "large" });
    await page.locator("dialog.cx summary", { hasText: "More options" }).click();
    await choose(page, "cx-lyrics", "large");
    const s2 = await settle(page, s1.token);
    expect(s2.settings.lyrics).toBe("large");
    await expect(page.locator('dialog.cx [data-cx="undo"]')).toBeHidden();

    await page.getByRole("button", { name: "Reset layout" }).click();
    const s3 = await settle(page, s2.token);
    expect(s3.settings).toMatchObject({ page: "ipad-11", orientation: "landscape", staff: "medium", lyrics: "medium", maxSystems: null });
    const undo = page.locator('dialog.cx [data-cx="undo"]');
    await expect(undo).toBeVisible();
    await undo.click();
    const s4 = await settle(page, s3.token);
    expect(s4.settings).toMatchObject({ page: "ipad-11", orientation: "landscape", staff: "large", lyrics: "large" });
    // Ctrl/Cmd+Z with focus outside a text field undoes too.
    await page.getByRole("button", { name: "Reset layout" }).click();
    const s5 = await settle(page, s4.token);
    expect(s5.settings.staff).toBe("medium");
    await page.locator("#cx-title").focus();
    await page.keyboard.press("ControlOrMeta+z");
    const s6 = await settle(page, s5.token);
    expect(s6.settings.staff).toBe("large");
  });

  test("Download PDF produces a real PDF with the iPad page size and the previewed page count", async ({ page }) => {
    await openEditor(page);
    await choose(page, "cx-tier", "ipad");
    const s = await settle(page, (await summary(page)).token);
    const n = s.pages.length;
    const button = page.locator('dialog.cx [data-cx="download"]');
    await expect(button).toHaveText(`Download PDF · ${n} page${n === 1 ? "" : "s"}`);
    await expect(button).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), button.click()]);
    expect(download.suggestedFilename()).toBe("Missa IX · Kyrie (11-inch iPad).pdf");
    const path = await download.path();
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(n);
    const box = doc.getPage(0).getMediaBox();
    expect(Math.abs(box.width - (157.8 * 72) / 25.4)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.height - (227.1 * 72) / 25.4)).toBeLessThanOrEqual(0.5);
    await expect(page.locator("dialog.cx #cx-status")).toContainText(`PDF downloaded: ${n} page`);
    await expect(button).toBeEnabled();
  });

  test("an injected layout error shows the deck copy and actions, never the diagnostic detail", async ({ page }) => {
    await openEditor(page);
    const s0 = await summary(page);
    await page.evaluate((detail) => {
      (window as unknown as Win).__editorFaults.error = {
        code: "UNSATISFIABLE_LAYOUT", severity: "error", partId: "kyrie:0", pageIndex: null, boundaryIds: [],
        reason: "system-too-tall", suggestions: ["smaller-music", "landscape"], detail,
      };
    }, SENTINEL);
    await choose(page, "cx-staff", "large");
    const notice = page.locator("dialog.cx .notice[data-code=UNSATISFIABLE_LAYOUT]");
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice.locator("p")).toHaveText("Can't fit Kyrie IX: at Large music size, one system is taller than the space on a Letter portrait page.");
    await expect(notice.getByRole("button")).toHaveText(["Use Medium music", "Switch to landscape"]);
    await expect(page.locator("dialog.cx #cx-status")).toHaveText("Can't lay out Kyrie IX with these settings.");
    await expect(page.locator('dialog.cx [data-cx="download"]')).toBeDisabled();
    await expect(page.locator("dialog.cx .cx-page").first()).toBeVisible(); // the previous good preview stays
    expect(await page.locator("dialog.cx [role=alert]").count()).toBe(0); // a part error is not a global alert
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(SENTINEL);
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(SENTINEL);

    await page.evaluate(() => { (window as unknown as Win).__editorFaults.error = null; });
    await notice.getByRole("button", { name: "Use Medium music" }).click();
    await settle(page, s0.token);
    await expect(notice).toHaveCount(0);
    expect((await summary(page)).settings.staff).toBe("medium");
  });

  test("a global error gets one role=alert paragraph and nothing on the status line", async ({ page }) => {
    await openEditor(page);
    await page.evaluate((detail) => {
      (window as unknown as Win).__editorFaults.error = { code: "RENDERER_LOAD_FAILED", severity: "error", partId: null, pageIndex: null, boundaryIds: [], reason: null, suggestions: [], detail };
    }, SENTINEL);
    await choose(page, "cx-staff", "small");
    const alert = page.locator("dialog.cx [role=alert]");
    await expect(alert).toHaveCount(1, { timeout: 60_000 });
    await expect(alert).toHaveText("Can't update the preview. The layout tools couldn't start in this browser.");
    await expect(page.locator("dialog.cx .notice").getByRole("button")).toHaveText(["Try again", "Use original layout"]);
    expect(await page.locator("dialog.cx #cx-status").innerText()).not.toContain("layout tools");
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(SENTINEL);
    // Use original layout closes the editor and says so on the page.
    await page.getByRole("button", { name: "Use original layout" }).click();
    await expect(page.locator("dialog.cx")).not.toHaveAttribute("open", "");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("export-btn");
    await expect(page.locator("#export-status")).toHaveText("Custom layout closed. Export PDF uses the original layout.");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("export-btn");
  });
});
