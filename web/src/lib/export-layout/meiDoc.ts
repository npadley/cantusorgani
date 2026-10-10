import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';
import type { EffectiveBreaks, LinePolicy, SafeBoundary } from './types';

const MEI_NS = 'http://www.music-encoding.org/ns/mei';
const XML_ID = 'xml:id';

function nextElementSibling(node: Node): Element | null {
  let n: Node | null = node.nextSibling;
  while (n) {
    if (n.nodeType === 1) return n as Element;
    // Only whitespace text may sit between a measure and its break.
    if (n.nodeType === 3 && (n.nodeValue ?? '').trim() === '') { n = n.nextSibling; continue; }
    if (n.nodeType === 8) { n = n.nextSibling; continue; }
    return null;
  }
  return null;
}

function localName(el: Element): string {
  return el.localName ?? el.nodeName;
}

function enclosingMeasure(node: Node): Element | null {
  for (let n: Node | null = node.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && localName(n as Element) === 'measure') return n as Element;
  }
  return null;
}

const refId = (ref: string | null): string | null => (ref && ref.startsWith('#') ? ref.slice(1) : null);

/**
 * At each chosen break, show the split-continuation notes that begin the next measure,
 * and draw a tie from their predecessor (end of the broken measure) to them.
 */
function revealSplitSustains(doc: Document, brokenMeasureIds: ReadonlySet<string>): void {
  if (brokenMeasureIds.size === 0) return;

  const byXmlId = new Map<string, Element>();
  for (const e of Array.from(doc.getElementsByTagName('*'))) {
    const id = e.getAttribute(XML_ID);
    if (id) byXmlId.set(id, e);
  }
  const continuations = Array.from(byXmlId.values()).filter((e) => e.getAttribute('type') === 'split-continuation');
  for (const cont of continuations) {
    if (localName(cont) !== 'note') continue;
    const prevId = refId(cont.getAttribute('prev'));
    const prev = prevId ? byXmlId.get(prevId) : undefined;
    const measure = prev ? enclosingMeasure(prev) : null;
    const measureId = measure?.getAttribute(XML_ID);
    if (!prev || !measure || !prevId || !measureId || !brokenMeasureIds.has(measureId)) continue;
    const contId = cont.getAttribute(XML_ID);
    if (!contId || enclosingMeasure(cont) === measure) continue;

    cont.removeAttribute('head.visible');
    cont.removeAttribute('stem.visible');

    // Courtesy accidental: copy the written accid from the first fragment of the chain.
    let first: Element = prev;
    const seen = new Set<Element>();
    while (first.getAttribute('type') === 'split-continuation' && !seen.has(first)) {
      seen.add(first);
      const pid = refId(first.getAttribute('prev'));
      const p = pid ? byXmlId.get(pid) : undefined;
      if (!p) break;
      first = p;
    }
    const accid = first.getAttribute('accid');
    if (accid) cont.setAttribute('accid', accid);

    const tieId = `${contId}-tie`;
    if (byXmlId.has(tieId)) continue;
    const tie = doc.createElementNS(MEI_NS, 'tie');
    tie.setAttribute(XML_ID, tieId);
    tie.setAttribute('type', 'split-tie');
    tie.setAttribute('startid', `#${prevId}`);
    tie.setAttribute('endid', `#${contId}`);
    measure.appendChild(tie);
  }
}

/**
 * Returns a copy of `meiXml` with the effective breaks materialised as `<sb/>`/`<pb/>`
 * elements placed immediately after each boundary's measure. The input string is never mutated.
 * Throws `Error('UNSAFE_ANCHOR: <id>')` for an unknown boundary or measure id.
 */
export function materialiseBreaks(
  meiXml: string,
  breaks: EffectiveBreaks,
  boundaries: readonly SafeBoundary[],
  policy: LinePolicy,
  /** Reveal split sustains at the chosen breaks (default). Layout pass 1 passes false to keep them hidden. */
  reveal = true,
): string {
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === 'error' || level === 'fatalError') throw new Error(`MEI_PARSE_ERROR: ${msg}`);
    },
  }).parseFromString(meiXml, 'text/xml');

  if (policy === 'automatic') {
    const sbs = Array.from(doc.getElementsByTagName('sb'));
    for (const sb of sbs) sb.parentNode?.removeChild(sb);
  }

  const measures = new Map<string, Element>();
  for (const m of Array.from(doc.getElementsByTagName('measure'))) {
    const id = m.getAttribute(XML_ID);
    if (id) measures.set(id, m);
  }
  const byId = new Map(boundaries.map((b) => [b.id, b] as const));

  for (const br of breaks.breaks) {
    const boundary = byId.get(br.boundaryId);
    if (!boundary) throw new Error(`UNSAFE_ANCHOR: ${br.boundaryId}`);
    const measure = measures.get(boundary.measureId);
    if (!measure || !measure.parentNode) throw new Error(`UNSAFE_ANCHOR: ${boundary.measureId}`);

    const next = nextElementSibling(measure);
    const nextName = next ? localName(next) : null;
    if (br.kind === 'system') {
      if (nextName === 'sb' || nextName === 'pb') continue; // already broken here; a page break implies a system break
      measure.parentNode.insertBefore(doc.createElementNS(MEI_NS, 'sb'), measure.nextSibling);
    } else {
      if (nextName === 'pb') continue;
      const pb = doc.createElementNS(MEI_NS, 'pb');
      if (next && nextName === 'sb') next.parentNode?.replaceChild(pb, next);
      else measure.parentNode.insertBefore(pb, measure.nextSibling);
    }
  }

  if (reveal) {
    const broken = new Set<string>();
    for (const br of breaks.breaks) {
      const b = byId.get(br.boundaryId);
      if (b) broken.add(b.measureId);
    }
    revealSplitSustains(doc, broken);
  }

  const out = new XMLSerializer().serializeToString(doc);
  const decl = /^\s*(<\?xml[^?]*\?>)/.exec(meiXml);
  if (decl && !out.startsWith('<?xml')) return `${decl[1]}\n${out}`;
  return out;
}

/**
 * Reveal split sustains that cross the end of each listed measure (a system or page starts
 * after it): unhide the continuation head and stem and add a `split-tie`. Returns a new string.
 */
export function revealSplitSustainsAfter(meiXml: string, brokenMeasureIds: ReadonlySet<string>): string {
  if (brokenMeasureIds.size === 0) return meiXml;
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === 'error' || level === 'fatalError') throw new Error(`MEI_PARSE_ERROR: ${msg}`);
    },
  }).parseFromString(meiXml, 'text/xml');
  revealSplitSustains(doc, brokenMeasureIds);
  const out = new XMLSerializer().serializeToString(doc);
  const decl = /^\s*(<\?xml[^?]*\?>)/.exec(meiXml);
  return decl && !out.startsWith('<?xml') ? `${decl[1]}\n${out}` : out;
}
