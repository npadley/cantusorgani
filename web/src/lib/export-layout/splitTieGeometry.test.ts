import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { renderMei } from './layout';
import { defaultMarginFor, paperDimensions } from './settings';
import { splitTieStartId } from './splitTieGeometry';
import { ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio, WASM_TIMEOUT_MS } from './__fixtures__/layoutHarness';
import type { SafeBoundary } from './types';
const mei = readFileSync(join(__dirname, '__fixtures__/gloria-ix.mei'), 'utf8');
const boundaries = JSON.parse(readFileSync(join(__dirname, '__fixtures__/gloria-ix.boundaries.json'), 'utf8')) as SafeBoundary[];
function notes(xml: string): Map<string, Element> {
 const doc = new DOMParser().parseFromString(xml, 'text/xml');
 return new Map(Array.from(doc.getElementsByTagName('note')).map(n => [n.getAttribute('xml:id')!, n]));
}
it('starts a split tie at the visible head rather than the hidden final fragment', () => {
 const byId = notes(mei);
 expect(splitTieStartId(byId.get('ev1e0022c1')!, byId)).toBe('ev1e0022');
});

it('keeps the nearest revealed head when a sustain spans several systems', () => {
 const byId = notes(mei);
 const previous = byId.get('ev1e0022c1')!;
 previous.removeAttribute('head.visible');
 expect(splitTieStartId(previous, byId)).toBe('ev1e0022c1');
});
it('leaves malformed or cyclic chains at their existing endpoint', () => {
 const byId = notes('<mei><note xml:id="a" head.visible="false" prev="#b"/><note xml:id="b" visible="false" prev="#a"/></mei>');
 expect(splitTieStartId(byId.get('a')!, byId)).toBe('a');
 byId.get('b')!.setAttribute('prev', '#missing');
 expect(splitTieStartId(byId.get('a')!, byId)).toBe('a');
});

describe('Gloria IX split tie outgoing fragments on iPad mini automatic', () => {
 const { newToolkit } = useRealVerovio();
 it('draws all three system-3 outgoing ties from their heads to the original system edge', async () => {
  const tk = newToolkit();
  const originalLoad = tk.loadData.bind(tk);
  tk.loadData = (xml: string) => {
   const doc = new DOMParser().parseFromString(xml, 'text/xml');
   const byId = new Map(Array.from(doc.getElementsByTagName('note')).map(n => [n.getAttribute('xml:id')!, n]));
   for (const tie of Array.from(doc.getElementsByTagName('tie'))) {
    if (tie.getAttribute('type') !== 'split-tie') continue;
    const end = byId.get(tie.getAttribute('endid')!.slice(1));
    const previous = byId.get(end?.getAttribute('prev')?.slice(1) ?? '');
    if (previous) tie.setAttribute('startid', `#${previous.getAttribute('xml:id')}`);
   }
   return originalLoad(new XMLSerializer().serializeToString(doc));
  };
  const base = settingsOf({ page:'ipad-mini', orientation:'portrait', staff:'medium', linePolicy:'automatic', maxSystems:null });
  const settings = { ...base, marginMm:defaultMarginFor(paperDimensions(base).kind) };
  const before = await renderMei(partOf(mei,boundaries),settings,[],ctxOf(tk),rectsOf(settings));
  tk.loadData = originalLoad;
  const layout = await renderMei(partOf(mei,boundaries),settings,[],ctxOf(tk),rectsOf(settings));
  expect(errors(layout.diagnostics)).toEqual([]);
  const tiePaths = (pages: typeof layout.pages): Map<string, string[]> => {
   const out = new Map<string,string[]>();
   for (const page of pages) {
    const doc = new DOMParser().parseFromString(page.svg, 'text/xml');
    for (const g of Array.from(doc.getElementsByTagName('g'))) {
     if (!(g.getAttribute('class') ?? '').split(/\s+/).includes('tie')) continue;
     const key = g.getAttribute('id') || g.getAttribute('class')!;
     out.set(key, [...(out.get(key) ?? []), ...Array.from(g.getElementsByTagName('path')).map(p => p.getAttribute('d')!)]);
    }
   }
   return out;
  };
  const oldPaths = tiePaths(before.pages);
  const newPaths = tiePaths(layout.pages);
  for (const [id, paths] of oldPaths) {
   // Only the original outgoing split fragment moves; continuation pieces and musical ties stay fixed.
   if (id.endsWith('-tie')) continue;
   expect(newPaths.get(id), id).toEqual(paths);
  }
  expect(layout.pages.map(p => p.systems)).toEqual(before.pages.map(p => p.systems));
  const svg = new DOMParser().parseFromString(layout.pages[0]!.svg, 'text/xml');
  for (const id of ['ev1e0022c2-tie','ev2e0024c2-tie','ev3e0021c2-tie']) {
   const group = Array.from(svg.getElementsByTagName('g')).find(g => g.getAttribute('id') === id)!;
   const nums = group.getElementsByTagName('path')[0]!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
   // Visible head x9567 plus its notehead attachment offset: not hidden fragment x10355.
   expect(nums[0], id).toBeGreaterThan(9567);
   expect(nums[0], id).toBeLessThan(9900);
   expect(nums[6], id).toBe(10389); // preserve the end-of-system boundary
   expect(nums[6]! - nums[0]!, id).toBeGreaterThan(450);
  }
 }, WASM_TIMEOUT_MS);
});
