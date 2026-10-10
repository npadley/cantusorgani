// Real-worker smoke test for the export layout worker (B7c).
//
// Needs a build that includes the test page:
//   E2E_TEST_PAGES=1 PUBLIC_ASSET_BASE=/systems pnpm exec astro build
// A normal `pnpm build` does not emit it, and this test then skips (see src/pages/e2e/[page].astro).
//
// The worker loads Verovio and fonts, lays out the MEI part with real WASM, and composes a real
// LayoutResult (B6a). Page sizes must equal the requested Letter portrait page.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const FIXTURES = "src/lib/export-layout/__fixtures__";
const PAGE = "/e2e/export-layout-worker/";
const MEI_URL = "/__e2e__/kyrie-ix.mei";

interface Manifest { readonly parts: readonly Record<string, unknown>[] }
const manifest = JSON.parse(readFileSync(`${FIXTURES}/manifest.fixture.json`, "utf8")) as Manifest;
const entry = manifest.parts[0] as Record<string, unknown>;

const part = {
  id: "kyrie:0", kind: "mei", label: "Kyrie IX", heading: { label: "Kyrie IX", rubric: "Lord, have mercy", rubricTranslation: null, credit: null }, sourceSystemCount: 5, sourceRevision: entry["renderHash"],
  target: entry["target"], renderHash: entry["renderHash"],
  conversion: { ...entry, meiUrl: MEI_URL },
};
const settings = {
  version: 2, page: "letter", customSize: null, orientation: "portrait", marginMm: 12, staff: "medium",
  lyrics: "medium", spacing: "normal", maxSystems: null, linePolicy: "original",
};

interface PageSummary { kind: string; widthMm: number; heightMm: number; svg?: { svg: string } }
interface WorkerMessage {
  type: string;
  token: number;
  partId?: string;
  diagnostic?: { code: string; detail: string };
  result?: { token: number; complete: boolean; diagnostics: { severity: string; code: string; detail: string }[]; pages: PageSummary[] };
}

async function messages(page: Page): Promise<readonly WorkerMessage[]> {
  return page.evaluate(() => (window as unknown as { __layoutWorker: { messages: never[] } }).__layoutWorker.messages);
}

test("the real layout worker lays out the Kyrie MEI and composes a complete Letter result", async ({ page, request }) => {
  const probe = await request.get(PAGE);
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1");

  await page.route(`**${MEI_URL}`, (route) =>
    route.fulfill({ contentType: "application/xml", body: readFileSync(`${FIXTURES}/kyrie-ix-experiment.mei`) }));
  const workerFailures: string[] = [];
  page.on("pageerror", (error) => workerFailures.push(error.message));

  await page.goto(PAGE);
  await expect(page.locator("#state")).toHaveAttribute("data-state", "ready");
  const started = Date.now();
  await page.evaluate((request) => {
    (window as unknown as { __layoutWorker: { post(m: unknown): void } }).__layoutWorker.post({ type: "layout", request });
  }, { token: 1, title: "Kyrie", parts: [part], settings, overrides: {} });

  await expect.poll(async () => (await messages(page)).some((m) => m.type === "error" || m.type === "result"), { timeout: 60_000 }).toBe(true);
  const elapsedMs = Date.now() - started;
  console.log(`export-layout worker: request to result ${elapsedMs} ms`);

  const all = await messages(page);
  const progress = all.filter((m) => m.type === "progress");
  expect(progress.length).toBeGreaterThanOrEqual(1);
  expect(progress[0]).toMatchObject({ token: 1, partId: "kyrie:0", done: 1, total: 1 });

  const last = all[all.length - 1] as WorkerMessage;
  expect(last.type, JSON.stringify(last.diagnostic)).toBe("result");
  expect(last.token).toBe(1);
  const result = last.result!;
  expect(result.token).toBe(1);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(result.complete).toBe(true);
  const meiPages = result.pages.filter((p) => p.kind === "mei");
  expect(meiPages.length).toBeGreaterThanOrEqual(1);
  for (const p of meiPages) expect(p.svg?.svg.startsWith("<svg")).toBe(true);
  expect(result.pages.length).toBeGreaterThanOrEqual(1);
  for (const p of result.pages) {
    expect(p.widthMm).toBeCloseTo(215.9, 1);
    expect(p.heightMm).toBeCloseTo(279.4, 1);
  }

  // PDF worker: the same result goes in, a real vector PDF comes out.
  const pdfStarted = Date.now();
  await page.evaluate((message) => {
    (window as unknown as { __pdfWorker: { post(m: unknown): void } }).__pdfWorker.post(message);
  }, { type: "pdf", token: 1, result });
  const pdfMessages = async (): Promise<readonly { type: string; token: number; pageCount?: number; byteSize?: number; diagnostic?: unknown }[]> =>
    page.evaluate(() => (window as unknown as { __pdfWorker: { messages: never[] } }).__pdfWorker.messages);
  await expect.poll(async () => (await pdfMessages()).length, { timeout: 60_000 }).toBeGreaterThan(0);
  console.log(`export-layout pdf worker: result to pdf ${Date.now() - pdfStarted} ms`);
  const pdfResponse = (await pdfMessages()).at(-1)!;
  expect(pdfResponse.type, JSON.stringify(pdfResponse.diagnostic)).toBe("pdf");
  expect(pdfResponse.token).toBe(1);
  expect(pdfResponse.pageCount).toBe(result.pages.length);
  expect(pdfResponse.byteSize).toBeGreaterThan(0);
  const base64 = await page.evaluate(() => (window as unknown as { __pdfWorker: { pdfBase64: string | null } }).__pdfWorker.pdfBase64);
  const bytes = Buffer.from(base64 ?? "", "base64");
  expect(bytes.length).toBe(pdfResponse.byteSize);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getPageCount()).toBe(result.pages.length);
  const size = doc.getPage(0).getSize();
  expect(Math.abs(size.width - 612)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(size.height - 792)).toBeLessThanOrEqual(0.5);
  expect(workerFailures).toEqual([]);
});
