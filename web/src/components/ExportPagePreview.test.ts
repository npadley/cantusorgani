import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ZOOM_STEPS, blankNote, pageAriaLabel, pageDescription, snapZoom, stepZoom, usedBottomMm,
} from "../scripts/exportPagePreview";
import type { CanonicalPage, MeiCanonicalPage, ScanCanonicalPage, FixedCanonicalPage } from "../lib/export-layout/types";
import ExportPagePreview from "./ExportPagePreview.astro";

const SCRIPT = readFileSync(new URL("../scripts/exportPagePreview.ts", import.meta.url), "utf8");
const COMPONENT = readFileSync(new URL("./ExportPagePreview.astro", import.meta.url), "utf8");

const rect = { xMm: 12, yMm: 12, widthMm: 191.9, heightMm: 255.4 };
const base = { index: 0, widthMm: 215.9, heightMm: 279.4, partId: "kyrie:0", printable: rect, content: rect, heading: null, footer: null, unusedFraction: 0 };
const mei = (over: Partial<MeiCanonicalPage> = {}): MeiCanonicalPage => ({
  ...base, kind: "mei", svg: { svg: "<svg/>", ids: [], namespace: "p0" },
  svgPlacement: { scaleX: 1, scaleY: 1, translateXMm: 12, translateYMm: 12 }, systemCount: 4, boundaries: [], ...over,
});
const scan = (over: Partial<ScanCanonicalPage> = {}): ScanCanonicalPage => ({ ...base, kind: "scan", images: [], systemCount: 1, ...over });
const fixed = (over: Partial<FixedCanonicalPage> = {}): FixedCanonicalPage => ({
  ...base, kind: "fixed", sourceUrl: "/x.pdf", sourcePaper: "letter", sourcePageIndex: 0,
  sourceSizePt: { width: 612, height: 792 }, transform: { scaleX: 1, scaleY: 1, translateXMm: 12, translateYMm: 12 }, systemCount: null, ...over,
});

describe("ExportPagePreview markup", () => {
  it("should render the toolbar with a labelled view group, zoom buttons and an empty page host", async () => {
    const html = await (await AstroContainer.create()).renderToString(ExportPagePreview, { props: {} });
    expect(html).toContain("data-cx-preview");
    expect(html).toMatch(/role="radiogroup"[^>]*aria-labelledby="cx-view-l"/);
    expect(html).toMatch(/class="sr-only"[^>]*value="pages"[^>]*checked/);
    expect(html).toContain(">Continuous<");
    expect(html).toMatch(/aria-label="Zoom out"[^>]*>−</);
    expect(html).toMatch(/aria-label="Zoom in"[^>]*>\+</);
    expect(html).toContain(">Fit width<");
    expect(html).toMatch(/<output[^>]*data-cx-zoom-value[^>]*>100%<\/output>/);
    expect(html).toMatch(/data-cx-updating[^>]*aria-hidden="true"[^>]*hidden/);
    expect(html).toMatch(/<div class="cx-pages"[^>]*data-cx-pages[^>]*><\/div>/);
    expect(html).toContain("Updating preview…");
  });

  it("should make the radio group name unique per instance", async () => {
    const html = await (await AstroContainer.create()).renderToString(ExportPagePreview, { props: { id: "b" } });
    expect(html).toContain('name="b-view"');
    expect(html).toContain('aria-labelledby="b-view-l"');
  });

  it("should style the sheet as print paper with a 1px control border and no shadow, and bundle Liberation Serif", () => {
    expect(COMPONENT).toMatch(/\.cx-page \{[^}]*background: var\(--print-paper\)[^}]*color: var\(--print-ink\)[^}]*border: 1px solid var\(--control-border\)/);
    expect(COMPONENT).not.toMatch(/box-shadow|gradient|touch-action|filter/);
    for (const face of ["Regular", "Italic", "Bold"]) expect(COMPONENT).toContain(`/fonts/export/LiberationSerif-${face}.ttf`);
    expect(COMPONENT).toMatch(/\.cx-guide \{[^}]*1px dashed var\(--rule\)/);
  });
});

describe("page text alternatives and labels", () => {
  it("should label MEI and scan pages with their system count and fixed pages as a fixed layout", () => {
    expect(pageAriaLabel(mei(), 1, 3, "Kyrie")).toBe("Page 1 of 3: Kyrie, 4 systems");
    expect(pageAriaLabel(mei({ systemCount: 1 }), 2, 3, "Kyrie")).toBe("Page 2 of 3: Kyrie, 1 system");
    expect(pageAriaLabel(scan({ systemCount: 2 }), 1, 1, "Gloria")).toBe("Page 1 of 1: Gloria, 2 systems");
    expect(pageAriaLabel(fixed(), 3, 3, "Credo")).toBe("Page 3 of 3: Credo, fixed typeset layout");
  });

  it("should name the preset from the page's own size and orientation", () => {
    expect(pageDescription({ widthMm: 215.9, heightMm: 279.4 })).toBe("Letter, portrait");
    expect(pageDescription({ widthMm: 297, heightMm: 210 })).toBe("A4, landscape");
    expect(pageDescription({ widthMm: 157.8, heightMm: 227.1 })).toBe("11-inch iPad, portrait");
    expect(pageDescription({ widthMm: 160, heightMm: 230 })).toBe("Custom 160 × 230 mm, portrait");
  });

  it("should note a blank page only when over 25% is unused and another page of the same part follows", () => {
    const pages: CanonicalPage[] = [mei({ unusedFraction: 0.3 }), mei({ unusedFraction: 0.3, partId: "kyrie:0" }), mei({ unusedFraction: 0.5, partId: "gloria:1" })];
    expect(blankNote(pages, 0)).toBe("The rest of page 1 is blank: the next system doesn't fit.");
    expect(blankNote(pages, 1)).toBeNull(); // next page belongs to another part
    expect(blankNote(pages, 2)).toBeNull(); // last page
    expect(blankNote([mei({ unusedFraction: 0.25 }), mei()], 0)).toBeNull();
    expect(blankNote([fixed({ unusedFraction: 0.6 }), fixed()], 0)).toBeNull();
  });

  it("should crop Continuous view to the used height, never below a floor or past the page", () => {
    expect(usedBottomMm(mei({ unusedFraction: 0.5 }))).toBeCloseTo(12 + 255.4 / 2 + 1, 5);
    expect(usedBottomMm(mei({ unusedFraction: 1 }))).toBe(12 + 10);
    expect(usedBottomMm(mei({ unusedFraction: 0 }))).toBeCloseTo(268.4, 5);
  });
});

describe("zoom", () => {
  it("should offer exactly the specified steps and snap to them", () => {
    expect(ZOOM_STEPS).toEqual([50, 75, 100, 125, 150, 200, 300]);
    expect(snapZoom(110)).toBe(100);
    expect(snapZoom(10)).toBe(50);
    expect(snapZoom(9999)).toBe(300);
    expect(snapZoom(Number.NaN)).toBe(100);
    expect(stepZoom(100, 1)).toBe(125);
    expect(stepZoom(50, -1)).toBe(50);
    expect(stepZoom(300, 1)).toBe(300);
  });
});

describe("SVG insertion boundary", () => {
  it("should insert generated SVG in exactly one place, fed only by CanonicalPage.svg.svg", () => {
    const sinks = SCRIPT.match(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/g) ?? [];
    expect(sinks).toEqual([".innerHTML ="]);
    expect(SCRIPT.match(/insertPageSvg\(/g)).toHaveLength(2); // definition and its single call
    expect(SCRIPT).toContain("insertPageSvg(holder, page.svg.svg)");
    expect(SCRIPT).not.toMatch(/\beval\(|new Function\(/);
  });
});
