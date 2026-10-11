// Spike S2: Verovio 6.3.0 layout control and the two-pass pagination algorithm.
//
//   cd web && node scripts/spike-verovio.ts [--write-fixture]
//
// Dev harness only (not part of the build or the test suite). It renders the
// Kyrie IX experiment MEI with the npm WASM build and prints a JSON report of:
//   1. option names (contracts §1.1) accepted by setOptions, read back by getOptions;
//   2. staff heights at scale 100 for unit 7, 9, 12;
//   3. `breaks` modes and `systemMaxPerPage`;
//   4. inserted <sb/>/<pb/> under each `breaks` mode;
//   5. `justifyVertically`;
//   6. per-system geometry (g.system extent and first measure id);
//   7. the two-pass algorithm (pass 1 tall page -> paginate -> breaks -> pass 2 encoded);
//   8. a hidden-note <gliss> (noh2.ily \voiceLine);
//   9. inputs for the Python-wheel determinism check;
//  10. candidate encodings for chant divisions and quilisma (A3b).
// Output goes to <repo>/build/spike-verovio/. With --write-fixture it also writes
// src/lib/export-layout/__fixtures__/s2-pass1-letter-medium.json and the glissando
// SVG under docs/superpowers/experiments/s2-assets/.
/// <reference path="../src/workers/verovio.d.ts" />
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createVerovioModule from "verovio/wasm";
import type { VerovioModule } from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

// ------------------------------------------------------------------ setup ---
const WEB = fileURLToPath(new URL("../", import.meta.url));
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const OUT = `${REPO}build/spike-verovio/`;
const FIXTURE_MEI = `${WEB}src/lib/export-layout/__fixtures__/kyrie-ix-experiment.mei`;
const FIXTURE_OUT = `${WEB}src/lib/export-layout/__fixtures__/s2-pass1-letter-medium.json`;
const ASSETS = `${REPO}docs/superpowers/experiments/s2-assets/`;
const WRITE_FIXTURE = process.argv.includes("--write-fixture");

type OptionValue = string | number | boolean;
type Options = Readonly<Record<string, OptionValue>>;

interface AvailableOption {
  readonly type: string;
  readonly default: unknown;
  readonly values?: readonly string[];
  readonly min?: number;
  readonly max?: number;
}
interface AvailableOptions {
  readonly groups: Readonly<Record<string, { readonly options: Readonly<Record<string, AvailableOption>> }>>;
}
/** Toolkit methods that exist in 6.3.0 but are not yet in the ambient verovio.d.ts. */
interface ToolkitExtras {
  getLog(): string;
  getOptions(): Readonly<Record<string, unknown>>;
  getAvailableOptions(): AvailableOptions;
}
type Toolkit = VerovioToolkit & ToolkitExtras;

const verovioModule: VerovioModule = await createVerovioModule();

/** Run fn with console.error/warn captured: Verovio reports rejected options there, not in getLog(). */
function captureConsole<T>(fn: () => T): { readonly result: T; readonly messages: string[] } {
  const messages: string[] = [];
  const origError = console.error;
  const origWarn = console.warn;
  const sink = (...args: readonly unknown[]): void => {
    messages.push(args.map(String).join(" ").trim());
  };
  console.error = sink;
  console.warn = sink;
  try {
    return { result: fn(), messages };
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
}

interface RenderResult {
  readonly pages: readonly string[];
  readonly log: string;
  readonly messages: readonly string[];
  readonly readBack: Readonly<Record<string, unknown>>;
}

/** Fresh toolkit per render, so no option state leaks between cases. */
function render(mei: string, options: Options): RenderResult {
  const toolkit = new VerovioToolkit(verovioModule) as Toolkit;
  try {
    const { result, messages } = captureConsole(() => {
      toolkit.setOptions(options);
      const readBack = toolkit.getOptions();
      if (!toolkit.loadData(mei)) throw new Error("loadData failed");
      const pages: string[] = [];
      for (let p = 1; p <= toolkit.getPageCount(); p++) pages.push(toolkit.renderToSVG(p));
      return { pages, readBack, log: toolkit.getLog() };
    });
    return { ...result, messages };
  } finally {
    toolkit.destroy();
  }
}

// ---------------------------------------------------------- page settings ---
interface PageCase {
  readonly id: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly marginMm: number;
  readonly kind: "print" | "screen" | "custom";
}
const PAGES = {
  letterP: { id: "letter-p", widthMm: 215.9, heightMm: 279.4, marginMm: 12, kind: "print" },
  letterL: { id: "letter-l", widthMm: 279.4, heightMm: 215.9, marginMm: 12, kind: "print" },
  a4P: { id: "a4-p", widthMm: 210, heightMm: 297, marginMm: 12, kind: "print" },
  a4L: { id: "a4-l", widthMm: 297, heightMm: 210, marginMm: 12, kind: "print" },
  a5P: { id: "a5-p", widthMm: 148, heightMm: 210, marginMm: 12, kind: "print" },
  a5L: { id: "a5-l", widthMm: 210, heightMm: 148, marginMm: 12, kind: "print" },
  ipad11P: { id: "ipad11-p", widthMm: 157.8, heightMm: 227.1, marginMm: 4, kind: "screen" },
  ipad11L: { id: "ipad11-l", widthMm: 227.1, heightMm: 157.8, marginMm: 4, kind: "screen" },
  ipadMiniP: { id: "ipadmini-p", widthMm: 115.9, heightMm: 176.6, marginMm: 4, kind: "screen" },
  custom: { id: "custom-160x230", widthMm: 160, heightMm: 230, marginMm: 4, kind: "custom" },
} as const satisfies Readonly<Record<string, PageCase>>;
const UNITS = { small: 7, medium: 9, large: 12 } as const;
type StaffId = keyof typeof UNITS;

const contentWidthMm = (p: PageCase): number => p.widthMm - 2 * p.marginMm;
const contentHeightMm = (p: PageCase): number => p.heightMm - 2 * p.marginMm;

/** Contracts §1.1 `verovioOptions`, verbatim, plus the per-case `breaks`. */
function contractOptions(page: PageCase, unit: number, breaks: string, pageHeightOverride?: number): Record<string, OptionValue> {
  return {
    scale: 100,
    pageWidth: Math.floor(contentWidthMm(page) * 10),
    pageHeight: pageHeightOverride ?? Math.floor(contentHeightMm(page) * 10),
    // S2: the brace/bracket is drawn 0.28 * unit mm LEFT of the system origin; reserve 0.3 * unit mm for it.
    pageMarginLeft: Math.ceil(unit * 3),
    pageMarginRight: 0,
    pageMarginTop: 0,
    pageMarginBottom: 0,
    unit,
    lyricSize: 4.5,
    spacingSystem: 4,
    font: "Leipzig",
    xmlIdChecksum: true,
    justifyVertically: page.kind !== "print",
    header: "none",
    footer: "none",
    svgViewBox: true,
    mnumInterval: 0,
    evenNoteSpacing: true,
    spacingLinear: 0.25,
    spacingNonLinear: 0.6,
    breaks,
  };
}
/** Options the spike adds on top of the contract: deterministic ids, and bounding boxes for geometry. */
function spikeOptions(page: PageCase, unit: number, breaks: string, extra: Options = {}, pageHeightOverride?: number): Options {
  return { ...contractOptions(page, unit, breaks, pageHeightOverride), svgBoundingBoxes: true, ...extra };
}

// -------------------------------------------------------------------- MEI ---
const RAW_MEI = readFileSync(FIXTURE_MEI, "utf8");

/** Measure k has xml:id "m00k" (fixture commit 87cd992). Older copies without ids get the same scheme. */
const mid = (n: number): string => `m${String(n).padStart(3, "0")}`;
function addMeasureIds(mei: string): string {
  return mei.replace(/<measure n="(\d+)"/g, (_w: string, n: string) => `<measure xml:id="${mid(Number(n))}" n="${n}"`);
}
const stripSb = (mei: string): string => mei.replace(/[ \t]*<sb\s*\/>\n?/g, "");
const stripPb = (mei: string): string => mei.replace(/[ \t]*<pb\s*\/>\n?/g, "");
const MEI = addMeasureIds(RAW_MEI);
const measureNumber = (id: string): number => Number(id.replace(/^m/, ""));
/** Synthetic boundary id: the boundary after measure k is "b00k"; a system starting at m00k starts after b00(k-1). */
const boundaryBefore = (measureId: string): string | null => {
  const n = measureNumber(measureId);
  return n <= 1 ? null : `b${String(n - 1).padStart(3, "0")}`;
};
/** Source <sb/> positions as the measure each one precedes. */
function sourceBreakStarts(mei: string): number[] {
  const out: number[] = [];
  const re = /<sb\s*\/>\s*<measure xml:id="m(\d+)"/g;
  for (let m = re.exec(mei); m; m = re.exec(mei)) out.push(Number(m[1]));
  return out;
}
/** Insert break elements immediately before the given measures. */
function insertBefore(mei: string, inserts: ReadonlyMap<number, string>): string {
  return mei.replace(/([ \t]*)<measure xml:id="m(\d+)"/g, (whole: string, indent: string, n: string) => {
    const ins = inserts.get(Number(n));
    return ins ? `${indent}${ins}\n${whole}` : whole;
  });
}
const noteIds = (mei: string): Set<string> => new Set([...mei.matchAll(/<note xml:id="([^"]+)"/g)].map((m) => m[1] ?? ""));

// -------------------------------------------------------------------- SVG ---
interface Box { minX: number; minY: number; maxX: number; maxY: number }
interface ParsedSystem {
  readonly svgId: string;
  readonly measureIds: string[];
  /** Union of descendant bounding-box rects (needs svgBoundingBoxes), excluding milestones. Inner SVG units. */
  bbox: Box | null;
  /** Staff-line extent: top line of first staff to bottom line of last staff. */
  staffBox: Box | null;
  readonly staffLineSets: number[][];
}
interface ParsedPage {
  readonly outerWidth: number;      // viewBox width = pageWidth (0.1 mm)
  readonly outerHeight: number;
  readonly innerWidth: number;      // definition-scale viewBox width
  readonly innerHeight: number;
  readonly mmPerUnit: number;       // mm per inner unit
  readonly offsetX: number;         // page-margin translate (pageMarginLeft), inner units
  readonly systems: ParsedSystem[];
  readonly noteIds: Set<string>;
  readonly glissPaths: { readonly id: string; readonly d: string; readonly attrs: string }[];
  readonly ids: Map<string, string>; // id -> class
}

interface Frame { readonly name: string; readonly cls: string; readonly id: string }
const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? (m[1] ?? null) : null;
};
const num = (attrs: string, name: string): number => Number(attr(attrs, name) ?? "NaN");
const grow = (b: Box | null, minX: number, minY: number, maxX: number, maxY: number): Box =>
  b
    ? { minX: Math.min(b.minX, minX), minY: Math.min(b.minY, minY), maxX: Math.max(b.maxX, maxX), maxY: Math.max(b.maxY, maxY) }
    : { minX, minY, maxX, maxY };
const MILESTONE = /Milestone|^mdiv\b|^score\b|^section\b/;
/** Spanners can be drawn partly in the NEXT system while their <g> lives in the start measure. */
const SPANNER = /^(tie|slur|gliss|phrase|lv|hairpin|bracketSpan)\b/;

function parseSvg(svg: string): ParsedPage {
  const stack: Frame[] = [];
  const systems: ParsedSystem[] = [];
  const notes = new Set<string>();
  const ids = new Map<string, string>();
  const glissPaths: { id: string; d: string; attrs: string }[] = [];
  const viewBoxes: number[][] = [];
  let current: ParsedSystem | null = null;
  let systemDepth = -1;
  let currentStaff: number[] | null = null;
  let glissId: string | null = null;
  let offsetX = 0;
  const spannerRects: Box[] = [];
  for (let m = TAG.exec(svg); m; m = TAG.exec(svg)) {
    const [, close, name = "", attrs = "", self] = m;
    if (close) {
      const top = stack.pop();
      if (stack.length === systemDepth) {
        current = null;
        systemDepth = -1;
      }
      if (top?.cls === "staff") currentStaff = null;
      if (top?.cls === "gliss") glissId = null;
      continue;
    }
    const cls = attr(attrs, "class") ?? "";
    const id = attr(attrs, "id") ?? "";
    if (id) ids.set(id, cls);
    if (name === "svg") {
      const vb = (attr(attrs, "viewBox") ?? "").split(/\s+/).map(Number);
      viewBoxes.push(vb);
    }
    if (name === "g" && cls === "page-margin") {
      const t = /translate\((-?[\d.]+)/.exec(attr(attrs, "transform") ?? "");
      offsetX = t ? Number(t[1]) : 0;
    }
    if (name === "g" && cls === "system") {
      current = { svgId: id, measureIds: [], bbox: null, staffBox: null, staffLineSets: [] };
      systems.push(current);
      systemDepth = stack.length;
    }
    if (current && name === "g" && cls === "measure") current.measureIds.push(id);
    if (current && name === "g" && cls === "staff") {
      currentStaff = [];
      current.staffLineSets.push(currentStaff);
    }
    if (name === "g" && cls === "note") notes.add(id);
    if (name === "g" && cls === "gliss") glissId = id;
    const parent = stack[stack.length - 1];
    if (current && name === "path" && parent?.cls === "staff" && currentStaff) {
      const d = /^M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)$/.exec(attr(attrs, "d") ?? "");
      if (d && d[2] === d[4]) {
        const y = Number(d[2]);
        currentStaff.push(y);
        current.staffBox = grow(current.staffBox, Number(d[1]), y, Number(d[3]), y);
      }
    }
    if (glissId && name === "path") glissPaths.push({ id: glissId, d: attr(attrs, "d") ?? "", attrs });
    if (current && name === "rect" && parent && parent.cls.includes("bounding-box") && !MILESTONE.test(parent.cls)) {
      const x = num(attrs, "x");
      const y = num(attrs, "y");
      const w = num(attrs, "width");
      const h = num(attrs, "height");
      if ([x, y, w, h].every(Number.isFinite)) {
        if (SPANNER.test(parent.cls)) spannerRects.push({ minX: x, minY: y, maxX: x + w, maxY: y + h });
        else current.bbox = grow(current.bbox, x, y, x + w, y + h);
      }
    }
    if (!self) stack.push({ name, cls, id });
  }
  // Assign each spanner piece to the system whose staff band is nearest its vertical centre.
  for (const r of spannerRects) {
    const cy = (r.minY + r.maxY) / 2;
    let best: ParsedSystem | null = null;
    let bestDist = Infinity;
    for (const sys of systems) {
      if (!sys.staffBox) continue;
      const dist = cy < sys.staffBox.minY ? sys.staffBox.minY - cy : cy > sys.staffBox.maxY ? cy - sys.staffBox.maxY : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = sys;
      }
    }
    if (best) best.bbox = grow(best.bbox, r.minX, r.minY, r.maxX, r.maxY);
  }
  const [outer = [], inner = []] = viewBoxes;
  const outerWidth = outer[2] ?? NaN;
  const innerWidth = inner[2] ?? NaN;
  return {
    outerWidth,
    outerHeight: outer[3] ?? NaN,
    innerWidth,
    innerHeight: inner[3] ?? NaN,
    mmPerUnit: outerWidth / 10 / innerWidth,
    offsetX,
    systems,
    noteIds: notes,
    glissPaths,
    ids,
  };
}

const round = (x: number, d = 2): number => Math.round(x * 10 ** d) / 10 ** d;
const firstMeasure = (s: ParsedSystem): string => s.measureIds[0] ?? "?";
const systemStarts = (pages: readonly ParsedPage[]): string[] => pages.flatMap((p) => p.systems.map(firstMeasure));

/** Mean staff height (top line to bottom line) in mm over every five-line staff on the page. */
function staffHeightMm(page: ParsedPage): number {
  const heights = page.systems
    .flatMap((s) => s.staffLineSets)
    .filter((lines) => lines.length === 5)
    .map((lines) => (Math.max(...lines) - Math.min(...lines)) * page.mmPerUnit);
  return heights.reduce((a, b) => a + b, 0) / heights.length;
}

// --------------------------------------------------------------- §1 names ---
const CONTRACT_OPTION_NAMES = [
  "scale", "pageWidth", "pageHeight", "pageMarginLeft", "pageMarginRight", "pageMarginTop", "pageMarginBottom",
  "unit", "lyricSize", "spacingSystem", "font", "justifyVertically", "header", "footer", "svgViewBox",
  "mnumInterval", "evenNoteSpacing", "spacingLinear", "spacingNonLinear", "breaks", "xmlIdChecksum",
] as const;
const OTHER_OPTION_NAMES = ["systemMaxPerPage", "inputFrom", "xmlIdSeed", "svgBoundingBoxes", "adjustPageHeight", "breaksNoWidow", "minLastJustification"] as const;

function checkOptionNames(): unknown {
  const toolkit = new VerovioToolkit(verovioModule) as Toolkit;
  const available: Record<string, AvailableOption> = {};
  for (const group of Object.values(toolkit.getAvailableOptions().groups)) Object.assign(available, group.options);
  const opts = contractOptions(PAGES.letterP, 9, "line");
  const { messages } = captureConsole(() => toolkit.setOptions({ ...opts, systemMaxPerPage: 2, inputFrom: "mei" }));
  const readBack = toolkit.getOptions();
  // Out-of-range or invalid values: setOptions still returns true; the option silently reverts to its DEFAULT.
  const invalid = captureConsole(() => {
    const t = new VerovioToolkit(verovioModule) as Toolkit;
    t.setOptions({ unit: 7 });
    t.setOptions({ unit: 13, breaks: "pages", bogusOption: 1 });
    const back = t.getOptions();
    t.destroy();
    return { unitAfter: back["unit"], breaksAfter: back["breaks"] };
  });
  toolkit.destroy();
  const rows = [...CONTRACT_OPTION_NAMES, ...OTHER_OPTION_NAMES].map((name) => {
    const meta = available[name];
    return {
      name,
      inContract: (CONTRACT_OPTION_NAMES as readonly string[]).includes(name),
      known: meta !== undefined,
      type: meta?.type ?? null,
      default: meta?.default ?? null,
      range: meta?.min !== undefined ? [meta.min, meta.max] : null,
      values: meta?.values ?? null,
      set: name in opts ? opts[name] : null,
      readBack: name in readBack ? readBack[name] : "(not reported by getOptions)",
    };
  });
  return { setOptionsMessages: messages, invalidValueBehaviour: { ...invalid.result, messages: invalid.messages }, rows };
}

// ------------------------------------------------------------- §2 staff ---
function checkStaffHeights(): unknown {
  return (Object.entries(UNITS) as [StaffId, number][]).map(([id, unit]) => {
    const r = render(MEI, spikeOptions(PAGES.letterP, unit, "line", { svgBoundingBoxes: false }));
    const page = parseSvg(r.pages[0] ?? "");
    const lines = page.systems[0]?.staffLineSets[0] ?? [];
    return {
      staff: id,
      unit,
      expectedMm: round(0.8 * unit, 2),
      measuredMm: round(staffHeightMm(page), 3),
      lineSpacingInnerUnits: lines.length > 1 ? (Math.max(...lines) - Math.min(...lines)) / 4 : null,
      outerViewBoxWidth: page.outerWidth,
      innerViewBoxWidth: page.innerWidth,
      mmPerInnerUnit: page.mmPerUnit,
    };
  });
}

// ------------------------------------------------------------- §3 breaks ---
function summarise(r: RenderResult): { pages: number; systemsPerPage: number[]; starts: string[]; warnings: string[] } {
  const parsed = r.pages.map(parseSvg);
  return {
    pages: parsed.length,
    systemsPerPage: parsed.map((p) => p.systems.length),
    starts: systemStarts(parsed),
    warnings: [...new Set(r.messages.filter((m) => !m.startsWith("[Warning] \t")))],
  };
}
function checkBreakModes(): unknown {
  const out: unknown[] = [];
  const source = sourceBreakStarts(MEI).map(mid);
  for (const [label, page, unit] of [["letter-p medium", PAGES.letterP, 9], ["a5-p large", PAGES.a5P, 12]] as const) {
    for (const breaks of ["auto", "line", "smart", "encoded", "none"]) {
      for (const cap of [0, 2, 3]) {
        const s = summarise(render(MEI, spikeOptions(page, unit, breaks, { systemMaxPerPage: cap, svgBoundingBoxes: false })));
        const startsSet = new Set(s.starts);
        out.push({
          case: label, breaks, systemMaxPerPage: cap, ...s,
          sourceSbAllHonoured: source.every((m) => startsSet.has(m)),
          extraBreaksBeyondSource: s.starts.filter((m) => m !== mid(1) && !source.includes(m)).length,
          capHonoured: cap === 0 || s.systemsPerPage.every((n) => n <= cap),
        });
      }
    }
  }
  return { sourceSystemStarts: [mid(1), ...source], results: out };
}

// ----------------------------------------------------- §4 encoded sb/pb ---
function checkEncodedBreaks(): unknown {
  // Strip source <sb/>, then insert <sb/> before m10 and m30 and <pb/> before m20 (variants: pb alone, pb+sb).
  const base = stripSb(MEI);
  const variants: Record<string, string> = {
    "sb@10,30 pb@20": insertBefore(base, new Map([[10, "<sb/>"], [20, "<pb/>"], [30, "<sb/>"]])),
    "sb@10,30 pb+sb@20": insertBefore(base, new Map([[10, "<sb/>"], [20, "<pb/>\n<sb/>"], [30, "<sb/>"]])),
    "sb@10,20,30 (no pb)": insertBefore(base, new Map([[10, "<sb/>"], [20, "<sb/>"], [30, "<sb/>"]])),
  };
  const out: unknown[] = [];
  for (const [name, mei] of Object.entries(variants)) {
    for (const breaks of ["encoded", "line", "auto", "smart"]) {
      const r = render(mei, spikeOptions(PAGES.ipad11P, 9, breaks, { svgBoundingBoxes: false }));
      const parsed = r.pages.map(parseSvg);
      const starts = systemStarts(parsed);
      out.push({
        variant: name, breaks, pages: parsed.length,
        pageStarts: parsed.map((p) => (p.systems[0] ? firstMeasure(p.systems[0]) : null)),
        starts,
        sbHonoured: [mid(10), mid(30)].every((m) => starts.includes(m)),
        pbStartsPage: parsed.some((p) => p.systems[0] && firstMeasure(p.systems[0]) === mid(20)),
      });
    }
  }
  // Overfull page under encoded: everything on one page (no pb) at A5 landscape large.
  const overfull = render(stripSb(MEI), spikeOptions(PAGES.a5L, 12, "encoded"));
  const op = overfull.pages.map(parseSvg);
  const bottom = Math.max(...(op[0]?.systems.map((s) => s.bbox?.maxY ?? 0) ?? [0]));
  // Overfull with many <sb/> and no <pb/>: does encoded paginate by itself?
  const manySb = insertBefore(stripSb(MEI), new Map(Array.from({ length: 12 }, (_, i) => [5 * (i + 1), "<sb/>"] as [number, string])));
  const ms = render(manySb, spikeOptions(PAGES.a5L, 12, "encoded")).pages.map(parseSvg);
  return {
    results: out,
    overfullNoBreaks: { pages: op.length, systems: op[0]?.systems.length ?? 0, contentBottomMm: round(bottom * (op[0]?.mmPerUnit ?? 0)), pageHeightMm: contentHeightMm(PAGES.a5L) },
    manySbNoPb: {
      pages: ms.length,
      systemsPerPage: ms.map((p) => p.systems.length),
      pageBottomsMm: ms.map((p) => round(Math.max(...p.systems.map((s) => s.bbox?.maxY ?? 0)) * p.mmPerUnit)),
      pageHeightMm: contentHeightMm(PAGES.a5L),
    },
  };
}

// ---------------------------------------------------- §5 justification ---
function checkJustifyVertically(): unknown {
  // Two pages of 2 systems + a last page with 1 system, under encoded, ipad-11 portrait (tall content).
  const base = stripSb(MEI);
  const mei = insertBefore(base, new Map([[13, "<sb/>"], [25, "<pb/>\n<sb/>"], [37, "<sb/>"], [49, "<pb/>\n<sb/>"]]));
  const out: unknown[] = [];
  for (const justify of [false, true]) {
    for (const breaks of ["encoded", "line"]) {
      const r = render(mei, spikeOptions(PAGES.ipad11P, 9, breaks, { justifyVertically: justify }));
      const parsed = r.pages.map(parseSvg);
      out.push({
        justifyVertically: justify, breaks,
        pages: parsed.map((p) => ({
          systemTopsMm: p.systems.map((s) => round((s.bbox?.minY ?? 0) * p.mmPerUnit)),
          systemBottomsMm: p.systems.map((s) => round((s.bbox?.maxY ?? 0) * p.mmPerUnit)),
          pageHeightMm: round(p.innerHeight * p.mmPerUnit),
        })),
      });
    }
  }
  return out;
}

// ---------------------------------------------------- §6/§7 two-pass ---
interface SystemGeometry {
  readonly index: number;
  readonly firstBoundaryId: string | null;
  readonly topMm: number;
  readonly heightMm: number;
}
interface MeasuredSystem extends SystemGeometry {
  readonly firstMeasureId: string;
  readonly staffTopMm: number;
  readonly staffBottomMm: number;
  readonly minXMm: number;
  readonly maxXMm: number;
}
function geometry(page: ParsedPage): MeasuredSystem[] {
  return page.systems.map((s, index) => {
    const box = s.bbox ?? s.staffBox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const k = page.mmPerUnit;
    return {
      index,
      firstBoundaryId: boundaryBefore(firstMeasure(s)),
      topMm: round(box.minY * k, 3),
      heightMm: round((box.maxY - box.minY) * k, 3),
      firstMeasureId: firstMeasure(s),
      staffTopMm: round((s.staffBox?.minY ?? 0) * k, 3),
      staffBottomMm: round((s.staffBox?.maxY ?? 0) * k, 3),
      minXMm: round((box.minX + page.offsetX) * k, 3),
      maxXMm: round((box.maxX + page.offsetX) * k, 3),
    };
  });
}

type PaginateResult =
  | { readonly ok: true; readonly pages: readonly (readonly number[])[] }
  | { readonly ok: false; readonly code: "SYSTEM_TOO_TALL"; readonly systemIndex: number };

/**
 * Greedy packing on pass-1 coordinates. A page holding systems s..e needs
 * (top[e] + height[e]) - top[s] <= contentHeight: Verovio's own inter-system
 * spacing (measured in pass 1, not a constant gap) is reused as-is.
 */
function paginateByExtent(systems: readonly SystemGeometry[], contentHeight: number, cap: number | null): PaginateResult {
  const pages: number[][] = [];
  let page: number[] = [];
  let pageTop = 0;
  for (const s of systems) {
    if (s.heightMm > contentHeight) return { ok: false, code: "SYSTEM_TOO_TALL", systemIndex: s.index };
    const fits = page.length > 0 && s.topMm + s.heightMm - pageTop <= contentHeight && (cap === null || page.length < cap);
    if (!fits && page.length > 0) {
      pages.push(page);
      page = [];
    }
    if (page.length === 0) pageTop = s.topMm;
    page.push(s.index);
  }
  if (page.length > 0) pages.push(page);
  return { ok: true, pages };
}
/** The eng-review B4a model: sum of heights plus a single minimum gap between systems. */
function paginateByGap(systems: readonly SystemGeometry[], contentHeight: number, gap: number, cap: number | null): PaginateResult {
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  for (const s of systems) {
    if (s.heightMm > contentHeight) return { ok: false, code: "SYSTEM_TOO_TALL", systemIndex: s.index };
    const need = page.length === 0 ? s.heightMm : used + gap + s.heightMm;
    if (page.length > 0 && (need > contentHeight || (cap !== null && page.length >= cap))) {
      pages.push(page);
      page = [];
      used = s.heightMm;
    } else used = need;
    page.push(s.index);
  }
  if (page.length > 0) pages.push(page);
  return { ok: true, pages };
}

interface TwoPassCase {
  readonly id: string;
  readonly page: PageCase;
  readonly staff: StaffId;
  readonly policy: "original" | "automatic";
  readonly cap: number | null;
  readonly breakMarkup?: "pb+sb" | "pb";
  readonly mei?: string;
}

function twoPass(c: TwoPassCase): Record<string, unknown> {
  const unit = UNITS[c.staff];
  const prepared = c.policy === "automatic" ? stripSb(stripPb(c.mei ?? MEI)) : stripPb(c.mei ?? MEI);
  const pass1Breaks = c.policy === "original" ? "line" : "auto";
  const H = contentHeightMm(c.page);
  const W = contentWidthMm(c.page);

  // Pass 1: one tall page (pageHeight 60000 = 6 m, Verovio's maximum).
  const r1 = render(prepared, spikeOptions(c.page, unit, pass1Breaks, { justifyVertically: false }, 60000));
  const p1 = r1.pages.map(parseSvg);
  const sys1 = p1.flatMap(geometry);
  const starts1 = sys1.map((s) => s.firstMeasureId);
  const gaps = sys1.slice(1).map((s, i) => round(s.topMm - ((sys1[i]?.topMm ?? 0) + (sys1[i]?.heightMm ?? 0)), 3));
  const minGap = gaps.length ? Math.min(...gaps) : 0;
  const maxGap = gaps.length ? Math.max(...gaps) : 0;

  const pag = paginateByExtent(sys1, H, c.cap);
  const pagGap = paginateByGap(sys1, H, minGap, c.cap);
  const pagMaxGap = paginateByGap(sys1, H, maxGap, c.cap);
  if (!pag.ok) return { case: c.id, pass1Pages: p1.length, pass1: sys1, paginate: pag };

  // Materialise: every page start gets <pb/> (+<sb/>), every other system start <sb/>. All source <sb/> are replaced.
  const inserts = new Map<number, string>();
  pag.pages.forEach((pageSystems, pi) => {
    pageSystems.forEach((si, k) => {
      const start = measureNumber(sys1[si]?.firstMeasureId ?? mid(1));
      if (start === 1) return;
      if (k === 0 && pi > 0) inserts.set(start, c.breakMarkup === "pb" ? "<pb/>" : "<pb/>\n<sb/>");
      else inserts.set(start, "<sb/>");
    });
  });
  const materialised = insertBefore(stripSb(prepared), inserts);

  // Pass 2: real page height, breaks: encoded.
  const r2 = render(materialised, spikeOptions(c.page, unit, "encoded"));
  const p2 = r2.pages.map(parseSvg);
  const starts2 = systemStarts(p2);
  const perPage2 = p2.map((p) => p.systems.length);
  const expectedPerPage = pag.pages.map((p) => p.length);
  const geom2 = p2.map(geometry);
  const bottoms = geom2.map((g) => Math.max(...g.map((s) => s.topMm + s.heightMm)));
  const tops = geom2.map((g) => Math.min(...g.map((s) => s.topMm)));
  const maxX = Math.max(...geom2.flat().map((s) => s.maxXMm));
  const minX = Math.min(...geom2.flat().map((s) => s.minXMm));
  const expectedNotes = noteIds(prepared);
  const seenNotes = new Set(p2.flatMap((p) => [...p.noteIds]));
  const missing = [...expectedNotes].filter((id) => !seenNotes.has(id));
  const staffMm = p2.map(staffHeightMm);

  // Same pass 2 without svgBoundingBoxes: does the bbox option change layout?
  const r2plain = render(materialised, spikeOptions(c.page, unit, "encoded", { svgBoundingBoxes: false }));
  const starts2plain = systemStarts(r2plain.pages.map(parseSvg));
  // Pass 2 rendered twice from fresh toolkits: identical SVG (xmlIdChecksum)?
  const r2again = render(materialised, spikeOptions(c.page, unit, "encoded"));

  // Predicted vs actual system tops on each page (justifyVertically off only).
  const predictedTops = pag.pages.map((ps) => {
    const t0 = sys1[ps[0] ?? 0]?.topMm ?? 0;
    return ps.map((si) => round((sys1[si]?.topMm ?? 0) - t0, 2));
  });

  return {
    case: c.id,
    page: { widthMm: c.page.widthMm, heightMm: c.page.heightMm, marginMm: c.page.marginMm, contentWidthMm: W, contentHeightMm: H, kind: c.page.kind },
    staff: c.staff,
    policy: c.policy,
    cap: c.cap,
    pass1Breaks,
    pass1Pages: p1.length,
    pass1Systems: sys1.length,
    pass1Gaps: gaps,
    pages: pag.pages.length,
    paginate: pag.pages,
    paginateByMinGapAgrees: pagGap.ok && JSON.stringify(pagGap.pages) === JSON.stringify(pag.pages),
    paginateByMaxGapAgrees: pagMaxGap.ok && JSON.stringify(pagMaxGap.pages) === JSON.stringify(pag.pages),
    pass2Pages: p2.length,
    pass2SystemsPerPage: perPage2,
    startsEqual: JSON.stringify(starts1) === JSON.stringify(starts2),
    pageAssignmentEqual: JSON.stringify(perPage2) === JSON.stringify(expectedPerPage),
    bboxOptionNeutral: JSON.stringify(starts2) === JSON.stringify(starts2plain),
    deterministicSvg: JSON.stringify(r2.pages) === JSON.stringify(r2again.pages),
    capHonoured: c.cap === null || perPage2.every((n) => n <= c.cap!),
    clippedBottom: bottoms.some((b) => b > H + 0.05),
    pageTopsMm: tops.map((t) => round(t)),
    pageBottomsMm: bottoms.map((b) => round(b)),
    predictedTopsMm: predictedTops,
    actualTopsMm: geom2.map((g) => g.map((s) => round(s.topMm - (g[0]?.topMm ?? 0)))),
    contentMinXMm: round(minX),
    contentMaxXMm: round(maxX),
    clippedLeft: minX < -0.05,
    rightOverflowMm: round(Math.max(0, maxX - W)),
    eventsMissing: missing.length,
    staffHeightMm: staffMm.map((h) => round(h, 3)),
    pass1Warnings: [...new Set(r1.messages.filter((m) => m.includes("Justification")))].length > 0,
    pass2Messages: [...new Set(r2.messages.filter((m) => !m.startsWith("[Warning] \t")))],
    pass1SystemsSample: sys1,
    starts1,
    starts2,
  };
}

// ----------------------------------------------------------- §8 gliss ---
interface GlissSpec { readonly id: string; readonly from: number; readonly to: number; readonly fromStaff: 1 | 2; readonly fromPitch: [string, number]; readonly toPitch: [string, number] }
/**
 * Imitate noh2.ily \voiceLine: a fifth "voice-line" layer whose noteheads are transparent,
 * joined by a dotted glissando. Each hidden note copies the rhythmic container of the
 * staff-2 layer-1 content in its measure, so the measure's duration is unchanged.
 */
function addGlissandi(mei: string, specs: readonly GlissSpec[]): string {
  let out = mei;
  const layerFor = (measure: number, noteId: string, pitch: [string, number], staffAttr: string): void => {
    const re = new RegExp(`(<measure xml:id="${mid(measure)}"[\\s\\S]*?<staff n="2">\\s*<layer n="1">)([\\s\\S]*?)(</layer>)([\\s\\S]*?)(</staff>)`);
    const m = re.exec(out);
    if (!m) throw new Error(`measure ${measure} not found`);
    const layer1 = m[2] ?? "";
    const notes = layer1.match(/<note\b/g) ?? [];
    if (notes.length !== 1) throw new Error(`m${measure} staff 2 layer 1 has ${notes.length} notes; pick a single-note measure`);
    const hidden = layer1
      .replace(/xml:id="[^"]+"/, `xml:id="${noteId}"`)
      .replace(/pname="[a-g]"/, `pname="${pitch[0]}"`)
      .replace(/oct="\d"/, `oct="${pitch[1]}"`)
      .replace(/<note /, `<note visible="false"${staffAttr} `);
    out = out.replace(re, `$1$2$3$4<layer n="3">${hidden}</layer>\n              $5`);
  };
  for (const g of specs) {
    layerFor(g.from, `${g.id}a`, g.fromPitch, g.fromStaff === 1 ? ' staff="1"' : "");
    layerFor(g.to, `${g.id}b`, g.toPitch, "");
    out = out.replace(
      new RegExp(`(<measure xml:id="${mid(g.from)}"[\\s\\S]*?)(</measure>)`),
      `$1  <gliss xml:id="${g.id}" startid="#${g.id}a" endid="#${g.id}b" lform="dotted" />\n            $2`,
    );
  }
  return out;
}
const GLISS: readonly GlissSpec[] = [
  // cross-staff (staff 1 -> staff 2), within one system: alto b3 in m6 to bass e3 in m7
  { id: "vl1", from: 6, to: 7, fromStaff: 1, fromPitch: ["b", 3], toPitch: ["e", 3] },
  // same staff, across the source <sb/> between m8 and m9 (\allowVoiceLineBreak)
  { id: "vl2", from: 8, to: 9, fromStaff: 2, fromPitch: ["a", 3], toPitch: ["g", 3] },
  // same staff, within one system
  { id: "vl3", from: 2, to: 3, fromStaff: 2, fromPitch: ["g", 3], toPitch: ["a", 3] },
];

function checkGlissando(): unknown {
  const mei = addGlissandi(MEI, GLISS);
  writeFileSync(`${OUT}kyrie-ix-gliss.mei`, mei);
  const r = render(mei, spikeOptions(PAGES.letterP, 9, "line", { svgBoundingBoxes: false }));
  const page = parseSvg(r.pages[0] ?? "");
  writeFileSync(`${OUT}kyrie-ix-gliss-letter-medium.svg`, r.pages[0] ?? "");
  if (WRITE_FIXTURE) {
    mkdirSync(ASSETS, { recursive: true });
    writeFileSync(`${ASSETS}kyrie-ix-gliss-letter-medium.svg`, r.pages[0] ?? "");
  }
  const glissReport = GLISS.map((g) => {
    const paths = page.glissPaths.filter((p) => p.id === g.id || p.id.startsWith(g.id));
    return {
      id: g.id,
      from: mid(g.from),
      to: mid(g.to),
      crossStaff: g.fromStaff === 1,
      inSvg: page.ids.get(g.id) ?? null,
      pathCount: page.glissPaths.filter((p) => page.ids.get(p.id) === "gliss" && p.id === g.id).length,
      paths: paths.map((p) => ({ d: p.d, dasharray: attr(p.attrs, "stroke-dasharray"), linecap: attr(p.attrs, "stroke-linecap"), width: attr(p.attrs, "stroke-width") })),
      hiddenNotesRendered: [`${g.id}a`, `${g.id}b`].map((id) => page.ids.get(id) ?? null),
    };
  });
  // Does the voice-line layer move anything? Compare system starts and note x of real notes with/without it.
  const plain = render(MEI, spikeOptions(PAGES.letterP, 9, "line", { svgBoundingBoxes: false }));
  const startsPlain = systemStarts(plain.pages.map(parseSvg));
  const startsGliss = systemStarts([page]);
  // Two-pass with the gliss MEI, automatic policy on A5 portrait (break may fall between gliss ends).
  const tp = [
    twoPass({ id: "gliss-letter-p-orig", page: PAGES.letterP, staff: "medium", policy: "original", cap: null, mei }),
    twoPass({ id: "gliss-a5-p-auto", page: PAGES.a5P, staff: "medium", policy: "automatic", cap: null, mei }),
  ].map((t) => ({ case: t["case"], startsEqual: t["startsEqual"], pageAssignmentEqual: t["pageAssignmentEqual"], eventsMissing: t["eventsMissing"], pass2Messages: t["pass2Messages"] }));
  return { log: r.log, messages: [...new Set(r.messages)], glissReport, systemStartsUnchanged: JSON.stringify(startsPlain) === JSON.stringify(startsGliss), twoPass: tp };
}


// ------------------------------------------------- §10 feature mappings ---
/**
 * Candidate CMN encodings for A3b: chant divisions and quilisma. Each measure is one candidate;
 * the SVG is saved for visual review. Findings are recorded in s2-verovio.md.
 */
function checkFeatureMappings(): unknown {
  const m = (n: number, right: string, inner = "", ctrl = ""): string =>
    `<measure xml:id="m${n}" n="${n}" metcon="false" right="${right}"><staff n="1"><layer n="1">` +
    `<note xml:id="n${n}a" dur="4" pname="g" oct="4" stem.visible="false"/>${inner}` +
    `<note xml:id="n${n}b" dur="4" pname="a" oct="4" stem.visible="false"/></layer></staff>${ctrl}</measure>`;
  const caesura = (num: string): string => `<caesura tstamp="2.5" staff="1" glyph.auth="smufl" glyph.num="U+${num}"/>`;
  const candidates: readonly [string, string][] = [
    ["minima: breath", m(1, "invis", "", '<breath tstamp="2.5" staff="1"/>')],
    ["minima: breath + glyph.num E8F3 (ignored)", m(2, "invis", "", '<breath tstamp="2.5" staff="1" glyph.auth="smufl" glyph.num="U+E8F3"/>')],
    ["minima: caesura E8F3", m(3, "invis", "", caesura("E8F3"))],
    ["maior: caesura E8F4", m(4, "invis", "", caesura("E8F4"))],
    ["maxima: caesura E8F5", m(5, "invis", "", caesura("E8F5"))],
    ["maxima: right=single", m(6, "single")],
    ["finalis: caesura E8F6", m(7, "invis", "", caesura("E8F6"))],
    ["barLine len/place in layer (ignored)", m(8, "invis", '<barLine form="single" len="2" place="8"/>')],
    ["quilisma: head.visible=false + dir/symbol E56C", m(9, "invis", '<note xml:id="q1" dur="4" pname="b" oct="4" stem.visible="false" head.visible="false"/>', '<dir startid="#q1" place="within"><symbol glyph.auth="smufl" glyph.num="U+E56C"/></dir>')],
    ["quilisma: mordent form=upper", m(10, "invis", '<note xml:id="q2" dur="4" pname="b" oct="4" stem.visible="false"/>', '<mordent startid="#q2" form="upper"/>')],
    ["quilisma: note glyph.num (ignored)", m(11, "invis", '<note xml:id="q3" dur="4" pname="b" oct="4" stem.visible="false" glyph.auth="smufl" glyph.num="U+E56C"/>')],
    ["finalis: right=dbl", m(12, "dbl")],
  ];
  const mei =
    '<?xml version="1.0" encoding="UTF-8"?><mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">' +
    "<meiHead><fileDesc><titleStmt><title>S2 feature candidates</title></titleStmt><pubStmt/></fileDesc></meiHead>" +
    '<music><body><mdiv><score><scoreDef><staffGrp><staffDef n="1" lines="5" clef.shape="G" clef.line="2"/></staffGrp></scoreDef><section>' +
    candidates.map(([, xml]) => xml).join("") +
    "</section></score></mdiv></body></music></mei>";
  const r = render(mei, { ...contractOptions(PAGES.letterL, 12, "auto"), pageHeight: 600, svgBoundingBoxes: false });
  const svg = r.pages[0] ?? "";
  writeFileSync(`${OUT}feature-mappings.svg`, svg);
  if (WRITE_FIXTURE) writeFileSync(`${ASSETS}feature-mappings.svg`, svg);
  const glyphs = [...svg.matchAll(/class="(caesura|breath|mordent|dir)"[\s\S]*?(?:#(E[0-9A-F]{3})|class="symbol")/g)].map((x) => `${x[1]}:${x[2] ?? "text-symbol"}`);
  return { candidates: candidates.map(([label], i) => `m${i + 1}: ${label}`), drawn: glyphs, messages: r.messages };
}

// --------------------------------------------------- §9 determinism prep ---
function prepareDeterminism(): unknown {
  const dir = `${OUT}determinism/`;
  mkdirSync(dir, { recursive: true });
  const options = spikeOptions(PAGES.letterP, 9, "line", { svgBoundingBoxes: false });
  const r = render(MEI, options);
  writeFileSync(`${dir}input.mei`, MEI);
  writeFileSync(`${dir}options.json`, JSON.stringify(options, null, 2));
  r.pages.forEach((svg, i) => writeFileSync(`${dir}wasm-page${i + 1}.svg`, svg));
  return { dir, pages: r.pages.length, options };
}

// ------------------------------------------------------------------- main ---
mkdirSync(OUT, { recursive: true });
const report: Record<string, unknown> = {};
const versionToolkit = new VerovioToolkit(verovioModule);
report["version"] = versionToolkit.getVersion();
versionToolkit.destroy();
report["options"] = checkOptionNames();
report["staffHeights"] = checkStaffHeights();
report["breakModes"] = checkBreakModes();
report["encodedBreaks"] = checkEncodedBreaks();
report["justifyVertically"] = checkJustifyVertically();

const P = PAGES as Readonly<Record<string, PageCase>>;
const page = (k: string): PageCase => {
  const p = P[k];
  if (!p) throw new Error(`no page ${k}`);
  return p;
};
const required: TwoPassCase[] = [];
for (const pk of ["letterP", "ipad11P", "a5L"]) {
  for (const staff of ["medium", "large"] as const) {
    for (const policy of ["original", "automatic"] as const) required.push({ id: `${page(pk).id}-${staff}-${policy}`, page: page(pk), staff, policy, cap: null });
  }
}
const matrix: TwoPassCase[] = [
  { id: "letter-p-orig", page: page("letterP"), staff: "medium", policy: "original", cap: null },
  { id: "letter-p-auto", page: page("letterP"), staff: "medium", policy: "automatic", cap: null },
  { id: "letter-l-orig", page: page("letterL"), staff: "medium", policy: "original", cap: null },
  { id: "a4-p-orig", page: page("a4P"), staff: "medium", policy: "original", cap: null },
  { id: "a4-l-auto", page: page("a4L"), staff: "medium", policy: "automatic", cap: null },
  { id: "a5-p-auto", page: page("a5P"), staff: "medium", policy: "automatic", cap: null },
  { id: "a5-l-orig", page: page("a5L"), staff: "medium", policy: "original", cap: null },
  { id: "letter-p-large-auto", page: page("letterP"), staff: "large", policy: "automatic", cap: null },
  { id: "letter-p-small-cap2", page: page("letterP"), staff: "small", policy: "automatic", cap: 2 },
  { id: "ipad11-p-auto", page: page("ipad11P"), staff: "medium", policy: "automatic", cap: null },
  { id: "ipad11-l-large-auto", page: page("ipad11L"), staff: "large", policy: "automatic", cap: null },
  { id: "ipadmini-p-auto", page: page("ipadMiniP"), staff: "medium", policy: "automatic", cap: null },
  { id: "custom-160x230-auto", page: page("custom"), staff: "medium", policy: "automatic", cap: null },
];
const variants: TwoPassCase[] = [
  { id: "letter-p-medium-original pb-only", page: page("letterP"), staff: "medium", policy: "original", cap: 2, breakMarkup: "pb" },
  { id: "letter-p-medium-original pb+sb cap2", page: page("letterP"), staff: "medium", policy: "original", cap: 2 },
  { id: "a5-l-large-automatic cap1", page: page("a5L"), staff: "large", policy: "automatic", cap: 1 },
];
const strip = (r: Record<string, unknown>): Record<string, unknown> => {
  const { pass1SystemsSample: _s, starts1: _a, starts2: _b, ...rest } = r;
  return rest;
};
const requiredResults = required.map(twoPass);
report["twoPassRequired"] = requiredResults.map(strip);
report["twoPassMatrix"] = matrix.map(twoPass).map(strip);
report["twoPassVariants"] = variants.map(twoPass).map(strip);
report["glissando"] = checkGlissando();
report["featureMappings"] = checkFeatureMappings();
report["determinism"] = prepareDeterminism();

// The pass-1 SystemGeometry[] for Letter portrait, medium staff, original policy.
const letterMedium = requiredResults.find((r) => r["case"] === "letter-p-medium-original");
const fixture: SystemGeometry[] = ((letterMedium?.["pass1SystemsSample"] ?? []) as MeasuredSystem[]).map(
  ({ index, firstBoundaryId, topMm, heightMm }) => ({ index, firstBoundaryId, topMm, heightMm }),
);
report["fixture"] = fixture;
if (WRITE_FIXTURE) writeFileSync(FIXTURE_OUT, `${JSON.stringify(fixture, null, 2)}\n`);

writeFileSync(`${OUT}report.json`, `${JSON.stringify(report, null, 2)}\n`);
const all = [...requiredResults, ...matrix.map(twoPass), ...variants.map(twoPass)];
const failures = all.filter((r) => r["pages"] !== undefined && !(r["startsEqual"] && r["pageAssignmentEqual"] && !r["clippedBottom"] && r["eventsMissing"] === 0));
console.log(JSON.stringify({ version: report["version"], cases: all.length, twoPassFailures: failures.map((f) => f["case"]), report: `${OUT}report.json` }, null, 2));
process.exitCode = failures.length > 0 ? 1 : 0;
