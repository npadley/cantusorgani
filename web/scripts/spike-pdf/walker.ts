// Spike S4 route (ii) (not shipped): draw Verovio's SVG subset onto a
// pdf-lib page as vectors. Browser- and worker-safe: no DOM, no Node APIs.
//
// Supported elements: svg (nested, viewBox), g, defs, symbol, use, path, rect,
// polyline, polygon, ellipse, circle, text, tspan, style/desc/title (ignored).
// Anything else is counted in `stats.unsupported` and skipped.
import {
  type Color,
  LineCapStyle,
  LineJoinStyle,
  type PDFFont,
  type PDFPage,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
} from "pdf-lib";
import { type XmlElement, parseXml } from "./xml.ts";

/** SVG affine matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m ∘ n: apply n first, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const scale = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0];
const FLIP_Y: Matrix = [1, 0, 0, -1, 0, 0];

export function parseTransform(src: string): Matrix {
  let m = IDENTITY;
  for (const call of src.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const fn = call[1];
    const n = (call[2] ?? "").split(/[\s,]+/).filter((s) => s !== "").map(Number);
    const [a = 0, b, c, d = 0, e = 0, f = 0] = n;
    let t: Matrix;
    switch (fn) {
      case "translate": t = translate(a, b ?? 0); break;
      case "scale": t = scale(a, b ?? a); break;
      case "matrix": t = [a, b ?? 0, c ?? 0, d, e, f]; break;
      case "rotate": {
        const r = (a * Math.PI) / 180;
        const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        t = b === undefined ? rot : multiply(translate(b, c ?? 0), multiply(rot, translate(-b, -(c ?? 0))));
        break;
      }
      case "skewX": t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0]; break;
      case "skewY": t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: throw new Error(`unsupported transform ${fn ?? "?"}`);
    }
    m = multiply(m, t);
  }
  return m;
}

export interface WalkerFonts {
  readonly regular: PDFFont;
  readonly italic: PDFFont;
  readonly bold: PDFFont;
  readonly boldItalic: PDFFont;
}

export interface WalkStats {
  uses: number;
  usesResolved: number;
  glyphPathsDrawn: number;
  paths: number;
  shapes: number;
  texts: number;
  textRuns: string[];
  unsupported: Record<string, number>;
}

interface Ctx {
  readonly ctm: Matrix;
  readonly viewport: { readonly w: number; readonly h: number };
  readonly color: Color;
  readonly fill: Color | null | "currentColor";
  readonly stroke: Color | null | "currentColor" | undefined; // undefined: Verovio CSS default
  readonly strokeWidth: number;
  readonly lineCap: LineCapStyle;
  readonly lineJoin: LineJoinStyle;
  readonly fontSize: number;
  readonly italic: boolean;
  readonly bold: boolean;
  readonly anchor: "start" | "middle" | "end";
  readonly inUse: boolean;
}

function parseColor(v: string): Color | null | "currentColor" {
  const s = v.trim().toLowerCase();
  if (s === "none" || s === "transparent") return null;
  if (s === "currentcolor") return "currentColor";
  if (s === "black") return rgb(0, 0, 0);
  if (s === "white") return rgb(1, 1, 1);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return rgb(Number.parseInt(full.slice(0, 2), 16) / 255, Number.parseInt(full.slice(2, 4), 16) / 255, Number.parseInt(full.slice(4, 6), 16) / 255);
  }
  const fn = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (fn !== null) return rgb(Number(fn[1]) / 255, Number(fn[2]) / 255, Number(fn[3]) / 255);
  throw new Error(`unsupported colour ${v}`);
}

const num = (el: XmlElement, key: string, fallback = 0): number => {
  const v = el.attrs.get(key);
  if (v === undefined) return fallback;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`bad number ${key}="${v}"`);
  return n;
};

/** Verovio's fixed stylesheet (svg-to-css rules we honour by class). */
const BOLD_CLASSES = new Set(["ending", "fing", "reh", "tempo"]);
const ITALIC_CLASSES = new Set(["dir", "dynam", "mNum"]);
/** `#id ellipse, path, polygon, polyline, rect {stroke:currentColor}` */
const CSS_STROKED = new Set(["ellipse", "path", "polygon", "polyline", "rect"]);

function inherit(el: XmlElement, ctx: Ctx): Ctx {
  const a = el.attrs;
  const classes = (a.get("class") ?? "").split(/\s+/);
  let { italic, bold } = ctx;
  if (el.name === "g") {
    if (classes.some((c) => BOLD_CLASSES.has(c))) bold = true;
    if (classes.some((c) => ITALIC_CLASSES.has(c))) italic = true;
    if (classes.includes("label")) bold = false;
  }
  const fontStyle = a.get("font-style");
  if (fontStyle !== undefined) italic = fontStyle === "italic" || fontStyle === "oblique";
  const fontWeight = a.get("font-weight");
  if (fontWeight !== undefined) bold = fontWeight === "bold" || Number(fontWeight) >= 600;
  const colorAttr = a.get("color");
  const color = colorAttr === undefined ? ctx.color : parseColor(colorAttr);
  const fs = a.get("font-size");
  const anchor = a.get("text-anchor");
  const cap = a.get("stroke-linecap");
  const join = a.get("stroke-linejoin");
  const fill = a.get("fill");
  const stroke = a.get("stroke");
  const transform = a.get("transform");
  return {
    ctm: transform === undefined ? ctx.ctm : multiply(ctx.ctm, parseTransform(transform)),
    viewport: ctx.viewport,
    color: color === null || color === "currentColor" ? ctx.color : color,
    fill: fill === undefined ? ctx.fill : parseColor(fill),
    stroke: stroke === undefined ? ctx.stroke : parseColor(stroke),
    strokeWidth: a.has("stroke-width") ? num(el, "stroke-width") : ctx.strokeWidth,
    lineCap: cap === "round" ? LineCapStyle.Round : cap === "square" ? LineCapStyle.Projecting : cap === "butt" ? LineCapStyle.Butt : ctx.lineCap,
    lineJoin: join === "round" ? LineJoinStyle.Round : join === "bevel" ? LineJoinStyle.Bevel : join === "miter" ? LineJoinStyle.Miter : ctx.lineJoin,
    fontSize: fs === undefined ? ctx.fontSize : Number.parseFloat(fs),
    italic,
    bold,
    anchor: anchor === "middle" || anchor === "end" || anchor === "start" ? anchor : ctx.anchor,
    inUse: ctx.inUse,
  };
}

function resolve(c: Color | null | "currentColor" | undefined, ctx: Ctx): Color | null {
  if (c === undefined || c === null) return null;
  return c === "currentColor" ? ctx.color : c;
}

export interface DrawBox { readonly xPt: number; readonly yTopPt: number; readonly widthPt: number; readonly heightPt: number }

/**
 * Draw `svg` into `box` (PDF points, top-left origin as on paper).
 * The root viewBox is scaled uniformly (xMidYMid meet) into the box.
 */
export function drawVerovioSvg(page: PDFPage, svg: string, box: DrawBox, fonts: WalkerFonts): WalkStats {
  const root = parseXml(svg);
  if (root.name !== "svg") throw new Error("root is not <svg>");
  const ids = new Map<string, XmlElement>();
  const index = (el: XmlElement): void => {
    const id = el.attrs.get("id");
    if (id !== undefined) ids.set(id, el);
    for (const c of el.children) if (typeof c !== "string") index(c);
  };
  index(root);

  const stats: WalkStats = { uses: 0, usesResolved: 0, glyphPathsDrawn: 0, paths: 0, shapes: 0, texts: 0, textRuns: [], unsupported: {} };
  const pageH = page.getHeight();
  // PDF user space: y up from the page bottom. Paper space: y down from the top.
  const paperToPdf: Matrix = [1, 0, 0, -1, 0, pageH];

  const vb = (root.attrs.get("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const [vx = 0, vy = 0, vw = box.widthPt, vh = box.heightPt] = vb.length === 4 ? vb : [];
  const s = Math.min(box.widthPt / vw, box.heightPt / vh);
  const rootCtm = multiply(
    paperToPdf,
    multiply(translate(box.xPt + (box.widthPt - vw * s) / 2, box.yTopPt + (box.heightPt - vh * s) / 2), multiply(scale(s, s), translate(-vx, -vy))),
  );

  const base: Ctx = {
    ctm: rootCtm, viewport: { w: vw, h: vh }, color: rgb(0, 0, 0), fill: "currentColor", stroke: undefined,
    strokeWidth: 1, lineCap: LineCapStyle.Butt, lineJoin: LineJoinStyle.Miter, fontSize: 16,
    italic: false, bold: false, anchor: "start", inUse: false,
  };

  const drawPath = (d: string, ctx: Ctx, cssStroked: boolean): void => {
    const fill = resolve(ctx.fill, ctx);
    const stroke = ctx.stroke === undefined ? (cssStroked ? ctx.color : null) : resolve(ctx.stroke, ctx);
    if (fill === null && (stroke === null || ctx.strokeWidth <= 0)) return;
    // drawSvgPath applies scale(1,-1) itself; pre-compose it away.
    const m = multiply(ctx.ctm, FLIP_Y);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), setLineJoin(ctx.lineJoin));
    page.drawSvgPath(d, {
      x: 0,
      y: 0,
      ...(fill === null ? {} : { color: fill }),
      ...(stroke === null || ctx.strokeWidth <= 0 ? {} : { borderColor: stroke, borderWidth: ctx.strokeWidth, borderLineCap: ctx.lineCap }),
    });
    page.pushOperators(popGraphicsState());
  };

  const fontFor = (ctx: Ctx): PDFFont =>
    ctx.bold ? (ctx.italic ? fonts.boldItalic : fonts.bold) : ctx.italic ? fonts.italic : fonts.regular;

  const drawText = (el: XmlElement, ctx: Ctx): void => {
    stats.texts += 1;
    // Flatten runs: each tspan may carry its own size/style; x/y on the text start the pen.
    interface Run { readonly text: string; readonly ctx: Ctx; readonly x: number | null; readonly y: number | null }
    const runs: Run[] = [];
    const collect = (node: XmlElement, c: Ctx): void => {
      const own = node === el ? c : inherit(node, c);
      let first = true;
      for (const child of node.children) {
        if (typeof child === "string") {
          const text = child.replace(/\s+/g, " ");
          const trimmed = runs.length === 0 ? text.trimStart() : text;
          if (trimmed.trim() === "") continue;
          runs.push({ text: trimmed.trim() === trimmed ? trimmed : trimmed.replace(/\s+$/, ""), ctx: own, x: first && node !== el && node.attrs.has("x") ? num(node, "x") : null, y: first && node !== el && node.attrs.has("y") ? num(node, "y") : null });
          first = false;
        } else if (child.name === "tspan") {
          collect(child, own);
        } else {
          stats.unsupported[`text>${child.name}`] = (stats.unsupported[`text>${child.name}`] ?? 0) + 1;
        }
      }
    };
    collect(el, ctx);
    if (runs.length === 0) return;
    const width = runs.reduce((w, r) => w + fontFor(r.ctx).widthOfTextAtSize(r.text, r.ctx.fontSize), 0);
    let penX = num(el, "x") - (ctx.anchor === "middle" ? width / 2 : ctx.anchor === "end" ? width : 0);
    let penY = num(el, "y");
    for (const r of runs) {
      if (r.x !== null) penX = r.x;
      if (r.y !== null) penY = r.y;
      const fill = resolve(r.ctx.fill, r.ctx);
      const font = fontFor(r.ctx);
      if (fill !== null && r.ctx.fontSize > 0) {
        // Glyph space is y-up; flip it back into the y-down SVG space.
        const m = multiply(r.ctx.ctm, multiply(translate(penX, penY), FLIP_Y));
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]));
        page.drawText(r.text, { x: 0, y: 0, size: r.ctx.fontSize, font, color: fill });
        page.pushOperators(popGraphicsState());
        stats.textRuns.push(r.text);
      }
      penX += font.widthOfTextAtSize(r.text, r.ctx.fontSize);
    }
  };

  const walk = (el: XmlElement, parent: Ctx): void => {
    switch (el.name) {
      case "defs": case "symbol": case "style": case "desc": case "title": case "metadata":
        return; // drawn only through <use>, or not drawn
      default: break;
    }
    let ctx = inherit(el, parent);
    switch (el.name) {
      case "svg": {
        if (el !== root) {
          const w = el.attrs.get("width");
          const h = el.attrs.get("height");
          const pw = w === undefined || w.endsWith("%") ? (parent.viewport.w * (w === undefined ? 100 : Number.parseFloat(w))) / 100 : Number.parseFloat(w);
          const ph = h === undefined || h.endsWith("%") ? (parent.viewport.h * (h === undefined ? 100 : Number.parseFloat(h))) / 100 : Number.parseFloat(h);
          const box2 = (el.attrs.get("viewBox") ?? "").split(/[\s,]+/).map(Number);
          let m = translate(num(el, "x"), num(el, "y"));
          let viewport = { w: pw, h: ph };
          if (box2.length === 4) {
            const [bx = 0, by = 0, bw = pw, bh = ph] = box2;
            const k = Math.min(pw / bw, ph / bh);
            m = multiply(m, multiply(translate((pw - bw * k) / 2, (ph - bh * k) / 2), multiply(scale(k, k), translate(-bx, -by))));
            viewport = { w: bw, h: bh };
          }
          ctx = { ...ctx, ctm: multiply(ctx.ctm, m), viewport };
        }
        for (const c of el.children) if (typeof c !== "string") walk(c, ctx);
        return;
      }
      case "g":
        for (const c of el.children) if (typeof c !== "string") walk(c, ctx);
        return;
      case "use": {
        stats.uses += 1;
        const href = el.attrs.get("xlink:href") ?? el.attrs.get("href") ?? "";
        const target = href.startsWith("#") ? ids.get(href.slice(1)) : undefined;
        if (target === undefined) return;
        stats.usesResolved += 1;
        const inner: Ctx = { ...ctx, ctm: multiply(ctx.ctm, translate(num(el, "x"), num(el, "y"))), inUse: true };
        const children = target.name === "symbol" || target.name === "g" ? target.children : [target];
        const targetCtx = target.name === "g" ? inherit(target, inner) : inner;
        for (const c of children) if (typeof c !== "string") walk(c, targetCtx);
        return;
      }
      case "path": {
        const d = el.attrs.get("d");
        if (d === undefined || d.trim() === "") return;
        stats.paths += 1;
        if (ctx.inUse) stats.glyphPathsDrawn += 1;
        drawPath(d, ctx, CSS_STROKED.has("path"));
        return;
      }
      case "rect": {
        const x = num(el, "x"); const y = num(el, "y"); const w = num(el, "width"); const h = num(el, "height");
        if (w <= 0 || h <= 0) return;
        stats.shapes += 1;
        drawPath(`M${x} ${y}h${w}v${h}h${-w}Z`, ctx, true);
        return;
      }
      case "ellipse": case "circle": {
        const cx = num(el, "cx"); const cy = num(el, "cy");
        const rx = el.name === "circle" ? num(el, "r") : num(el, "rx");
        const ry = el.name === "circle" ? rx : num(el, "ry");
        if (rx <= 0 || ry <= 0) return;
        stats.shapes += 1;
        drawPath(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`, ctx, el.name === "ellipse");
        return;
      }
      case "polyline": case "polygon": {
        const pts = (el.attrs.get("points") ?? "").trim().split(/[\s,]+/).map(Number);
        if (pts.length < 4) return;
        let d = `M${pts[0]} ${pts[1]}`;
        for (let k = 2; k + 1 < pts.length; k += 2) d += `L${pts[k]} ${pts[k + 1]}`;
        if (el.name === "polygon") d += "Z";
        stats.shapes += 1;
        drawPath(d, ctx, true);
        return;
      }
      case "text":
        drawText(el, ctx);
        return;
      default:
        stats.unsupported[el.name] = (stats.unsupported[el.name] ?? 0) + 1;
    }
  };
  walk(root, base);
  return stats;
}
