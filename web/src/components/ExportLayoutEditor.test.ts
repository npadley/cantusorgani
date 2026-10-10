import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { COPY_DECK, copyFor } from "../scripts/exportLayoutCopy";
import { DEFAULT_SETTINGS } from "../lib/export-layout/types";
import type { LayoutDiagnostic, LayoutDiagnosticCode, UnsatisfiableReason } from "../lib/export-layout/types";
import ExportLayoutEditor from "./ExportLayoutEditor.astro";

const SOURCE = readFileSync(new URL("../styles/exportEditor.css", import.meta.url), "utf8");
const SCRIPT = readFileSync(new URL("../scripts/exportLayout.ts", import.meta.url), "utf8");

// Exhaustive by construction: a new code in the union fails to compile here until it is added.
const ALL_CODES = Object.keys({
  UNSATISFIABLE_LAYOUT: 1, CAP_EXCEEDED: 1, STALE_ANCHOR: 1, UNSAFE_ANCHOR: 1, CONTENT_CLIPPED: 1,
  EVENT_MISSING: 1, STAFF_HEIGHT_MISMATCH: 1, CROWDED_ORIGINAL_LINES: 1,
  RENDERER_FAILED: 1, RENDERER_LOAD_FAILED: 1, ASSET_MISSING: 1, ASSET_HASH_MISMATCH: 1,
  UNSAFE_SVG: 1, INVALID_PAGE: 1, FONT_UNAVAILABLE: 1, BUDGET_EXCEEDED: 1, SOURCE_CEILING: 1,
  FIXED_PAGE_COUNT_MISMATCH: 1, SCAN_TOO_LARGE: 1, PDF_FAILED: 1, CANCELLED: 1, TIMEOUT: 1,
} satisfies Record<LayoutDiagnosticCode, 1>) as LayoutDiagnosticCode[];
const REASONS: readonly UnsatisfiableReason[] = ["system-too-tall", "system-too-wide", "heading-too-tall", "no-convergence"];
const SENTINEL = "SENTINEL-detail-9f3a";

const diag = (code: LayoutDiagnosticCode, reason: UnsatisfiableReason | null = null): LayoutDiagnostic => ({
  code, severity: "error", partId: "kyrie:0", pageIndex: null, boundaryIds: [], reason,
  suggestions: reason === null ? [] : ["smaller-music", "landscape"], detail: SENTINEL,
});
const ctx = { partLabel: "Kyrie", settings: { ...DEFAULT_SETTINGS, staff: "large" as const } };

describe("copy deck", () => {
  it("should have a row for every LayoutDiagnosticCode and never print a code or the detail", () => {
    expect(ALL_CODES).toHaveLength(22);
    expect(Object.keys(COPY_DECK).sort()).toEqual([...ALL_CODES].sort());
    for (const code of ALL_CODES) {
      const reasons = code === "UNSATISFIABLE_LAYOUT" ? REASONS : [null];
      for (const reason of reasons) {
        const copy = copyFor(diag(code, reason), ctx);
        const shown = JSON.stringify(copy);
        expect(shown, code).not.toContain(SENTINEL);
        expect(shown, code).not.toMatch(/\b(MEI|SVG|WASM|Verovio)\b/);
        if (code !== "CANCELLED") expect(copy.text.length, code).toBeGreaterThan(0);
        if (copy.blocking) expect(copy.text, code).toMatch(/^Can't|^Your saved/);
      }
    }
  });

  it("should write the spec sentences for the layout failures, naming part, size and paper", () => {
    expect(copyFor(diag("UNSATISFIABLE_LAYOUT", "system-too-tall"), ctx).text).toBe("Can't fit Kyrie: at Large music size, one system is taller than the space on a Letter portrait page.");
    expect(copyFor(diag("UNSATISFIABLE_LAYOUT", "system-too-wide"), ctx).text).toBe("Can't fit Kyrie: its original lines are too long for Letter portrait at Large music size.");
    expect(copyFor(diag("UNSATISFIABLE_LAYOUT", "no-convergence"), ctx).text).toBe("Can't settle the page breaks for Kyrie with these settings.");
    expect(copyFor(diag("UNSATISFIABLE_LAYOUT", "system-too-tall"), ctx).actions).toEqual(["smaller-music", "landscape"]);
  });

  it("should treat unknown codes and internal faults with the generic row, and keep advisories non-blocking", () => {
    const unknown = copyFor({ ...diag("CAP_EXCEEDED"), code: "FROM_THE_FUTURE" as LayoutDiagnosticCode }, ctx);
    expect(unknown.text).toBe("Can't update the preview of Kyrie. Your settings are kept.");
    expect(unknown.actions).toEqual(["try-again", "use-original"]);
    expect(copyFor({ ...diag("CROWDED_ORIGINAL_LINES"), severity: "warning" }, ctx).blocking).toBe(false);
    expect(copyFor(diag("CANCELLED"), ctx).silent).toBe(true);
  });

  it("should never read diagnostic.detail anywhere in the editor script", () => {
    const code = (s: string): string => s.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
    expect(code(SCRIPT)).not.toMatch(/\b(d|x|diag|diagnostic)\.detail\b|\[["']detail["']\]/);
    expect(readFileSync(new URL("../scripts/exportLayoutCopy.ts", import.meta.url), "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.detail\b/);
  });
});

describe("ExportLayoutEditor markup", async () => {
  const html = await (await AstroContainer.create()).renderToString(ExportLayoutEditor, { props: {} });

  it("should keep the dialog inside an inert template, labelled by its title and selection", () => {
    expect(html).toMatch(/<template[^>]*data-cx-template/);
    expect(html).toMatch(/<dialog[^>]*class="cx no-print"[^>]*aria-labelledby="cx-title"[^>]*aria-describedby="cx-sel"/);
    expect(html).toMatch(/<h2 id="cx-title" tabindex="-1"[^>]*>Customize export<\/h2>/);
    expect(html).toMatch(/data-cx="close"[^>]*>Close<\/button>/);
  });

  it("should have exactly one live region and no alert until a global error renders one", () => {
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/id="cx-status"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="cx-status"/);
    expect(html).not.toContain('role="alert"');
    expect(html.match(/aria-live=/g)).toHaveLength(1);
  });

  it("should label the settings region and every radio group", () => {
    expect(html).toMatch(/<aside[^>]*role="region"[^>]*aria-label="Export settings"[^>]*tabindex="-1"/);
    const groups = html.match(/<div[^>]*role="radiogroup"[^>]*>/g) ?? [];
    expect(groups.length).toBeGreaterThanOrEqual(9);
    for (const g of groups) expect(g, g).toMatch(/aria-label(ledby)?=/);
    // Real radios, hidden with the sr-only technique (never display:none).
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    for (const r of radios) expect(r, r).toContain('class="sr-only"');
    expect(SOURCE).not.toMatch(/\.sr-only\s*\{[^}]*display:\s*none/);
  });

  it("should offer the specified controls with the specified labels", () => {
    for (const text of ["Music size", "Systems per page", "Page size", "Orientation", "Margins", "Line breaks", "Sung text size", "Space between systems",
      "Choose where systems break", "Reset layout", "Undo", "Download PDF", "Original", "Fit to page", "Print", "iPad", "Custom", "Portrait", "Landscape", "Letter", "A4", "A5", "iPad mini", "11-inch iPad", "13-inch iPad", "Small", "Medium", "Large", "Compact", "Normal", "Spacious", "Each part starts on a new page."]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('aria-label="Fewer systems per page"');
    expect(html).toContain('aria-label="More systems per page"');
    expect(html).toContain('aria-label="Small, 5.6 mm"');
    expect(html).toContain('aria-label="Medium, 7.2 mm"');
    expect(html).toContain('aria-label="Large, 9.6 mm"');
    expect(html).toMatch(/aria-controls="cx-settings"/);
    expect(html).toMatch(/data-cx="margin"[^>]*min="3"[^>]*max="25"/);
    expect(html.match(/<details/g)).toHaveLength(1); // only More options
    expect(html).not.toMatch(/type="range"/); // no sliders anywhere
  });

  it("should use CSS media queries at 62rem and 40rem, never box-shadow or gradients", () => {
    expect(SOURCE).toContain("@media (max-width: 61.99rem)");
    expect(SOURCE).toContain("@media (max-width: 39.99rem)");
    expect(SOURCE).toContain("@media (min-width: 62rem)");
    expect(SOURCE).not.toMatch(/box-shadow|gradient|backdrop-filter|border-radius:\s*[3-9]/);
    expect(SOURCE).toContain("html:has(dialog.cx[open]) { overflow: hidden; }");
    expect(SOURCE).not.toMatch(/transition:/);
  });
});
