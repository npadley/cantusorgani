// Real-worker smoke test for the export layout worker (B7c).
//
// Needs a build that includes the test page:
//   E2E_TEST_PAGES=1 PUBLIC_ASSET_BASE=/systems pnpm exec astro build
// A normal `pnpm build` does not emit it, and this test then skips (see src/pages/e2e/[page].astro).
//
// compose is a placeholder until B6a, so the worker is expected to load Verovio and fonts,
// really lay out the MEI part with WASM (a `progress` message), then fail in compose with
// detail "NOT_WIRED: compose".
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const FIXTURES = "src/lib/export-layout/__fixtures__";
const PAGE = "/e2e/export-layout-worker/";
const MEI_URL = "/__e2e__/kyrie-ix.mei";

interface Manifest { readonly parts: readonly Record<string, unknown>[] }
const manifest = JSON.parse(readFileSync(`${FIXTURES}/manifest.fixture.json`, "utf8")) as Manifest;
const entry = manifest.parts[0] as Record<string, unknown>;

const part = {
  id: "kyrie:0", kind: "mei", label: "Kyrie IX", heading: null, sourceSystemCount: 5, sourceRevision: entry["renderHash"],
  target: entry["target"], renderHash: entry["renderHash"],
  conversion: { ...entry, meiUrl: MEI_URL },
};
const settings = {
  version: 2, page: "ipad-11", customSize: null, orientation: "portrait", marginMm: 4, staff: "medium",
  lyrics: "medium", spacing: "normal", maxSystems: null, linePolicy: "original",
};

async function messages(page: Page): Promise<readonly { type: string; token: number; diagnostic?: { code: string; detail: string }; partId?: string }[]> {
  return page.evaluate(() => (window as unknown as { __layoutWorker: { messages: never[] } }).__layoutWorker.messages);
}

test("the real layout worker loads Verovio, lays out the Kyrie MEI, then fails in the unwired compose", async ({ page, request }) => {
  const probe = await request.get(PAGE);
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1");

  await page.route(`**${MEI_URL}`, (route) =>
    route.fulfill({ contentType: "application/xml", body: readFileSync(`${FIXTURES}/kyrie-ix-experiment.mei`) }));
  const workerFailures: string[] = [];
  page.on("pageerror", (error) => workerFailures.push(error.message));

  await page.goto(PAGE);
  await expect(page.locator("#state")).toHaveAttribute("data-state", "ready");
  await page.evaluate((request) => {
    (window as unknown as { __layoutWorker: { post(m: unknown): void } }).__layoutWorker.post({ type: "layout", request });
  }, { token: 1, title: "Kyrie", parts: [part], settings, overrides: {} });

  await expect.poll(async () => (await messages(page)).some((m) => m.type === "error" || m.type === "result"), { timeout: 60_000 }).toBe(true);
  const all = await messages(page);
  const progress = all.filter((m) => m.type === "progress");
  expect(progress.length).toBeGreaterThanOrEqual(1);
  expect(progress[0]).toMatchObject({ token: 1, partId: "kyrie:0", done: 1, total: 1 });
  const last = all[all.length - 1];
  expect(last).toMatchObject({ type: "error", token: 1, diagnostic: { detail: "NOT_WIRED: compose" } });
  expect(workerFailures).toEqual([]);
});
