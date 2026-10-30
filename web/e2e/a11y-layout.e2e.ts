// PR 24: layout evidence for ui/accessibility.md. Every page template from routes.json, plus the open Choose parts sheet
// and the Ordinary Form Mass setting, checked for:
//   - reflow at 320 px (WCAG 1.4.10): no horizontal scroll;
//   - text spacing (1.4.12): the spacing stylesheet applied, and no text clipped or controls overlapping;
//   - forced colours: every field and control keeps an edge or its text, and every Tab stop shows a focus outline;
//   - 200% zoom, proxied by a 640 px viewport (1280 px at 2x): no horizontal scroll, clipping or overlap.
//   pnpm build && pnpm exec playwright test e2e/a11y-layout.e2e.ts
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Route = { id: string; url: string };

const seen = new Set<string>();
const pages = (JSON.parse(readFileSync(resolve("e2e/routes.json"), "utf8")) as Route[])
  .filter(({ url }) => !seen.has(url) && seen.add(url));

/** The WCAG 1.4.12 values, as a user stylesheet would apply them. */
const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

/** Layout rounding can leave a fraction of a pixel. */
const SUBPIXEL = 1;

async function open(page: Page, url: string): Promise<void> {
  page.on("pageerror", e => { throw new Error(`pageerror: ${e.message}`); });
  // The real Turnstile widget rejects the test host (error 110200); its layout is not ours to test.
  await page.route("**/challenges.cloudflare.com/**", r => r.abort());
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
}

async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate((subpixel) => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth + subpixel) return [];
    // Name the elements that reach past the viewport, deepest first, so a failure points at the cause.
    const out: string[] = [];
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= root.clientWidth + subpixel) continue;
      if (el.closest("[hidden], .sr-only")) continue;
      // An element inside its own scroll container (a wide table, say) scrolls there, not on the page.
      let scroller = el.parentElement;
      let contained = false;
      while (scroller && scroller !== document.body) {
        const ox = getComputedStyle(scroller).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") { contained = true; break; }
        scroller = scroller.parentElement;
      }
      if (!contained) out.push(`${el.tagName.toLowerCase()}.${el.className} right=${Math.round(r.right)}`);
    }
    return [`page scrolls to ${root.scrollWidth}px in ${root.clientWidth}px`, ...out.slice(-8)];
  }, SUBPIXEL);
}

/** Text cut off by its own box, and visible controls that overlap one another. */
async function clippedOrOverlapping(page: Page): Promise<string[]> {
  return page.evaluate((subpixel) => {
    const problems: string[] = [];
    const visible = (el: Element) => {
      if (el.closest("[hidden], .sr-only, [aria-hidden='true']")) return false;
      // A closed disclosure keeps its content's boxes but does not paint them.
      const closed = el.closest("details:not([open])");
      if (closed && !closed.querySelector(":scope > summary")?.contains(el)) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""} "${(el.textContent ?? "").trim().slice(0, 40)}"`;

    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      if (!visible(el) || !(el.textContent ?? "").trim()) continue;
      const s = getComputedStyle(el);
      const clipsX = s.overflowX === "hidden" || s.overflowX === "clip";
      const clipsY = s.overflowY === "hidden" || s.overflowY === "clip";
      if (!clipsX && !clipsY) continue;
      // Count only text the box itself holds: an image or score scaled into a frame is not clipped text.
      const hasText = [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim()) ||
        [...el.children].some(c => getComputedStyle(c).display.startsWith("inline") && (c.textContent ?? "").trim());
      if (!hasText) continue;
      if ((clipsX && el.scrollWidth > el.clientWidth + subpixel) || (clipsY && el.scrollHeight > el.clientHeight + subpixel)) {
        problems.push(`clipped: ${name(el)} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
      }
    }

    const controls = [...document.body.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, summary")]
      .filter(visible)
      // A visually hidden input drawn by its label (the segmented controls) is measured through the label.
      .filter(el => !(el instanceof HTMLInputElement && el.getBoundingClientRect().width <= 1));
    // A sticky or fixed bar (the rail, the reading controls) floats over the page by design, so it is compared only
    // with controls in the same bar.
    const layer = (el: Element) => {
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === "sticky" || position === "fixed") return node;
      }
      return null;
    };
    const boxes = controls.map(el => ({ el, layer: layer(el), rects: [...el.getClientRects()].filter(r => r.width > 0 && r.height > 0) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      if (a.layer !== b.layer) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // An input and its own label are one control.
      if (a.el.closest("label")?.contains(b.el) || b.el.closest("label")?.contains(a.el)) continue;
      const hit = a.rects.some(ra => b.rects.some(rb =>
        Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > subpixel &&
        Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > subpixel));
      if (hit) problems.push(`overlap: ${name(a.el)} and ${name(b.el)}`);
    }
    return problems;
  }, SUBPIXEL);
}

/** Opens the Choose parts sheet, which only exists as a dialog at phone widths. */
async function openSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Choose parts/ }).click();
  await expect(page.getByRole("dialog", { name: "Choose parts", exact: true })).toBeVisible();
}

test.describe("Reflow at 320 px", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  for (const { id, url } of pages) {
    test(`${id} has no horizontal scroll`, async ({ page }) => {
      await open(page, url);
      expect(await horizontalOverflow(page), `${id} (${url})`).toEqual([]);
    });
  }
  test("the open Choose parts sheet has no horizontal scroll", async ({ page }) => {
    await open(page, "/piece/dominica-i-adventus/");
    await openSheet(page);
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await clippedOrOverlapping(page)).toEqual([]);
  });
});

test.describe("Text spacing (WCAG 1.4.12)", () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    test.describe(`at ${viewport.width} px`, () => {
      test.use({ viewport });
      for (const { id, url } of pages) {
        test(`${id} keeps its text and controls apart`, async ({ page }) => {
          await open(page, url);
          await page.addStyleTag({ content: TEXT_SPACING });
          expect(await horizontalOverflow(page), `${id} (${url})`).toEqual([]);
          expect(await clippedOrOverlapping(page), `${id} (${url})`).toEqual([]);
        });
      }
    });
  }
  test("the Ordinary Form Mass setting survives text spacing at 390 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/ordinary-form/advent-1/");
    await page.addStyleTag({ content: TEXT_SPACING });
    const select = page.getByLabel("Mass setting", { exact: true });
    await expect(select).toBeVisible();
    await select.selectOption("XVII");
    expect(await clippedOrOverlapping(page)).toEqual([]);
  });
});

test.describe("Forced colours", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  for (const { id, url } of pages) {
    test(`${id} keeps its controls and focus visible`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: "active" });
      await open(page, url);
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);

      // A field, a box drawn with appearance: none, or an empty button is only visible by its edge once forced
      // colours drop backgrounds and shadows. A button with text or an icon keeps that.
      const edgeless = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.body.querySelectorAll<HTMLElement>("button, input:not([type=hidden]), select, textarea, [role=switch]")) {
          if (el.closest("[hidden], .sr-only")) continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1) continue;
          const s = getComputedStyle(el);
          if (s.visibility === "hidden" || s.display === "none") continue;
          const edge = ["Top", "Right", "Bottom", "Left"].some(side =>
            s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none" &&
            parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0);
          const native = s.appearance !== "none" && el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type);
          const isField = el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ||
            (el instanceof HTMLInputElement && !["button", "submit", "reset", "image"].includes(el.type));
          const hasContent = (el.textContent ?? "").trim() !== "" || el.querySelector("svg, img") !== null ||
            (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type) && el.value.trim() !== "");
          if (edge || native) continue;
          if (!isField && hasContent) continue;
          out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${el.className} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
        }
        return out;
      });
      expect(edgeless, `${id} (${url}) controls with no edge in forced colours`).toEqual([]);

      // Every Tab stop shows an outline (box-shadow rings vanish in forced colours). A visually hidden input shows
      // its focus on the label it draws.
      const unringed: string[] = [];
      const visited = await page.evaluateHandle(() => new Set<Element>());
      for (let press = 0; press < 60; press++) {
        await page.keyboard.press("Tab");
        const state = await page.evaluate((stops) => {
          const el = document.activeElement;
          if (!el || el === document.body || stops.has(el)) return { done: true, ring: true, name: "" };
          stops.add(el);
          // Cloudflare's Turnstile widget draws its own frame; its focus is Cloudflare's, not the site's CSS.
          if (el.closest(".cf-turnstile")) return { done: false, ring: true, name: "" };
          const ringed = (node: Element | null) => {
            if (!node) return false;
            const s = getComputedStyle(node);
            return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1;
          };
          const drawn = el.nextElementSibling ?? el.closest("label");
          return {
            done: false,
            ring: ringed(el) || (el.getBoundingClientRect().width <= 1 && ringed(drawn)),
            name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`,
          };
        }, visited);
        if (state.done) break;
        if (!state.ring) unringed.push(state.name);
      }
      expect(unringed, `${id} (${url}) Tab stops with no outline in forced colours`).toEqual([]);
    });
  }
});

test.describe("200% zoom (640 px viewport)", () => {
  test.use({ viewport: { width: 640, height: 450 } });
  for (const { id, url } of pages) {
    test(`${id} loses nothing`, async ({ page }) => {
      await open(page, url);
      expect(await horizontalOverflow(page), `${id} (${url})`).toEqual([]);
      expect(await clippedOrOverlapping(page), `${id} (${url})`).toEqual([]);
      await expect(page.locator("main h1").first()).toBeVisible();
    });
  }
  test("the piece page still offers every export action", async ({ page }) => {
    await open(page, "/piece/dominica-i-adventus/");
    for (const target of ["#export-btn", "#export-customize"]) {
      const control = page.locator(target);
      if (!(await control.isVisible())) await openSheet(page);
      await expect(control).toBeVisible();
    }
  });
});
