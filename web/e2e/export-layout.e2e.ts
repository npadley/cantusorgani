// B10a: the acceptance matrix (Contracts section 3), through the real editor, the real layout and PDF workers,
// and a PDF verifier.
//
//   pnpm build:e2e && pnpm test:e2e:export        (builds dist-e2e/ with the fixture manifest and the test pages)
//
// For each case the spec sets the case's settings through the editor's own controls, waits for the layout, asserts
// what the contract specifies about it (page size, staff size, systems, break placement, nothing missing), downloads
// the PDF with the Download button, reads the canonical layout out of the page, and hands both to
// scripts/verify-export-pdf.ts. Cases with a UI path use it for every setting, with one exception noted per case.
//
// The matrix is the 13 cases of Contracts section 3 plus the two further large-staff iPad cases the layout work
// measured (ipad11-p-large-auto, ipadmini-p-large-auto). Outputs go to <repo>/build/b10a/ (never committed).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";

import { verifyExportPdf } from "../scripts/verify-export-pdf";
import type { CanonicalExpectation, VerifyReport } from "../scripts/verify-export-pdf";

const FIXTURES = "src/lib/export-layout/__fixtures__";
const PAGE = "/e2e/export-layout-worker/";
const MEI_URL = "/__e2e__/kyrie-ix.mei";
const OUT = resolve(process.cwd(), "..", "build", "b10a");
const MEI = readFileSync(`${FIXTURES}/kyrie-ix.mei`, "utf8");

interface Manifest { readonly parts: readonly Record<string, unknown>[] }
const entry = (JSON.parse(readFileSync(`${FIXTURES}/manifest.fixture.json`, "utf8")) as Manifest).parts[0] as Record<string, unknown> & { boundaries: { id: string; measureId: string; sourceBreak: boolean }[] };
const meiPart = {
  id: "kyrie:0", kind: "mei", label: "Kyrie IX",
  heading: { label: "Kyrie IX", rubric: "Lord, have mercy", rubricTranslation: null, credit: "Nova Organi Harmonia" },
  sourceSystemCount: 5, sourceRevision: entry["renderHash"], target: entry["target"], renderHash: entry["renderHash"],
  conversion: { ...entry, meiUrl: MEI_URL },
};

// ------------------------------------------------------------------- the matrix ---
type Staff = "small" | "medium" | "large";
interface Case {
  readonly id: string;
  readonly page: "letter" | "a4" | "a5" | "ipad-mini" | "ipad-11" | "custom";
  readonly custom?: readonly [number, number];
  readonly orientation: "portrait" | "landscape";
  readonly staff: Staff;
  readonly lines: "original" | "automatic";
  readonly cap: number | null;
}
const CASES: readonly Case[] = [
  { id: "letter-p-orig", page: "letter", orientation: "portrait", staff: "medium", lines: "original", cap: null },
  { id: "letter-p-auto", page: "letter", orientation: "portrait", staff: "medium", lines: "automatic", cap: null },
  { id: "letter-l-orig", page: "letter", orientation: "landscape", staff: "medium", lines: "original", cap: null },
  { id: "a4-p-orig", page: "a4", orientation: "portrait", staff: "medium", lines: "original", cap: null },
  { id: "a4-l-auto", page: "a4", orientation: "landscape", staff: "medium", lines: "automatic", cap: null },
  { id: "a5-p-auto", page: "a5", orientation: "portrait", staff: "medium", lines: "automatic", cap: null },
  { id: "a5-l-orig", page: "a5", orientation: "landscape", staff: "medium", lines: "original", cap: null },
  { id: "letter-p-large-auto", page: "letter", orientation: "portrait", staff: "large", lines: "automatic", cap: null },
  { id: "letter-p-small-cap2", page: "letter", orientation: "portrait", staff: "small", lines: "automatic", cap: 2 },
  { id: "ipad11-p-auto", page: "ipad-11", orientation: "portrait", staff: "medium", lines: "automatic", cap: null },
  { id: "ipad11-l-large-auto", page: "ipad-11", orientation: "landscape", staff: "large", lines: "automatic", cap: null },
  { id: "ipadmini-p-auto", page: "ipad-mini", orientation: "portrait", staff: "medium", lines: "automatic", cap: null },
  { id: "custom-160x230-auto", page: "custom", custom: [160, 230], orientation: "portrait", staff: "medium", lines: "automatic", cap: null },
  // Beyond the 13 required: the other two large-staff iPad layouts.
  { id: "ipad11-p-large-auto", page: "ipad-11", orientation: "portrait", staff: "large", lines: "automatic", cap: null },
  { id: "ipadmini-p-large-auto", page: "ipad-mini", orientation: "portrait", staff: "large", lines: "automatic", cap: null },
];
const REQUIRED = 13;
const PRESET_MM: Readonly<Record<string, readonly [number, number]>> = {
  letter: [215.9, 279.4], a4: [210, 297], a5: [148, 210], "ipad-mini": [115.9, 176.6], "ipad-11": [157.8, 227.1],
};
const STAFF_MM: Readonly<Record<Staff, number>> = { small: 5.6, medium: 7.2, large: 9.6 };
const physical = (c: Case): readonly [number, number] => {
  const [w, h] = c.custom ?? PRESET_MM[c.page]!;
  return c.orientation === "landscape" ? [h, w] : [w, h];
};
const expectedMargin = (c: Case): number => (c.page === "letter" || c.page === "a4" || c.page === "a5" ? 12 : 4);

// Facts from the fixture, not from the result under test.
const NOTE_IDS = [...MEI.matchAll(/<note\b[^>]*?\sxml:id="(ev[^"c]+)"/g)].map((m) => m[1]!);
const SYLLABLE_LETTERS = [...MEI.matchAll(/<syl\b[^>]*>([^<]*)<\/syl>/g)].map((m) => m[1]!).join("").normalize("NFC").replace(/[^\p{L}]/gu, "");
const MEASURE_OF = new Map(entry.boundaries.map((b) => [b.id, b.measureId]));
const SOURCE_BREAKS = entry.boundaries.filter((b) => b.sourceBreak).map((b) => b.id).sort();
/** Measures that end a lyric word (a copy of layout.ts wordFinalMeasures, kept independent on purpose). */
const WORD_FINAL = (() => {
  const out = new Set<string>();
  let open = false;
  for (const block of MEI.split(/<measure\b/).slice(1)) {
    const id = /\sxml:id="([^"]+)"/.exec(block)?.[1];
    for (const m of block.matchAll(/<syl\b[^>]*?\swordpos="([imts])"/g)) open = m[1] === "i" || m[1] === "m";
    if (id && !open) out.add(id);
  }
  return out;
})();

// ------------------------------------------------------------------ page glue ---
interface PageFacts {
  widthMm: number; heightMm: number; systemCount: number | null; kind: string;
  ids: string[]; namespace: string; starts: string[];
}
interface Snapshot {
  phase: string; canDownload: boolean; token: number; requestToken: number;
  settings: { page: string; staff: string; orientation: string; marginMm: number; maxSystems: number | null; linePolicy: string; customSize: { widthMm: number; heightMm: number } | null };
  errors: string[]; complete: boolean; pages: PageFacts[];
}
interface Win { __openEditor(parts: unknown[], title: string): Promise<{ controller: { subscribe(l: (s: unknown) => void): () => void } }>; __editor?: Win["__openEditor"] extends (...a: never[]) => Promise<infer H> ? H : never }

test.setTimeout(240_000);

async function openEditor(page: Page): Promise<void> {
  const probe = await page.request.get(PAGE);
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1 (use pnpm build:e2e)");
  await page.route(`**${MEI_URL}`, (route) => route.fulfill({ contentType: "application/xml", body: MEI }));
  await page.goto(PAGE);
  await expect(page.locator("#state")).toHaveAttribute("data-state", "ready");
  await page.locator("#export-customize").focus();
  await page.evaluate(async (part) => {
    const w = window as unknown as Win;
    w.__editor = await w.__openEditor([part], "Missa IX · Kyrie");
  }, meiPart);
  await expect.poll(async () => (await snapshot(page)).canDownload, { timeout: 120_000 }).toBe(true);
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    let out: Snapshot | null = null;
    w.__editor!.controller.subscribe((s) => {
      const st = s as {
        phase: string; canDownload: boolean; requestToken: number; settings: Snapshot["settings"];
        result: { token: number; complete: boolean; diagnostics: { severity: string; code: string }[]; pages: { kind: string; widthMm: number; heightMm: number; systemCount: number | null; svg?: { ids: string[]; namespace: string }; boundaries?: { boundaryId: string }[] }[] } | null;
      };
      out = {
        phase: st.phase, canDownload: st.canDownload, requestToken: st.requestToken, token: st.result?.token ?? -1, settings: st.settings,
        errors: (st.result?.diagnostics ?? []).filter((d) => d.severity === "error").map((d) => d.code),
        complete: st.result?.complete ?? false,
        pages: (st.result?.pages ?? []).map((p) => ({
          kind: p.kind, widthMm: p.widthMm, heightMm: p.heightMm, systemCount: p.systemCount,
          ids: p.svg?.ids ?? [], namespace: p.svg?.namespace ?? "", starts: (p.boundaries ?? []).map((b) => b.boundaryId),
        })),
      };
    })();
    return out!;
  });
}

const radio = (page: Page, name: string, value: string) => page.locator(`dialog.cx input[name="${name}"][value="${value}"]`).locator("xpath=..");

/** Set every setting of the case through the editor's controls. */
async function applySettings(page: Page, c: Case): Promise<void> {
  if (c.page === "custom") {
    await radio(page, "cx-tier", "custom").click();
    const [w, h] = c.custom!;
    await page.locator('dialog.cx [data-cx="custom-w"]').fill(String(w));
    await page.locator('dialog.cx [data-cx="custom-h"]').fill(String(h));
    await page.locator('dialog.cx [data-cx="custom-h"]').press("Tab");
  } else if (c.page === "ipad-mini" || c.page === "ipad-11") {
    await radio(page, "cx-tier", "ipad").click();
    await radio(page, "cx-ipad", c.page).click();
  } else if (c.page !== "letter") {
    await radio(page, "cx-print", c.page).click();
  }
  if (c.orientation === "landscape") await radio(page, "cx-orient", "landscape").click();
  if (c.staff !== "medium") await radio(page, "cx-staff", c.staff).click();
  if (c.lines === "automatic") await radio(page, "cx-lines", "automatic").click();
  const match = (s: Snapshot): boolean =>
    s.settings.page === c.page && s.settings.orientation === c.orientation && s.settings.staff === c.staff
    && s.settings.linePolicy === c.lines && s.settings.maxSystems === null;
  await expect.poll(async () => { const s = await snapshot(page); return match(s) && s.canDownload && s.token === s.requestToken; }, { timeout: 120_000 }).toBe(true);

  if (c.cap !== null) {
    // The Systems stepper: from "As many as fit (now N)", minus lowers the cap one step at a time.
    const value = page.locator('dialog.cx [data-cx="cap-value"]');
    const now = Number(/now (\d+)/.exec((await value.textContent()) ?? "")![1]);
    for (let n = now; n > c.cap; n--) await page.locator('dialog.cx [data-cx="cap-minus"]').click();
    await expect(value).toHaveText(String(c.cap));
    await expect.poll(async () => { const s = await snapshot(page); return s.settings.maxSystems === c.cap && s.canDownload && s.token === s.requestToken; }, { timeout: 120_000 }).toBe(true);
  }
}

/** What the canonical layout draws, read from the preview of that very result: staff lines and text, in mm. */
async function canonicalExpectation(page: Page, staffHeightMm: number): Promise<{ expectation: CanonicalExpectation; lyricLetters: string }> {
  const pages = await page.evaluate(() => {
    const out: { widthMm: number; heightMm: number; staves: number[][]; text: string[] }[] = [];
    for (const wrap of document.querySelectorAll<HTMLElement>("dialog.cx .cx-pg")) {
      const frame = wrap.querySelector<HTMLElement>(".cx-page")!;
      const sheet = wrap.querySelector<HTMLElement>(".cx-sheet")!.getBoundingClientRect();
      const heightMm = Number(frame.dataset["heightMm"]);
      const staves: number[][] = [];
      // Each measure draws its own five-line segment of every staff, so one measure per system gives the staves.
      for (const system of wrap.querySelectorAll(".cx-svg g.system")) {
        for (const staff of system.querySelector("g.measure")!.querySelectorAll(":scope > g.staff")) {
          const ys = [...staff.querySelectorAll(":scope > path")].map((l) => { const r = l.getBoundingClientRect(); return ((r.top + r.height / 2 - sheet.top) / sheet.height) * heightMm; });
          if (ys.length === 5) staves.push(ys.sort((a, b) => a - b));
        }
      }
      const text = [...wrap.querySelectorAll(".cx-svg text")].map((t) => t.textContent ?? "");
      text.push(...[...wrap.querySelectorAll(".cx-text text")].map((t) => t.textContent ?? ""));
      out.push({ widthMm: Number(frame.dataset["widthMm"]), heightMm, staves, text });
    }
    return out;
  });
  const lyrics = await page.evaluate(() => [...document.querySelectorAll("dialog.cx .cx-svg text")].map((t) => t.textContent ?? "").join(""));
  return { expectation: { staffHeightMm, pages }, lyricLetters: lyrics.normalize("NFC").replace(/[^\p{L}]/gu, "") };
}

/** Press Download and read the file it delivers. */
async function download(page: Page): Promise<{ bytes: Uint8Array; filename: string }> {
  const button = page.locator('dialog.cx [data-cx="download"]');
  await expect(button).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), button.click()]);
  return { bytes: new Uint8Array(readFileSync(await file.path())), filename: file.suggestedFilename() };
}

interface Produced { snap: Snapshot; expectation: CanonicalExpectation; lyricLetters: string; bytes: Uint8Array; filename: string }
async function produce(page: Page, c: Case): Promise<Produced> {
  await openEditor(page);
  await applySettings(page, c);
  const snap = await snapshot(page);
  const { expectation, lyricLetters } = await canonicalExpectation(page, STAFF_MM[c.staff]);
  const { bytes, filename } = await download(page);
  return { snap, expectation, lyricLetters, bytes, filename };
}

// ---------------------------------------------------------------- the matrix ---
interface Row { case: string; required: boolean; pages: number; systems: string; staves: number; maxStaffDeltaMm: string; midWordStarts: number; verifier: string }
const rows: Row[] = [];

test.describe("Contracts section 3 matrix: editor, workers, PDF", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.afterAll(() => {
    if (rows.length === 0) return;
    mkdirSync(OUT, { recursive: true });
    const head = "| case | required | pages | systems per page | staves | max staff delta (mm) | mid-word starts | verifier |\n|---|---|---|---|---|---|---|---|\n";
    writeFileSync(`${OUT}/matrix.md`, head + rows.map((r) => `| ${r.case} | ${r.required ? "yes" : "extra"} | ${r.pages} | ${r.systems} | ${r.staves} | ${r.maxStaffDeltaMm} | ${r.midWordStarts} | ${r.verifier} |`).join("\n") + "\n");
    console.table(rows);
  });

  test("lists the 13 required cases and the extra large-staff iPad cases", () => {
    expect(CASES.slice(0, REQUIRED).map((c) => c.id)).toEqual([
      "letter-p-orig", "letter-p-auto", "letter-l-orig", "a4-p-orig", "a4-l-auto", "a5-p-auto", "a5-l-orig", "letter-p-large-auto",
      "letter-p-small-cap2", "ipad11-p-auto", "ipad11-l-large-auto", "ipadmini-p-auto", "custom-160x230-auto",
    ]);
    expect(CASES.filter((c) => c.staff === "large" && c.page.startsWith("ipad")).map((c) => c.id)).toEqual(["ipad11-l-large-auto", "ipad11-p-large-auto", "ipadmini-p-large-auto"]);
    expect(NOTE_IDS).toHaveLength(358);
    expect(SYLLABLE_LETTERS.length).toBeGreaterThan(30);
  });

  for (const c of CASES) {
    test(c.id, async ({ page }) => {
      const { snap, expectation, lyricLetters, bytes, filename } = await produce(page, c);
      const [wantW, wantH] = physical(c);

      // --- the layout the editor reached, from the UI settings
      expect(snap.settings).toMatchObject({ page: c.page, orientation: c.orientation, staff: c.staff, linePolicy: c.lines, maxSystems: c.cap, marginMm: expectedMargin(c) });
      if (c.custom) expect(snap.settings.customSize).toEqual({ widthMm: c.custom[0], heightMm: c.custom[1] });
      expect(snap.errors).toEqual([]);
      expect(snap.complete).toBe(true);
      expect(snap.pages.length).toBeGreaterThan(0);
      expect(snap.pages.every((p) => p.kind === "mei")).toBe(true);

      // --- page size, separate pages
      for (const p of snap.pages) { expect(p.widthMm).toBeCloseTo(wantW, 1); expect(p.heightMm).toBeCloseTo(wantH, 1); }

      // --- all voices, lyrics and final systems are present; nothing is clipped (no CONTENT_CLIPPED among the errors above)
      const present = new Set(snap.pages.flatMap((p) => p.ids));
      const missing = NOTE_IDS.filter((id) => !snap.pages.some((p) => present.has(`${p.namespace}-${id}`)));
      expect(missing).toEqual([]);
      // Every syllable, in order, on the pages together (the heading and credit are checked by the verifier per page).
      expect(lyricLetters).toBe(SYLLABLE_LETTERS);

      // --- systems and the cap
      const perPage = snap.pages.map((p) => p.systemCount!);
      const systems = perPage.reduce((a, b) => a + b, 0);
      expect(systems).toBeGreaterThanOrEqual(snap.pages.length);
      if (c.cap !== null) for (const n of perPage) expect(n).toBeLessThanOrEqual(c.cap);

      // --- staff height within 0.1 mm on the canonical layout and (below) in the PDF
      const staves = expectation.pages.flatMap((p) => p.staves);
      expect(staves.length).toBeGreaterThanOrEqual(systems);
      for (const s of staves) expect(Math.abs(s[4]! - s[0]! - STAFF_MM[c.staff])).toBeLessThanOrEqual(0.1);

      // --- break placement
      const starts = snap.pages.flatMap((p) => p.starts);
      const midWord = starts.filter((id) => !WORD_FINAL.has(MEASURE_OF.get(id)!));
      if (c.lines === "original") {
        // Original lines: the system starts are exactly the source's own line breaks.
        expect([...starts].sort()).toEqual(SOURCE_BREAKS);
      } else {
        // Automatic: no system starts inside a word.
        expect(midWord).toEqual([]);
      }

      // --- the downloaded PDF
      expect(filename).toBe(`Missa IX · Kyrie (${c.page === "custom" ? "custom" : { letter: "Letter", a4: "A4", a5: "A5", "ipad-mini": "iPad mini", "ipad-11": "11-inch iPad" }[c.page]}).pdf`);
      expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
      mkdirSync(`${OUT}/matrix`, { recursive: true });
      writeFileSync(`${OUT}/matrix/${c.id}.pdf`, bytes);
      writeFileSync(`${OUT}/matrix/${c.id}.json`, JSON.stringify(expectation));
      const report: VerifyReport = await verifyExportPdf(bytes, expectation);
      expect(report.problems).toEqual([]);
      expect(report.pageCount).toBe(snap.pages.length);
      rows.push({
        case: c.id, required: CASES.indexOf(c) < REQUIRED, pages: snap.pages.length, systems: perPage.join(" + "), staves: staves.length,
        maxStaffDeltaMm: Math.max(...report.pages.map((p) => p.maxStaffDeltaMm)).toFixed(4), midWordStarts: c.lines === "automatic" ? midWord.length : 0,
        verifier: report.ok ? "pass" : "FAIL",
      });
    });
  }
});

// ------------------------------------------------- the verifier rejects wrong PDFs ---
const BASE_CASE = CASES.find((c) => c.id === "ipad11-p-auto")!;

/** The page's content streams in order, as an array of refs (pdf-lib stores one stream or an array). */
function contentRefs(doc: PDFDocument, pageIndex: number): { refs: PDFRef[]; set(next: PDFRef[]): void } {
  const page = doc.getPage(pageIndex);
  const raw = page.node.get(PDFName.of("Contents"));
  const refs: PDFRef[] = raw instanceof PDFArray ? raw.asArray().map((r) => r as PDFRef) : [raw as PDFRef];
  return { refs, set: (next) => page.node.set(PDFName.of("Contents"), doc.context.obj(next)) };
}

async function mutated(bytes: Uint8Array, how: "drop-page" | "shift-staff" | "alter-syllable"): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (how === "drop-page") {
    doc.removePage(doc.getPageCount() - 1);
  } else if (how === "shift-staff") {
    // Everything on page 1 moves 2.8 mm down.
    const { refs, set } = contentRefs(doc, 0);
    const before = doc.context.register(doc.context.stream("q 1 0 0 1 0 -8 cm\n"));
    const after = doc.context.register(doc.context.stream("\nQ"));
    set([before, ...refs, after]);
  } else {
    // One glyph of the first syllable is replaced by another glyph the page uses, so it reads as a different letter.
    const { refs, set } = contentRefs(doc, 0);
    const text = refs.map((r) => new TextDecoder("latin1").decode(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode()));
    const all = text.join("\n");
    const codes = [...new Set([...all.matchAll(/<([0-9a-fA-F]{4})>\s*Tj/g)].map((m) => m[1]!))];
    const hit = /<([0-9a-fA-F]{4})>\s*Tj/.exec(all);
    if (hit === null || codes.length < 2) throw new Error("no text-showing operator to alter");
    const replacement = codes.find((k) => k !== hit[1])!;
    const changed = all.replace(hit[0], hit[0].replace(hit[1]!, replacement));
    set([doc.context.register(doc.context.stream(new TextEncoder().encode(changed)))]);
  }
  return doc.save({ useObjectStreams: false });
}

test.describe("the verifier fails a PDF that does not match the canonical layout", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const how of ["drop-page", "shift-staff", "alter-syllable"] as const) {
    test(`${how}`, async ({ page }) => {
      const { expectation, bytes } = await produce(page, BASE_CASE);
      expect(expectation.pages.length).toBeGreaterThan(1);
      const good = await verifyExportPdf(bytes, expectation);
      expect(good.problems).toEqual([]);
      const bad = await verifyExportPdf(await mutated(bytes, how), expectation);
      expect(bad.ok, `a PDF with ${how} must fail`).toBe(false);
      const expectedProblem = { "drop-page": /page count/, "shift-staff": /staff line is .* mm from the canonical position/, "alter-syllable": /text differs/ }[how];
      expect(bad.problems.join("\n")).toMatch(expectedProblem);
      mkdirSync(`${OUT}/negative`, { recursive: true });
      writeFileSync(`${OUT}/negative/${how}.txt`, `${bad.problems.join("\n")}\n`);
    });
  }
});

// ------------------------------------------------------- what the PDFs look like ---
test("renders sample pages of the matrix PDFs with pdf.js (build/b10a/)", async ({ page }) => {
  test.skip(rows.length === 0, "needs the matrix tests to have written their PDFs in this run");
  const probe = await page.request.get(PAGE);
  test.skip(probe.status() === 404, "dist was built without E2E_TEST_PAGES=1");
  await page.goto(PAGE);
  await expect(page.locator("#state")).toHaveAttribute("data-state", "ready");
  mkdirSync(OUT, { recursive: true });
  for (const [id, n, scale] of [["ipad11-p-auto", 1, 2], ["letter-p-large-auto", 1, 1.5], ["a5-l-orig", 2, 2]] as const) {
    const png = await page.evaluate(([b64, no, sc]) => (window as unknown as { __renderPdfPage(b: string, n: number, s: number): Promise<string> }).__renderPdfPage(b64, no, sc),
      [readFileSync(`${OUT}/matrix/${id}.pdf`).toString("base64"), n, scale] as const);
    expect(png.startsWith("data:image/png;base64,")).toBe(true);
    writeFileSync(`${OUT}/pdf-${id}-p${n}.png`, Buffer.from(png.split(",")[1]!, "base64"));
  }
});
