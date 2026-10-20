// K5: chant lines in composeExport. Real Verovio layout for the MEI cases, synthetic lines for geometry,
// and the K0 Tract fixture (through K1's normalizer) for the long-chant case.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import createVerovioModule from 'verovio/wasm';
import type { VerovioModule } from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { composeExport, firstPageTopMm, reservationFor } from './compose';
import type { ComposeDeps } from './compose';
import { loadFontProfile } from './fonts';
import { normalizeExsurgeSvg, splitChantLines } from './chantSvg';
import { renderMei } from './layout';
import type { PageRects } from './layout';
import { paperDimensions, usableRect } from './settings';
import { sanitizePageSvg } from './svg';
import { DEFAULT_SETTINGS, PROVISIONAL_LIMITS } from './types';
import type {
  ChantLineArt,
  ChantRef,
  ExportPart,
  FixedExportPart,
  FontProfile,
  LayoutSettings,
  MeiExportPart,
  MeiLayout,
  MeiPart,
  PartHeading,
  SafeBoundary,
  ScanExportPart,
} from './types';

const FONT_DIR = join(__dirname, '..', '..', '..', 'public', 'fonts', 'export');
const pad = (n: number): string => String(n).padStart(3, '0');
const settingsOf = (patch: Partial<LayoutSettings> = {}): LayoutSettings => ({ ...DEFAULT_SETTINGS, ...patch });
const IPAD = settingsOf({ page: 'ipad-11', marginMm: 4, linePolicy: 'automatic', chant: 'before' });
const heading = (label: string, extra: Partial<PartHeading> = {}): PartHeading => ({
  label, rubric: null, rubricTranslation: null, credit: null, ...extra,
});
const ref = (id: number): ChantRef => ({ id, incipit: `Chant ${id}`, annotation: 'Intr.', mode: '1' });

// ---- parts ----------------------------------------------------------------
const meiPart = (id: string, chants: readonly ChantRef[]): MeiExportPart => ({
  id, kind: 'mei', label: 'Kyrie', heading: heading('Kyrie', { credit: 'Credit line' }), sourceSystemCount: 3, chants,
  sourceRevision: 'rev1', target: 'movement:test', renderHash: 'h'.repeat(32),
  conversion: {
    digest: 'd'.repeat(64), meiUrl: '', meiSha256: '', sourceRevision: 'rev1', profile: 'accompaniment-v1',
    verovio: '6.3.0-425dd7b', boundaries: [], capabilities: { manualBreaks: true },
  },
});
const scanPart = (id: string, chants: readonly ChantRef[], stems: readonly string[] = ['a/s1', 'a/s2']): ScanExportPart => ({
  id, kind: 'scan', label: 'Gradual', heading: heading('Gradual', { credit: 'Source: Graduale Romanum' }), sourceSystemCount: 3, chants,
  sourceRevision: stems[0] ?? '', stems, customizableAvailable: false,
});
const fixedPart = (id: string, chants: readonly ChantRef[]): FixedExportPart => ({
  id, kind: 'fixed', label: 'Credo', heading: heading('Credo', { credit: 'ignored' }), sourceSystemCount: 3, chants,
  sourceRevision: 'fx', target: 'movement:credo', renderHash: 'f'.repeat(32), letterPdf: 'letter.pdf', a4Pdf: 'a4.pdf',
});

// ---- chant lines -----------------------------------------------------------
/** A synthetic chant line: a sanitized SVG with the given size on paper. */
function syntheticLines(chantId: number, count: number, heightMm: number, widthMm = 100): ChantLineArt[] {
  return Array.from({ length: count }, (_, line) => ({
    chantId, line, widthMm, heightMm,
    svg: sanitizePageSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${heightMm}"><path d="M0 0 L${widthMm} ${heightMm}" stroke="#000" fill="none"/></svg>`,
      `c${chantId}l${line}`,
    ),
  }));
}
const MM_PER_UNIT = 0.144;
/** A K0 fixture, normalized, split, sanitized and sized as the worker will do it. */
function fixtureLines(file: string, chantId: number): ChantLineArt[] {
  const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'chant', file), 'utf8')) as { svg: string };
  return splitChantLines(normalizeExsurgeSvg(fixture.svg)).map((l, line) => ({
    chantId, line, widthMm: l.widthUnits * MM_PER_UNIT, heightMm: l.heightUnits * MM_PER_UNIT,
    svg: sanitizePageSvg(l.svg, `c${chantId}l${line}`),
  }));
}

// ---- fakes ----------------------------------------------------------------
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
function makeDeps(fonts: FontProfile): ComposeDeps {
  const png: Record<string, string> = { 'a/s1': '1200x400', 'a/s2': '1200x400' };
  const pdfs: Record<string, readonly (readonly [number, number])[]> = { 'letter.pdf': [[612, 792], [612, 792]], 'a4.pdf': [[595.28, 841.89]] };
  return {
    fonts,
    assets: {
      async bytes(url) {
        const stem = url.replace(/@2x\.png$/, '');
        if (url.endsWith('@2x.png') && png[stem] !== undefined) return enc(`png:${png[stem]}`);
        if (pdfs[url] !== undefined) return enc(`pdf:${url}`);
        throw new Error(`ASSET_MISSING: ${url}`);
      },
    },
    pngSize(bytes) {
      const m = /^png:(\d+)x(\d+)$/.exec(dec(bytes));
      if (!m) throw new Error('bad png');
      return { width: Number(m[1]), height: Number(m[2]) };
    },
    async pdfPageSize(bytes, index) {
      const url = dec(bytes).replace(/^pdf:/, '');
      const list = pdfs[url]!;
      const p = list[Math.min(index, list.length - 1)] ?? [0, 0];
      return { width: p[0], height: p[1], count: list.length };
    },
  };
}

const EXPERIMENT_MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix-experiment.mei'), 'utf8');
const SOURCE_BREAK_MEASURES = [8, 16, 26, 39, 50];
function experimentBoundaries(): SafeBoundary[] {
  const out: SafeBoundary[] = [];
  let other = 1;
  for (let k = 1; k <= 60; k++) {
    const si = SOURCE_BREAK_MEASURES.indexOf(k);
    out.push({
      id: si >= 0 ? `b${pad(si + 1)}` : `c${pad(other++)}`,
      onset: `${k}/1`, sourceBreak: si >= 0, division: null, measureId: `m${pad(k)}`, afterText: null,
    });
  }
  return out;
}

describe('composeExport with chant', () => {
  let wasm: VerovioModule;
  let fonts: FontProfile;
  beforeAll(async () => {
    wasm = await createVerovioModule();
    fonts = await loadFontProfile(async (url) => new Uint8Array(readFileSync(join(FONT_DIR, url.split('/').pop()!))));
  });
  const deps = (): ComposeDeps => makeDeps(fonts);
  const lines = (m: Record<number, readonly ChantLineArt[] | null>): ReadonlyMap<number, readonly ChantLineArt[] | null> =>
    new Map(Object.entries(m).map(([k, v]) => [Number(k), v] as const));

  async function meiLayout(part: MeiExportPart, s: LayoutSettings, arts: readonly ChantLineArt[], share = true): Promise<MeiLayout> {
    const withB: MeiExportPart = { ...part, conversion: { ...part.conversion, boundaries: experimentBoundaries() } };
    const meiPartInput: MeiPart = { part: withB, meiXml: EXPERIMENT_MEI };
    const res = reservationFor(part, s, fonts, arts, share);
    const full = usableRect(paperDimensions(s), s.marginMm);
    const content = { ...full, heightMm: full.heightMm - res.footerMm };
    const top = firstPageTopMm(res);
    const rects: PageRects = { content, firstPageContent: { ...content, yMm: content.yMm + top, heightMm: content.heightMm - top } };
    const tk = new VerovioToolkit(wasm);
    return { ...(await renderMei(meiPartInput, s, [], { token: 1, fonts, limits: PROVISIONAL_LIMITS, isCancelled: () => false, toolkit: tk }, rects)), chantShare: share };
  }

  it('chantSharesPageWithMei: a short chant sits under the heading and the accompaniment starts on the same page', async () => {
    const part = meiPart('m:0', [ref(1)]);
    const arts = syntheticLines(1, 2, 18);
    const layout = await meiLayout(part, IPAD, arts);
    const r = await composeExport([part], new Map([[part.id, layout]]), IPAD, deps(), 1, lines({ 1: arts }));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const first = r.pages[0]!;
    expect(first.kind).toBe('mei');
    expect(first.heading).not.toBeNull();
    expect(first.chant.map((c) => c.line)).toEqual([0, 1]);
    // chant sits below the heading, and the accompaniment content starts below the chant
    const headingBottom = first.heading!.rect.yMm + first.heading!.rect.heightMm;
    expect(first.chant[0]!.rect.yMm).toBeGreaterThanOrEqual(headingBottom - 1e-6);
    const chantBottom = Math.max(...first.chant.map((c) => c.rect.yMm + c.rect.heightMm));
    expect(first.content.yMm).toBeGreaterThanOrEqual(chantBottom);
    expect(r.pages.filter((p) => p.chant.length > 0)).toHaveLength(1);
  });

  it('chantPushesMeiWhenNoRoom: with less than one system of room the accompaniment starts on the next page', async () => {
    const part = meiPart('m:0', [ref(1)]);
    const page = paperDimensions(IPAD);
    const tall = page.heightMm - 2 * IPAD.marginMm - 45;
    const arts = syntheticLines(1, 1, tall);
    const layout = await meiLayout(part, IPAD, arts);
    const r = await composeExport([part], new Map([[part.id, layout]]), IPAD, deps(), 1, lines({ 1: arts }));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.pages[0]!.kind).toBe('scan');
    expect(r.pages[0]!.chant).toHaveLength(1);
    expect(r.pages[0]!.heading).not.toBeNull();
    expect(r.pages[1]!.kind).toBe('mei');
    expect(r.pages[1]!.heading).toBeNull();
    expect(r.pages[1]!.chant).toEqual([]);
    expect(r.pages.map((p) => p.index)).toEqual(r.pages.map((_, i) => i));
  });

  it('longChantSplitsBetweenLines: the Tract fixture spans pages, never splits a line and keeps order', async () => {
    const arts = fixtureLines('tr-889-479.json', 889);
    const part = scanPart('s:0', [ref(889)]);
    const r = await composeExport([part], new Map(), settingsOf({ page: 'ipad-mini', marginMm: 4, chant: 'before' }), deps(), 1, lines({ 889: arts }));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const withChant = r.pages.filter((p) => p.chant.length > 0);
    expect(withChant.length).toBeGreaterThanOrEqual(2);
    expect(withChant.flatMap((p) => p.chant.map((c) => c.line))).toEqual(arts.map((a) => a.line));
    for (const p of withChant) {
      for (const c of p.chant) {
        expect(c.rect.yMm).toBeGreaterThanOrEqual(p.printable.yMm - 1e-6);
        expect(c.rect.yMm + c.rect.heightMm).toBeLessThanOrEqual(p.printable.yMm + p.printable.heightMm + 1e-6);
      }
      const sorted = [...p.chant].sort((a, b) => a.rect.yMm - b.rect.yMm);
      sorted.slice(1).forEach((c, i) => expect(c.rect.yMm).toBeGreaterThanOrEqual(sorted[i]!.rect.yMm + sorted[i]!.rect.heightMm - 1e-6));
    }
  });

  it('fixedPartGetsChantPages: chant goes on its own pages, headed by the part label, before the fixed pages', async () => {
    const arts = syntheticLines(5, 3, 30);
    const part = fixedPart('f:0', [ref(5)]);
    const r = await composeExport([part], new Map(), IPAD, deps(), 1, lines({ 5: arts }));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const kinds = r.pages.map((p) => p.kind);
    expect(kinds[0]).toBe('scan');
    expect(kinds.slice(1).every((k) => k === 'fixed')).toBe(true);
    expect(r.pages[0]!.chant).toHaveLength(3);
    expect(r.pages[0]!.heading!.lines.map((l) => l.text)).toEqual(['Credo']);
    expect(r.pages[0]!.footer!.lines.map((l) => l.text).join(' ')).toContain('GregoBase');
    expect(r.pages.slice(1).every((p) => p.chant.length === 0 && p.footer === null)).toBe(true);
  });

  it('scanPartReservesChant: scans pack below the chant and the footer names GregoBase', async () => {
    const arts = syntheticLines(7, 2, 25);
    const part = scanPart('s:0', [ref(7)], ['a/s1']);
    const r = await composeExport([part], new Map(), IPAD, deps(), 1, lines({ 7: arts }));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const page = r.pages[0]!;
    expect(page.kind).toBe('scan');
    if (page.kind !== 'scan') return;
    expect(page.chant).toHaveLength(2);
    expect(page.images).toHaveLength(1);
    const chantBottom = Math.max(...page.chant.map((c) => c.rect.yMm + c.rect.heightMm));
    expect(page.images[0]!.rect.yMm).toBeGreaterThanOrEqual(chantBottom);
    expect(page.footer!.lines.map((l) => l.text).join(' ')).toMatch(/Source: Graduale Romanum.*Chant: GregoBase \(CC0\)/);
  });

  it('missingChantIsInfo: a chant that could not be drawn gives CHANT_UNAVAILABLE and the part prints without it', async () => {
    const part = scanPart('s:0', [ref(9)]);
    const r = await composeExport([part], new Map(), IPAD, deps(), 1, lines({ 9: null }));
    const d = r.diagnostics.find((x) => x.code === 'CHANT_UNAVAILABLE');
    expect(d).toMatchObject({ severity: 'info', partId: 's:0' });
    expect(r.complete).toBe(true);
    expect(r.pages.every((p) => p.chant.length === 0)).toBe(true);
    expect(r.pages[0]!.kind).toBe('scan');
  });

  it('chantOnly: three parts, one without chant, give chant pages only and leave the chantless part out', async () => {
    const withChant = scanPart('s:0', [ref(7)]);
    const none = scanPart('s:1', []);
    const fixed = fixedPart('f:0', [ref(5)]);
    const settings = { ...IPAD, chant: 'only' as const };
    const r = await composeExport([withChant, none, fixed], new Map(), settings, deps(), 1,
      lines({ 7: syntheticLines(7, 2, 25), 5: syntheticLines(5, 3, 30) }));
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.pages.map((p) => p.partId)).toEqual(['s:0', 'f:0']);
    expect(r.pages.every((p) => p.kind === 'scan' && p.images.length === 0 && p.chant.length > 0)).toBe(true);
    expect(r.pages.find((p) => p.partId === 's:0')!.footer!.lines.map((l) => l.text).join(' ')).toContain('GregoBase');
    expect(r.pages.map((p) => p.index)).toEqual([0, 1]);
  });

  it('chantOnly: MEI parts need no layout, and nothing to print is an error', async () => {
    const mei = meiPart('m:0', [ref(1)]);
    const settings = { ...IPAD, chant: 'only' as const };
    const ok = await composeExport([mei], new Map(), settings, deps(), 1, lines({ 1: syntheticLines(1, 2, 20) }));
    expect(ok.diagnostics).toEqual([]);
    expect(ok.pages).toHaveLength(1);
    const empty = await composeExport([scanPart('s:0', [])], new Map(), settings, deps(), 1);
    expect(empty.complete).toBe(false);
    expect(empty.pages).toHaveLength(0);
  });

  it('prints no chant when the setting is off, whatever the parts carry', async () => {
    const part = scanPart('s:0', [ref(7)]);
    const r = await composeExport([part], new Map(), { ...IPAD, chant: 'off' }, deps(), 1, lines({ 7: syntheticLines(7, 2, 25) }));
    expect(r.pages.every((p) => p.chant.length === 0)).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  it('rejects an export over the chant line cap', async () => {
    const part = scanPart('s:0', [ref(7)]);
    const r = await composeExport([part], new Map(), IPAD, deps(), 1, lines({ 7: syntheticLines(7, 121, 5) }));
    expect(r.diagnostics.some((d) => d.code === 'CAP_EXCEEDED' && d.severity === 'error')).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('puts the chant SVG hash into the result digest', async () => {
    const part = scanPart('s:0', [ref(7)]);
    const a = await composeExport([part], new Map(), IPAD, deps(), 1, lines({ 7: syntheticLines(7, 2, 25) }));
    const b = await composeExport([part], new Map(), IPAD, deps(), 1, lines({ 7: syntheticLines(7, 2, 26) }));
    const again = await composeExport([part], new Map(), IPAD, deps(), 1, lines({ 7: syntheticLines(7, 2, 25) }));
    expect(a.digests.result).toBe(again.digests.result);
    expect(a.digests.result).not.toBe(b.digests.result);
    expect(a.digests.settings).not.toBe((await composeExport([part], new Map(), { ...IPAD, chant: 'off' }, deps(), 1)).digests.settings);
  });
});

export type { ExportPart };
