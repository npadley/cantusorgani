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
  const revealed = new Set<string>();
  for (const cont of continuations) {
    if (localName(cont) !== 'note') continue;
    const prevId = refId(cont.getAttribute('prev'));
    const prev = prevId ? byXmlId.get(prevId) : undefined;
    const measure = prev ? enclosingMeasure(prev) : null;
    const measureId = measure?.getAttribute(XML_ID);
    if (!prev || !measure || !prevId || !measureId || !brokenMeasureIds.has(measureId)) continue;
    const contId = cont.getAttribute(XML_ID);
    if (!contId || enclosingMeasure(cont) === measure) continue;

    // D17: a revealed continuation shows its head only. The stem, flag and accidental stay off.
    cont.removeAttribute('head.visible');
    cont.removeAttribute('visible');
    revealed.add(contId);

    const tieId = `${contId}-tie`;
    if (byXmlId.has(tieId)) continue;
    const tie = doc.createElementNS(MEI_NS, 'tie');
    tie.setAttribute(XML_ID, tieId);
    tie.setAttribute('type', 'split-tie');
    tie.setAttribute('startid', `#${prevId}`);
    tie.setAttribute('endid', `#${contId}`);
    measure.appendChild(tie);
  }
  retargetSustainTies(doc, byXmlId, revealed);
  continueSlursAcrossPages(doc, byXmlId);
}

/**
 * Verovio draws a spanning control element only on the page that holds its measure. A slur that crosses a
 * page break (a source line break inside a slur, A8) would therefore lose its end on the next page, so a
 * copy of it goes into the first measure after each page break it crosses. Slurs end on first heads, which
 * are always visible, so no retargeting is needed (unlike ties).
 */
/** The first note in `measure` on the same staff number and layer number as `like`. */
function firstNoteLike(measure: Element, like: Element): Element | null {
  const place = (el: Element): [string, string] => {
    let staff = '';
    let layer = '';
    for (let n: Node | null = el.parentNode; n; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      const name = localName(n as Element);
      if (name === 'layer' && layer === '') layer = (n as Element).getAttribute('n') ?? '1';
      if (name === 'staff' && staff === '') staff = (n as Element).getAttribute('n') ?? '1';
    }
    return [staff, layer];
  };
  const [staff, layer] = place(like);
  for (const note of Array.from(measure.getElementsByTagName('note'))) {
    const [s, l] = place(note);
    if (s === staff && l === layer && note.getAttribute(XML_ID)) return note;
  }
  return null;
}

function continueSlursAcrossPages(doc: Document, byXmlId: ReadonlyMap<string, Element>): void {
  const pbs = Array.from(doc.getElementsByTagName('pb'));
  if (pbs.length === 0) return;
  const measures = Array.from(doc.getElementsByTagName('measure'));
  const index = new Map(measures.map((m, i) => [m, i] as const));
  for (const slur of Array.from(doc.getElementsByTagName('slur'))) {
    const id = slur.getAttribute(XML_ID);
    const start = byXmlId.get(refId(slur.getAttribute('startid')) ?? '');
    const end = byXmlId.get(refId(slur.getAttribute('endid')) ?? '');
    const from = start ? enclosingMeasure(start) : null;
    const to = end ? enclosingMeasure(end) : null;
    if (!id || !from || !to) continue;
    const a = index.get(from) ?? -1;
    const b = index.get(to) ?? -1;
    pbs.forEach((pb, k) => {
      let next: Element | null = nextElementSibling(pb);
      while (next && (localName(next) === 'sb' || localName(next) === 'pb')) next = nextElementSibling(next);
      const n = next && localName(next) === 'measure' ? (index.get(next) ?? -1) : -1;
      if (n <= a || n > b) return;
      const copyId = `${id}-pg${k}`;
      if (byXmlId.has(copyId)) return;
      // Verovio draws nothing for a slur whose start is on another page, so the copy starts at the first
      // note of the same staff and layer on the new page and keeps the true end note.
      const first = firstNoteLike(next!, start!);
      if (!first) return;
      const copy = slur.cloneNode(true) as Element;
      copy.setAttribute(XML_ID, copyId);
      copy.setAttribute('startid', `#${first.getAttribute(XML_ID) ?? ''}`);
      next!.appendChild(copy);
    });
  }
}

/**
 * The converter draws a note's tie from its first head to the next note's first head, across the
 * hidden fragments. Once a fragment is revealed at a break (with its own split-tie from the one
 * before), the arc to the next note must start at the last revealed head, or it would run over it.
 */
function retargetSustainTies(doc: Document, byXmlId: ReadonlyMap<string, Element>, revealed: ReadonlySet<string>): void {
  if (revealed.size === 0) return;
  for (const tie of Array.from(doc.getElementsByTagName('tie'))) {
    if (tie.getAttribute('type') === 'split-tie') continue;
    let current = refId(tie.getAttribute('startid'));
    const seen = new Set<string>();
    let last = current;
    while (current && !seen.has(current)) {
      seen.add(current);
      const next = refId(byXmlId.get(current)?.getAttribute('next') ?? null);
      if (!next) break;
      if (revealed.has(next)) last = next;
      current = next;
    }
    const start = refId(tie.getAttribute('startid'));
    if (last && last !== start) {
      tie.setAttribute('startid', `#${last}`);
      // A tie is drawn where its element sits. The new start lies in a later measure, which may be on
      // the next PAGE: move the element there, or the tie is drawn on the page of the old start and
      // the page that holds the revealed head and the end note gets none.
      const startEl = byXmlId.get(last);
      const home = startEl ? enclosingMeasure(startEl) : null;
      if (home && enclosingMeasure(tie) !== home) home.appendChild(tie);
    }
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

/**
 * Mark every split-continuation note `visible="false"` so Verovio draws nothing for it: with only
 * `head.visible="false"` its ledger lines, dots and stubs are still drawn. A continuation revealed at
 * a system start loses the attribute again (see `revealSplitSustains`). Returns a new string.
 */
export function hideSplitContinuations(meiXml: string): string {
  if (!meiXml.includes('split-continuation')) return meiXml;
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === 'error' || level === 'fatalError') throw new Error(`MEI_PARSE_ERROR: ${msg}`);
    },
  }).parseFromString(meiXml, 'text/xml');
  for (const el of Array.from(doc.getElementsByTagName('note'))) {
    if (el.getAttribute('type') === 'split-continuation') el.setAttribute('visible', 'false');
  }
  const out = new XMLSerializer().serializeToString(doc);
  const decl = /^\s*(<\?xml[^?]*\?>)/.exec(meiXml);
  return decl && !out.startsWith('<?xml') ? `${decl[1]}\n${out}` : out;
}
