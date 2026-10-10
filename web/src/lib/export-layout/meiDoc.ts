import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element, Node } from '@xmldom/xmldom';
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

  const out = new XMLSerializer().serializeToString(doc);
  const decl = /^\s*(<\?xml[^?]*\?>)/.exec(meiXml);
  if (decl && !out.startsWith('<?xml')) return `${decl[1]}\n${out}`;
  return out;
}
