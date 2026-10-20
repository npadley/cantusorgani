/**
 * Exsurge SVG normalizer and line splitter (card K1 of the chant-in-export feature).
 *
 * Exsurge (bbloomf/exsurge, vendored at 16c626f) emits SVG that the page sanitizer (`svg.ts`,
 * security boundary B5) rejects on purpose: an undeclared `xlink` prefix, bookkeeping attributes,
 * a descendant-selector `<style>` block, inline `style` attributes and `<line>` elements. This
 * module is a *closed* rewrite in front of the unchanged sanitizer: every element, attribute, style
 * property and class it does not list is rejected with `UNSAFE_SVG: exsurge <what>`, never
 * stripped, so a new Exsurge version cannot slip a feature through. See spec section 5.
 *
 * Pure: `@xmldom/xmldom` only, no DOM globals, so it runs in the layout worker and in Vitest.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

type XmldomNode = Parameters<XMLSerializer['serializeToString']>[0];

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const FONT_FAMILY = 'Liberation Serif';
const SMALL_CAPS_SCALE = 0.8;

/** Exsurge's line box: at least this far above the baseline (top staff line 43.75 + 15 units). */
const MIN_ASCENT = 58.75;
/** ... and at least this far below it (default lyric baseline 16.857 + descent). */
const MIN_BELOW = 24.63;
/** Depth of lyric text below its baseline, as a fraction of the font size (Exsurge boxes 0.405; a little generous so descenders never clip). */
const LYRIC_DESCENT = 0.42;
/** Cap height of Liberation Serif as a fraction of the font size, for annotation overhang. */
const CAP_HEIGHT = 0.6547;
/** A drop cap whose letter has a tail ('Q', 'J') descends this far below its baseline. */
const TAILED_DROP_CAP_DESCENT = 0.1621;

function unsafe(what: string): Error {
  return new Error(`UNSAFE_SVG: exsurge ${what}`);
}

// ---------------------------------------------------------------- allowlists ---

const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
/**
 * Only `translate(n[,n])` and `scale(n[,n])`, in any number. Walked token by token with plain string operations (no
 * nested or overlapping regex quantifiers, so no input can make it backtrack).
 */
export function isSafeTransform(value: string): boolean {
  let rest = value.trim().toLowerCase();
  if (rest === '') return false;
  while (rest !== '') {
    const open = rest.startsWith('translate(') ? 'translate(' : rest.startsWith('scale(') ? 'scale(' : null;
    if (open === null) return false;
    const close = rest.indexOf(')');
    if (close < 0) return false;
    const args = rest.slice(open.length, close).split(',');
    if (args.length > 2 || !args.every((a) => NUMBER_RE.test(a.trim()))) return false;
    rest = rest.slice(close + 1).trimStart();
  }
  return true;
}
const PATH_DATA_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;
const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;
const CLASS_RE = /^[A-Za-z0-9_.: -]*$/;

/** Bookkeeping attributes Exsurge adds, removed (and only these) wherever they appear. */
const BOOKKEEPING: Readonly<Record<string, readonly string[]>> = {
  g: ['source-index', 'element-index'],
  use: ['source-index', 'element-index', 'id'],
  rect: ['source-index', 'element-index'],
  text: ['source-index', 'element-index'],
  tspan: ['source-index', 'element-index'],
  line: ['key'],
};

type AttrKind = 'number' | 'color' | 'paint' | 'class' | 'id' | 'transform' | 'path' | 'href' | 'text';

const ELEMENT_ATTRS: Readonly<Record<string, Readonly<Record<string, AttrKind>>>> = {
  g: { id: 'id', class: 'class', transform: 'transform' },
  defs: {},
  path: { d: 'path', fill: 'paint', stroke: 'paint', 'stroke-width': 'number', class: 'class' },
  line: { x1: 'number', y1: 'number', x2: 'number', y2: 'number', stroke: 'paint', 'stroke-width': 'number', class: 'class' },
  rect: { x: 'number', y: 'number', width: 'number', height: 'number', fill: 'paint', class: 'class' },
  use: { 'xlink:href': 'href', class: 'class', x: 'number', y: 'number', transform: 'transform' },
  text: { x: 'number', y: 'number', class: 'class', 'text-anchor': 'text', style: 'text' },
  tspan: { class: 'class', style: 'text' },
  style: {},
};

const ROOT_ATTRS: ReadonlySet<string> = new Set([
  'xmlns', 'xmlns:xlink', 'version', 'class', 'width', 'height', 'viewBox',
]);

// ------------------------------------------------------------------- parsing ---

/** Repair the root's `xlink=` declaration (a plain attribute in Exsurge's output), nothing else. */
function repairNamespace(svg: string): string {
  const m = /^(\s*(?:<\?xml\s[^>]*\?>\s*)?)(<svg\b[^>]*>)/.exec(svg);
  if (m === null) throw unsafe('malformed SVG: no <svg> root');
  const [, head = '', tag = ''] = m;
  const repaired = tag.replace(/(\s)xlink=("|')([^"']*)\2/, (_all, ws: string, q: string, value: string) => {
    if (value !== XLINK_NS) throw unsafe(`xlink declaration "${value.slice(0, 40)}"`);
    return `${ws}xmlns:xlink=${q}${XLINK_NS}${q}`;
  });
  return head + repaired + svg.slice(m[0].length);
}

function scanSource(svg: string): void {
  if (/<!DOCTYPE/i.test(svg)) throw unsafe('DOCTYPE declaration');
  if (/<!ENTITY/i.test(svg)) throw unsafe('entity declaration');
  if (/<\?(?!xml\s)/.test(svg)) throw unsafe('processing instruction');
  if (/&(?!(?:#[0-9]+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/.test(svg)) throw unsafe('entity reference');
}

function parse(svg: string): Document {
  scanSource(svg);
  const parser = new DOMParser({
    onError: (level, message) => {
      throw unsafe(`malformed SVG (${level}: ${message.slice(0, 80)})`);
    },
  });
  let doc: Document;
  try {
    doc = parser.parseFromString(repairNamespace(svg), 'image/svg+xml') as unknown as Document;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('UNSAFE_SVG')) throw e;
    throw unsafe(`malformed SVG (${e instanceof Error ? e.message.slice(0, 80) : 'parse error'})`);
  }
  const root = doc.documentElement as Element | null;
  if (root === null || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw unsafe('root element is not an SVG <svg>');
  }
  return doc;
}

// -------------------------------------------------------------------- styles ---

interface ClassFace {
  readonly fontSize: number;
  readonly fill: string;
}

/** `svg.Exsurge .lyric{fill:#000;font-family:'Liberation Serif';font-size:19.2px;font-kerning:normal}` */
function parseStyleBlock(css: string): Map<string, ClassFace> {
  const faces = new Map<string, ClassFace>();
  let rest = css.trim();
  while (rest.length > 0) {
    const open = rest.indexOf('{');
    const close = rest.indexOf('}');
    if (open === -1 || close < open) throw unsafe('style rule is malformed');
    const selector = rest.slice(0, open).trim();
    const body = rest.slice(open + 1, close);
    rest = rest.slice(close + 1).trim();
    const sel = /^svg\.Exsurge \.([A-Za-z][A-Za-z0-9_-]*)$/.exec(selector);
    if (sel === null) throw unsafe(`style selector "${selector.slice(0, 40)}"`);
    let fill: string | null = null;
    let fontSize: number | null = null;
    for (const decl of body.split(';')) {
      if (decl.trim() === '') continue;
      const colon = decl.indexOf(':');
      if (colon === -1) throw unsafe(`style declaration "${decl.trim().slice(0, 40)}"`);
      const name = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (name === 'fill') {
        if (!COLOR_RE.test(value)) throw unsafe(`style fill "${value.slice(0, 20)}"`);
        fill = value;
      } else if (name === 'font-family') {
        if (value.replace(/['"]/g, '') !== FONT_FAMILY) throw unsafe(`style font-family "${value.slice(0, 30)}"`);
      } else if (name === 'font-size') {
        const px = /^(-?[\d.]+)px$/.exec(value);
        const n = px === null ? NaN : Number(px[1]);
        if (!Number.isFinite(n) || n <= 0) throw unsafe(`style font-size "${value.slice(0, 20)}"`);
        fontSize = n;
      } else if (name === 'font-kerning') {
        if (value !== 'normal') throw unsafe(`style font-kerning "${value.slice(0, 20)}"`);
      } else {
        throw unsafe(`style property ${name}`);
      }
    }
    if (fill === null || fontSize === null) throw unsafe(`style rule .${sel[1] ?? ''} lacks fill or font-size`);
    faces.set(sel[1] ?? '', { fontSize, fill });
  }
  return faces;
}

interface InlineStyle {
  italic: boolean;
  bold: boolean;
  smallCaps: boolean;
  fill: string | null;
}

/** Inline `style="..."` declarations; only the five Exsurge emits are accepted. */
function parseInline(style: string): InlineStyle {
  const out: InlineStyle = { italic: false, bold: false, smallCaps: false, fill: null };
  for (const decl of style.split(';')) {
    if (decl.trim() === '') continue;
    const colon = decl.indexOf(':');
    if (colon === -1) throw unsafe(`style declaration "${decl.trim().slice(0, 40)}"`);
    const name = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    switch (name) {
      case 'font-style':
        if (value !== 'italic') throw unsafe(`style font-style "${value.slice(0, 20)}"`);
        out.italic = true;
        break;
      case 'font-weight':
        if (value !== 'bold') throw unsafe(`style font-weight "${value.slice(0, 20)}"`);
        out.bold = true;
        break;
      case 'font-variant':
        if (value !== 'small-caps') throw unsafe(`style font-variant "${value.slice(0, 20)}"`);
        out.smallCaps = true;
        break;
      case 'fill':
        if (!COLOR_RE.test(value)) throw unsafe(`style fill "${value.slice(0, 20)}"`);
        out.fill = value;
        break;
      case 'font-family':
        // 'Exsurge Characters' is not vendored; the run keeps its letter in Liberation Serif.
        if (value.replace(/['"]/g, '') !== 'Exsurge Characters') {
          throw unsafe(`style font-family "${value.slice(0, 30)}"`);
        }
        break;
      default:
        throw unsafe(`style property ${name}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------- walking ---

function checkAttributeValue(tag: string, name: string, kind: AttrKind, value: string): void {
  const bad = (): Error => unsafe(`attribute ${name}="${value.slice(0, 40)}" on <${tag}>`);
  switch (kind) {
    case 'number':
      if (!NUMBER_RE.test(value.trim())) throw bad();
      break;
    case 'color':
      if (!COLOR_RE.test(value)) throw bad();
      break;
    case 'paint':
      if (value !== 'none' && !COLOR_RE.test(value)) throw bad();
      break;
    case 'class':
      if (!CLASS_RE.test(value)) throw bad();
      break;
    case 'id':
      if (!ID_RE.test(value)) throw bad();
      break;
    case 'transform':
      if (!isSafeTransform(value)) throw unsafe(`transform "${value.slice(0, 40)}" on <${tag}>`);
      break;
    case 'path':
      if (!PATH_DATA_RE.test(value)) throw bad();
      break;
    case 'href':
      if (!/^#.+$/.test(value) || !ID_RE.test(value.slice(1))) throw unsafe(`external href "${value.slice(0, 60)}" on <${tag}>`);
      break;
    case 'text':
      break;
  }
}

/** Remove bookkeeping and empty attributes; reject everything not allowlisted for `tag`. */
function cleanAttributes(el: Element, tag: string): void {
  const strip = BOOKKEEPING[tag] ?? [];
  const allowed = ELEMENT_ATTRS[tag] ?? {};
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (/^on/i.test(name)) throw unsafe(`attribute ${name} on <${tag}>`);
    if (strip.includes(name)) {
      el.removeAttribute(name);
      continue;
    }
    const kind = allowed[name];
    if (kind === undefined) throw unsafe(`attribute ${name} on <${tag}>`);
    if ((name === 'class' || name === 'style') && attr.value.trim() === '') {
      el.removeAttribute(name);
      continue;
    }
    checkAttributeValue(tag, name, kind, attr.value);
  }
}

function trimmedNumber(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

function elementChildren(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
}

function requireOnlyText(el: Element, tag: string): void {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1) throw unsafe(`element <${(c as Element).localName}> inside <${tag}>`);
    if (c.nodeType !== 3) throw unsafe(`node type ${c.nodeType} inside <${tag}>`);
  }
}

function faceFor(classes: string, faces: ReadonlyMap<string, ClassFace>): ClassFace {
  for (const token of classes.split(/\s+/)) {
    const face = faces.get(token);
    if (face !== undefined) return face;
  }
  throw unsafe(`text class "${classes.slice(0, 40)}" has no style rule`);
}

function normalizeText(text: Element, faces: ReadonlyMap<string, ClassFace>): void {
  const classes = text.getAttribute('class') ?? '';
  const face = faceFor(classes, faces);
  const own = parseInline(text.getAttribute('style') ?? '');
  text.removeAttribute('style');
  text.setAttribute('font-size', trimmedNumber(face.fontSize));
  text.setAttribute('font-family', FONT_FAMILY);
  text.setAttribute('fill', own.fill ?? face.fill);
  if (own.italic) text.setAttribute('font-style', 'italic');
  if (own.bold) text.setAttribute('font-weight', 'bold');

  for (const child of Array.from(text.childNodes)) {
    if (child.nodeType === 3) {
      if (own.smallCaps && child.nodeValue !== null) child.nodeValue = child.nodeValue.toUpperCase();
      continue;
    }
    if (child.nodeType !== 1) throw unsafe(`node type ${child.nodeType} inside <text>`);
    const span = child as Element;
    if (span.localName !== 'tspan') throw unsafe(`element <${span.localName}> inside <text>`);
    cleanAttributes(span, 'tspan');
    requireOnlyText(span, 'tspan');
    const s = parseInline(span.getAttribute('style') ?? '');
    span.removeAttribute('style');
    if (s.italic) span.setAttribute('font-style', 'italic');
    if (s.bold) span.setAttribute('font-weight', 'bold');
    if (s.fill !== null) span.setAttribute('fill', s.fill);
    if (s.smallCaps || own.smallCaps) {
      span.setAttribute('font-size', trimmedNumber(face.fontSize * SMALL_CAPS_SCALE));
      for (const c of Array.from(span.childNodes)) {
        if (c.nodeValue !== null) c.nodeValue = c.nodeValue.toUpperCase();
      }
    }
  }
  collapseDoubledPeriod(text);
}

/**
 * Exsurge appends '.' to a rubric glyph (`V.`, `R.`) and the GABC source usually supplies another,
 * so the next run begins with a second period (`V.` + `. Dó`). Show one.
 */
function collapseDoubledPeriod(text: Element): void {
  const spans = elementChildren(text);
  for (let i = 0; i + 1 < spans.length; i += 1) {
    const rubric = spans[i];
    const next = spans[i + 1];
    if (rubric === undefined || next === undefined) continue;
    if ((rubric.getAttribute('class') ?? '').split(/\s+/).includes('rubric') && (rubric.textContent ?? '').endsWith('.')) {
      const first = next.firstChild;
      if (first !== null && first.nodeType === 3 && (first.nodeValue ?? '').startsWith('.')) {
        first.nodeValue = (first.nodeValue ?? '').slice(1);
      }
    }
  }
}

function normalizeLine(doc: Document, line: Element): Element {
  const path = doc.createElementNS(SVG_NS, 'path');
  const x1 = line.getAttribute('x1');
  const y1 = line.getAttribute('y1');
  const x2 = line.getAttribute('x2');
  const y2 = line.getAttribute('y2');
  if (x1 === null || y1 === null || x2 === null || y2 === null) throw unsafe('<line> lacks coordinates');
  path.setAttribute('d', `M${x1} ${y1} L${x2} ${y2}`);
  path.setAttribute('fill', 'none');
  for (const name of ['stroke', 'stroke-width', 'class']) {
    const v = line.getAttribute(name);
    if (v !== null) path.setAttribute(name, v);
  }
  return path;
}

function walkChildren(doc: Document, parent: Element, faces: ReadonlyMap<string, ClassFace>): void {
  for (const child of Array.from(parent.childNodes)) {
    switch (child.nodeType) {
      case 1:
        break;
      case 3:
        if ((child.nodeValue ?? '').trim() !== '' && parent.localName !== 'text' && parent.localName !== 'tspan') {
          throw unsafe(`text content inside <${parent.localName}>`);
        }
        continue;
      case 8:
        parent.removeChild(child);
        continue;
      default:
        throw unsafe(`node type ${child.nodeType} inside <${parent.localName}>`);
    }
    const el = child as Element;
    const tag = el.localName;
    if (el.namespaceURI !== SVG_NS) throw unsafe(`element <${el.nodeName}> in foreign namespace`);
    if (ELEMENT_ATTRS[tag] === undefined) throw unsafe(`element <${tag}>`);
    cleanAttributes(el, tag);
    if (tag === 'line') {
      requireOnlyText(el, tag);
      parent.replaceChild(normalizeLine(doc, el), el);
    } else if (tag === 'text') {
      normalizeText(el, faces);
    } else if (tag === 'style') {
      throw unsafe('<style> outside <defs>');
    } else if (tag === 'path' || tag === 'rect' || tag === 'use') {
      requireOnlyText(el, tag);
    } else {
      walkChildren(doc, el, faces);
    }
  }
}

function checkRoot(root: Element): void {
  for (const attr of Array.from(root.attributes)) {
    if (/^on/i.test(attr.name)) throw unsafe(`attribute ${attr.name} on <svg>`);
    if (!ROOT_ATTRS.has(attr.name)) throw unsafe(`attribute ${attr.name} on <svg>`);
  }
  if (root.getAttribute('xmlns') !== SVG_NS) throw unsafe('root lacks the SVG namespace');
  if (root.getAttribute('xmlns:xlink') !== XLINK_NS) throw unsafe('root lacks the xlink namespace');
  for (const name of ['width', 'height']) {
    if (!NUMBER_RE.test(root.getAttribute(name) ?? '')) throw unsafe(`root ${name} is not a plain number`);
  }
}

/** Collect and remove every `<style>` block (only direct children of `<defs>` are accepted). */
function takeStyles(doc: Document): Map<string, ClassFace> {
  const faces = new Map<string, ClassFace>();
  for (const style of Array.from(doc.getElementsByTagName('style'))) {
    const parent = style.parentNode as Element | null;
    if (parent === null || parent.localName !== 'defs') throw unsafe('<style> outside <defs>');
    for (const a of Array.from(style.attributes)) throw unsafe(`attribute ${a.name} on <style>`);
    requireOnlyText(style, 'style');
    for (const [name, face] of parseStyleBlock(style.textContent ?? '')) faces.set(name, face);
    parent.removeChild(style);
  }
  return faces;
}

/**
 * Rewrite Exsurge's SVG so the unchanged `sanitizePageSvg` accepts it (spec section 5, rules 1-6).
 * Throws `UNSAFE_SVG: exsurge <what>` on anything not listed.
 */
export function normalizeExsurgeSvg(svg: string): string {
  const doc = parse(svg);
  const root = doc.documentElement;
  checkRoot(root);
  // Exsurge's root class is `Exsurge ChantScore`. A page that already drew chant carries Exsurge's own `<style>`
  // (`svg.Exsurge .lyric{font-size:19.2px}`), which applies document-wide to any SVG with that class and would restyle the
  // export's lyrics (K9 finding: syllables collided). The export's SVG is self-styled, so it drops the class.
  root.removeAttribute('class');
  const faces = takeStyles(doc);
  walkChildren(doc, root, faces);
  return new XMLSerializer().serializeToString(doc as unknown as XmldomNode);
}

// ------------------------------------------------------------------ splitting ---

interface Matrix {
  readonly sx: number;
  readonly sy: number;
  readonly tx: number;
  readonly ty: number;
}
const IDENTITY: Matrix = { sx: 1, sy: 1, tx: 0, ty: 0 };

/** translate()/scale() only; anything else was already rejected by the normalizer. */
function parseTransform(src: string | null): Matrix {
  let m = IDENTITY;
  if (src === null) return m;
  let rest = src.trim().toLowerCase();
  while (rest !== '') {
    const translate = rest.startsWith('translate(');
    const close = rest.indexOf(')');
    if (close < 0) break;
    const args = rest.slice(translate ? 'translate('.length : 'scale('.length, close).split(',').map((n) => Number(n.trim()));
    const a = args[0] ?? 0;
    const b = args[1];
    if (translate) {
      m = { ...m, tx: m.tx + m.sx * a, ty: m.ty + m.sy * (b ?? 0) };
    } else {
      m = { ...m, sx: m.sx * a, sy: m.sy * (b ?? a) };
    }
    rest = rest.slice(close + 1).trimStart();
  }
  return m;
}

/** Control-point bounding box `[minY, maxY]` of SVG path data (arcs by end point). */
function pathYRange(d: string): readonly [number, number] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  let cy = 0;
  let sy = 0;
  let cmd = '';
  let lo = Infinity;
  let hi = -Infinity;
  const num = (): number => {
    const n = Number(tokens[i]);
    i += 1;
    if (!Number.isFinite(n)) throw unsafe('path data');
    return n;
  };
  const mark = (y: number): void => {
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i] ?? '')) {
      cmd = tokens[i] ?? '';
      i += 1;
    } else if (cmd === '') {
      throw unsafe('path data');
    }
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const abs = (y: number): number => (rel ? cy + y : y);
    if (up === 'Z') {
      cy = sy;
    } else if (up === 'M' || up === 'L' || up === 'T') {
      num();
      cy = abs(num());
      mark(cy);
      if (up === 'M') {
        sy = cy;
        cmd = rel ? 'l' : 'L';
      }
    } else if (up === 'H') {
      num();
      mark(cy);
    } else if (up === 'V') {
      cy = abs(num());
      mark(cy);
    } else if (up === 'C' || up === 'S' || up === 'Q') {
      const points = up === 'C' ? 3 : 2;
      let last = cy;
      for (let k = 0; k < points; k += 1) {
        num();
        last = abs(num());
        mark(last);
      }
      cy = last;
    } else if (up === 'A') {
      for (let k = 0; k < 5; k += 1) num();
      num();
      cy = abs(num());
      mark(cy);
    } else {
      throw unsafe(`path command ${cmd}`);
    }
  }
  return lo === Infinity ? [0, 0] : [lo, hi];
}

interface Extent {
  top: number;
  bottom: number;
}

function grow(e: Extent, y0: number, y1: number): void {
  e.top = Math.min(e.top, y0, y1);
  e.bottom = Math.max(e.bottom, y0, y1);
}

function numAttr(el: Element, name: string): number {
  const n = Number(el.getAttribute(name));
  if (!Number.isFinite(n)) throw unsafe(`attribute ${name} on <${el.localName}> is not a number`);
  return n;
}

function textExtent(text: Element, y: number, e: Extent): void {
  const size = numAttr(text, 'font-size');
  const cls = (text.getAttribute('class') ?? '').split(/\s+/);
  let descent = LYRIC_DESCENT;
  if (cls.includes('dropCap')) {
    descent = /[QJ]/.test(text.textContent ?? '') ? TAILED_DROP_CAP_DESCENT : 0;
  }
  grow(e, y - CAP_HEIGHT * size, y + descent * size);
}

/**
 * Vertical extent of one chant line in its own coordinates (origin on the line's translate), the
 * way Exsurge boxes it: ink of staff lines, rules, glyph outlines and text, but never less than
 * the line box floor, so staves keep an even pitch. Glyph outlines come from `glyphs` (id to its
 * path's y-range in user units). The first line's overhang (drop cap, annotation) is ink, not floor.
 */
function measureLine(line: Element, glyphs: ReadonlyMap<string, readonly [number, number]>): Extent {
  const e: Extent = { top: -MIN_ASCENT, bottom: MIN_BELOW };
  const visit = (el: Element, m: Matrix): void => {
    for (const child of elementChildren(el)) {
      const tag = child.localName;
      const cm = parseTransform(child.getAttribute('transform'));
      const composed: Matrix = {
        sx: m.sx * cm.sx,
        sy: m.sy * cm.sy,
        tx: m.tx + m.sx * cm.tx,
        ty: m.ty + m.sy * cm.ty,
      };
      if (tag === 'g') {
        visit(child, composed);
      } else if (tag === 'use') {
        const id = (child.getAttribute('xlink:href') ?? '').slice(1);
        const range = glyphs.get(id);
        if (range === undefined) throw unsafe(`missing glyph #${id}`);
        const y = numAttr(child, 'y');
        grow(e, composed.ty + composed.sy * (y + range[0]), composed.ty + composed.sy * (y + range[1]));
      } else if (tag === 'rect') {
        const y = numAttr(child, 'y');
        grow(e, m.ty + m.sy * y, m.ty + m.sy * (y + numAttr(child, 'height')));
      } else if (tag === 'path') {
        const [lo, hi] = pathYRange(child.getAttribute('d') ?? '');
        grow(e, m.ty + m.sy * lo, m.ty + m.sy * hi);
      } else if (tag === 'text') {
        textExtent(child, m.ty + m.sy * numAttr(child, 'y'), e);
      }
    }
  };
  visit(line, IDENTITY);
  return e;
}

function glyphRanges(defs: Element): Map<string, readonly [number, number]> {
  const out = new Map<string, readonly [number, number]>();
  for (const g of elementChildren(defs)) {
    const id = g.getAttribute('id');
    if (g.localName !== 'g' || id === null) continue;
    const m = parseTransform(g.getAttribute('transform'));
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of Array.from(g.getElementsByTagName('path'))) {
      const [a, b] = pathYRange(p.getAttribute('d') ?? '');
      lo = Math.min(lo, m.ty + m.sy * a);
      hi = Math.max(hi, m.ty + m.sy * b);
    }
    out.set(id, lo === Infinity ? [0, 0] : [Math.min(lo, hi), Math.max(lo, hi)]);
  }
  return out;
}

export interface ChantLineSvg {
  readonly svg: string;
  readonly heightUnits: number;
  readonly widthUnits: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Split the output of `normalizeExsurgeSvg` into one standalone SVG per `g.chantLine`, each with
 * only the glyph `<defs>` it uses, re-based so the line's box starts at y = 0 (its `chantLine`
 * group is `translate(0, ascent)`) and `viewBox="0 0 width height"` from the measured bounds.
 */
export function splitChantLines(normalized: string): readonly ChantLineSvg[] {
  const doc = parse(normalized);
  const root = doc.documentElement;
  const widthUnits = numAttr(root, 'width');
  const lines = Array.from(doc.getElementsByTagName('g')).filter((g) =>
    (g.getAttribute('class') ?? '').split(/\s+/).includes('chantLine'),
  );
  if (lines.length === 0) return [];
  const defs = doc.getElementsByTagName('defs')[0];
  if (defs === undefined) throw unsafe('no <defs> for the chant lines');
  const glyphs = glyphRanges(defs);
  const glyphNodes = new Map<string, Element>();
  for (const g of elementChildren(defs)) {
    const id = g.getAttribute('id');
    if (id !== null) glyphNodes.set(id, g);
  }

  return lines.map((line): ChantLineSvg => {
    const extent = measureLine(line, glyphs);
    const ascent = round2(-extent.top);
    const heightUnits = round2(extent.bottom - extent.top);

    const out = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" version="1.1" ` +
        `width="${widthUnits}" height="${heightUnits}" viewBox="0 0 ${widthUnits} ${heightUnits}"><defs/></svg>`,
      'image/svg+xml',
    ) as unknown as Document;
    const outDefs = out.getElementsByTagName('defs')[0];
    if (outDefs === undefined) throw unsafe('internal: no output <defs>');

    const copy = line.cloneNode(true) as Element;
    copy.setAttribute('transform', `translate(0,${ascent})`);
    const used = new Set<string>();
    for (const use of Array.from(copy.getElementsByTagName('use'))) {
      used.add((use.getAttribute('xlink:href') ?? '').slice(1));
    }
    for (const [id, node] of glyphNodes) {
      if (used.has(id)) outDefs.appendChild(out.importNode(node, true));
    }
    out.documentElement.appendChild(out.importNode(copy, true));
    return {
      svg: new XMLSerializer().serializeToString(out as unknown as XmldomNode),
      heightUnits,
      widthUnits,
    };
  });
}

