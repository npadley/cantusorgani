import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultMarginFor, paperDimensions } from './settings';
import { renderMei } from './layout';
import {
  WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, settingsOf, useRealVerovio,
} from './__fixtures__/layoutHarness';
import manifest from './__fixtures__/manifest.fixture.json';
import type { BreakOverride, LayoutSettings, MeiLayout, SafeBoundary } from './types';

/** Layout smoke test on the converter's real output for Kyrie IX (card A3e), with real Verovio WASM. */
const MEI = readFileSync(join(__dirname, '__fixtures__', 'kyrie-ix.mei'), 'utf8');
const BOUNDARIES = manifest.parts[0]!.boundaries as unknown as SafeBoundary[];
const PART = partOf(MEI, BOUNDARIES);
const ORIGINAL_NOTES = [...MEI.matchAll(/<note\b[^>]*?\sxml:id="(ev[^"c]+)"/g)].map((m) => m[1]!);

function settingsFor(page: 'letter' | 'ipad-11', linePolicy: 'original' | 'automatic'): LayoutSettings {
  const base = settingsOf({ page, orientation: 'portrait', staff: 'medium', linePolicy, maxSystems: null });
  return { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
}

describe('real converter output lays out (Kyrie IX)', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();

  it('has the 358 original notes and the five source-break boundaries', () => {
    expect(ORIGINAL_NOTES).toHaveLength(358);
    expect(BOUNDARIES.filter((b) => b.sourceBreak)).toHaveLength(5);
  });

  it.each([
    ['letter-p-orig', 'letter', 'original'],
    ['ipad11-p-auto', 'ipad-11', 'automatic'],
  ] as const)('%s', async (_id, page, linePolicy) => {
    const s = settingsFor(page, linePolicy);
    const layout = await renderMei(PART, s, [], ctxOf(newToolkit()), rectsOf(s));

    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.length).toBeGreaterThan(0);

    const svg = layout.pages.map((p) => p.svg).join('\n');
    const present = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    expect(ORIGINAL_NOTES.filter((id) => !present.has(id))).toEqual([]);

    // Continuation fragments draw nothing: no glyph, no stem, no tie.
    const groups = [...svg.matchAll(/<g\b[^>]*class="note split-continuation"[^>]*?(?:\/>|>[\s\S]*?<\/g>)/g)];
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.filter((g) => /<use|<path|<text/.test(g[0]))).toEqual([]);
    expect(svg).not.toContain('split-tie');

    expect(Math.abs(layout.staffHeightMm - 7.2)).toBeLessThanOrEqual(0.1);

    if (linePolicy === 'original') {
      const starts = layout.pages.flatMap((p) => p.systems).map((sys) => sys.firstBoundaryId).filter((id) => id !== null);
      expect([...starts].sort()).toEqual(BOUNDARIES.filter((b) => b.sourceBreak).map((b) => b.id).sort());
    }
  });
});


/** Split-continuation notes of the fixture, with the measures of the fragment before them and of themselves. */
function continuationNotes(): { id: string; prevMeasure: string; measure: string }[] {
  const measureOf = new Map<string, string>();
  const tags: { id: string; prev: string | null; measure: string; continuation: boolean; note: boolean }[] = [];
  for (const block of MEI.split(/<measure\b/).slice(1)) {
    const measure = /\sxml:id="([^"]+)"/.exec(block)![1]!;
    for (const tag of block.matchAll(/<(note|space|rest)\b[^>]*>/g)) {
      const id = /\sxml:id="([^"]+)"/.exec(tag[0])?.[1];
      if (!id) continue;
      measureOf.set(id, measure);
      tags.push({
        id, measure, note: tag[1] === 'note', continuation: /\stype="split-continuation"/.test(tag[0]),
        prev: /\sprev="#([^"]+)"/.exec(tag[0])?.[1] ?? null,
      });
    }
  }
  return tags
    .filter((t) => t.note && t.continuation && t.prev !== null && measureOf.get(t.prev) !== t.measure)
    .map((t) => ({ id: t.id, prevMeasure: measureOf.get(t.prev!)!, measure: t.measure }));
}

function continuationGroups(layout: MeiLayout): { id: string; visible: boolean }[] {
  const svg = layout.pages.map((p) => p.svg).join('\n');
  return [...svg.matchAll(/<g\b[^>]*?\sid="([^"]+)"[^>]*class="note split-continuation"[^>]*?(?:\/>|>[\s\S]*?<\/g>)/g)]
    .map((m) => ({ id: m[1]!, visible: /<use|<path|<text/.test(m[0]) }));
}

const splitTies = (layout: MeiLayout): number =>
  layout.pages.map((p) => p.svg).join('\n').match(/class="tie split-tie/g)?.length ?? 0;

describe('revealed split sustains draw on real Verovio output', { timeout: WASM_TIMEOUT_MS }, () => {
  const { newToolkit } = useRealVerovio();
  const REVISION = manifest.parts[0]!.sourceRevision;
  const part = partOf(MEI, BOUNDARIES, REVISION);
  const s = settingsFor('letter', 'automatic');

  // First safe boundary (in manifest order) whose measure holds the predecessor of a continuation note.
  const continuations = continuationNotes();
  const chosen = BOUNDARIES.find((b) => continuations.some((c) => c.prevMeasure === b.measureId))!;
  const revealed = continuations.filter((c) => c.prevMeasure === chosen.measureId).map((c) => c.id);

  it('picks a boundary from the fixture', () => {
    expect(chosen).toBeDefined();
    expect(revealed.length).toBeGreaterThanOrEqual(1);
  });

  it('draws nothing for continuations and no split tie without a break', async () => {
    const layout = await renderMei(part, s, [], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    const groups = continuationGroups(layout);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.filter((g) => g.visible)).toEqual([]);
    expect(splitTies(layout)).toBe(0);
  });

  it('reveals exactly the continuations at a chosen system break and draws their ties', async () => {
    const override: BreakOverride = { boundaryId: chosen.id, sourceRevision: REVISION, kind: 'system' };
    const layout = await renderMei(part, s, [override], ctxOf(newToolkit()), rectsOf(s));
    expect(errors(layout.diagnostics)).toEqual([]);
    expect(layout.pages.flatMap((p) => p.systems).map((sys) => sys.firstBoundaryId)).toContain(chosen.id);

    const groups = continuationGroups(layout);
    const visible = groups.filter((g) => g.visible).map((g) => g.id).sort();
    expect(visible).toEqual([...revealed].sort());
    expect(groups.length).toBeGreaterThan(revealed.length); // the others still draw nothing
    expect(splitTies(layout)).toBe(revealed.length);
  });
});
