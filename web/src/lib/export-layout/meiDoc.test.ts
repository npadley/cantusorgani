import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { materialiseBreaks } from './meiDoc';
import type { EffectiveBreak, EffectiveBreaks, SafeBoundary } from './types';

const MEI_NS = 'http://www.music-encoding.org/ns/mei';

const FIXTURE = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix-experiment.mei'), 'utf8');

const SMALL = `<?xml version="1.0" encoding="utf-8"?>
<mei xmlns="${MEI_NS}" meiversion="5.0"><music><body><mdiv><score><section>
  <measure xml:id="ma"><staff n="1"><layer n="1"><note xml:id="n1" dur="4" pname="c" oct="4"/><rest xml:id="r1" dur="4"/></layer></staff></measure>
  <sb/>
  <measure xml:id="mb"><staff n="1"><layer n="1"><note xml:id="n2" dur="4" pname="d" oct="4"/><space xml:id="s1" dur="4"/></layer></staff></measure>
  <measure xml:id="mc"><staff n="1"><layer n="1"><note xml:id="n3" dur="4" pname="e" oct="4"/></layer></staff></measure>
</section></score></mdiv></body></music></mei>`;

const bd = (id: string, measureId: string): SafeBoundary =>
  ({ id, onset: '0', sourceBreak: false, division: null, measureId, afterText: null });
const SMALL_B = [bd('b1', 'ma'), bd('b2', 'mb'), bd('b3', 'mc')];
const eb = (boundaryId: string, kind: 'system' | 'page'): EffectiveBreak => ({ boundaryId, kind, origin: 'user' });
const breaksOf = (...b: EffectiveBreak[]): EffectiveBreaks => ({ partId: 'p', breaks: b, droppedOverrides: [] });

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml');
const ids = (xml: string, tags: string[]): string[] => {
  const doc = parse(xml);
  return tags.flatMap((t) => Array.from(doc.getElementsByTagName(t)).map((e) => e.getAttribute('xml:id') ?? ''))
    .sort();
};
const eventIds = (xml: string) => ids(xml, ['note', 'rest', 'space']);

/** Local names of element siblings following the measure with the given id. */
function after(xml: string, measureId: string): string[] {
  const m = Array.from(parse(xml).getElementsByTagName('measure')).find((e) => e.getAttribute('xml:id') === measureId);
  const out: string[] = [];
  for (let n = m?.nextSibling ?? null; n; n = n.nextSibling) {
    if (n.nodeType === 1) { out.push((n as Element).localName ?? ''); if ((n as Element).localName === 'measure') break; }
  }
  return out;
}
const count = (xml: string, tag: string) => parse(xml).getElementsByTagName(tag).length;

describe('materialiseBreaks', () => {
  it('keeps the note/rest/space xml:id set identical (small and experiment MEI)', () => {
    const out = materialiseBreaks(SMALL, breaksOf(eb('b1', 'page'), eb('b3', 'system')), SMALL_B, 'automatic');
    expect(eventIds(out)).toEqual(eventIds(SMALL));
    const fb = [bd('f1', 'm008'), bd('f2', 'm016')];
    const fo = materialiseBreaks(FIXTURE, breaksOf(eb('f1', 'system'), eb('f2', 'page')), fb, 'automatic');
    expect(eventIds(fo)).toEqual(eventIds(FIXTURE));
    expect(eventIds(fo).length).toBeGreaterThan(50);
  });

  it('automatic removes source sb; original keeps it', () => {
    expect(count(SMALL, 'sb')).toBe(1);
    expect(count(materialiseBreaks(SMALL, breaksOf(), SMALL_B, 'automatic'), 'sb')).toBe(0);
    expect(count(materialiseBreaks(SMALL, breaksOf(), SMALL_B, 'original'), 'sb')).toBe(1);
    expect(count(FIXTURE, 'sb')).toBeGreaterThan(0);
    expect(count(materialiseBreaks(FIXTURE, breaksOf(), [], 'automatic'), 'sb')).toBe(0);
    expect(count(materialiseBreaks(FIXTURE, breaksOf(), [], 'original'), 'sb')).toBe(count(FIXTURE, 'sb'));
  });

  it('inserts sb and pb immediately after the correct measure', () => {
    const out = materialiseBreaks(SMALL, breaksOf(eb('b2', 'system'), eb('b3', 'page')), SMALL_B, 'automatic');
    expect(after(out, 'ma')).toEqual(['measure']);
    expect(after(out, 'mb')).toEqual(['sb', 'measure']);
    expect(after(out, 'mc')).toEqual(['pb']);
    const fo = materialiseBreaks(FIXTURE, breaksOf(eb('f', 'page')), [bd('f', 'm004')], 'automatic');
    expect(after(fo, 'm004')).toEqual(['pb', 'measure']);
  });

  it('page replaces an adjacent sb; system leaves it', () => {
    const page = materialiseBreaks(SMALL, breaksOf(eb('b1', 'page')), SMALL_B, 'original');
    expect(after(page, 'ma')).toEqual(['pb', 'measure']);
    expect(count(page, 'sb')).toBe(0);
    const sys = materialiseBreaks(SMALL, breaksOf(eb('b1', 'system')), SMALL_B, 'original');
    expect(after(sys, 'ma')).toEqual(['sb', 'measure']);
    expect(count(sys, 'sb')).toBe(1);
  });

  it('throws UNSAFE_ANCHOR for an unknown boundary or measure id', () => {
    expect(() => materialiseBreaks(SMALL, breaksOf(eb('nope', 'system')), SMALL_B, 'automatic'))
      .toThrow('UNSAFE_ANCHOR: nope');
    expect(() => materialiseBreaks(SMALL, breaksOf(eb('x', 'system')), [bd('x', 'ghost')], 'automatic'))
      .toThrow('UNSAFE_ANCHOR: ghost');
  });

  it('does not mutate the input string', () => {
    const copy = `${SMALL}`;
    materialiseBreaks(SMALL, breaksOf(eb('b2', 'page')), SMALL_B, 'automatic');
    expect(SMALL).toBe(copy);
  });

  it('output re-parses, keeps the XML declaration, and inserted elements are in the MEI namespace', () => {
    const out = materialiseBreaks(SMALL, breaksOf(eb('b2', 'system'), eb('b3', 'page')), SMALL_B, 'automatic');
    expect(out.startsWith('<?xml')).toBe(true);
    const doc = parse(out);
    for (const tag of ['sb', 'pb']) {
      const els = Array.from(doc.getElementsByTagName(tag));
      expect(els.length).toBe(1);
      expect(els[0]?.namespaceURI).toBe(MEI_NS);
    }
    expect(out).not.toMatch(/<(sb|pb)[^>]*xmlns=/);
  });

  it('rejects malformed XML', () => {
    expect(() => materialiseBreaks('<mei><measure></mei>', breaksOf(), [], 'original')).toThrow();
  });
});

describe('materialiseBreaks split sustains', () => {
  const SPLIT = `<?xml version="1.0" encoding="utf-8"?>
<mei xmlns="${MEI_NS}" meiversion="5.0"><music><body><mdiv><score><section>
  <measure xml:id="ma"><staff n="1"><layer n="1"><note xml:id="evx" dur="2" pname="c" oct="4" accid="s" next="#evxc1"/></layer></staff></measure>
  <measure xml:id="mb"><staff n="1"><layer n="1"><note xml:id="evxc1" type="split-continuation" prev="#evx" dur="2" pname="c" oct="4" head.visible="false" stem.visible="false"/><note xml:id="evy" dur="2" pname="d" oct="4"/></layer></staff>
  <staff n="2"><layer n="1"><space xml:id="evzc1" type="split-continuation" prev="#evz" dur="1"/></layer></staff></measure>
  <measure xml:id="mc"><staff n="1"><layer n="1"><note xml:id="evw" dur="1" pname="e" oct="4"/></layer></staff></measure>
</section></score></mdiv></body></music></mei>`;
  const SB = [bd('b1', 'ma'), bd('b2', 'mb')];
  const el = (xml: string, id: string): Element | undefined =>
    Array.from(parse(xml).getElementsByTagName('*')).find((e) => e.getAttribute('xml:id') === id);

  for (const kind of ['system', 'page'] as const) {
    it(`reveals the continuation with a tie at a ${kind} break`, () => {
      const out = materialiseBreaks(SPLIT, breaksOf(eb('b1', kind)), SB, 'automatic');
      const cont = el(out, 'evxc1');
      expect(cont?.hasAttribute('head.visible')).toBe(false);
      expect(cont?.hasAttribute('stem.visible')).toBe(false);
      expect(cont?.getAttribute('accid')).toBe('s');
      const tie = el(out, 'evxc1-tie');
      expect(tie?.localName).toBe('tie');
      expect(tie?.namespaceURI).toBe(MEI_NS);
      expect(tie?.getAttribute('type')).toBe('split-tie');
      expect(tie?.getAttribute('startid')).toBe('#evx');
      expect(tie?.getAttribute('endid')).toBe('#evxc1');
      expect(tie?.parentNode?.nodeName).toBe('measure');
      expect((tie?.parentNode as Element | null)?.getAttribute('xml:id')).toBe('ma');
      expect(eventIds(out)).toEqual(eventIds(SPLIT));
      expect(parse(out).documentElement?.namespaceURI).toBe(MEI_NS);
    });
  }

  it('copies no accid when the first fragment had none', () => {
    const noAccid = SPLIT.replace(' accid="s"', '');
    const out = materialiseBreaks(noAccid, breaksOf(eb('b1', 'system')), SB, 'automatic');
    expect(el(out, 'evxc1')?.hasAttribute('accid')).toBe(false);
    expect(el(out, 'evxc1-tie')).toBeDefined();
  });

  it('leaves continuations untouched where there is no break', () => {
    const out = materialiseBreaks(SPLIT, breaksOf(eb('b2', 'system')), SB, 'automatic');
    const cont = el(out, 'evxc1');
    expect(cont?.getAttribute('head.visible')).toBe('false');
    expect(cont?.getAttribute('stem.visible')).toBe('false');
    expect(cont?.hasAttribute('accid')).toBe(false);
    expect(el(out, 'evxc1-tie')).toBeUndefined();
    expect(count(out, 'tie')).toBe(0);
  });

  it('adds no tie for space continuations and does not mutate the input', () => {
    const copy = `${SPLIT}`;
    const out = materialiseBreaks(SPLIT, breaksOf(eb('b1', 'system'), eb('b2', 'page')), SB, 'original');
    expect(SPLIT).toBe(copy);
    expect(el(out, 'evzc1-tie')).toBeUndefined();
    expect(count(out, 'tie')).toBe(1);
  });
});
