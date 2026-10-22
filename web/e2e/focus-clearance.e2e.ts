import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "phone", width: 390, height: 600, sticky: true },
  { name: "desktop", width: 1280, height: 900, sticky: false },
]) {
  test(`focus stays clear of the export bar while tabbing the whole piece page (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/piece/dominica-i-adventus/");
    await expect(page.locator(".export")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const visited = await page.evaluateHandle(() => new Set<Element>());
    let finished = false;
    let tabStops = 0;
    let clearanceChecks = 0;
    let reachedExport = false;

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
          return { finished: true, insideBar: false, clearance: null };
        }
        seen.add(focused);
        const bar = document.querySelector<HTMLElement>(".export");
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
    if (viewport.sticky) {
      expect(clearanceChecks, "The phone viewport must exercise sticky-bar clearance").toBeGreaterThan(0);
    }
  });
}
