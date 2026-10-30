// PR 8 baseline: what Quick and Customize actually put in the PDF; landed before the selection refactor.
// Pins heading order, omitted parts, reader scan overrides, typeset source files and chant on/off.
//
//   pnpm build:e2e && E2E_DIST=dist-e2e pnpm exec playwright test e2e/pdf-contents.e2e.ts
//
// Scans and typeset assets are local stand-ins. Only the source-file marker is text in a typeset PDF;
// headings and chant must therefore come from the real export path, not from the fixture.
import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chantStaffCount, imageBoxes, lettersOf, pageTexts } from "../scripts/verify-export-pdf";
import { dateLabel } from "../src/lib/dayService";
import type { DayTable } from "../src/lib/dayService";
import { parseRuns } from "../src/lib/exportSelection";

const CHANT_SPACE_MM = 1.8 * 1.565; // Medium music, as in export-chant.e2e.ts (D30).
const CASES = [
  {
    name: "Advent I", url: "/piece/dominica-i-adventus/",
    // catalog.json sections + exportParts.ts/sectionName: no incipits in these labels.
    labels: ["Introit", "Gradual", "Alleluia", "Offertory", "Communion"],
    omit: "Gradual",
  },
  {
    name: "OF Easter", url: "/ordinary-form/easter/?cycle=A&season=easter",
    // ordinary-form-propers.json Easter lenders + exportParts.ts borrowed-part labels.
    labels: [
      "Introit (from Dominica Resurrectionis)", "Gradual (from Dominica Resurrectionis)",
      "Alleluia (from Dominica Resurrectionis)", "Sequence (from Dominica Resurrectionis)",
      "Offertory (from Dominica Resurrectionis)", "Communion (from Dominica Resurrectionis)",
      // Missa I, the Kyriale's suggestion for Eastertide (ordinaryFormKyriale.ts).
      "Kyrie", "Gloria", "Sanctus", "Agnus Dei", "Ite, missa est, alleluia", "Ite, missa est",
    ],
    omit: "Gradual (from Dominica Resurrectionis)",
  },
] as const;

type Mode = "Quick" | "Customize";
interface Part { label: string; systems: number; runs: ReturnType<typeof parseRuns> }
// Disabled boxes belong to Masses not chosen on an OF page; they never export.
const boxes = (page: Page) => page.locator('input[name="export-part"]:not(:disabled)');
const downloadButton = (page: Page) => page.locator('dialog.cx [data-cx="download"]');
const marker = (url: string): string => `TYPESET ${new URL(url, "http://localhost").pathname}`;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function scanPng(): Buffer {
  const width = 1700, height = 420;
  const rows = Array.from({ length: height }, () => { const row = Buffer.alloc(width + 1, 255); row[0] = 0; return row; });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
async function serveAssets(page: Page, baseURL: string): Promise<void> {
  const png = scanPng();
  const headers = { "access-control-allow-origin": "*" };
  const pdfs = new Map<string, Buffer>();
  // Context routes also cover requests from the PDF/layout workers.
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/typeset/") && url.pathname.endsWith(".pdf")) {
      let body = pdfs.get(url.pathname);
      if (!body) {
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        pdf.addPage([612, 792]).drawText(marker(url.href), { x: 36, y: 700, size: 8, font });
        body = Buffer.from(await pdf.save());
        pdfs.set(url.pathname, body);
      }
      return route.fulfill({ contentType: "application/pdf", headers, body });
    }
    if (url.pathname.endsWith("@2x.png") || (url.pathname.includes("/systems/") && url.pathname.endsWith(".webp")))
      return route.fulfill({ contentType: "image/png", headers, body: png });
    if (url.pathname.includes("/typeset/") && url.pathname.endsWith(".svg"))
      return route.fulfill({ contentType: "image/svg+xml", headers, body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    return route.continue();
  });
}

async function tick(page: Page, wanted: readonly string[]): Promise<void> {
  const details = page.locator("details.parts");
  if (await details.count()) await details.evaluate(d => { (d as HTMLDetailsElement).open = true; });
  for (const box of await boxes(page).all()) {
    if (wanted.includes((await box.getAttribute("data-label"))!) !== await box.isChecked()) await box.locator("xpath=..").click();
  }
  if (await details.count()) await details.evaluate(d => { (d as HTMLDetailsElement).open = false; });
}

const radio = (page: Page, name: string, value: string) => page.locator(`dialog.cx input[name="${name}"][value="${value}"]`).locator("xpath=..");
async function setChant(page: Page, value: "before" | "off"): Promise<void> {
  await radio(page, "cx-chant", value).click();
  await expect(page.locator(`dialog.cx input[name="cx-chant"][value="${value}"]`)).toBeChecked();
  await expect(downloadButton(page)).toBeEnabled({ timeout: 120_000 });
}
async function openEditor(page: Page): Promise<void> {
  await page.locator("#export-customize").click();
  await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
  await expect(downloadButton(page)).toBeEnabled({ timeout: 120_000 });
  const settings = page.locator('dialog.cx [data-cx="settings-btn"]');
  if (await settings.isVisible()) await settings.click();
  await page.locator('dialog.cx select[name="cx-page"]').selectOption('letter');
  // Medium is the default; pin it since the chant verifier uses its spacing.
  await expect(page.locator('dialog.cx input[name="cx-staff"][value="medium"]')).toBeChecked();
  if (await settings.isVisible()) await page.locator('dialog.cx [data-cx="panel-done"]').click();
  await expect(page.locator("dialog.cx .cx-plabel").first()).toContainText("Letter", { timeout: 120_000 });
  await expect(downloadButton(page)).toBeEnabled({ timeout: 120_000 });
  await setChant(page, "before");
}
async function download(page: Page, mode: Mode): Promise<Uint8Array> {
  const button = mode === "Quick" ? page.locator("#export-btn") : downloadButton(page);
  await expect(button).toBeEnabled({ timeout: 120_000 });
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), button.click()]);
  const stream = await file.createReadStream();
  if (!stream) throw new Error("Download has no stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}
async function closeEditor(page: Page): Promise<void> {
  await page.locator('dialog.cx [data-cx="close"]').click();
  await expect(page.locator("dialog.cx")).not.toHaveAttribute("open", "");
}

async function inspect(bytes: Uint8Array) {
  const text = (await pageTexts(bytes)).flat();
  return {
    text, letters: lettersOf(text),
    markers: text.filter(t => t.startsWith("TYPESET ")),
    scans: (await imageBoxes(bytes)).reduce((n, p) => n + p.boxes.length, 0),
    chant: await chantStaffCount(bytes, CHANT_SPACE_MM),
  };
}
function headingsInOrder(text: readonly string[], labels: readonly string[]): void {
  const letters = lettersOf(text);
  let after = 0;
  for (const label of labels) {
    const at = letters.indexOf(lettersOf([label]), after);
    expect(at, `heading ${label} after offset ${after}`).toBeGreaterThanOrEqual(after);
    after = at + lettersOf([label]).length;
  }
}

// A dropped heading, an ignored checkbox or scan switch, a wrong paper PDF, or chant in Quick fails here.
test.describe("PDF contents", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.beforeEach(async ({ page, baseURL }) => {
    const probe = await page.request.get("/e2e/export-layout-worker/");
    test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1 (use pnpm build:e2e)");
    page.on("pageerror", e => { throw new Error(`pageerror: ${e.message}`); });
    await page.addInitScript(() => { localStorage.clear(); });
    await serveAssets(page, baseURL!);
  });

  for (const index of [0, 1]) test(`St Philip Neri: dated service ${index + 1} PDF contains only its Ordinary`, async ({ page }) => {
    test.setTimeout(600_000);
    const day = "/day/sancti/05-26/";
    await page.goto(day, { waitUntil: "networkidle" });
    const data = JSON.parse((await page.locator(".export").getAttribute("data-day-service"))!) as { table: DayTable };
    const masses = data.table.options.filter((o, i, all) => o.mass !== null && all.findIndex(other => other.mass === o.mass) === i
      && data.table.groups.some(g => g.option === o.key && g.dates.length > 0));
    expect(masses.length, "St Philip Neri needs at least two dated, non-null Mass options").toBeGreaterThanOrEqual(2);
    const chosen = masses[index]!;
    const other = masses.find(o => o.mass !== chosen.mass)!;
    const fixture = { mass: chosen.mass!, other: other.mass!, date: data.table.groups.find(g => g.option === chosen.key)!.dates[0]! };
    await page.goto(`${day}?date=${fixture.date}`, { waitUntil: "networkidle" });
    const root = page.locator(".export");
    const chosenBoxes = boxes(page);
    const parts = await chosenBoxes.evaluateAll(nodes => nodes.filter(n => !(n as HTMLInputElement).disabled && (n as HTMLInputElement).checked).map(n => ({
      label: (n as HTMLInputElement).dataset["label"]!,
      systems: Number((n as HTMLInputElement).dataset["systems"]),
      runs: (n as HTMLInputElement).dataset["runs"]!,
      ordinary: (n as HTMLInputElement).dataset["ordinaryOption"] ?? null,
    })));
    expect(parts.some(p => p.ordinary === chosen.key)).toBe(true);
    expect(parts.some(p => p.ordinary === other.key)).toBe(false);
    const excludedRuns = await root.locator(`input[data-ordinary-option="${other.key}"]`).evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).dataset["runs"]!));
    const bytes = await download(page, "Quick");
    const result = await inspect(bytes);
    // The title is the PDF's metadata (pdf.ts setTitle); the pages print only the part headings.
    const pdfTitle = (await PDFDocument.load(bytes, { updateMetadata: false })).getTitle() ?? "";
    expect(pdfTitle).toContain(`with Missa ${fixture.mass} — ${dateLabel(fixture.date)}`);
    expect(pdfTitle).not.toContain(`Missa ${fixture.other} `);
    const runs = parts.flatMap(p => parseRuns(p.runs));
    expect(result.markers).toEqual(runs.filter(r => r.letter && r.key).map(r => marker(r.letter!)));
    const typesetSystems = runs.filter(r => r.letter && r.key).reduce((n, r) => n + r.count, 0);
    expect(result.scans).toBe(parts.reduce((n, p) => n + p.systems, 0) - typesetSystems);
    for (const run of excludedRuns.flatMap(parseRuns)) if (run.letter) expect(result.markers).not.toContain(marker(run.letter));
  });

  test("St Therese: the October day PDF has no Tract", async ({ page }) => {
    test.setTimeout(600_000);
    const day = "/day/sancti/10-03/";
    await page.goto(day, { waitUntil: "networkidle" });
    const data = JSON.parse((await page.locator(".export").getAttribute("data-day-service"))!) as { table: DayTable };
    const october = data.table.groups.filter(g => g.group === "other").flatMap(g => g.dates).find(iso => iso.slice(5, 7) === "10");
    expect(october, "an October date in the table's other season group").toBeDefined();
    await page.goto(`${day}?date=${october!}`, { waitUntil: "networkidle" });
    const tract = page.locator('input[name="export-part"][data-part="tract"]');
    expect(await tract.count()).toBeGreaterThan(0);
    for (const box of await tract.all()) await expect(box).not.toBeChecked();
    const omittedRuns = (await tract.evaluateAll(nodes => nodes.map(n => (n as HTMLInputElement).dataset["runs"]!))).flatMap(parseRuns);
    const result = await inspect(await download(page, "Quick"));
    expect(result.letters).not.toContain(lettersOf(["Tract"]));
    for (const run of omittedRuns) if (run.letter) expect(result.markers).not.toContain(marker(run.letter));
  });

  for (const fixture of CASES) for (const mode of ["Quick", "Customize"] as const) {
    test(`${fixture.name}: ${mode} preserves selection, representation and chant`, async ({ page }) => {
      test.setTimeout(600_000);
      await page.goto(fixture.url, { waitUntil: "networkidle" });
      const parts: Part[] = [];
      for (const box of await boxes(page).all()) {
        await expect(box).toBeChecked();
        parts.push({ label: (await box.getAttribute("data-label"))!, systems: Number(await box.getAttribute("data-systems")), runs: parseRuns((await box.getAttribute("data-runs"))!) });
      }
      expect(parts.map(p => p.label)).toEqual(fixture.labels);
      // Today's two selections are entirely fixed typeset: 5 Advent parts / 6 OF lender parts.
      for (const part of parts) {
        expect(part.runs.length).toBeGreaterThan(0);
        expect(part.runs.reduce((n, r) => n + r.count, 0)).toBe(part.systems);
        for (const run of part.runs) { expect(run.key).toBeTruthy(); expect(run.letter).toBeTruthy(); expect(run.a4).toBeTruthy(); }
      }
      const expectedMarkers = (selected: readonly Part[]) => selected.flatMap(p => p.runs.map(r => marker(r.letter!)));
      const exportSelection = async (selected: readonly Part[], scanPart?: Part, allScans = false) => {
        if (mode === "Customize") await openEditor(page);
        const result = await inspect(await download(page, mode));
        headingsInOrder(result.text, selected.map(p => p.label));
        expect(result.markers).toEqual(expectedMarkers(allScans ? [] : selected.filter(p => p !== scanPart)));
        expect(result.scans).toBe(allScans ? selected.reduce((n, p) => n + p.systems, 0) : scanPart?.systems ?? 0);
        if (mode === "Quick") expect(result.chant).toEqual(result.chant.map(() => 0));
        else {
          expect(result.chant.reduce((n, c) => n + c, 0)).toBeGreaterThan(0);
          await closeEditor(page);
        }
        return result;
      };

      await page.locator("#export-paper").selectOption("letter");
      const baseline = await exportSelection(parts);
      if (mode === "Quick") {
        // Quick's Paper picks each typeset part's A4 PDF instead of its Letter one.
        await page.locator("#export-paper").selectOption("a4");
        const a4 = await inspect(await download(page, mode));
        expect(a4.markers).toEqual(parts.flatMap(p => p.runs.map(r => marker(r.a4!))));
        await page.locator("#export-paper").selectOption("letter");
      }
      // The bar announces each change to the selection once (PR 8's selectionchange).
      await page.evaluate(() => {
        const w = window as Window & { selectionChanges?: number };
        w.selectionChanges = 0;
        document.addEventListener("selectionchange", (e) => { if (e instanceof CustomEvent) w.selectionChanges! += 1; });
      });
      const changes = () => page.evaluate(() => (window as Window & { selectionChanges?: number }).selectionChanges ?? 0);
      const omitted = parts.find(p => p.label === fixture.omit)!;
      const remaining = parts.filter(p => p !== omitted);
      await tick(page, remaining.map(p => p.label));
      expect(await changes()).toBe(1);
      const without = await exportSelection(remaining);
      expect(without.letters).not.toContain(lettersOf([omitted.label]));
      for (const text of expectedMarkers([omitted])) expect(without.markers).not.toContain(text);
      await tick(page, parts.map(p => p.label));

      if (fixture.name === "Advent I") {
        // Both visible entry points must omit exactly the same music as tick().
        for (const surface of ["rail", "inline"] as const) {
          const scope = surface === "rail" ? page.locator(".service-rail") : page.locator("#music");
          const box = scope.getByRole("checkbox", { name: `In PDF: ${omitted.label}`, exact: true });
          await box.uncheck();
          const result = await exportSelection(remaining);
          expect(result.letters).not.toContain(lettersOf([omitted.label]));
          for (const text of expectedMarkers([omitted])) expect(result.markers).not.toContain(text);
          await box.check();
        }
      }

      const switched = parts[0]!;
      const key = switched.runs[0]!.key!;
      const ownSegment = page.locator(`.typeset-segment[data-typeset-key="${key}"]`).first();
      await ownSegment.locator(".show-scan").click();
      await expect(ownSegment).toHaveAttribute("data-show", "scan");
      const mixed = await exportSelection(parts, switched);
      expect(mixed.scans - baseline.scans).toBe(switched.systems);

      const beforeSwitch = await changes();
      await page.getByRole("button", { name: "Show the scans", exact: true }).click();
      await expect.poll(changes).toBe(beforeSwitch + 1);
      await exportSelection(parts, undefined, true);
      expect(await changes()).toBe(beforeSwitch + 1);
      await page.getByRole("button", { name: "Show the typeset music", exact: true }).click();
      await expect(page.locator("html")).not.toHaveAttribute("data-view", "scans");
      await expect.poll(() => page.evaluate(() => localStorage.getItem("typeset-view"))).toBe("typeset");
      await exportSelection(parts);

      if (mode === "Customize") {
        await openEditor(page);
        await setChant(page, "off");
        const off = await inspect(await download(page, mode));
        expect(off.chant).toEqual(off.chant.map(() => 0));
        expect(off.markers).toEqual(expectedMarkers(parts));
        expect(off.scans).toBe(0);
        // Characterisation: fixed pages are embedded whole, without added headings when chant is Off.
        // Our stand-ins have only markers. "Before each part" above adds the headings on chant pages.
        for (const part of parts) expect(off.letters).not.toContain(lettersOf([part.label]));
        await closeEditor(page);
      }
    });
  }

  test("Advent I: Quick preserves an omission made in the phone sheet", async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CASES[0].url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Choose parts/ }).click();
    const sheet = page.getByRole("dialog", { name: "Choose parts", exact: true });
    const box = sheet.getByRole("checkbox", { name: "In PDF: Gradual", exact: true });
    const omittedRuns = parseRuns((await box.getAttribute("data-runs"))!);
    const remaining = await boxes(page).evaluateAll(nodes => nodes.filter(n => (n as HTMLInputElement).dataset["label"] !== "Gradual")
      .map(n => ({ label: (n as HTMLInputElement).dataset["label"]!, runs: (n as HTMLInputElement).dataset["runs"]! })));
    await box.uncheck();
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expect(sheet).not.toBeVisible();
    const result = await inspect(await download(page, "Quick"));
    headingsInOrder(result.text, remaining.map(p => p.label));
    expect(result.letters).not.toContain(lettersOf(["Gradual"]));
    expect(result.markers).toEqual(remaining.flatMap(p => parseRuns(p.runs).map(r => marker(r.letter!))));
    for (const run of omittedRuns) expect(result.markers).not.toContain(marker(run.letter!));
    expect(result.scans).toBe(0);
    expect(result.chant).toEqual(result.chant.map(() => 0));
  });

  for (const width of [1024, 390]) test(`Advent I: Customize Change parts through the ${width === 390 ? "sheet" : "rail"} omits Gradual from the PDF`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.goto(CASES[0].url, { waitUntil: "networkidle" });
    const parts: Part[] = [];
    for (const box of await boxes(page).all()) parts.push({
      label: (await box.getAttribute("data-label"))!,
      systems: Number(await box.getAttribute("data-systems")),
      runs: parseRuns((await box.getAttribute("data-runs"))!),
    });
    expect(parts.map(p => p.label)).toEqual(CASES[0].labels);
    const omitted = parts.find(p => p.label === "Gradual")!;
    const remaining = parts.filter(p => p !== omitted);
    await page.locator("#export-customize").click();
    await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
    await expect(downloadButton(page)).toBeEnabled({ timeout: 120_000 });
    const settings = page.locator('dialog.cx [data-cx="settings-btn"]');
    if (await settings.isVisible()) await settings.click();
    await page.locator('dialog.cx select[name="cx-page"]').selectOption('letter');
    // Chant adds real part headings to the fixed stand-in PDFs, as in the baseline cases.
    await setChant(page, "before");
    if (await settings.isVisible()) await page.locator('dialog.cx [data-cx="panel-done"]').click();
    await page.locator('dialog.cx [data-cx="change-parts"]').click();
    await expect(page.locator("dialog.cx")).not.toHaveAttribute("open", "");
    const selector = width === 390 ? page.locator("#choose-parts-sheet") : page.locator(".service-rail");
    await expect(selector).toBeVisible();
    await selector.getByRole("checkbox", { name: "In PDF: Gradual", exact: true }).uncheck();
    if (width === 390) await selector.getByRole("button", { name: "Done", exact: true }).click();
    else await selector.getByRole("button", { name: "Return to Customize", exact: true }).click();
    await expect(page.locator("dialog.cx")).toHaveAttribute("open", "");
    await expect(page.locator('dialog.cx [data-cx="partlist"] .cx-pn')).toHaveText(remaining.map(p => p.label));
    await expect(page.locator("dialog.cx")).not.toHaveAttribute("data-panel", "open");
    const result = await inspect(await download(page, "Customize"));
    headingsInOrder(result.text, remaining.map(p => p.label));
    expect(result.letters).not.toContain(lettersOf([omitted.label]));
    expect(result.markers).toEqual(remaining.flatMap(p => p.runs.map(r => marker(r.letter!))));
    for (const run of omitted.runs) expect(result.markers).not.toContain(marker(run.letter!));
    expect(result.scans).toBe(0);
    expect(result.chant.reduce((n, count) => n + count, 0)).toBeGreaterThan(0);
  });

  // PR 17: the Ordinary Form occasion in the rail. Year C leaves Communion I (Years A and B) on the page, unticked;
  // an inline In PDF box in the reading column omits one more part. The PDF holds the rest of the lenders, in order.
  test("OF Corpus Christi: Year C, ticked through the reading column, holds the selected lenders in order", async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/ordinary-form/corpus-christi/?cycle=C&season=ordinary", { waitUntil: "networkidle" });
    const parts: (Part & { id: string; years: string[]; checked: boolean })[] = [];
    for (const box of await boxes(page).all()) parts.push({
      id: (await box.getAttribute("value"))!,
      label: (await box.getAttribute("data-label"))!,
      systems: Number(await box.getAttribute("data-systems")),
      runs: parseRuns((await box.getAttribute("data-runs"))!),
      years: ((await box.getAttribute("data-years")) ?? "").split(",").filter(Boolean),
      checked: await box.isChecked(),
    });
    const excluded = parts.filter(p => p.years.length > 0 && !p.years.includes("C"));
    expect(excluded.length, "Corpus Christi has a Year A/B alternative").toBeGreaterThan(0);
    for (const p of parts) expect(p.checked, p.label).toBe(!excluded.includes(p));
    const selected = parts.filter(p => p.checked);
    const omitted = selected.find(p => p.label.startsWith("Gradual"));
    if (!omitted) throw new Error(`No Gradual among ${selected.map(p => p.label).join(", ")}`);
    await page.locator(`.reading-column [data-inline-part="${omitted.id}"]`).uncheck();
    await expect(page.locator(`.service-rail input[name="export-part"][value="${omitted.id}"]`)).not.toBeChecked();
    const remaining = selected.filter(p => p !== omitted);
    const result = await inspect(await download(page, "Quick"));
    headingsInOrder(result.text, remaining.map(p => p.label));
    for (const gone of [omitted, ...excluded]) {
      expect(result.letters).not.toContain(lettersOf([gone.label]));
      for (const run of gone.runs) if (run.letter) expect(result.markers).not.toContain(marker(run.letter));
    }
    expect(result.markers).toEqual(remaining.flatMap(p => p.runs.flatMap(r => r.letter ? [marker(r.letter)] : [])));
    expect(result.chant).toEqual(result.chant.map(() => 0));
  });

  test("dated Vespers: the lineup PDF follows the sung order", async ({ page }) => {
    test.setTimeout(600_000);
    await page.goto("/vespers/2026-11-08/", { waitUntil: "networkidle" });
    const parts = await boxes(page).evaluateAll(nodes => nodes.map(node => ({
      label: (node as HTMLInputElement).dataset["label"]!,
      systems: Number((node as HTMLInputElement).dataset["systems"]),
      checked: (node as HTMLInputElement).checked,
    })));
    expect(parts.length).toBeGreaterThan(10);
    for (const part of parts) expect(part.checked, part.label).toBe(true);
    // The rendered reading order is independent of the export selector.
    const sung = await page.locator(".lineup .item").evaluateAll(nodes => nodes.flatMap(node => {
      const systems = node.querySelectorAll("img.system");
      if (systems.length === 0) return [];
      const section = node.closest(".vespers-section")!;
      const heading = section.querySelector("h2")!.textContent!.trim();
      const itemHeading = node.querySelector("h3")?.textContent?.trim();
      return [section.querySelectorAll(".item").length > 1
        ? `${heading}: ${itemHeading ?? (systems[0] as HTMLElement).dataset["item"]}` : heading];
    }));
    expect(parts.map(part => part.label)).toEqual(sung);
    const result = await inspect(await download(page, "Quick"));
    headingsInOrder(result.text, sung);
    expect(result.scans).toBe(parts.reduce((sum, part) => sum + part.systems, 0));
    expect(result.markers).toEqual([]);
    expect(result.chant).toEqual(result.chant.map(() => 0));
  });

});
