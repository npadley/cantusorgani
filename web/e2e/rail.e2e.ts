// PR 9: the shared selection, service rail and native Choose parts sheet.
//   pnpm build && pnpm exec playwright test e2e/rail.e2e.ts
// Uses real pages in plain dist/, with local stand-ins for notation images.
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

const PAGES = ["/piece/dominica-i-adventus/", "/kyriale/ix/"] as const;
// Built dist/: one export segment with a chant toggle.
// Catalogue inventory (including borrowed ranges): the largest piece selection has 154 systems.
// No piece/Kyriale page reaches the 300-system ceiling; the empty refusal is exercised below.
const SINGLE = "/piece/cantus-ad-libitum-agnus-dei-i-ii/";
const railBoxes = (page: Page) => page.locator('.service-rail input[name="export-part"]');
const sheetOf = (page: Page) => page.getByRole("dialog", { name: "Choose parts", exact: true });
const openerOf = (page: Page) => page.getByRole("button", { name: /^Choose parts/ });

async function assets(page: Page): Promise<void> {
  await page.route(/\/(systems|typeset)\/.*\.(svg|webp|png)(\?.*)?$/, route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="420"><path d="M0 10H1700" stroke="black"/></svg>',
  }));
}

/** Let native scrolling and font layout settle, without moving focus or scrolling it ourselves. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function focusedIsClear(page: Page): Promise<void> {
  await settled(page);
  const state = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) throw new Error("No focused control");
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { html: el.outerHTML.slice(0, 200), top: r.top, bottom: r.bottom, left: r.left, right: r.right,
      height: innerHeight, width: innerWidth, unobstructed: !!hit && (el.contains(hit) || hit.contains(el)) };
  });
  expect(state.top, state.html).toBeGreaterThanOrEqual(0);
  // A control flush with the edge can measure a fraction of a pixel past it after layout rounding.
  expect(state.bottom, state.html).toBeLessThanOrEqual(state.height + 1);
  expect(state.left, state.html).toBeGreaterThanOrEqual(0);
  expect(state.right, state.html).toBeLessThanOrEqual(state.width + 1);
  expect(state.unobstructed, state.html).toBe(true);
}

test.describe("Service rail", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", error => { throw new Error(`pageerror: ${error.message}`); });
    await page.addInitScript(() => localStorage.clear());
    await assets(page);
  });

  for (const url of PAGES) {
    test(`${url} inline and rail synchronize both ways; Select all and Clear announce empty exactly once`, async ({ page }) => {
      await page.goto(url);
      const boxes = railBoxes(page);
      expect(await boxes.count()).toBeGreaterThan(1);
      const inline = page.locator("#music [data-inline-part]");
      await expect(inline).toHaveCount(await boxes.count());
      for (const box of await boxes.all()) {
        const id = (await box.getAttribute("value"))!;
        const match = page.locator(`#music [data-inline-part="${id}"]`);
        await expect(box).toHaveAccessibleName(`In PDF: ${await box.getAttribute("data-label")}`);
        await box.uncheck();
        await expect(match).not.toBeChecked();
        await match.check();
        await expect(box).toBeChecked();
        await match.uncheck();
        await expect(box).not.toBeChecked();
        await box.check();
        await expect(match).toBeChecked();
      }
      // PR 10: the bar keeps one live region (#export-status, visually hidden in the rail). The rail shows the
      // same count as plain text in #selection-status.
      const status = page.locator("#selection-status");
      const live = page.locator("#export-status");
      await expect(live).toHaveAttribute("role", "status");
      await expect(live).toHaveAttribute("aria-live", "polite");
      await expect(status).not.toHaveAttribute("role", "status");
      await settled(page);
      // Observe actual live-region writes, rather than merely counting selection events.
      await page.evaluate(() => {
        const writes: { id: string; text: string }[] = [];
        (window as Window & { railWrites?: typeof writes }).railWrites = writes;
        const observer = new MutationObserver(records => {
          for (const record of records) {
            const el = record.target instanceof Element ? record.target : record.target.parentElement;
            const region = el?.closest('[role="status"], [aria-live]');
            if (region) writes.push({ id: region.id, text: region.textContent ?? "" });
          }
        });
        observer.observe(document.querySelector(".service-rail")!, { subtree: true, childList: true, characterData: true });
      });
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(status).toContainText(`0 of ${await boxes.count()} parts, 0 systems. Tick at least one part to export.`);
      for (const box of [...await boxes.all(), ...await inline.all()]) await expect(box).not.toBeChecked();
      await expect(page.locator("#export-btn")).toBeDisabled();
      await expect(page.locator("#export-customize")).toBeDisabled();
      await settled(page);
      const refusals = await page.evaluate(() => (window as Window & {
        railWrites?: { id: string; text: string }[];
      }).railWrites?.filter(write => write.text.includes("Tick at least one part")));
      expect(refusals).toEqual([{ id: "export-status", text: await status.textContent() }]);
      await page.getByRole("button", { name: "Select all", exact: true }).click();
      for (const box of [...await boxes.all(), ...await inline.all()]) await expect(box).toBeChecked();
      const total = await boxes.evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number((node as HTMLInputElement).dataset["systems"]), 0));
      await expect(status).toHaveText(`${await boxes.count()} of ${await boxes.count()} parts, ${total} systems`);
      await expect(page.locator("#export-btn")).toBeEnabled();
      await expect(page.locator("#export-customize")).toBeEnabled();
    });

    for (const width of [390, 768]) test(`${url} ${width}px sheet is modal, traps focus and returns it on Esc and Done`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(url);
      const opener = openerOf(page), sheet = sheetOf(page);
      for (const close of ["Escape", "Done"] as const) {
        await opener.click();
        await expect(sheet).toBeVisible();
        expect(await sheet.evaluate(el => el.matches(":modal"))).toBe(true);
        await expect(opener).toHaveAttribute("aria-expanded", "true");
        await expect(sheet.locator("#selection-status")).toHaveCount(1);
        await expect(page.locator("#selection-status")).toHaveCount(1);
        await expect(sheet.locator('input[name="export-part"]').first()).toBeFocused();
        const stops = await sheet.locator('button, input, [tabindex="0"]').count();
        for (const key of ["Tab", "Shift+Tab"]) for (let i = 0; i < stops + 2; i++) {
          await page.keyboard.press(key);
          const focus = await sheet.evaluate(el => ({
            inside: el.contains(document.activeElement),
            outsidePage: document.activeElement === null || document.activeElement === document.body,
          }));
          expect(focus.inside || focus.outsidePage).toBe(true);
          if (focus.inside) await focusedIsClear(page);
        }
        // Native modal inertness rejects programmatic focus and a real click on background content.
        const background = page.locator(".nav .brand");
        await background.evaluate(el => (el as HTMLElement).focus());
        expect(await sheet.evaluate(el => el.contains(document.activeElement) || document.activeElement === null || document.activeElement === document.body)).toBe(true);
        const bounds = await background.boundingBox();
        expect(bounds).not.toBeNull();
        const before = page.url();
        await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
        expect(page.url()).toBe(before);
        expect(await sheet.evaluate(el => el.contains(document.activeElement) || document.activeElement === null || document.activeElement === document.body)).toBe(true);
        if (close === "Escape") await page.keyboard.press("Escape");
        else await sheet.getByRole("button", { name: "Done", exact: true }).click();
        await expect(sheet).not.toBeVisible();
        await expect(opener).toBeFocused();
        await expect(opener).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator("[data-selection-home] #selection-status")).toHaveCount(1);
      }
    });

    test(`${url} resizing the open sheet focuses the same checkbox in the rail`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url);
      await openerOf(page).click();
      const sheet = sheetOf(page);
      const box = sheet.locator('input[name="export-part"]').nth(1);
      await box.focus();
      const id = await box.getAttribute("value");
      await page.setViewportSize({ width: 1024, height: 844 });
      await expect(sheet).not.toBeVisible();
      const restored = page.locator(`.service-rail [data-part-list] input[value="${id}"]`);
      await expect(restored).toBeFocused();
      await focusedIsClear(page);
    });

    test(`${url} keyboard order at 1024px is skip link, rail controls, then music, with clear focus`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto(url);
      await settled(page);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to music", exact: true })).toBeFocused();
      await focusedIsClear(page);
      // Capture the rail's visible controls in DOM order; keyboard traversal must visit each before music.
      const expected = await page.locator('.service-rail button:visible, .service-rail input:visible, .service-rail select:visible, .service-rail summary:visible, .service-rail a:visible')
        .evaluateAll(nodes => nodes.map(node => node.outerHTML));
      expect(expected.length).toBeGreaterThan(5);
      const visited: string[] = [];
      let musicReached = false;
      for (let i = 0; i < 200; i++) {
        await page.keyboard.press("Tab");
        const state = await page.evaluate(() => ({
          rail: !!document.activeElement?.closest(".service-rail"),
          music: !!document.activeElement?.closest("#music"),
          html: document.activeElement?.outerHTML ?? "",
        }));
        await focusedIsClear(page);
        if (state.rail) visited.push(state.html);
        if (state.music) { musicReached = true; break; }
      }
      expect(musicReached).toBe(true);
      expect(visited).toEqual(expected);
    });

    test(`${url} first notation is in the viewport on load at 390×844`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url);
      await settled(page);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      const first = page.locator("#music img.system:visible, #music img.typeset-music:visible, #music svg:visible").first();
      await expect(first).toBeInViewport();
      expect(await first.evaluate(el => el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : true)).toBe(true);
    });
  }

  for (const width of [390, 1024]) test(`one-part piece keeps reader tools and exports without a chooser at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(SINGLE);
    await expect(railBoxes(page)).toHaveCount(1);
    await expect(railBoxes(page)).not.toBeVisible();
    await expect(openerOf(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select all", exact: true })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Clear", exact: true })).not.toBeVisible();
    const tools = page.locator(".reader-tools");
    await expect(tools.locator("summary")).toBeVisible();
    if (!await tools.evaluate(el => (el as HTMLDetailsElement).open)) await tools.locator("summary").click();
    await expect(tools.getByRole("checkbox", { name: "Show the chant with each part" })).toBeVisible();
    await expect(page.locator("#export-btn")).toBeVisible();
    await expect(page.locator("#export-btn")).toBeEnabled();
    await expect(page.locator("#export-customize")).toBeVisible();
    await expect(page.locator("#export-customize")).toBeEnabled();
    await expect(page.locator("#music")).toBeVisible();
  });
});

test.describe("Service rail without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const url of [...PAGES, SINGLE]) for (const width of [390, 1024]) {
    test(`${url} ${width}px keeps music and jump links and explains export needs JavaScript`, async ({ page }) => {
      page.on("pageerror", error => { throw new Error(`pageerror: ${error.message}`); });
      await assets(page);
      await page.setViewportSize({ width, height: 844 });
      await page.goto(url);
      await expect(page.getByText("Export needs JavaScript.", { exact: true })).toBeVisible();
      await expect(page.locator('.service-rail input[type="checkbox"]:visible, [data-inline-part]:visible')).toHaveCount(0);
      for (const control of ["[data-select-all]", "[data-clear]", "[data-choose-parts]", "#export-btn", "#export-customize"]) {
        await expect(page.locator(`${control}:visible`)).toHaveCount(0);
      }
      await expect(page.locator("#music")).toBeVisible();
      await expect(page.getByRole("link", { name: "Skip to music", exact: true })).toHaveAttribute("href", "#music");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to music", exact: true })).toBeFocused();
      await expect(page.getByRole("link", { name: "Skip to music", exact: true })).toBeVisible();
      if (url !== SINGLE) {
        const links = page.locator('.movements a[href^="#"]');
        expect(await links.count()).toBeGreaterThan(1);
        for (const link of await links.all()) {
          await expect(link).toBeVisible();
          await expect(page.locator((await link.getAttribute("href"))!)).toBeVisible();
        }
      }
    });
  }
});
