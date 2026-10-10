// B2: draw Verovio's SVG subset onto pdf-lib pages as vectors (spike S4,
// route ii). Browser- and worker-safe: no DOM, no Node APIs.
//
// Every element and attribute is checked against a closed allowlist. Anything
// else throws `UNSAFE_SVG: <name>`; nothing is skipped silently. Text is drawn
// with the embedded Liberation Serif faces. Leipzig *text* (a private-use
// codepoint in a font-family="Leipzig" tspan, S2 R8) has no outline in the SVG
// and no embedded font is allowed, so it throws UNSAFE_SVG rather than print a
// blank or a fallback glyph. Music glyphs that arrive as <use> paths are fine.
import fontkit from '@pdf-lib/fontkit';
import {
  type Color,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineJoin,
} from 'pdf-lib';
import type { FontProfile, PhysicalPage, SanitizedSvg } from './types';

const MM_TO_PT = 72 / 25.4;

export interface PlacementMm {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

export type FaceName = 'regular' | 'italic' | 'bold';

/** Lazily embeds only the faces a drawing actually uses. */
export interface EmbeddedFonts {
  readonly profileDigest: string;
  get(face: FaceName): Promise<PDFFont>;
}

export function createEmbeddedFonts(doc: PDFDocument, fonts: FontProfile): EmbeddedFonts {
  doc.registerFontkit(fontkit);
  const cache = new Map<FaceName, Promise<PDFFont>>();
  const bytesFor = (face: FaceName): Uint8Array =>
    face === 'regular' ? fonts.headingRegular.bytes : face === 'italic' ? fonts.headingItalic.bytes : fonts.headingBold.bytes;
  return {
    profileDigest: fonts.digest,
    get(face) {
      let p = cache.get(face);
      if (p === undefined) {
        p = doc.embedFont(bytesFor(face), { subset: true });
        cache.set(face, p);
      }
      return p;
    },
  };
}

const unsafe = (what: string): Error => new Error(`UNSAFE_SVG: ${what}`);

// --------------------------------------------------------------- XML reader --
// Workers have no DOMParser. This strict reader accepts well-formed XML only,
// rejects DOCTYPE/declarations and throws on anything it does not understand.

interface XmlElement {
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
}
type XmlNode = XmlElement | string;
interface MutableElement { name: string; attrs: Map<string, string>; children: XmlNode[] }

const NAME = /[A-Za-z_][\w.:-]*/y;
const ATTR = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, ent: string) => {
    switch (ent) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const cp = ent.startsWith('#x') ? Number.parseInt(ent.slice(2), 16) : Number.parseInt(ent.slice(1), 10);
        if (!Number.isFinite(cp) || cp > 0x10ffff) throw unsafe('xml: bad character reference');
        return String.fromCodePoint(cp);
      }
    }
  });
}

function parseXml(src: string): XmlElement {
  const stack: MutableElement[] = [];
  let root: MutableElement | null = null;
  let i = 0;
  const top = (): MutableElement | undefined => stack[stack.length - 1];
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt === -1 ? src.length : lt;
    if (textEnd > i) {
      const text = src.slice(i, textEnd);
      const parent = top();
      if (parent !== undefined) parent.children.push(decodeEntities(text));
      else if (text.trim() !== '') throw unsafe('xml: text outside the root element');
    }
    if (lt === -1) break;
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt);
      if (end === -1) throw unsafe('xml: unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end === -1) throw unsafe('xml: unterminated comment');
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (end === -1) throw unsafe('xml: unterminated CDATA');
      top()?.children.push(src.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) throw unsafe('xml: DOCTYPE and declarations are not accepted');
    if (src.startsWith('</', lt)) {
      const gt = src.indexOf('>', lt);
      if (gt === -1) throw unsafe('xml: unterminated end tag');
      const name = src.slice(lt + 2, gt).trim();
      const open = stack.pop();
      if (open?.name !== name) throw unsafe(`xml: mismatched </${name}>`);
      i = gt + 1;
      continue;
    }
    NAME.lastIndex = lt + 1;
    const nameMatch = NAME.exec(src);
    if (nameMatch === null) throw unsafe(`xml: bad tag at ${lt}`);
    const el: MutableElement = { name: nameMatch[0], attrs: new Map(), children: [] };
    i = NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = i;
      const a = ATTR.exec(src);
      if (a === null) break;
      const key = a[1];
      const value = a[3] ?? a[4] ?? '';
      if (key !== undefined) {
        if (el.attrs.has(key)) throw unsafe(`xml: duplicate attribute ${key}`);
        el.attrs.set(key, decodeEntities(value));
      }
      i = ATTR.lastIndex;
    }
    while (src[i] === ' ' || src[i] === '\n' || src[i] === '\t' || src[i] === '\r') i++;
    const parent = top();
    if (parent !== undefined) parent.children.push(el);
    else if (root === null) root = el;
    else throw unsafe('xml: more than one root element');
    if (src.startsWith('/>', i)) { i += 2; continue; }
    if (src[i] !== '>') throw unsafe(`xml: bad tag end at ${i}`);
    i += 1;
    stack.push(el);
  }
  if (stack.length > 0 || root === null) throw unsafe('xml: unterminated document');
  return root;
}

// ------------------------------------------------------------------ matrices --

/** SVG affine matrix [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f. */
type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m after n: apply n first. */
function multiply(m: Matrix, n: Matrix): Matrix {
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

function parseTransform(src: string): Matrix {
  let m = IDENTITY;
  let consumed = 0;
  for (const call of src.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    consumed += call[0].length;
    const fn = call[1];
    const n = (call[2] ?? '').split(/[\s,]+/).filter((s) => s !== '').map(Number);
    if (n.some((v) => !Number.isFinite(v))) throw unsafe(`transform: ${src}`);
    const [a = 0, b, c, d = 0, e = 0, f = 0] = n;
    let t: Matrix;
    switch (fn) {
      case 'translate': t = translate(a, b ?? 0); break;
      case 'scale': t = scale(a, b ?? a); break;
      case 'matrix': t = [a, b ?? 0, c ?? 0, d, e, f]; break;
      case 'rotate': {
        const r = (a * Math.PI) / 180;
        const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        t = b === undefined ? rot : multiply(translate(b, c ?? 0), multiply(rot, translate(-b, -(c ?? 0))));
        break;
      }
      case 'skewX': t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: throw unsafe(`transform: ${fn ?? '?'}`);
    }
    m = multiply(m, t);
  }
  if (consumed === 0 && src.trim() !== '') throw unsafe(`transform: ${src}`);
  return m;
}

// ------------------------------------------------------------------ allowlist --

const COMMON_ATTRS = [
  'id', 'class', 'transform', 'fill', 'stroke', 'color', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'font-size', 'font-style', 'font-weight', 'font-family', 'text-anchor', 'visibility', 'display',
];
const ELEMENT_ATTRS: Readonly<Record<string, readonly string[]>> = {
  svg: ['viewBox', 'x', 'y', 'width', 'height', 'overflow', 'version', 'xmlns', 'xmlns:xlink'],
  g: [],
  use: ['xlink:href', 'href', 'x', 'y'],
  path: ['d'],
  rect: ['x', 'y', 'width', 'height'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  polyline: ['points'],
  polygon: ['points'],
  text: ['x', 'y'],
  tspan: ['x', 'y'],
};
/** Never drawn, and their content is not inspected. */
const INERT = new Set(['defs', 'symbol', 'style', 'desc', 'title', 'metadata']);

function checkAttrs(el: XmlElement): void {
  const extra = ELEMENT_ATTRS[el.name];
  if (extra === undefined) throw unsafe(el.name);
  for (const key of el.attrs.keys()) {
    if (!COMMON_ATTRS.includes(key) && !extra.includes(key)) throw unsafe(`${el.name}@${key}`);
  }
  for (const key of ['xlink:href', 'href']) {
    const v = el.attrs.get(key);
    if (v !== undefined && !v.startsWith('#')) throw unsafe(`${el.name}@${key} (external reference)`);
  }
}

// --------------------------------------------------------------------- walker --

type Paint = Color | null | 'currentColor';

export interface WalkStats {
  uses: number;
  usesResolved: number;
  /** Path/shape paint operations emitted. */
  paintOps: number;
  /** Drawables suppressed by visibility="hidden" (R7). */
  hiddenSkipped: number;
  textRuns: string[];
  facesUsed: FaceName[];
}

interface Ctx {
  readonly ctm: Matrix;
  readonly viewport: { readonly w: number; readonly h: number };
  readonly color: Color;
  readonly fill: Paint;
  readonly stroke: Paint | undefined; // undefined: Verovio stylesheet default
  readonly strokeWidth: number;
  readonly lineCap: LineCapStyle;
  readonly lineJoin: LineJoinStyle;
  readonly dash: readonly number[] | null;
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly italic: boolean;
  readonly bold: boolean;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly visible: boolean;
}

function parseColor(v: string): Paint {
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  if (s === 'currentcolor') return 'currentColor';
  if (s === 'black') return rgb(0, 0, 0);
  if (s === 'white') return rgb(1, 1, 1);
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return rgb(
      Number.parseInt(full.slice(0, 2), 16) / 255,
      Number.parseInt(full.slice(2, 4), 16) / 255,
      Number.parseInt(full.slice(4, 6), 16) / 255,
    );
  }
  const fn = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
  if (fn !== null) return rgb(Number(fn[1]) / 255, Number(fn[2]) / 255, Number(fn[3]) / 255);
  throw unsafe(`colour ${v}`);
}

const num = (el: XmlElement, key: string, fallback = 0): number => {
  const v = el.attrs.get(key);
  if (v === undefined) return fallback;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) throw unsafe(`${el.name}@${key}="${v}"`);
  return n;
};

/** Verovio's fixed stylesheet, honoured by class instead of parsing CSS. */
const BOLD_CLASSES = new Set(['ending', 'fing', 'reh', 'tempo']);
const ITALIC_CLASSES = new Set(['dir', 'dynam', 'mNum']);
/** `#id ellipse, path, polygon, polyline, rect {stroke:currentColor}` */
const CSS_STROKED = new Set(['ellipse', 'path', 'polygon', 'polyline', 'rect']);

function inherit(el: XmlElement, ctx: Ctx): Ctx {
  const a = el.attrs;
  const classes = (a.get('class') ?? '').split(/\s+/);
  let { italic, bold } = ctx;
  if (el.name === 'g') {
    if (classes.some((c) => BOLD_CLASSES.has(c))) bold = true;
    if (classes.some((c) => ITALIC_CLASSES.has(c))) italic = true;
    if (classes.includes('label')) bold = false;
  }
  const fontStyle = a.get('font-style');
  if (fontStyle !== undefined) italic = fontStyle === 'italic' || fontStyle === 'oblique';
  const fontWeight = a.get('font-weight');
  if (fontWeight !== undefined) bold = fontWeight === 'bold' || Number(fontWeight) >= 600;
  const colorAttr = a.get('color');
  const colorParsed = colorAttr === undefined ? null : parseColor(colorAttr);
  const color = colorParsed === null || colorParsed === 'currentColor' ? ctx.color : colorParsed;
  const fs = a.get('font-size');
  const anchor = a.get('text-anchor');
  const cap = a.get('stroke-linecap');
  const join = a.get('stroke-linejoin');
  const fill = a.get('fill');
  const stroke = a.get('stroke');
  const transform = a.get('transform');
  const dashes = a.get('stroke-dasharray');
  const visibility = a.get('visibility');
  let visible = ctx.visible;
  if (visibility === 'hidden' || visibility === 'collapse') visible = false;
  else if (visibility === 'visible') visible = true;
  else if (visibility !== undefined && visibility !== 'inherit') throw unsafe(`${el.name}@visibility="${visibility}"`);
  const fontSize = fs === undefined ? ctx.fontSize : Number.parseFloat(fs);
  if (!Number.isFinite(fontSize)) throw unsafe(`${el.name}@font-size="${fs ?? ''}"`);
  return {
    ctm: transform === undefined ? ctx.ctm : multiply(ctx.ctm, parseTransform(transform)),
    viewport: ctx.viewport,
    color,
    fill: fill === undefined ? ctx.fill : parseColor(fill),
    stroke: stroke === undefined ? ctx.stroke : parseColor(stroke),
    strokeWidth: a.has('stroke-width') ? num(el, 'stroke-width') : ctx.strokeWidth,
    lineCap: cap === 'round' ? LineCapStyle.Round : cap === 'square' ? LineCapStyle.Projecting : cap === 'butt' ? LineCapStyle.Butt : ctx.lineCap,
    lineJoin: join === 'round' ? LineJoinStyle.Round : join === 'bevel' ? LineJoinStyle.Bevel : join === 'miter' ? LineJoinStyle.Miter : ctx.lineJoin,
    dash: dashes === undefined ? ctx.dash : parseDash(dashes),
    fontSize,
    fontFamily: a.get('font-family') ?? ctx.fontFamily,
    italic,
    bold,
    anchor: anchor === 'middle' || anchor === 'end' || anchor === 'start' ? anchor : ctx.anchor,
    visible,
  };
}

function parseDash(v: string): readonly number[] | null {
  const t = v.trim();
  if (t === 'none' || t === '') return null;
  const parts = t.split(/[\s,]+/).map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) throw unsafe(`stroke-dasharray="${v}"`);
  if (parts.every((n) => n === 0)) return null;
  return parts.length % 2 === 1 ? [...parts, ...parts] : parts;
}

function resolvePaint(c: Paint | undefined, ctx: Ctx): Color | null {
  if (c === undefined || c === null) return null;
  return c === 'currentColor' ? ctx.color : c;
}

const faceOf = (ctx: Ctx): FaceName => (ctx.bold ? 'bold' : ctx.italic ? 'italic' : 'regular');
const isPrivateUse = (cp: number): boolean => cp >= 0xe000 && cp <= 0xf8ff;
const isLeipzig = (ctx: Ctx): boolean => /(^|[\s,'"])leipzig([\s,'"]|$)/i.test(ctx.fontFamily);

/**
 * Draw `svgString` onto `page`, scaled uniformly (xMidYMid meet) from its root
 * viewBox into `placement` (millimetres from the page's top-left; default: the
 * whole page). `embedded` must come from `createEmbeddedFonts` for the same
 * document and the same font profile.
 */
export async function drawSvgOnPage(
  pdfPage: PDFPage,
  svgString: string,
  fonts: FontProfile,
  embedded: EmbeddedFonts,
  placement?: PlacementMm,
): Promise<WalkStats> {
  if (embedded.profileDigest !== fonts.digest) throw new Error('FONT_UNAVAILABLE: embedded fonts do not match the profile');
  const root = parseXml(svgString);
  if (root.name !== 'svg') throw unsafe(`root element ${root.name}`);

  const ids = new Map<string, XmlElement>();
  const index = (el: XmlElement): void => {
    const id = el.attrs.get('id');
    if (id !== undefined) {
      ids.set(id, el);
    }
    for (const c of el.children) if (typeof c !== 'string') index(c);
  };
  index(root);

  const stats: WalkStats = { uses: 0, usesResolved: 0, paintOps: 0, hiddenSkipped: 0, textRuns: [], facesUsed: [] };
  const pageW = pdfPage.getWidth();
  const pageH = pdfPage.getHeight();
  const box = placement === undefined
    ? { x: 0, y: 0, w: pageW, h: pageH }
    : { x: placement.xMm * MM_TO_PT, y: placement.yMm * MM_TO_PT, w: placement.widthMm * MM_TO_PT, h: placement.heightMm * MM_TO_PT };
  // PDF user space is y-up from the bottom; paper space is y-down from the top.
  const paperToPdf: Matrix = [1, 0, 0, -1, 0, pageH];

  const vb = (root.attrs.get('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.some((v) => !Number.isFinite(v))) throw unsafe('svg@viewBox');
  const [vx = 0, vy = 0, vw = box.w, vh = box.h] = vb.length === 4 ? vb : [];
  if (!(vw > 0) || !(vh > 0)) throw unsafe('svg@viewBox');
  const s = Math.min(box.w / vw, box.h / vh);
  const rootCtm = multiply(
    paperToPdf,
    multiply(translate(box.x + (box.w - vw * s) / 2, box.y + (box.h - vh * s) / 2), multiply(scale(s, s), translate(-vx, -vy))),
  );

  const base: Ctx = {
    ctm: rootCtm, viewport: { w: vw, h: vh }, color: rgb(0, 0, 0), fill: 'currentColor', stroke: undefined,
    strokeWidth: 1, lineCap: LineCapStyle.Butt, lineJoin: LineJoinStyle.Miter, dash: null, fontSize: 16, fontFamily: '',
    italic: false, bold: false, anchor: 'start', visible: true,
  };

  const note = (face: FaceName): void => {
    if (!stats.facesUsed.includes(face)) stats.facesUsed.push(face);
  };

  const drawPath = (d: string, ctx: Ctx, cssStroked: boolean): void => {
    if (!ctx.visible) { stats.hiddenSkipped += 1; return; }
    const fill = resolvePaint(ctx.fill, ctx);
    const stroke = ctx.stroke === undefined ? (cssStroked ? ctx.color : null) : resolvePaint(ctx.stroke, ctx);
    const stroked = stroke !== null && ctx.strokeWidth > 0;
    if (fill === null && !stroked) return;
    // drawSvgPath applies scale(1,-1) itself; pre-compose it away.
    const m = multiply(ctx.ctm, FLIP_Y);
    pdfPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), setLineJoin(ctx.lineJoin));
    pdfPage.drawSvgPath(d, {
      x: 0,
      y: 0,
      ...(fill === null ? {} : { color: fill }),
      ...(stroked ? { borderColor: stroke, borderWidth: ctx.strokeWidth, borderLineCap: ctx.lineCap, ...(ctx.dash === null ? {} : { borderDashArray: [...ctx.dash] }) } : {}),
    });
    pdfPage.pushOperators(popGraphicsState());
    stats.paintOps += 1;
  };

  interface Run { readonly text: string; readonly ctx: Ctx; readonly x: number | null; readonly y: number | null }

  const drawText = async (el: XmlElement, ctx: Ctx): Promise<void> => {
    const runs: Run[] = [];
    const collect = (node: XmlElement, c: Ctx): void => {
      let own = c;
      if (node !== el) {
        checkAttrs(node);
        if (node.attrs.get('display') === 'none') return;
        own = inherit(node, c);
      }
      let first = true;
      for (const child of node.children) {
        if (typeof child === 'string') {
          const text = child.replace(/\s+/g, ' ');
          const lead = runs.length === 0 ? text.trimStart() : text;
          if (lead.trim() === '') continue;
          runs.push({
            text: lead.trim() === lead ? lead : lead.replace(/\s+$/, ''),
            ctx: own,
            x: first && node !== el && node.attrs.has('x') ? num(node, 'x') : null,
            y: first && node !== el && node.attrs.has('y') ? num(node, 'y') : null,
          });
          first = false;
        } else if (child.name === 'tspan') {
          collect(child, own);
        } else {
          throw unsafe(`text>${child.name}`);
        }
      }
    };
    collect(el, ctx);
    if (runs.length === 0) return;

    // Resolve each run's face first (embedding is async), then measure.
    const resolved = await Promise.all(
      runs.map(async (r) => {
        if (isLeipzig(r.ctx)) return null;
        const face = faceOf(r.ctx);
        return { face, font: await embedded.get(face) };
      }),
    );
    const widthOf = (k: number): number => {
      const r = runs[k];
      const f = resolved[k];
      if (r === undefined) return 0;
      if (f === null || f === undefined) return 0;
      return f.font.widthOfTextAtSize(r.text, r.ctx.fontSize);
    };
    const total = runs.reduce((w, _r, k) => w + widthOf(k), 0);
    let penX = num(el, 'x') - (ctx.anchor === 'middle' ? total / 2 : ctx.anchor === 'end' ? total : 0);
    let penY = num(el, 'y');

    for (const [k, r] of runs.entries()) {
      if (r.x !== null) penX = r.x;
      if (r.y !== null) penY = r.y;
      const f = resolved[k];
      const fill = resolvePaint(r.ctx.fill, r.ctx);
      if (f === null || f === undefined) {
        // Leipzig run (R8): no outline and no embedded font, so refuse.
        const cp = r.text.codePointAt(0) ?? 0;
        throw unsafe(`leipzig text glyph U+${cp.toString(16).toUpperCase()} (no vector outline in the SVG)`);
      }
      for (const ch of r.text) {
        if (isPrivateUse(ch.codePointAt(0) ?? 0)) throw unsafe('private-use character outside a Leipzig run');
      }
      if (!r.ctx.visible) { stats.hiddenSkipped += 1; penX += widthOf(k); continue; }
      if (fill !== null && r.ctx.fontSize > 0) {
        // Glyph space is y-up; flip it back into the y-down SVG space.
        const m = multiply(r.ctx.ctm, multiply(translate(penX, penY), FLIP_Y));
        pdfPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]));
        pdfPage.drawText(r.text, { x: 0, y: 0, size: r.ctx.fontSize, font: f.font, color: fill });
        pdfPage.pushOperators(popGraphicsState());
        stats.textRuns.push(r.text);
        note(f.face);
      }
      penX += widthOf(k);
    }
  };

  const walk = async (el: XmlElement, parent: Ctx): Promise<void> => {
    if (INERT.has(el.name)) return; // drawn only through <use>, or not drawn
    checkAttrs(el);
    if (el.attrs.get('display') === 'none') return;
    let ctx = inherit(el, parent);
    switch (el.name) {
      case 'svg': {
        if (el !== root) {
          const w = el.attrs.get('width');
          const h = el.attrs.get('height');
          const pw = w === undefined || w.endsWith('%') ? (parent.viewport.w * (w === undefined ? 100 : Number.parseFloat(w))) / 100 : Number.parseFloat(w);
          const ph = h === undefined || h.endsWith('%') ? (parent.viewport.h * (h === undefined ? 100 : Number.parseFloat(h))) / 100 : Number.parseFloat(h);
          if (!Number.isFinite(pw) || !Number.isFinite(ph)) throw unsafe('svg@width/height');
          const box2 = (el.attrs.get('viewBox') ?? '').split(/[\s,]+/).map(Number);
          let m = translate(num(el, 'x'), num(el, 'y'));
          let viewport = { w: pw, h: ph };
          if (box2.length === 4) {
            const [bx = 0, by = 0, bw = pw, bh = ph] = box2;
            if (![bx, by, bw, bh].every(Number.isFinite) || bw <= 0 || bh <= 0) throw unsafe('svg@viewBox');
            const k = Math.min(pw / bw, ph / bh);
            m = multiply(m, multiply(translate((pw - bw * k) / 2, (ph - bh * k) / 2), multiply(scale(k, k), translate(-bx, -by))));
            viewport = { w: bw, h: bh };
          }
          ctx = { ...ctx, ctm: multiply(ctx.ctm, m), viewport };
        }
        for (const c of el.children) if (typeof c !== 'string') await walk(c, ctx);
        return;
      }
      case 'g':
        for (const c of el.children) if (typeof c !== 'string') await walk(c, ctx);
        return;
      case 'use': {
        stats.uses += 1;
        const href = el.attrs.get('xlink:href') ?? el.attrs.get('href') ?? '';
        const target = href.startsWith('#') ? ids.get(href.slice(1)) : undefined;
        if (target === undefined) throw unsafe(`use: unresolved reference "${href}"`);
        stats.usesResolved += 1;
        const inner: Ctx = { ...ctx, ctm: multiply(ctx.ctm, translate(num(el, 'x'), num(el, 'y'))) };
        if (target.name === 'symbol' || target.name === 'g') {
          if (target.name === 'g') checkAttrs(target);
          if (target.attrs.get('display') === 'none') return;
          const targetCtx = target.name === 'g' ? inherit(target, inner) : inner;
          for (const c of target.children) if (typeof c !== 'string') await walk(c, targetCtx);
        } else {
          await walk(target, inner);
        }
        return;
      }
      case 'path': {
        const d = el.attrs.get('d');
        if (d === undefined || d.trim() === '') return;
        drawPath(d, ctx, true);
        return;
      }
      case 'rect': {
        const x = num(el, 'x'); const y = num(el, 'y'); const w = num(el, 'width'); const h = num(el, 'height');
        if (w <= 0 || h <= 0) return;
        drawPath(`M${x} ${y}h${w}v${h}h${-w}Z`, ctx, true);
        return;
      }
      case 'ellipse': case 'circle': {
        const cx = num(el, 'cx'); const cy = num(el, 'cy');
        const rx = el.name === 'circle' ? num(el, 'r') : num(el, 'rx');
        const ry = el.name === 'circle' ? rx : num(el, 'ry');
        if (rx <= 0 || ry <= 0) return;
        drawPath(`M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`, ctx, el.name === 'ellipse');
        return;
      }
      case 'polyline': case 'polygon': {
        const pts = (el.attrs.get('points') ?? '').trim().split(/[\s,]+/).map(Number);
        if (pts.length < 4 || pts.some((v) => !Number.isFinite(v))) return;
        let d = `M${pts[0]} ${pts[1]}`;
        for (let k = 2; k + 1 < pts.length; k += 2) d += `L${pts[k]} ${pts[k + 1]}`;
        if (el.name === 'polygon') d += 'Z';
        drawPath(d, ctx, true);
        return;
      }
      case 'text':
        await drawText(el, ctx);
        return;
      default:
        throw unsafe(el.name);
    }
  };
  await walk(root, base);
  return stats;
}

/**
 * One-page vector PDF, exactly `page.widthMm x page.heightMm`, with the SVG
 * drawn into `placement` (default: the whole page).
 */
export async function svgToVectorPdf(
  svg: SanitizedSvg,
  page: PhysicalPage,
  fonts: FontProfile,
  placement?: PlacementMm,
): Promise<Uint8Array> {
  // No timestamps/producer: identical input gives identical bytes.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const embedded = createEmbeddedFonts(doc, fonts);
  const pdfPage = doc.addPage([page.widthMm * MM_TO_PT, page.heightMm * MM_TO_PT]);
  await drawSvgOnPage(pdfPage, svg.svg, fonts, embedded, placement);
  return doc.save({ useObjectStreams: false });
}
