import { DOMParser } from '@xmldom/xmldom';
import type { Element, Node } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { WASM_TIMEOUT_MS, useRealVerovio } from './__fixtures__/layoutHarness';

// Each deferred original break meets the ending hidden anchor of its voice-line glissando.
// Verovio draws the segment to the right edge of the preceding system/page.
const MEI = `<?xml version="1.0" encoding="UTF-8"?>
<mei meiversion="5.0" xmlns="http://www.music-encoding.org/ns/mei">
<meiHead><fileDesc><titleStmt><title>Voice line break</title></titleStmt><pubStmt/></fileDesc></meiHead>
<music><body><mdiv><score>
<scoreDef mnum.visible="false"><staffGrp><staffDef clef.line="2" clef.shape="G" lines="5" n="1"/></staffGrp></scoreDef>
<section>
<measure metcon="false" n="1" right="invis" xml:id="ma"><staff n="1"><layer n="1"><note dur="4" oct="4" pname="c" xml:id="n1"/></layer><layer n="2"><note dur="4" oct="4" pname="e" head.visible="false" stem.visible="false" xml:id="v1"/></layer></staff><gliss endid="#v2" lform="solid" startid="#v1" type="voice-line" xml:id="gl"/></measure>
BREAK
<measure metcon="false" n="2" right="invis" xml:id="mb"><staff n="1"><layer n="1"><note dur="4" oct="4" pname="d" xml:id="n2"/></layer><layer n="2"><note dur="4" oct="4" pname="f" head.visible="false" stem.visible="false" xml:id="v2"/></layer></staff></measure>
</section></score></mdiv></body></music></mei>`;

function systemOf(el: Element): Element | null {
  for (let n: Node | null = el; n; n = n.parentNode) {
    if (n.nodeType === 1 && (n as Element).getAttribute('class')?.split(/\s+/).includes('system')) return n as Element;
  }
  return null;
}

describe('voice-line glissando at an original break (real Verovio)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  it.each([['system', '<sb/>'], ['page', '<pb/>']] as const)('draws the glissando to the %s edge', (_kind, tag) => {
    const toolkit = newToolkit();
    toolkit.setOptions({ breaks: 'encoded', pageWidth: 2100, pageHeight: 2970, scale: 40 });
    expect(toolkit.loadData(MEI.replace('BREAK', tag))).toBeTruthy();
    const pages = Array.from({ length: toolkit.getPageCount() }, (_, i) =>
      new DOMParser().parseFromString(toolkit.renderToSVG(i + 1), 'text/xml'));
    const startPage = pages.findIndex((doc) => doc.getElementById('v1'));
    const endPage = pages.findIndex((doc) => doc.getElementById('v2'));
    expect(startPage).toBeGreaterThanOrEqual(0);
    expect(endPage).toBeGreaterThanOrEqual(0);
    const gliss = pages[startPage]?.getElementById('gl');
    expect(gliss?.getAttribute('class')?.split(/\s+/)).toContain('gliss');
    expect(gliss?.getElementsByTagName('path').length).toBeGreaterThan(0);
    expect(systemOf(pages[startPage]!.getElementById('v1')!)).toBe(systemOf(gliss!));
    expect(systemOf(pages[endPage]!.getElementById('v2')!)).not.toBe(systemOf(gliss!));
    if (tag === '<pb/>') expect(endPage).toBeGreaterThan(startPage);
  });
});
