import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExsurgeContext, ExsurgeLib } from '../exsurge';
import { clearChantRenderCache, ensureExportFace, renderChantSvg } from './chantRender';
import type { ChantScale } from './chantScale';

const SCALE: ChantScale = { mmPerUnit: 0.144, widthUnits: 1333, setFontSize: 31.25 };
const CHANT = { id: 277, gabc: '(c4) Ex<eu>a</eu>(f)', annotation: 'Grad.', mode: '3' };

function stubFonts(faces: readonly unknown[] | Error): ReturnType<typeof vi.fn> {
  const load = vi.fn(async () => { if (faces instanceof Error) throw faces; return faces; });
  vi.stubGlobal('document', { fonts: { load } });
  return load;
}

interface Calls { rubric: string[]; font: [string, number][]; widths: number[]; gabc: string[]; annotation: string[]; svgNodes: number }
function stubLib(): { lib: ExsurgeLib; calls: Calls } {
  const calls: Calls = { rubric: [], font: [], widths: [], gabc: [], annotation: [], svgNodes: 0 };
  class Ctxt {
    textColor = ''; staffLineColor = ''; neumeLineColor = ''; dividerLineColor = ''; negativeFillColor = ''; spaceBetweenSystems = -1;
    setGlyphScaling(): void {}
    setFont(family: string, size: number): void { calls.font.push([family, size]); }
    setRubricColor(color: string): void { calls.rubric.push(color); }
  }
  class Score {
    annotation: unknown = null;
    lines = [];
    performLayoutAsync(_c: ExsurgeContext, done: () => void): void { done(); }
    layoutChantLines(_c: ExsurgeContext, width: number, done: () => void): void { calls.widths.push(width); done(); }
    createSvgNode(): SVGSVGElement { calls.svgNodes += 1; return { outerHTML: '<svg id="stub"/>' } as unknown as SVGSVGElement; }
  }
  class Annotations { constructor(_c: ExsurgeContext, first: string, second?: string) { calls.annotation.push(first, second ?? ''); } }
  const lib = {
    ChantContext: Ctxt, TextMeasuringStrategy: { Canvas: 'canvas' }, ChantScore: Score, Annotations,
    Gabc: { createMappingsFromSource: (_c: ExsurgeContext, gabc: string) => { calls.gabc.push(gabc); return {}; } },
  } as unknown as ExsurgeLib;
  return { lib, calls };
}

describe('ensureExportFace', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads the regular and the italic face', async () => {
    const load = stubFonts([{}]);
    await expect(ensureExportFace()).resolves.toBe(true);
    expect(load.mock.calls.map((c) => c[0])).toEqual(['16px "Liberation Serif"', 'italic 16px "Liberation Serif"']);
  });
  it('is false when no face is declared, when loading throws, and without a document', async () => {
    stubFonts([]);
    await expect(ensureExportFace()).resolves.toBe(false);
    stubFonts(new Error('network'));
    await expect(ensureExportFace()).resolves.toBe(false);
    vi.unstubAllGlobals();
    await expect(ensureExportFace()).resolves.toBe(false);
  });
});

describe('renderChantSvg', () => {
  beforeEach(() => clearChantRenderCache());
  afterEach(() => vi.unstubAllGlobals());

  it('sets the rubric colour, the export face and the job width, and returns the SVG string', async () => {
    stubFonts([{}]);
    const { lib, calls } = stubLib();
    await expect(renderChantSvg(lib, CHANT, SCALE)).resolves.toBe('<svg id="stub"/>');
    expect(calls.rubric).toEqual(['#d00']);
    expect(calls.font).toEqual([["'Liberation Serif'", 31.25]]);
    expect(calls.widths).toEqual([1333]);
    expect(calls.gabc).toEqual(['(c4) Exa(f)']);
    expect(calls.annotation).toEqual(['%Grad.%', '%3%']);
  });

  it('serves the same (chant, width, font size) from the cache', async () => {
    stubFonts([{}]);
    const { lib, calls } = stubLib();
    await renderChantSvg(lib, CHANT, SCALE);
    await renderChantSvg(lib, CHANT, SCALE);
    expect(calls.svgNodes).toBe(1);
    await renderChantSvg(lib, CHANT, { ...SCALE, widthUnits: 749 });
    expect(calls.svgNodes).toBe(2);
  });

  it('does not render when the export face is unavailable', async () => {
    stubFonts([]);
    const { lib, calls } = stubLib();
    await expect(renderChantSvg(lib, CHANT, SCALE)).resolves.toBeNull();
    expect(calls.svgNodes).toBe(0);
    expect(calls.font).toEqual([]);
  });

  it('rejects on an Exsurge failure and does not cache it', async () => {
    stubFonts([{}]);
    const { lib } = stubLib();
    const bad = { ...lib, Gabc: { createMappingsFromSource: () => { throw new Error('parse'); } } } as unknown as ExsurgeLib;
    await expect(renderChantSvg(bad, CHANT, SCALE)).rejects.toThrow('parse');
    await expect(renderChantSvg(lib, CHANT, SCALE)).resolves.toBe('<svg id="stub"/>');
  });
});
