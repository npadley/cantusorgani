// PR 9: focus clearance in the bottom bar, sticky rail and modal sheet.
//   pnpm build && pnpm exec playwright test e2e/focus-clearance.e2e.ts
import { expect, test } from "@playwright/test";

/** A control flush with an edge can measure a fraction of a pixel past it after layout rounding. */
const SUBPIXEL = 1;

for (const viewport of [
  { name: "phone", width: 390, height: 600, sticky: true },
  { name: "desktop", width: 1280, height: 900, sticky: false },
]) {
  test(`focus stays clear of the export bar while tabbing the whole piece page (${viewport.name})`, async ({ page }) => {
    page.on("pageerror", e => { throw new Error(`pageerror: ${e.message}`); });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/piece/dominica-i-adventus/");
    await expect(page.locator(".export")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const visited = await page.evaluateHandle(() => new Set<Element>());
    let finished = false;
    let tabStops = 0;
    let clearanceChecks = 0;
    let reachedExport = false;
    let railChecks = 0;

    for (let press = 0; press < 200; press++) {
      await page.keyboard.press("Tab");
      // Let native focus scrolling and layout settle before measuring, without
      // scrolling the target ourselves (which would mask a clearance failure).
      await page.evaluate(() => new Promise<void>((resolve) => {
        setTimeout(resolve, 400);
      }));
      const state = await page.evaluate((seen) => {
        const focused = document.activeElement;
        if (!document.hasFocus() || !focused || focused === document.body || focused === document.documentElement || seen.has(focused)) {
          return { finished: true, insideBar: false, clearance: null, railClearance: null };
        }
        seen.add(focused);
        const bar = document.querySelector<HTMLElement>(".service-rail, .export");
        if (!bar) throw new Error("The piece page must have an export bar");
        const insideBar = bar.contains(focused);
        const barRect = bar.getBoundingClientRect();
        const style = getComputedStyle(bar);
        // A sticky bar only obstructs content while pinned to the viewport's
        // bottom edge; after it scrolls away, footer links need no clearance.
        const pinned = style.position === "sticky" && style.visibility === "visible" &&
          barRect.height > 0 && barRect.top < innerHeight &&
          Math.abs(barRect.bottom - innerHeight) <= 1;
        return {
          finished: false,
          insideBar,
          railClearance: insideBar && style.position === "sticky" && style.top !== "auto" ? {
            top: focused.getBoundingClientRect().top,
            bottom: focused.getBoundingClientRect().bottom,
            railTop: Math.max(0, barRect.top),
            railBottom: Math.min(innerHeight, barRect.bottom),
            element: focused.outerHTML.slice(0, 300),
          } : null,
          clearance: pinned && !insideBar ? {
            bottom: focused.getBoundingClientRect().bottom,
            barTop: barRect.top,
            element: focused.outerHTML.slice(0, 300),
          } : null,
        };
      }, visited);

      if (state.finished) {
        finished = true;
        break;
      }
      tabStops++;
      reachedExport ||= state.insideBar;
      if (state.railClearance) {
        railChecks++;
        expect(state.railClearance.top, state.railClearance.element).toBeGreaterThanOrEqual(state.railClearance.railTop);
        expect(state.railClearance.bottom, state.railClearance.element).toBeLessThanOrEqual(state.railClearance.railBottom + SUBPIXEL);
      }
      if (state.clearance) {
        clearanceChecks++;
        expect(state.clearance.bottom, `Tab ${press + 1}: ${state.clearance.element}`)
          .toBeLessThanOrEqual(state.clearance.barTop);
      }
    }

    await visited.dispose();
    expect(finished, "Tab traversal must leave the page or wrap within 200 presses").toBe(true);
    expect(tabStops, "Tab traversal must visit page controls").toBeGreaterThan(0);
    expect(reachedExport, "Tab traversal must reach the export controls").toBe(true);
    if (!viewport.sticky) expect(railChecks, "The desktop viewport must exercise focus inside the sticky rail").toBeGreaterThan(0);
    if (viewport.sticky) {
      expect(clearanceChecks, "The phone viewport must exercise sticky-bar clearance").toBeGreaterThan(0);
    }
  });
}


for (const width of [390, 768]) {
  test(`focus stays clear of the open Choose parts sheet edges (${width}px)`, async ({ page }) => {
    page.on("pageerror", e => { throw new Error(`pageerror: ${e.message}`); });
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/piece/dominica-i-adventus/");
    await page.getByRole("button", { name: /^Choose parts/ }).click();
    const sheet = page.getByRole("dialog", { name: "Choose parts", exact: true });
    await expect(sheet).toBeVisible();
    const count = await sheet.locator("button, input").count();
    expect(count).toBeGreaterThan(5);
    for (const key of ["Tab", "Shift+Tab"]) for (let press = 0; press < count + 1; press++) {
      await page.keyboard.press(key);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const state = await sheet.evaluate(el => {
        const focus = document.activeElement;
        if (focus === null || focus === document.body) return { outsidePage: true };
        if (!(focus instanceof HTMLElement)) throw new Error("Missing focused control");
        const r = focus.getBoundingClientRect(), bounds = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { outsidePage: false, inside: el.contains(focus), top: r.top, bottom: r.bottom, left: r.left, right: r.right,
          minY: Math.max(0, bounds.top), maxY: Math.min(innerHeight, bounds.bottom),
          minX: Math.max(0, bounds.left), maxX: Math.min(innerWidth, bounds.right),
          clear: !!hit && (focus.contains(hit) || hit.contains(focus)), html: focus.outerHTML.slice(0, 300) };
      });
      if (state.outsidePage) continue;
      expect(state.inside, state.html).toBe(true);
      expect(state.top, state.html).toBeGreaterThanOrEqual(state.minY);
      expect(state.bottom, state.html).toBeLessThanOrEqual(state.maxY);
      expect(state.left, state.html).toBeGreaterThanOrEqual(state.minX);
      expect(state.right, state.html).toBeLessThanOrEqual(state.maxX);
      expect(state.clear, state.html).toBe(true);
    }
  });
}
