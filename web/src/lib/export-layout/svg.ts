/**
 * SVG page sanitizer and namespacer (card B5). Security boundary.
 *
 * Verovio pages are untrusted-by-construction input to the preview and the vector PDF walker, so
 * the policy is closed: every element, attribute and CSS declaration must be on an explicit
 * allowlist, and anything else is rejected with a diagnostic (never silently stripped, because
 * that could hide music). The allowlist is no broader than what the PDF walker supports
 * (docs/superpowers/experiments/s3-s4-fonts-pdf.md), plus Verovio's fixed `<style>` rules.
 *
 * Uses `@xmldom/xmldom`, so it runs in a worker and in Vitest (no `DOMParser` in workers).
 * Errors: `UNSAFE_SVG: <reason>` for policy violations, `INVALID_PAGE: <reason>` for input that
 * is not a well-formed SVG document.
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { SanitizedSvg, SvgBounds } from './types';

type XmldomNode = Parameters<XMLSerializer['serializeToString']>[0];

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Elements the PDF walker handles (or deliberately ignores: style, desc, title). */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'ellipse', 'circle', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc', 'style',
]);

/** Elements that are named in the rejection message as explicitly forbidden. */
const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set(['script', 'foreignObject', 'image', 'iframe', 'set']);

/** Elements that may only contain character data. */
const TEXT_ONLY_ELEMENTS: ReadonlySet<string> = new Set(['style', 'desc', 'title']);

const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  // identity and structure
  'id', 'class', 'type', 'version', 'overflow', 'viewBox', 'preserveAspectRatio',
  // geometry
  'd', 'points', 'transform', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r',
  // presentation
  'fill', 'stroke', 'color', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'visibility', 'display',
  // references (use only)
  'href', 'xlink:href',
]);

/** Presentation attributes whose values go through the same value policy as CSS declarations. */
const PRESENTATION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'fill', 'stroke', 'color', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'visibility', 'display',
]);

const STYLE_PROPERTIES: ReadonlySet<string> = new Set([
  'stroke', 'fill', 'color', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'visibility', 'display',
]);

const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;
const NAMESPACE_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const PATH_DATA_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;
const TRANSFORM_RE = /^[A-Za-z0-9\s().,+\-]*$/;
const VALID_URL_RE = /url\(\s*(['"]?)#([A-Za-z0-9_][A-Za-z0-9_.:-]*)\1\s*\)/gi;
const ANY_URL_RE = /url\s*\(/i;
const SAFE_VALUE_RE = /^[A-Za-z0-9#.,%\s'"-]*$/;
const COMPOUND_RE = /^(?:[a-z]+|\*)?(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;

function unsafe(reason: string): Error {
  return new Error(`UNSAFE_SVG: ${reason}`);
}
function invalid(reason: string): Error {
  return new Error(`INVALID_PAGE: ${reason}`);
}

/** A reference to an id, rewritten once the full id set is known. */
interface PendingRef {
  readonly id: string;
  readonly where: string;
}

interface Ctx {
  readonly namespace: string;
  readonly ids: string[];
  readonly idSet: Set<string>;
  readonly refs: PendingRef[];
  readonly rewrites: Array<() => void>;
}

function prefixed(ctx: Ctx, id: string): string {
  return `${ctx.namespace}-${id}`;
}

/** Byte-level scan, run before the parser so declarations never reach it. */
function scanSource(svg: string): void {
  if (/<!DOCTYPE/i.test(svg)) throw unsafe('DOCTYPE declaration');
  if (/<!ENTITY/i.test(svg)) throw unsafe('entity declaration');
  let i = svg.indexOf('<?');
  while (i !== -1) {
    const start = svg.charCodeAt(0) === 0xfeff ? 1 : 0;
    const isDeclaration = i === start && /^<\?xml\s[^>]*\?>/.test(svg.slice(i));
    if (!isDeclaration) throw unsafe('processing instruction');
    i = svg.indexOf('<?', i + 2);
  }
  if (/&(?!(?:#[0-9]+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/.test(svg)) throw unsafe('entity reference');
}

/**
 * Validate one declaration value (CSS or presentation attribute). `url(...)` must be a
 * same-document fragment; the returned function renders the value with ids rewritten.
 */
function checkValue(ctx: Ctx, raw: string, where: string, inStyle: boolean): (finalise: boolean) => string {
  const suffix = inStyle ? ' in style' : '';
  const value = raw.trim();
  let stripped = value;
  const refIds: string[] = [];
  stripped = stripped.replace(VALID_URL_RE, (_m, _q: string, id: string) => {
    refIds.push(id);
    return 'x';
  });
  if (ANY_URL_RE.test(stripped)) throw unsafe(`external url()${suffix}`);
  stripped = stripped.replace(/rgba?\(\s*[0-9.%]+(?:\s*,\s*[0-9.%]+){2,3}\s*\)/gi, 'x');
  if (!SAFE_VALUE_RE.test(stripped)) throw unsafe(`unsafe value "${value.slice(0, 40)}" in ${where}`);
  for (const id of refIds) ctx.refs.push({ id, where });
  return () =>
    value.replace(VALID_URL_RE, (_m, q: string, id: string) => `url(${q}#${prefixed(ctx, id)}${q})`);
}

interface CssRule {
  readonly selectors: string[];
  readonly decls: Array<{ readonly name: string; readonly value: () => string }>;
}

function parseStyle(ctx: Ctx, css: string): CssRule[] {
  if (/@import/i.test(css)) throw unsafe('@import in style');
  if (css.includes('@')) throw unsafe('at-rule in style');
  if (css.includes('\\')) throw unsafe('backslash escape in style');
  if (css.includes('/*')) throw unsafe('comment in style');
  const rules: CssRule[] = [];
  let rest = css.trim();
  while (rest.length > 0) {
    const open = rest.indexOf('{');
    const close = rest.indexOf('}');
    if (open === -1 || close === -1 || close < open) throw unsafe('malformed style rule');
    const selectorText = rest.slice(0, open).trim();
    const body = rest.slice(open + 1, close);
    if (body.includes('{')) throw unsafe('nested style rule');
    rest = rest.slice(close + 1).trim();

    const selectors = selectorText.split(',').map((s) => s.trim());
    const outSelectors: string[] = [];
    for (const sel of selectors) {
      const parts = sel.split(/\s+/);
      const rendered: string[] = [];
      let nonEmpty = sel.length > 0;
      parts.forEach((part, idx) => {
        if (idx === 0 && part.startsWith('#')) {
          const id = part.slice(1);
          if (!ID_RE.test(id)) throw unsafe(`style selector "${sel}"`);
          rendered.push(`#${prefixed(ctx, id)}`);
          return;
        }
        if (part.length === 0 || !COMPOUND_RE.test(part)) {
          nonEmpty = false;
          return;
        }
        const tag = /^[a-z]+/.exec(part)?.[0];
        if (tag !== undefined && !ALLOWED_ELEMENTS.has(tag)) throw unsafe(`style selector "${sel}"`);
        rendered.push(part);
      });
      if (!nonEmpty || rendered.length !== parts.length) throw unsafe(`style selector "${sel}"`);
      outSelectors.push(rendered.join(' '));
    }

    const decls: CssRule['decls'] = [];
    for (const decl of body.split(';')) {
      if (decl.trim().length === 0) continue;
      const colon = decl.indexOf(':');
      if (colon === -1) throw unsafe(`malformed style declaration "${decl.trim().slice(0, 40)}"`);
      const name = decl.slice(0, colon).trim().toLowerCase();
      if (!STYLE_PROPERTIES.has(name) && !/^font-[a-z-]+$/.test(name)) {
        throw unsafe(`style property "${name}" not allowed`);
      }
      const render = checkValue(ctx, decl.slice(colon + 1), `style ${name}`, true);
      decls.push({ name, value: () => render(true) });
    }
    rules.push({ selectors: outSelectors, decls });
  }
  return rules;
}

function renderStyle(rules: readonly CssRule[]): string {
  return rules
    .map((r) => `${r.selectors.join(', ')} {${r.decls.map((d) => `${d.name}:${d.value()}`).join('; ')}}`)
    .join('\n');
}

function checkAttributes(ctx: Ctx, el: Element, tag: string, isRoot: boolean): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (/^on/i.test(name)) throw unsafe(`event handler attribute ${name}`);
    if (name === 'xmlns') {
      if (attr.value !== SVG_NS) throw unsafe('foreign default namespace declaration');
      continue;
    }
    if (name === 'xmlns:xlink') {
      if (attr.value !== XLINK_NS) throw unsafe('foreign xlink namespace declaration');
      continue;
    }
    if (name.startsWith('xmlns')) throw unsafe(`namespace declaration ${name} not allowed`);
    if (!ALLOWED_ATTRIBUTES.has(name)) throw unsafe(`attribute ${name} not allowed`);

    const value = attr.value;
    // Any url(...) anywhere must be a same-document fragment.
    if (ANY_URL_RE.test(value) && !PRESENTATION_ATTRIBUTES.has(name)) {
      const stripped = value.replace(VALID_URL_RE, '');
      if (ANY_URL_RE.test(stripped)) throw unsafe('external url()');
    }

    if (name === 'href' || name === 'xlink:href') {
      if (tag !== 'use') throw unsafe(`href on <${tag}>`);
      if (/^\s*javascript:/i.test(value)) throw unsafe('javascript: href');
      const m = /^#(.+)$/.exec(value);
      if (m === null || !ID_RE.test(m[1] ?? '')) throw unsafe(`external href "${value.slice(0, 60)}"`);
      const id = m[1] ?? '';
      ctx.refs.push({ id, where: `${name} on <use>` });
      ctx.rewrites.push(() => setAttr(el, attr, `#${prefixed(ctx, id)}`));
      continue;
    }
    if (name === 'id') {
      if (!ID_RE.test(value)) throw unsafe(`invalid id "${value.slice(0, 40)}"`);
      if (ctx.idSet.has(value)) throw unsafe(`duplicate id "${value}"`);
      ctx.idSet.add(value);
      ctx.ids.push(prefixed(ctx, value));
      ctx.rewrites.push(() => setAttr(el, attr, prefixed(ctx, value)));
      continue;
    }
    if (name === 'class') {
      const tokens = value.split(/\s+/).filter((t) => t.length > 0);
      if (!tokens.every((t) => /^[A-Za-z0-9_.:-]+$/.test(t))) throw unsafe(`invalid class "${value.slice(0, 40)}"`);
      ctx.rewrites.push(() =>
        setAttr(el, attr, tokens.map((t) => (t.startsWith('id-') ? `id-${prefixed(ctx, t.slice(3))}` : t)).join(' ')),
      );
      continue;
    }
    if (name === 'type') {
      if (tag !== 'style' || value !== 'text/css') throw unsafe(`attribute type="${value.slice(0, 20)}" on <${tag}>`);
      continue;
    }
    if (name === 'd' || name === 'points') {
      if (!PATH_DATA_RE.test(value)) throw unsafe(`unsafe ${name} data`);
      continue;
    }
    if (name === 'transform') {
      if (!TRANSFORM_RE.test(value)) throw unsafe('unsafe transform');
      continue;
    }
    if (PRESENTATION_ATTRIBUTES.has(name)) {
      const render = checkValue(ctx, value, `attribute ${name}`, false);
      ctx.rewrites.push(() => setAttr(el, attr, render(true)));
      continue;
    }
    if (isRoot && name === 'overflow') continue;
  }
}

function setAttr(el: Element, attr: Attr, value: string): void {
  if (attr.value === value) return;
  if (attr.namespaceURI !== null && attr.namespaceURI !== '') {
    el.setAttributeNS(attr.namespaceURI, attr.name, value);
  } else {
    el.setAttribute(attr.name, value);
  }
}

function walk(ctx: Ctx, el: Element, isRoot: boolean): void {
  const tag = el.localName;
  if (FORBIDDEN_ELEMENTS.has(tag) || tag.startsWith('animate')) throw unsafe(`forbidden element <${tag}>`);
  if (el.namespaceURI !== SVG_NS) throw unsafe(`element <${el.nodeName}> in foreign namespace`);
  if (!ALLOWED_ELEMENTS.has(tag)) throw unsafe(`element <${tag}> not allowed`);
  checkAttributes(ctx, el, tag, isRoot);

  if (tag === 'style') {
    let css = '';
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 || child.nodeType === 4) css += child.nodeValue ?? '';
      else if (child.nodeType !== 8) throw unsafe('element inside <style>');
    }
    const rules = parseStyle(ctx, css);
    ctx.rewrites.push(() => {
      while (el.firstChild !== null) el.removeChild(el.firstChild);
      el.appendChild(el.ownerDocument.createTextNode(renderStyle(rules)));
    });
    return;
  }

  for (const child of Array.from(el.childNodes)) {
    switch (child.nodeType) {
      case 1:
        if (TEXT_ONLY_ELEMENTS.has(tag)) throw unsafe(`element inside <${tag}>`);
        walk(ctx, child as Element, false);
        break;
      case 3:
        break;
      case 4:
        throw unsafe('CDATA section outside <style>');
      case 5:
        throw unsafe('entity reference');
      case 7:
        throw unsafe('processing instruction');
      case 8:
        el.removeChild(child);
        break;
      default:
        throw unsafe(`node type ${child.nodeType} not allowed`);
    }
  }
}

function parseXml(svg: string): Document {
  const parser = new DOMParser({
    onError: (level, message) => {
      throw invalid(`${level}: ${message}`);
    },
  });
  let doc: Document;
  try {
    doc = parser.parseFromString(svg, 'image/svg+xml') as unknown as Document;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('INVALID_PAGE')) throw e;
    throw invalid(e instanceof Error ? e.message : String(e));
  }
  const root = doc.documentElement as Element | null;
  if (root === null || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw invalid('root element is not an SVG <svg>');
  }
  return doc;
}

export function sanitizePageSvg(svg: string, namespace: string): SanitizedSvg {
  if (!NAMESPACE_RE.test(namespace)) throw unsafe(`invalid namespace "${namespace.slice(0, 40)}"`);
  scanSource(svg);
  const doc = parseXml(svg);
  const ctx: Ctx = { namespace, ids: [], idSet: new Set(), refs: [], rewrites: [] };
  walk(ctx, doc.documentElement, true);
  for (const ref of ctx.refs) {
    if (!ctx.idSet.has(ref.id)) throw unsafe(`reference to missing id "${ref.id}" (${ref.where})`);
  }
  for (const apply of ctx.rewrites) apply();
  return { svg: new XMLSerializer().serializeToString(doc as unknown as XmldomNode), ids: ctx.ids, namespace };
}

// ------------------------------------------------------------------ bounds ---

function mmOf(value: string | null): number | null {
  if (value === null) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*mm\s*$/.exec(value);
  const n = m === null ? NaN : Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function viewBoxOf(el: Element | null): [number, number, number, number] | null {
  const raw = el?.getAttribute('viewBox') ?? null;
  if (raw === null) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  return w > 0 && h > 0 ? [x, y, w, h] : null;
}

/**
 * Physical page size and the margin box, in mm.
 *
 * Size, in order of preference: explicit `mm` width/height on the root; Verovio's inner
 * `svg.definition-scale` viewBox (0.01 mm per unit, independent of the render `scale`, which only
 * changes the outer viewBox: the Kyrie fixture is 840x1188 outer for 21000x29700 inner = A4);
 * the outer viewBox in 0.1 mm units. `contentBBox` is the margin box (page minus the
 * `g.page-margin` translate), a conservative stand-in for the ink bounds.
 */
export function measureSvgBounds(svg: SanitizedSvg): SvgBounds {
  const doc = parseXml(svg.svg);
  const root = doc.documentElement;
  const inner = Array.from(root.getElementsByTagName('svg')).find((e) =>
    (e.getAttribute('class') ?? '').split(/\s+/).includes('definition-scale'),
  ) ?? null;
  const innerBox = viewBoxOf(inner);
  const outerBox = viewBoxOf(root);

  let widthMm = mmOf(root.getAttribute('width'));
  let heightMm = mmOf(root.getAttribute('height'));
  if (widthMm === null || heightMm === null) {
    if (innerBox !== null) {
      widthMm = innerBox[2] / 100;
      heightMm = innerBox[3] / 100;
    } else if (outerBox !== null) {
      widthMm = outerBox[2] / 10;
      heightMm = outerBox[3] / 10;
    } else {
      throw invalid('cannot determine page size: no mm width/height or viewBox');
    }
  }

  let xMm = 0;
  let yMm = 0;
  const margin = Array.from(root.getElementsByTagName('g')).find((g) =>
    (g.getAttribute('class') ?? '').split(/\s+/).includes('page-margin'),
  );
  const t = /translate\(\s*(-?[0-9.]+)[\s,]+(-?[0-9.]+)\s*\)/.exec(margin?.getAttribute('transform') ?? '');
  if (t !== null && innerBox !== null) {
    const unitMm = widthMm / innerBox[2];
    xMm = Math.min(Math.max(Number(t[1]) * unitMm, 0), widthMm / 2);
    yMm = Math.min(Math.max(Number(t[2]) * unitMm, 0), heightMm / 2);
  }
  return {
    widthMm,
    heightMm,
    contentBBox: { xMm, yMm, widthMm: widthMm - 2 * xMm, heightMm: heightMm - 2 * yMm },
  };
}
