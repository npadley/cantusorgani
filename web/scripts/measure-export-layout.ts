// C2b: measurement harness for the custom export (layout worker and PDF worker) in real Chromium.
//
//   cd web
//   E2E_TEST_PAGES=1 PUBLIC_ASSET_BASE=/systems pnpm exec astro build
//   node scripts/measure-export-layout.ts            # RUNS=5 by default; RUNS=2 for a quick look
//   (CHROMIUM_CHANNEL overrides the browser channel; default full Chromium, falling back to the headless shell)
//
// The build must include the gated test page (src/pages/e2e/[page].astro). The script serves dist/
// itself on an ephemeral localhost port with cross-origin-isolation headers (so
// performance.measureUserAgentSpecificMemory can run), drives the page in headless Chromium through
// Playwright, and writes build/measure/<timestamp>.json (never committed; build/ is gitignored).
// A Markdown summary goes to stdout.
//
// Each run uses a FRESH browser context (empty HTTP cache, new workers). Per run it measures:
//   cold      first `layout` post -> first `result` (Verovio WASM init, fonts, MEI fetch, layout, compose)
//   firstPart first `layout` post -> first `progress` message (the first part rendered)
//   warm      a settings change (staff medium -> large; large -> medium for the large condition),
//             same worker -> new `result`
//   pdfCold   `pdf` post -> `pdf` response for the cold result (includes starting the PDF worker)
//   pdfWarm   a second `pdf` post for the warm result, same PDF worker
//   memory    measureUserAgentSpecificMemory when crossOriginIsolated and available, plus CDP
//             Performance.getMetrics (MAIN-THREAD JS heap only; worker heaps are not in it)
// All times are performance.now() differences taken inside the page. Nothing is estimated: a value
// that could not be measured is recorded as null with a reason, and a failed run is kept (with its
// stage and detail) and counted. Percentiles use nearest-rank over the successful runs; with 5 runs
// p95 equals the max. Localhost serving has no network latency, so these are CPU-bound baselines.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cpus, loadavg, platform, release } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

const RUNS = Number(process.env["RUNS"] ?? 5);
const REQUEST_TIMEOUT_MS = 120_000;
const DIST = resolve("dist");
const PAGE_PATH = "/e2e/export-layout-worker/?measure";
const MEI_URL = "/__measure__/kyrie-ix.mei";
const FIXTURES = resolve("src/lib/export-layout/__fixtures__");
const COMMAND = "node scripts/measure-export-layout.ts";

// ---------------------------------------------------------------- types ---
interface Timed {
  ms: number; firstProgressMs: number | null; progress: number; type: string; token: number;
  complete: boolean | null; pageCount: number | null; byteSize: number | null; errorDetail: string | null;
}
interface Settings {
  version: 2; page: string; customSize: null; orientation: "portrait"; marginMm: number;
  staff: "small" | "medium" | "large"; lyrics: "medium"; spacing: "normal"; maxSystems: null; linePolicy: "original" | "automatic";
}
interface Condition { id: string; description: string; parts: number; settings: Settings; warmStaff: "medium" | "large" }
interface MemoryReading {
  userAgentSpecific: { totalBytes: number | null; status: "ok" | "unavailable"; reason: string | null };
  cdpMainThreadJsHeap: { usedBytes: number | null; totalBytes: number | null; status: "ok" | "unavailable"; reason: string | null };
}
interface RunRecord {
  run: number; ok: boolean; failedStage: string | null; failureDetail: string | null;
  coldMs: number | null; firstPartMs: number | null; coldPages: number | null;
  warmMs: number | null; warmPages: number | null;
  pdfColdMs: number | null; pdfColdBytes: number | null; pdfColdPages: number | null;
  pdfWarmMs: number | null; pdfWarmBytes: number | null;
  servedBytes: number | null; servedByCategory: Record<string, number> | null;
  memory: MemoryReading | null;
  /** 1-minute system load average at the start and end of the run (a contended machine inflates every time). */
  loadStart: number; loadEnd: number | null;
  /** True when the 1-minute load average at the start or end of the run exceeded the CPU count. */
  noisy: boolean;
}
interface Stat { n: number; p50: number | null; p95: number | null; max: number | null }

// ------------------------------------------------------------- fixtures ---
interface Manifest { parts: Record<string, unknown>[] }
const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.fixture.json"), "utf8")) as Manifest;
const entry = manifest.parts[0] as Record<string, unknown>;
const meiBytes = readFileSync(join(FIXTURES, "kyrie-ix.mei"));

function makeParts(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `kyrie:${i}`, kind: "mei", label: `Kyrie IX (${i + 1})`,
    heading: { label: `Kyrie IX (${i + 1})`, rubric: "Lord, have mercy", rubricTranslation: null, credit: null },
    sourceSystemCount: 5, sourceRevision: entry["renderHash"], target: entry["target"], renderHash: entry["renderHash"],
    conversion: { ...entry, meiUrl: MEI_URL },
  }));
}
const base = (patch: Partial<Settings>): Settings => ({
  version: 2, page: "letter", customSize: null, orientation: "portrait", marginMm: 12, staff: "medium",
  lyrics: "medium", spacing: "normal", maxSystems: null, linePolicy: "original", ...patch,
});
const CONDITIONS: Condition[] = [
  { id: "letter-p-orig", description: "Kyrie, Letter portrait, medium staff, original lines", parts: 1, settings: base({}), warmStaff: "large" },
  { id: "ipad11-p-auto", description: "Kyrie, iPad 11 portrait (4 mm margins), medium staff, automatic lines", parts: 1, settings: base({ page: "ipad-11", marginMm: 4, linePolicy: "automatic" }), warmStaff: "large" },
  { id: "letter-p-large-auto", description: "Kyrie, Letter portrait, large staff, automatic lines (warm change goes large to medium)", parts: 1, settings: base({ staff: "large", linePolicy: "automatic" }), warmStaff: "medium" },
  { id: "multi-3x", description: "Kyrie repeated as 3 separate parts (distinct ids, same MEI), Letter, original lines", parts: 3, settings: base({}), warmStaff: "large" },
  { id: "multi-6x", description: "Kyrie repeated as 6 separate parts (distinct ids, same MEI), Letter, original lines", parts: 6, settings: base({}), warmStaff: "large" },
];

// --------------------------------------------------------------- server ---
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".ttf": "font/ttf", ".woff2": "font/woff2",
  ".svg": "image/svg+xml", ".png": "image/png", ".mei": "application/xml", ".txt": "text/plain",
};
const served: { path: string; bytes: number }[] = [];

function category(path: string): string {
  if (path === MEI_URL) return "mei";
  if (path.startsWith("/fonts/export/")) return "fonts";
  if (/export-layout\.worker-[^/]+\.js$/.test(path)) return "layoutWorkerChunk";
  if (/export-layout-pdf\.worker-[^/]+\.js$/.test(path)) return "pdfWorkerChunk";
  if (path.startsWith("/_astro/")) return "otherScripts";
  if (path.startsWith("/e2e/")) return "html";
  return "other";
}
function send(res: ServerResponse, status: number, headers: Record<string, string | number>, body?: Buffer): void {
  res.writeHead(status, {
    "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp",
    "cross-origin-resource-policy": "same-origin", "cache-control": "no-store", ...headers,
  });
  res.end(body);
}
function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = decodeURIComponent(url.pathname);
  if (path === MEI_URL) {
    served.push({ path, bytes: meiBytes.length });
    send(res, 200, { "content-type": MIME[".mei"] as string, "content-length": meiBytes.length }, meiBytes);
    return;
  }
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) return send(res, 403, {});
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { "content-type": "text/plain" }, Buffer.from("not found"));
  const size = statSync(file).size;
  served.push({ path, bytes: size });
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream", "content-length": size,
    "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp",
    "cross-origin-resource-policy": "same-origin", "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- stats ---
function stat(values: readonly (number | null)[]): Stat {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, p50: null, p95: null, max: null };
  const rank = (p: number): number => xs[Math.max(0, Math.ceil(p * xs.length) - 1)] as number;
  return { n: xs.length, p50: rank(0.5), p95: rank(0.95), max: xs[xs.length - 1] as number };
}
const fmtMs = (v: number | null): string => (v === null ? "n/a" : v >= 100 ? v.toFixed(0) : v.toFixed(1));
const fmtTriple = (s: Stat): string => (s.n === 0 ? "n/a" : `${fmtMs(s.p50)} / ${fmtMs(s.p95)} / ${fmtMs(s.max)}`);
const kib = (b: number | null): string => (b === null ? "n/a" : `${(b / 1024).toFixed(1)} KiB`);
const mib = (b: number | null): string => (b === null ? "unavailable" : `${(b / 1048576).toFixed(1)} MiB`);

// ------------------------------------------------------------- measuring ---
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolveP, rejectP) => {
    const timer = setTimeout(() => rejectP(new Error(`TIMEOUT: ${label} exceeded ${REQUEST_TIMEOUT_MS} ms`)), REQUEST_TIMEOUT_MS);
    work.then((v) => { clearTimeout(timer); resolveP(v); }, (e: unknown) => { clearTimeout(timer); rejectP(e instanceof Error ? e : new Error(String(e))); });
  });
}
const layoutIn = (page: Page, request: unknown): Promise<Timed> =>
  withTimeout(page.evaluate((r) => (window as unknown as { __measure: { layout(r: unknown): Promise<Timed> } }).__measure.layout(r), request), "layout");
const pdfIn = (page: Page, token: number): Promise<Timed> =>
  withTimeout(page.evaluate((t) => (window as unknown as { __measure: { pdf(t: number): Promise<Timed> } }).__measure.pdf(t), token), "pdf");

async function readMemory(page: Page, context: BrowserContext): Promise<MemoryReading> {
  const memory: MemoryReading = {
    userAgentSpecific: { totalBytes: null, status: "unavailable", reason: null },
    cdpMainThreadJsHeap: { usedBytes: null, totalBytes: null, status: "unavailable", reason: null },
  };
  try {
    const result = await withTimeout(page.evaluate(async () => {
      const perf = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
      if (!window.crossOriginIsolated) return { error: "page is not cross-origin isolated" };
      if (typeof perf.measureUserAgentSpecificMemory !== "function") return { error: "performance.measureUserAgentSpecificMemory is not available" };
      try { return { bytes: (await perf.measureUserAgentSpecificMemory()).bytes }; } catch (e) { return { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
    }), "measureUserAgentSpecificMemory");
    if ("bytes" in result) memory.userAgentSpecific = { totalBytes: result.bytes, status: "ok", reason: null };
    else memory.userAgentSpecific.reason = result.error;
  } catch (e) {
    memory.userAgentSpecific.reason = e instanceof Error ? e.message : String(e);
  }
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const get = (name: string): number | null => metrics.find((m) => m.name === name)?.value ?? null;
    const used = get("JSHeapUsedSize");
    memory.cdpMainThreadJsHeap = { usedBytes: used, totalBytes: get("JSHeapTotalSize"), status: used === null ? "unavailable" : "ok", reason: used === null ? "metric missing" : null };
  } catch (e) {
    memory.cdpMainThreadJsHeap.reason = e instanceof Error ? e.message : String(e);
  }
  return memory;
}

const emptyRun = (run: number): RunRecord => ({
  run, ok: false, failedStage: null, failureDetail: null, coldMs: null, firstPartMs: null, coldPages: null, warmMs: null, warmPages: null,
  pdfColdMs: null, pdfColdBytes: null, pdfColdPages: null, pdfWarmMs: null, pdfWarmBytes: null, servedBytes: null, servedByCategory: null, memory: null,
  loadStart: loadavg()[0] ?? 0, loadEnd: null, noisy: false,
});

async function oneRun(browser: Awaited<ReturnType<typeof chromium.launch>>, origin: string, condition: Condition, run: number): Promise<RunRecord> {
  const record = emptyRun(run);
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  served.length = 0;
  let stage = "load";
  try {
    await page.goto(origin + PAGE_PATH);
    await page.waitForFunction(() => document.getElementById("state")?.dataset["state"] === "ready", undefined, { timeout: 30_000 });
    const parts = makeParts(condition.parts);
    const request = (token: number, settings: Settings): unknown => ({ type: "layout", request: { token, title: "Kyrie", parts, settings, overrides: {} } });

    stage = "cold layout";
    const cold = await layoutIn(page, request(1, condition.settings));
    record.coldMs = cold.ms; record.firstPartMs = cold.firstProgressMs; record.coldPages = cold.pageCount;
    if (cold.type !== "result" || cold.complete !== true) throw new Error(`layout ${cold.type}${cold.complete === false ? " (incomplete)" : ""}: ${cold.errorDetail ?? "no detail"}`);

    stage = "cold pdf";
    const pdfCold = await pdfIn(page, 1);
    record.pdfColdMs = pdfCold.ms; record.pdfColdBytes = pdfCold.byteSize; record.pdfColdPages = pdfCold.pageCount;
    if (pdfCold.type !== "pdf") throw new Error(`pdf ${pdfCold.type}: ${pdfCold.errorDetail ?? "no detail"}`);

    stage = "warm layout";
    const warm = await layoutIn(page, request(2, { ...condition.settings, staff: condition.warmStaff }));
    record.warmMs = warm.ms; record.warmPages = warm.pageCount;
    if (warm.type !== "result" || warm.complete !== true) throw new Error(`warm layout ${warm.type}${warm.complete === false ? " (incomplete)" : ""}: ${warm.errorDetail ?? "no detail"}`);

    stage = "warm pdf";
    const pdfWarm = await pdfIn(page, 2);
    record.pdfWarmMs = pdfWarm.ms; record.pdfWarmBytes = pdfWarm.byteSize;
    if (pdfWarm.type !== "pdf") throw new Error(`warm pdf ${pdfWarm.type}: ${pdfWarm.errorDetail ?? "no detail"}`);

    if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join("; ")}`);
    record.ok = true;
    record.failedStage = null;
  } catch (e) {
    record.failedStage = stage;
    record.failureDetail = e instanceof Error ? e.message : String(e);
  }
  const byCategory: Record<string, number> = {};
  for (const s of served) byCategory[category(s.path)] = (byCategory[category(s.path)] ?? 0) + s.bytes;
  record.servedBytes = served.reduce((a, s) => a + s.bytes, 0);
  record.servedByCategory = byCategory;
  if (record.ok) record.memory = await readMemory(page, context);
  record.loadEnd = loadavg()[0] ?? null;
  record.noisy = Math.max(record.loadStart, record.loadEnd ?? 0) > cpus().length;
  await context.close();
  return record;
}

// ----------------------------------------------------------------- bytes ---
function fileBytes(path: string): { path: string; rawBytes: number; gzipBytes: number; brotliBytes: number } {
  const data = readFileSync(path);
  return { path: path.slice(DIST.length), rawBytes: data.length, gzipBytes: gzipSync(data, { level: 9 }).length, brotliBytes: brotliCompressSync(data).length };
}
function findChunk(pattern: RegExp): ReturnType<typeof fileBytes> | null {
  const dir = join(DIST, "_astro");
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((f) => pattern.test(f));
  return name === undefined ? null : fileBytes(join(dir, name));
}

// ------------------------------------------------------------------ main ---
async function main(): Promise<void> {
  if (!existsSync(join(DIST, "e2e", "export-layout-worker", "index.html"))) {
    console.error("dist/ has no test page. Build with: E2E_TEST_PAGES=1 PUBLIC_ASSET_BASE=/systems pnpm exec astro build");
    process.exit(2);
  }
  const server = createServer(handle);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  const origin = `http://127.0.0.1:${address.port}`;
  // Full Chromium in new headless mode supports measureUserAgentSpecificMemory; the headless shell does not.
  let channel = process.env["CHROMIUM_CHANNEL"] ?? "chromium";
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ channel });
  } catch {
    channel = "headless-shell";
    browser = await chromium.launch();
  }
  const startedAt = new Date();

  const results: { condition: Condition; runs: RunRecord[]; loadAtStart: number; loadAtEnd: number }[] = [];
  for (const condition of CONDITIONS) {
    const runs: RunRecord[] = [];
    const loadAtStart = loadavg()[0] ?? 0;
    for (let i = 1; i <= RUNS; i++) {
      const record = await oneRun(browser, origin, condition, i);
      runs.push(record);
      console.error(`${condition.id} run ${i}/${RUNS}: ${record.ok ? `cold ${fmtMs(record.coldMs)} ms, warm ${fmtMs(record.warmMs)} ms, pdf ${fmtMs(record.pdfColdMs)} ms` : `FAILED at ${record.failedStage}: ${record.failureDetail}`}`);
    }
    results.push({ condition, runs, loadAtStart, loadAtEnd: loadavg()[0] ?? 0 });
  }
  const browserVersion = browser.version();
  await browser.close();
  server.close();

  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
  const bytes = {
    layoutWorkerChunk: findChunk(/^export-layout\.worker-.*\.js$/),
    pdfWorkerChunk: findChunk(/^export-layout-pdf\.worker-.*\.js$/),
    fonts: readdirSync(join(DIST, "fonts", "export")).filter((f) => f.endsWith(".ttf")).map((f) => fileBytes(join(DIST, "fonts", "export", f))),
    mei: { path: "src/lib/export-layout/__fixtures__/kyrie-ix.mei", rawBytes: meiBytes.length, gzipBytes: gzipSync(meiBytes, { level: 9 }).length },
  };

  const summarise = (ok: RunRecord[]) => ({
    n: ok.length,
    coldMs: stat(ok.map((r) => r.coldMs)), firstPartMs: stat(ok.map((r) => r.firstPartMs)), warmMs: stat(ok.map((r) => r.warmMs)),
    pdfColdMs: stat(ok.map((r) => r.pdfColdMs)), pdfWarmMs: stat(ok.map((r) => r.pdfWarmMs)),
    pdfBytes: stat(ok.map((r) => r.pdfColdBytes)), servedBytes: stat(ok.map((r) => r.servedBytes)),
    memoryUserAgentSpecificBytes: stat(ok.map((r) => r.memory?.userAgentSpecific.totalBytes ?? null)),
    memoryCdpMainThreadJsHeapUsedBytes: stat(ok.map((r) => r.memory?.cdpMainThreadJsHeap.usedBytes ?? null)),
  });
  const summary = results.map(({ condition, runs, loadAtStart, loadAtEnd }) => {
    const ok = runs.filter((r) => r.ok);
    const all = summarise(ok);
    return {
      all, clean: summarise(ok.filter((r) => !r.noisy)), noisyRuns: runs.filter((r) => r.noisy).length,
      loadAtStart, loadAtEnd,
      id: condition.id, description: condition.description, parts: condition.parts, settings: condition.settings, warmStaff: condition.warmStaff,
      runs: runs.length, succeeded: ok.length, failed: runs.length - ok.length,
      failures: runs.filter((r) => !r.ok).map((r) => ({ run: r.run, stage: r.failedStage, detail: r.failureDetail })),
      pages: ok.map((r) => r.coldPages).find((p) => p !== null) ?? null,
    };
  });
  const memoryReasons = [...new Set(results.flatMap((r) => r.runs).flatMap((r) => (r.memory && r.memory.userAgentSpecific.status !== "ok" ? [r.memory.userAgentSpecific.reason ?? "unknown"] : [])))];

  const report = {
    meta: {
      timestamp: startedAt.toISOString(), command: COMMAND, runsPerCondition: RUNS, browser: `Chromium ${browserVersion} (Playwright, headless, ${channel})`,
      platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? "unknown", cpuCount: cpus().length, node: process.version,
      commit: git.status === 0 ? git.stdout.trim() : null,
      notes: ["Localhost serving: no network latency. Fresh browser context per run (cold HTTP cache).",
        "Percentiles are nearest-rank over successful runs; p95 equals max when n <= 20.",
        "Run-time load averages are recorded per run (loadStart/loadEnd); a high value means other processes shared the CPU and the times are upper bounds.",
        "cdpMainThreadJsHeap covers the page's main thread only, not the worker heaps."],
    },
    bytes, conditions: summary, runs: Object.fromEntries(results.map(({ condition, runs }) => [condition.id, runs])),
  };
  const outDir = resolve("..", "build", "measure");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

  // ---- Markdown summary ----
  const lines: string[] = [];
  lines.push(`# Export layout measurements`, "");
  lines.push(`- Date: ${report.meta.timestamp}; commit ${report.meta.commit ?? "unknown"}`);
  lines.push(`- Browser: ${report.meta.browser}; ${report.meta.platform}; ${report.meta.cpu} x${report.meta.cpuCount}; Node ${report.meta.node}`);
  lines.push(`- ${RUNS} runs per condition, fresh browser context each; times in ms as p50 / p95 / max over successful runs (nearest rank)`, "");
  const table = (title: string, pick: (c: (typeof summary)[number]) => ReturnType<typeof summarise>): void => {
    lines.push(`### ${title}`, "");
    lines.push(`| Condition | Parts | Pages | n | Cold (post to result) | First part | Warm change | PDF cold | PDF warm | PDF size | Memory (UA-specific) |`);
    lines.push(`|---|---:|---:|---:|---|---|---|---|---|---|---|`);
    for (const c of summary) {
      const m = pick(c);
      lines.push(`| ${c.id} | ${c.parts} | ${c.pages ?? "n/a"} | ${m.n}/${c.runs} | ${fmtTriple(m.coldMs)} | ${fmtTriple(m.firstPartMs)} | ${fmtTriple(m.warmMs)} | ${fmtTriple(m.pdfColdMs)} | ${fmtTriple(m.pdfWarmMs)} | ${kib(m.pdfBytes.p50)} | ${mib(m.memoryUserAgentSpecificBytes.p50)} |`);
    }
    lines.push("");
  };
  table("All successful runs", (c) => c.all);
  table(`Excluding noisy runs (1-minute load average above ${cpus().length} cores at start or end)`, (c) => c.clean);
  lines.push(`Noisy runs per condition: ${summary.map((c) => `${c.id} ${c.noisyRuns}/${c.runs}`).join("; ")}. Load average (1 min) at condition start/end: ${summary.map((c) => `${c.id} ${c.loadAtStart.toFixed(1)}/${c.loadAtEnd.toFixed(1)}`).join("; ")}.`);
  lines.push("", `Warm change: staff medium to large (large to medium for letter-p-large-auto), same worker. PDF cold includes starting the PDF worker and loading fonts; PDF warm is the second export.`);
  const failed = summary.filter((c) => c.failed > 0);
  lines.push("", failed.length === 0 ? "Failures: none." : "Failures:");
  for (const c of failed) for (const f of c.failures) lines.push(`- ${c.id} run ${f.run}: ${f.stage}: ${f.detail}`);
  lines.push("", `Memory: ${memoryReasons.length === 0 ? "measureUserAgentSpecificMemory succeeded in every successful run." : `measureUserAgentSpecificMemory unavailable in some runs (${memoryReasons.join("; ")}).`}`);
  lines.push(`Main-thread JS heap used after the run (CDP, workers excluded), p50: ${summary.map((c) => `${c.id} ${mib(c.all.memoryCdpMainThreadJsHeapUsedBytes.p50)}`).join("; ")}.`);
  lines.push("", `| Bytes | Raw | Gzip -9 | Brotli |`, `|---|---:|---:|---:|`);
  const row = (name: string, b: { rawBytes: number; gzipBytes: number; brotliBytes?: number } | null): string =>
    b === null ? `| ${name} | n/a | n/a | n/a |` : `| ${name} | ${kib(b.rawBytes)} | ${kib(b.gzipBytes)} | ${b.brotliBytes === undefined ? "n/a" : kib(b.brotliBytes)} |`;
  lines.push(row("Layout worker chunk (Verovio + layout + compose)", bytes.layoutWorkerChunk));
  lines.push(row("PDF worker chunk", bytes.pdfWorkerChunk));
  for (const f of bytes.fonts) lines.push(row(`Font ${f.path.split("/").pop()}`, f));
  lines.push(row("MEI (Kyrie IX, per part fetched)", bytes.mei));
  const pdfSizes = summary.map((c) => `${c.id} ${kib(c.all.pdfBytes.p50)}`).join("; ");
  lines.push("", `PDF size (p50): ${pdfSizes}.`);
  lines.push(`Total bytes served per cold run (p50): ${summary.map((c) => `${c.id} ${kib(c.all.servedBytes.p50)}`).join("; ")}.`);
  lines.push("", `JSON: ${outFile}`);
  console.log(lines.join("\n"));
  if (summary.some((c) => c.succeeded === 0)) process.exitCode = 1;
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
