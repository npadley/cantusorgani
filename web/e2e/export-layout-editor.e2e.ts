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
        await expect(page.getByRole("button", { name: "Choose where systems break" })).toBeVisible();
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

// ------------------------------------------------------------ break editing ---
const BREAK_VIEWPORTS = [
  { name: "1280", width: 1280, height: 800 },
  { name: "390", width: 390, height: 844 },
] as const;
const SHOTS_C = resolve(process.cwd(), "..", "build", "b8c");
const SHOTS_C2 = resolve(process.cwd(), "..", "build", "b8c2");

interface Pack { phase: string; systems: number; pages: number; digest: string; breaks: { boundaryId: string; kind: string; origin: string }[] }
async function pack(page: Page): Promise<Pack> {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    let out: Pack | null = null;
    w.__editor!.controller.subscribe((s) => {
      const st = s as { phase: string; result: { digests: { result: string }; pages: { systemCount: number | null }[]; effectiveBreaks: { breaks: { boundaryId: string; kind: string; origin: string }[] }[] } | null };
      out = {
        phase: st.phase, pages: st.result?.pages.length ?? 0, digest: st.result?.digests.result ?? "",
        systems: (st.result?.pages ?? []).reduce((n, p) => n + (p.systemCount ?? 0), 0),
        breaks: (st.result?.effectiveBreaks ?? []).flatMap((e) => e.breaks),
      };
    })();
    return out!;
  });
}
async function settleResult(page: Page, previousDigest: string): Promise<Pack> {
  await expect.poll(async () => { const p = await pack(page); return p.phase === "ready" && p.digest !== previousDigest && p.digest !== ""; }, { timeout: 120_000 }).toBe(true);
  return pack(page);
}

for (const vp of BREAK_VIEWPORTS) {
  test.describe(`break editing at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    const narrow = vp.width < 992;
    const handles = (page: Page) => page.locator("dialog.cx .cx-bp:not([hidden])");

    async function modeOn(page: Page): Promise<void> {
      if (narrow) await page.locator('dialog.cx [data-cx="settings-btn"]').click();
      await page.locator('dialog.cx [data-cx="break-mode"]').click();
      await expect(page.locator('dialog.cx [data-cx="break-mode"]')).toHaveAttribute("aria-pressed", "true");
      await expect(handles(page).first()).toBeVisible();
    }
    /** A visible handle of the given kind, deep enough in the piece to be a mid-line point. */
    async function pick(page: Page, kind: string, nth = 1): Promise<string> {
      const list = page.locator(`dialog.cx .cx-bp:not([hidden])[data-kind="${kind}"]`);
      await expect.poll(() => list.count()).toBeGreaterThan(nth);
      return (await list.nth(nth).getAttribute("data-boundary"))!;
    }
    const byId = (page: Page, id: string) => page.locator(`dialog.cx .cx-bp[data-boundary="${id}"]`);

    test("shows labelled handles with 44 px hit areas and a roving tab stop, and keeps overlay markup out of the layout result", async ({ page }) => {
      await openEditor(page);
      if (narrow) await expect(page.locator('dialog.cx [data-cx="settings-btn"]')).toBeVisible();
      await modeOn(page);
      expect(await page.evaluate(() => document.activeElement?.classList.contains("cx-bp"))).toBe(true); // focus moved to the first handle
      if (narrow) await expect(page.locator('dialog.cx [data-cx="settings"]')).toBeHidden();
      await expect(page.locator("dialog.cx #cx-status")).toHaveText("Break points shown. Select one to start a new system or page there.");

      const first = handles(page).first();
      expect(await first.getAttribute("aria-label")).toMatch(/^Break point \d+ of \d+ in Kyrie IX, after '.+', page 1\. Now: (no break|original line break)\.$/);
      const sizes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("dialog.cx .cx-bp:not([hidden])")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      expect(sizes.length).toBeGreaterThan(3);
      for (const [w, h] of sizes) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
      await expect(page.locator('dialog.cx .cx-bp[data-kind="orig"]').first()).toHaveAttribute("aria-label", /Now: original line break\.$/);

      // One tab stop per page section.
      const stops = await page.evaluate(() => [...document.querySelectorAll("dialog.cx .cx-overlay")].map((o) => o.querySelectorAll('.cx-bp[tabindex="0"]').length));
      expect(stops.length).toBeGreaterThan(0);
      for (const n of stops) expect(n).toBe(1);

      // Roving focus: arrows, Home, End.
      const idAt = () => page.evaluate(() => (document.activeElement as HTMLElement).dataset["boundary"]);
      const start = await idAt();
      await page.keyboard.press("ArrowRight");
      const second = await idAt();
      expect(second).not.toBe(start);
      await page.keyboard.press("ArrowLeft");
      expect(await idAt()).toBe(start);
      await page.keyboard.press("End");
      const last = await idAt();
      await page.keyboard.press("Home");
      expect(await idAt()).toBe(start);
      expect(last).not.toBe(start);
      expect(await page.evaluate(() => document.querySelectorAll('dialog.cx .cx-bp[tabindex="0"]').length)).toBe(1);

      // Overlays are in the preview only: not inside the sheet, and never in the result's SVG.
      expect(await page.locator("dialog.cx .cx-sheet .cx-overlay, dialog.cx .cx-svg .cx-bp").count()).toBe(0);
      const leaked = await page.evaluate(() => {
        let svgs: string[] = [];
        (window as unknown as Win).__editor!.controller.subscribe((s) => {
          const st = s as { result: { pages: { svg?: { svg: string; ids: string[] } }[] } | null };
          svgs = (st.result?.pages ?? []).flatMap((p) => (p.svg ? [p.svg.svg, ...p.svg.ids] : []));
        })();
        return svgs.filter((x) => /cx-(overlay|bp|bpline|menu|bplab)|data-boundary|aria-haspopup/.test(x)).length;
      });
      expect(leaked).toBe(0);
      mkdirSync(SHOTS_C, { recursive: true });
      mkdirSync(SHOTS_C2, { recursive: true });
      if (!narrow) await page.screenshot({ path: `${SHOTS_C}/break-mode-${vp.name}.png` });

      // Esc on a handle leaves the overlay without closing the dialog.
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-cx"))).toBe(narrow ? "break-done" : "break-mode");
    });

    test("adds a page break by keyboard, sees the page count and the PDF change, then undoes it with Ctrl/Cmd+Z", async ({ page }) => {
      await openEditor(page);
      const before = await pack(page);
      await modeOn(page);
      const id = await pick(page, "none", 3);
      await byId(page, id).focus();
      await page.keyboard.press("Enter");
      const menu = page.locator("dialog.cx .cx-menu");
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute("role", "group");
      await expect(menu.locator("#cx-menu-title")).toContainText("break point");
      await expect(menu.getByRole("button")).toHaveText(["◀", "▶", "Cancel", "Start new system here", "Start new page here"]);
      await expect(menu.getByRole("button", { name: "Previous break point" })).toBeVisible();
      await expect(menu.getByRole("button", { name: "Next break point" })).toBeVisible();
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-m"))).toBe("system");
      if (narrow) {
        const mb = (await menu.boundingBox())!;
        const fb = (await page.locator("dialog.cx .cx-foot").boundingBox())!;
        expect(mb.y + mb.height).toBeLessThanOrEqual(fb.y + 1); // above the footer
        expect(mb.width).toBeGreaterThanOrEqual(vp.width - 2);
        await page.screenshot({ path: `${SHOTS_C}/break-menu-${vp.name}.png` });
      }
      await page.keyboard.press("Escape"); // closes the menu, back to the handle
      await expect(menu).toHaveCount(0);
      expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset["boundary"])).toBe(id);
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Start new page here" }).focus();
      await page.keyboard.press("Enter");

      const after = await settleResult(page, before.digest);
      expect(after.pages).toBe(before.pages + 1);
      expect(after.breaks.find((b) => b.boundaryId === id)).toMatchObject({ kind: "page", origin: "user" });
      await expect(menu).toHaveCount(0);
      // Focus returns to the same handle, now a page break.
      await expect(byId(page, id)).toBeFocused();
      await expect(byId(page, id)).toHaveAttribute("data-kind", "page");
      await expect(byId(page, id)).toHaveAttribute("aria-label", /Now: your new page\.$/);
      await expect(page.locator("dialog.cx #cx-status")).toContainText("New page starts after");
      await expect(page.locator("dialog.cx #cx-status")).toContainText("Undo is available.");
      await expect(page.locator('dialog.cx [data-cx="undo"]')).toBeVisible();
      await expect(page.locator('dialog.cx [data-cx="break-count"]').or(page.locator("dialog.cx .cx-help", { hasText: "of your breaks" })).first()).toBeAttached();
      await expect(page.locator("dialog.cx .cx-page")).toHaveCount(after.pages);

      // The downloaded PDF has the new page.
      const button = page.locator('dialog.cx [data-cx="download"]');
      await expect(button).toHaveText(`Download PDF · ${after.pages} pages`);
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), button.click()]);
      const doc = await PDFDocument.load(readFileSync(await download.path()), { updateMetadata: false });
      expect(doc.getPageCount()).toBe(after.pages);
      await expect(button).toBeEnabled({ timeout: 60_000 });

      // Undo with the keyboard (focus is on a handle, not in a text field).
      await byId(page, id).focus();
      await page.keyboard.press("ControlOrMeta+z");
      const undone = await settleResult(page, after.digest);
      expect(undone.pages).toBe(before.pages);
      expect(undone.breaks.find((b) => b.boundaryId === id)).toBeUndefined();
      expect(undone.digest).toBe(before.digest);
    });

    test("adds and removes a system break by pointer, and an original line break offers no new-system action", async ({ page }) => {
      await openEditor(page);
      const before = await pack(page);
      await modeOn(page);
      const id = await pick(page, "none", 4);
      await byId(page, id).scrollIntoViewIfNeeded();
      await byId(page, id).click();
      await page.getByRole("button", { name: "Start new system here" }).click();
      const added = await settleResult(page, before.digest);
      expect(added.systems).toBe(before.systems + 1);
      expect(added.breaks.find((b) => b.boundaryId === id)).toMatchObject({ kind: "system", origin: "user" });
      await expect(byId(page, id)).toHaveAttribute("data-kind", "system");
      await expect(byId(page, id)).toHaveAttribute("aria-label", /Now: your new system\.$/);
      await expect(page.locator("dialog.cx #cx-status")).toContainText("New system starts after");

      await byId(page, id).click();
      await expect(page.getByRole("button", { name: "Start new system here (current)" })).toBeDisabled();
      await page.getByRole("button", { name: "Remove my break" }).click();
      const removed = await settleResult(page, added.digest);
      expect(removed.systems).toBe(before.systems);
      expect(removed.digest).toBe(before.digest);
      await expect(byId(page, id)).toHaveAttribute("data-kind", "none");
      await expect(page.locator("dialog.cx #cx-status")).toContainText("Break removed after");

      // Original line break: the panel replaces "Start new system" with a note.
      const orig = page.locator('dialog.cx .cx-bp:not([hidden])[data-kind="orig"]').first();
      await orig.scrollIntoViewIfNeeded();
      await orig.click();
      const menu = page.locator("dialog.cx .cx-menu");
      await expect(menu).toContainText("Original line break. To remove it, choose Line breaks: Fit to page.");
      await expect(menu.getByRole("button", { name: /Start new system here/ })).toHaveCount(0);
      await expect(menu.getByRole("button", { name: "Remove my break" })).toHaveCount(0);
      await menu.getByRole("button", { name: "Cancel" }).click();
      await expect(menu).toHaveCount(0);
      await expect(orig).toBeFocused();
    });

    test("thins crowded handles by zoom and turns off in Continuous view", async ({ page }) => {
      await openEditor(page);
      if (narrow) {
        // Below 40rem the strip and toolbar give way to a compact bar, and the page is enlarged to 300% for tapping.
        await modeOn(page);
        await expect(page.locator("dialog.cx .cx-fit")).toBeHidden();
        await expect(page.locator("dialog.cx .cx-toolbar")).toBeHidden();
        await expect(page.locator("dialog.cx .cx-breakbar")).toBeVisible();
        await expect(page.locator('dialog.cx [data-cx="zoom-value"], dialog.cx [data-cx-zoom-value]')).toHaveText("300%");
        await page.locator('dialog.cx [data-cx="break-done"]').click();
        await expect(page.locator('dialog.cx [data-cx="break-mode"]')).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("dialog.cx .cx-bp")).toHaveCount(0);
        await expect(page.locator("dialog.cx .cx-fit")).toBeVisible();
        await expect(page.locator("dialog.cx [data-cx-zoom-value]")).toHaveText("100%");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-cx"))).toBe("settings-btn");
        return;
      }
      await modeOn(page);
      const total = await page.locator("dialog.cx .cx-bp").count();
      const zoomOut = page.locator("dialog.cx").getByRole("button", { name: "Zoom out" });
      const zoomIn = page.locator("dialog.cx").getByRole("button", { name: "Zoom in" });
      const v100 = await handles(page).count();
      await zoomOut.click();
      await zoomOut.click();
      const v50 = await handles(page).count();
      for (let i = 0; i < 6; i++) await zoomIn.click();
      const v300 = await handles(page).count();
      expect(v50).toBeLessThanOrEqual(v100);
      expect(v300).toBeGreaterThanOrEqual(v100);
      expect(v50).toBeLessThan(v300);
      expect(total).toBeGreaterThanOrEqual(v300);
      // Visible handles never sit closer than 44 px within a row.
      const gaps = await page.evaluate(() => {
        const rows = new Map<string, number[]>();
        for (const b of document.querySelectorAll<HTMLElement>("dialog.cx .cx-bp:not([hidden])")) {
          const r = b.getBoundingClientRect();
          const key = `${b.closest(".cx-pg")?.getAttribute("data-page")}:${Math.round(r.top / 8)}`;
          rows.set(key, [...(rows.get(key) ?? []), r.left + r.width / 2]);
        }
        return [...rows.values()].flatMap((xs) => xs.sort((a, b) => a - b).slice(1).map((x, i) => x - xs[i]!));
      });
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(43);

      await page.locator("dialog.cx .cx-vo", { hasText: "Continuous" }).click();
      await expect(page.locator('dialog.cx [data-cx="break-mode"]')).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("dialog.cx .cx-bp")).toHaveCount(0);
      await page.locator('dialog.cx [data-cx="break-mode"]').click();
      await expect(page.locator("dialog.cx .cx-preview")).toHaveAttribute("data-view", "pages");
      await expect(handles(page).first()).toBeVisible();
    });

    test("keeps handle chips and lines clear of the music: chips sit below the staves, lines show only for focus and existing breaks", async ({ page }) => {
      await openEditor(page);
      await modeOn(page);
      await page.screenshot({ path: `${SHOTS_C2}/break-mode-${vp.name}.png` });
      const geometry = await page.evaluate(() => {
        // Staff extents of every drawn system, in viewport px.
        const systems = [...document.querySelectorAll("dialog.cx .cx-svg g.system")].map((s) => {
          const lines = [...s.querySelectorAll("g.staff > path")].map((l) => l.getBoundingClientRect());
          return { top: Math.min(...lines.map((r) => r.top)), bottom: Math.max(...lines.map((r) => r.bottom)), left: Math.min(...lines.map((r) => r.left)), right: Math.max(...lines.map((r) => r.right)) };
        });
        const bad: string[] = [];
        let checked = 0;
        for (const b of document.querySelectorAll<HTMLElement>("dialog.cx .cx-bp:not([hidden])")) {
          const chip = b.querySelector(".box")!.getBoundingClientRect();
          const cy = chip.top + chip.height / 2;
          const cx = chip.left + chip.width / 2;
          // The system this chip belongs to: the lowest one whose staves end above the chip's centre.
          const above = systems.filter((s) => s.bottom <= cy + 1 && cx >= s.left - 40 && cx <= s.right + 40).sort((a, b2) => b2.bottom - a.bottom)[0];
          checked++;
          if (above === undefined) { bad.push(`no system above chip at ${Math.round(cx)},${Math.round(cy)}`); continue; }
          if (chip.top < above.bottom - 0.5) bad.push(`chip overlaps staves (${Math.round(chip.top)} < ${Math.round(above.bottom)})`);
          const next = systems.filter((s) => s.top > above.bottom + 1).sort((a, b2) => a.top - b2.top)[0];
          if (next !== undefined && chip.bottom > next.top) bad.push("chip runs into the next system's staves");
          if (chip.width > 16 || chip.height > 16) bad.push(`chip ${chip.width}x${chip.height} is not small`);
        }
        return { bad, checked };
      });
      expect(geometry.checked).toBeGreaterThan(5);
      expect(geometry.bad).toEqual([]);

      const opacity = (sel: string) => page.locator(sel).first().evaluate((e) => Number(getComputedStyle(e).opacity));
      // A plain, unfocused break point shows no line.
      const plainId = (await page.locator('dialog.cx .cx-bp:not([hidden])[data-kind="none"]').nth(2).getAttribute("data-boundary"))!;
      const plain = byId(page, plainId);
      await page.locator("#export-btn").focus(); // move focus out of the overlay (also behind the modal: harmless)
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const lineOf = (id: string) => page.locator(`dialog.cx .cx-bp[data-boundary="${id}"] + .cx-bpline`);
      expect(await lineOf(plainId).evaluate((e) => Number(getComputedStyle(e).opacity))).toBe(0);
      // An original line break keeps a thin, translucent line.
      const origOpacity = await opacity('dialog.cx .cx-bpline[data-kind="orig"]');
      expect(origOpacity).toBeGreaterThan(0.2);
      expect(origOpacity).toBeLessThan(0.8);
      expect(await page.locator('dialog.cx .cx-bpline[data-kind="orig"]').first().evaluate((e) => getComputedStyle(e).width)).toBe("1px");
      // Focus (or hover) reveals one line, thin and translucent.
      await plain.focus();
      const focused = await lineOf(plainId).evaluate((e) => Number(getComputedStyle(e).opacity));
      expect(focused).toBeGreaterThan(0.4);
      expect(focused).toBeLessThan(1);
      await expect(plain.locator(".cx-bplab")).toBeVisible();
      await page.screenshot({ path: `${SHOTS_C2}/handle-focused-${vp.name}.png` });
      // The caption sits beside the chip, in the gap: it does not intersect any lyric text.
      const overLyrics = await page.evaluate(() => {
        const cap = document.querySelector<HTMLElement>("dialog.cx .cx-bp:focus .cx-bplab")!.getBoundingClientRect();
        return [...document.querySelectorAll("dialog.cx .cx-svg text, dialog.cx .cx-svg tspan")].filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.left < cap.right && r.right > cap.left && r.top < cap.bottom - 2 && r.bottom > cap.top + 2;
        }).length;
      });
      expect(overLyrics).toBe(0);
      // Existing breaks keep a distinct chip: a user system break shows the glyph and its own line.
      await plain.click();
      await page.getByRole("button", { name: "Start new system here" }).click();
      await expect(plain).toHaveAttribute("data-kind", "system");
      expect(await plain.locator(".box").textContent()).toBe("↵");
    });

    test("with the action panel open the current system is fully visible above the panel", async ({ page }) => {
      await openEditor(page);
      await modeOn(page);
      const id = await pick(page, "none", 6);
      await byId(page, id).click();
      const menu = page.locator("dialog.cx .cx-menu");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("button", { name: "Start new system here" })).toBeVisible();
      await expect(menu.getByRole("button", { name: "Start new page here" })).toBeVisible();
      // Compact: title row, one row of two actions, one line for "Now" and remove-or-note.
      const rows = await menu.evaluate((m) => {
        const r = (s: string) => m.querySelector(s)!.getBoundingClientRect();
        const a = m.querySelector('[data-m="system"]')!.getBoundingClientRect();
        const b = m.querySelector('[data-m="page"]')!.getBoundingClientRect();
        return { sideBySide: Math.abs(a.top - b.top) < 2 && b.left > a.left, height: m.getBoundingClientRect().height, headBottom: r(".cx-menu-head").bottom, actsTop: r(".cx-menu-acts").top };
      });
      expect(rows.sideBySide).toBe(true);
      if (narrow) expect(rows.height).toBeLessThanOrEqual(190);
      const view = await page.evaluate((boundary) => {
        const chip = document.querySelector<HTMLElement>(`dialog.cx .cx-bp[data-boundary="${boundary}"]`)!;
        const line = chip.nextElementSibling!.getBoundingClientRect();
        // The system that holds this break point: the g.system whose vertical range contains the line.
        const mid = line.top + line.height / 2;
        const sys = [...document.querySelectorAll("dialog.cx .cx-svg g.system")].map((s) => s.getBoundingClientRect()).find((r) => r.top <= mid && mid <= r.bottom)!;
        const menuTop = document.querySelector("dialog.cx .cx-menu")!.getBoundingClientRect().top;
        const previewTop = document.querySelector("dialog.cx .cx-preview")!.getBoundingClientRect().top;
        return { top: sys.top, bottom: sys.bottom, height: sys.height, menuTop, previewTop, vh: window.innerHeight };
      }, id);
      expect(view.height).toBeGreaterThanOrEqual(120);
      expect(view.top).toBeGreaterThanOrEqual(view.previewTop - 1);
      expect(view.bottom).toBeLessThanOrEqual(narrow ? view.menuTop + 1 : view.vh);
      expect(view.bottom).toBeLessThanOrEqual(view.vh);
      mkdirSync(SHOTS_C2, { recursive: true });
      await page.screenshot({ path: `${SHOTS_C2}/panel-open-${vp.name}.png` });
    });

    test("the left column never overlaps itself: the FIT summary clears the settings text at every scroll position", async ({ page }) => {
      test.skip(narrow, "the two-column layout is 62rem and up");
      await openEditor(page);
      const overlaps = async (): Promise<string[]> => page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(`dialog.cx ${s}`)!;
        const result = q("[data-cx=result]").getBoundingClientRect();
        const fit = q("[data-cx=fit]");
        const fitBox = fit.getBoundingClientRect();
        const settings = q("[data-cx=settings]").getBoundingClientRect();
        const out: string[] = [];
        // Only the part of a settings element inside the scroller is drawn: clip it, then test it against the summary.
        for (const n of document.querySelectorAll<HTMLElement>("dialog.cx [data-cx=settings] :is(p, span, label, legend, h3, li, summary, button, input):not([hidden])")) {
          const r = n.getBoundingClientRect();
          const l = Math.max(r.left, settings.left), rt = Math.min(r.right, settings.right), tp = Math.max(r.top, settings.top), bt = Math.min(r.bottom, settings.bottom);
          if (rt <= l || bt <= tp) continue;
          if (l < result.right && rt > result.left && tp < result.bottom && bt > result.top) out.push(`${n.tagName} ${n.textContent?.trim().slice(0, 30)}`);
        }
        if (fitBox.bottom > settings.top + 0.5) out.push("fit group extends into the settings column");
        if (result.bottom > fitBox.bottom - 8) out.push("the summary has no padding above the group's edge");
        if (getComputedStyle(fit).borderBottomWidth !== "1px") out.push("no rule under the FIT group");
        return out;
      });
      expect(await overlaps()).toEqual([]);
      const scroller = page.locator("dialog.cx [data-cx=settings]");
      const max = await scroller.evaluate((e) => e.scrollHeight - e.clientHeight);
      expect(max).toBeGreaterThan(50);
      for (const at of [Math.round(max / 2), max]) {
        await scroller.evaluate((e, y) => { e.scrollTop = y; }, at);
        expect(await overlaps(), `scrollTop ${at}`).toEqual([]);
      }
    });
  });
}
