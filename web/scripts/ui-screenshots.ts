// Capture a running production preview; this script does not build or start it.
//
//   cd web
//   node scripts/ui-screenshots.ts --only piece,piece-export,piece-chant
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import type { Page } from "@playwright/test";

type Action =
  | { type: "click"; role: "button"; name: string; dialog: string; waitHidden?: string[] }
  | { type: "check"; role: "checkbox"; name: string };
interface Route { id: string; url: string; note: string; action?: Action }

async function act(page: Page, action: Action): Promise<void> {
  const control = page.getByRole(action.role, { name: action.name, exact: true });
  switch (action.type) {
    case "click":
      await control.click();
      await page.getByRole("dialog", { name: action.dialog, exact: true }).waitFor({ state: "visible" });
      // The editor lays the music out in a worker; wait until its progress text is gone.
      for (const text of action.waitHidden ?? []) {
        await page.getByText(text).first().waitFor({ state: "hidden", timeout: 120_000 });
      }
      break;
    case "check":
      await control.check();
      if (!await control.isChecked()) throw new Error(`Checkbox did not stay checked: ${action.name}`);
      break;
    default:
      throw new Error(`Unknown action: ${JSON.stringify(action)}`);
  }
}

// Pages with third-party widgets (Turnstile) never go network-idle; settle on "load".
async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch {
    await page.waitForLoadState("load");
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "http://localhost:4322" },
      only: { type: "string" },
      out: { type: "string", default: "../docs/ui/screenshots" },
      all: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const base = new URL(values.base);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("--base must be an HTTP(S) URL");
  const routes = JSON.parse(readFileSync(new URL("../../docs/ui/routes.json", import.meta.url), "utf8")) as Route[];
  const only = values.only === undefined ? null : new Set(values.only.split(",").map((id) => id.trim()));
  const unknown = only ? [...only].filter((id) => !routes.some((route) => route.id === id)) : [];
  if (unknown.length) throw new Error(`Unknown --only IDs: ${unknown.join(", ")}`);
  const selected = routes.filter((route) => !only || only.has(route.id));
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });

  // The committed baseline keeps three variants per page; --all adds 768 and the
  // remaining dark views for local review.
  const variants: ReadonlyArray<readonly [number, "light" | "dark"]> = values.all
    ? [390, 768, 1024].flatMap((width) => [[width, "light"], [width, "dark"]] as const)
    : [[390, "light"], [1024, "light"], [1024, "dark"]];
  const failures: string[] = [];
  let written = 0;
  let bytes = 0;
  const browser = await chromium.launch();
  try {
    for (const route of selected) {
      for (const [width, colorScheme] of variants) {
        {
          const name = `${route.id}-${width}-${colorScheme}.jpg`;
          try {
            // Isolate remembered theme, typeset, chant and export preferences.
            const context = await browser.newContext({
              viewport: { width, height: width === 390 ? 844 : 900 },
              colorScheme,
              deviceScaleFactor: 1,
              locale: "en-US",
              timezoneId: "UTC",
              reducedMotion: "reduce",
            });
            try {
              const page = await context.newPage();
              page.setDefaultTimeout(30_000);
              const response = await page.goto(new URL(route.url, base).href, { waitUntil: "domcontentloaded" });
              if (response?.status() !== 200) {
                throw new Error(`HTTP ${response?.status() ?? "no response"} at ${page.url()} (expected 200)`);
              }
              await settle(page);
              await page.evaluate(async () => { await document.fonts.ready; });
              if (route.action) await act(page, route.action);
              // Actions can load the editor's fonts and chant notation lazily.
              await settle(page);
              await page.evaluate(async () => { await document.fonts.ready; });
              await page.waitForTimeout(500);
              // Clicking a control may scroll it into view; baseline the top viewport.
              await page.evaluate(() => window.scrollTo(0, 0));
              const jpeg = await page.screenshot({
                path: resolve(out, name), type: "jpeg", quality: 70, fullPage: false,
              });
              bytes += jpeg.length;
              written += 1;
            } finally {
              await context.close();
            }
          } catch (error) {
            const failure = `${name}: ${error instanceof Error ? error.message : String(error)}`;
            failures.push(failure);
            console.error(`FAIL ${failure}`);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`ui-screenshots: ${written}/${selected.length * variants.length} screenshots, ${failures.length} failures, ${bytes} total bytes written to ${out}`);
  if (failures.length) {
    console.error(`Failures:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`ui-screenshots: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
