import { DOMParser } from '@xmldom/xmldom';
import type { Element, Node } from '@xmldom/xmldom';

/**
 * Geometry measured from one Verovio SVG page (spike S2, section 6).
 *
 * Verovio's SVG has an outer `<svg viewBox="0 0 W H">` in 0.1 mm (W = pageWidth) and an
 * inner `<svg class="definition-scale" viewBox="0 0 10W 10H">`, so one inner unit is
 * 0.01 mm at `scale: 100`. All results are in mm relative to the content origin.
 */
export interface MeasuredSystem {
  /** `id` of the first `<g class="measure">`, which is the MEI `xml:id`. */
  readonly firstMeasureId: string;
  readonly measureIds: readonly string[];
  /** Vertical extent of everything drawn in the system (staff band when no bounding boxes). */
  readonly topMm: number;
  readonly heightMm: number;
  /** Top line of the first staff and bottom line of the last staff. */
  readonly staffTopMm: number;
  readonly staffBottomMm: number;
  readonly minXMm: number;
  readonly maxXMm: number;
}
export interface MeasuredPage {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly mmPerUnit: number;
  readonly systems: readonly MeasuredSystem[];
  /** `xml:id` of every `<g class="note">` on the page, hidden notes included. */
  readonly noteIds: ReadonlySet<string>;
  /** Height (top line to bottom line) of every five-line staff on the page. */
  readonly staffHeightsMm: readonly number[];
}

interface Box { minX: number; minY: number; maxX: number; maxY: number }
interface WorkSystem {
  measureIds: string[];
  bbox: Box | null;
  staffBox: Box | null;
  staffLineSets: number[][];
}

const MILESTONE = new Set(['pageMilestone', 'systemMilestone', 'mdiv', 'score', 'section']);
/** Spanners can be drawn partly in the NEXT system while their group lives in the start measure (R3). */
const SPANNERS = new Set(['tie', 'slur', 'gliss', 'phrase', 'lv', 'hairpin', 'bracketSpan']);
const STAFF_LINE = /^M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)$/;

const grow = (b: Box | null, minX: number, minY: number, maxX: number, maxY: number): Box =>
  b
    ? { minX: Math.min(b.minX, minX), minY: Math.min(b.minY, minY), maxX: Math.max(b.maxX, maxX), maxY: Math.max(b.maxY, maxY) }
    : { minX, minY, maxX, maxY };

const classes = (el: Element): readonly string[] => (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c !== '');
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (let n: Node | null = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as Element);
  return out;
}
function viewBox(el: Element): readonly number[] {
  return (el.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number);
}

/** Measure one Verovio page. Throws `Error('SVG_PARSE_ERROR: ...')` for malformed input. */
export function measureSvgPage(svg: string): MeasuredPage {
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === 'error' || level === 'fatalError') throw new Error(`SVG_PARSE_ERROR: ${msg}`);
    },
  }).parseFromString(svg, 'text/xml');
  const root = doc.documentElement;
  if (!root || (root.localName ?? root.nodeName) !== 'svg') throw new Error('SVG_PARSE_ERROR: no <svg> root');
  const outer = viewBox(root);
  const innerEl = elementChildren(root).find((c) => classes(c).includes('definition-scale'));
  const inner = innerEl ? viewBox(innerEl) : [];
  const outerWidth = outer[2] ?? NaN;
  const outerHeight = outer[3] ?? NaN;
  const innerWidth = inner[2] ?? NaN;
  if (!Number.isFinite(outerWidth) || !Number.isFinite(innerWidth) || innerWidth <= 0) {
    throw new Error('SVG_PARSE_ERROR: missing viewBox');
  }
  const mmPerUnit = outerWidth / 10 / innerWidth;

  const systems: WorkSystem[] = [];
  const noteIds = new Set<string>();
  const spannerRects: Box[] = [];
  let offsetX = 0;
  let offsetY = 0;

  const walk = (el: Element, system: WorkSystem | null, staff: number[] | null, parentCls: readonly string[]): void => {
    const name = el.localName ?? el.nodeName;
    const cls = classes(el);
    let sys = system;
    let stf = staff;
    if (name === 'g') {
      if (cls.includes('page-margin')) {
        const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)?/.exec(el.getAttribute('transform') ?? '');
        offsetX = t ? Number(t[1]) : 0;
        offsetY = t && t[2] !== undefined ? Number(t[2]) : 0;
      }
      if (cls.includes('system') && !cls.includes('bounding-box')) {
        sys = { measureIds: [], bbox: null, staffBox: null, staffLineSets: [] };
        systems.push(sys);
      } else if (sys && cls.includes('measure') && !cls.includes('bounding-box')) {
        sys.measureIds.push(el.getAttribute('id') ?? '');
      } else if (sys && cls.includes('staff') && !cls.includes('bounding-box')) {
        stf = [];
        sys.staffLineSets.push(stf);
      } else if (cls.includes('note') && !cls.includes('bounding-box')) {
        const id = el.getAttribute('id');
        if (id) noteIds.add(id);
      }
    } else if (name === 'path' && sys && stf && parentCls.includes('staff')) {
      const d = STAFF_LINE.exec(el.getAttribute('d') ?? '');
      if (d && d[2] === d[4]) {
        const y = Number(d[2]);
        stf.push(y);
        sys.staffBox = grow(sys.staffBox, Number(d[1]), y, Number(d[3]), y);
      }
    } else if (name === 'rect' && sys && parentCls.includes('bounding-box') && !parentCls.some((c) => MILESTONE.has(c))) {
      const x = Number(el.getAttribute('x'));
      const y = Number(el.getAttribute('y'));
      const w = Number(el.getAttribute('width'));
      const h = Number(el.getAttribute('height'));
      if ([x, y, w, h].every(Number.isFinite)) {
        const box = { minX: x, minY: y, maxX: x + w, maxY: y + h };
        if (parentCls.some((c) => SPANNERS.has(c))) spannerRects.push(box);
        else sys.bbox = grow(sys.bbox, box.minX, box.minY, box.maxX, box.maxY);
      }
    }
    for (const child of elementChildren(el)) walk(child, sys, stf, cls);
  };
  walk(root, null, null, []);

  // Assign each spanner piece to the system whose staff band is nearest its vertical centre (R3).
  for (const r of spannerRects) {
    const cy = (r.minY + r.maxY) / 2;
    let best: WorkSystem | null = null;
    let bestDist = Infinity;
    for (const s of systems) {
      if (!s.staffBox) continue;
      const dist = cy < s.staffBox.minY ? s.staffBox.minY - cy : cy > s.staffBox.maxY ? cy - s.staffBox.maxY : 0;
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
    if (best) best.bbox = grow(best.bbox, r.minX, r.minY, r.maxX, r.maxY);
  }

  const k = mmPerUnit;
  const measured: MeasuredSystem[] = systems.map((s) => {
    const box = s.bbox ?? s.staffBox ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    // Staff lines always count towards the vertical extent, even when a bounding box is smaller.
    const top = s.staffBox ? Math.min(box.minY, s.staffBox.minY) : box.minY;
    const bottom = s.staffBox ? Math.max(box.maxY, s.staffBox.maxY) : box.maxY;
    return {
      firstMeasureId: s.measureIds[0] ?? '',
      measureIds: s.measureIds,
      topMm: round3((top + offsetY) * k),
      heightMm: round3((bottom - top) * k),
      staffTopMm: round3(((s.staffBox?.minY ?? 0) + offsetY) * k),
      staffBottomMm: round3(((s.staffBox?.maxY ?? 0) + offsetY) * k),
      minXMm: round3((box.minX + offsetX) * k),
      maxXMm: round3((box.maxX + offsetX) * k),
    };
  });
  const staffHeightsMm = systems
    .flatMap((s) => s.staffLineSets)
    .filter((lines) => lines.length === 5)
    .map((lines) => (Math.max(...lines) - Math.min(...lines)) * k);

  return { widthMm: outerWidth / 10, heightMm: outerHeight / 10, mmPerUnit, systems: measured, noteIds, staffHeightsMm };
}
