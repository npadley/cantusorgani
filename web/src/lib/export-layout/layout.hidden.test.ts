import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMei } from './layout';
import { WASM_TIMEOUT_MS, ctxOf, errors, partOf, rectsOf, useRealVerovio } from './__fixtures__/layoutHarness';
import { MATRIX, settingsFor } from './__fixtures__/catalogueSweep';
import { orphanLedgerLines, stemmedContinuations, stubArcs } from './__fixtures__/layoutChecks';
import manifest from './__fixtures__/manifest.fixture.json';
import type { SafeBoundary } from './types';

/** A hidden split-continuation draws nothing; a revealed one is a head only; no tie or slur is a mid-system stub. */
const fx = (n: string): string => readFileSync(join(__dirname, '__fixtures__', n), 'utf8');
const PIECES: readonly (readonly [string, string, SafeBoundary[]])[] = [
  ['kyrie-ix', 'kyrie-ix.mei', manifest.parts[0]!.boundaries as unknown as SafeBoundary[]],
  ['agnus-ix', 'agnus-ix.mei', JSON.parse(fx('agnus-ix.boundaries.json'))],
  ['sanctus-ix', 'sanctus-ix.mei', JSON.parse(fx('sanctus-ix.boundaries.json'))],
  ['gloria-ix', 'gloria-ix.mei', JSON.parse(fx('gloria-ix.boundaries.json'))],
  ['ite-ix', 'ite-ix.mei', JSON.parse(fx('ite-ix.boundaries.json'))],
];

describe('hidden continuations draw nothing', () => {
  it('orphanLedgerLines finds a ledger line with no head on it', () => {
    const svg = '<svg><path d="M0 100 L900 100"/><path d="M0 280 L900 280"/><g class="ledgerLines below"><path d="M100 460 L300 460" /></g></svg>';
    expect(orphanLedgerLines(svg)).toEqual(['ledger 100-300 @ 460']);
    const withHead = svg.replace('</svg>', '<g class="notehead"><use transform="translate(150, 460)"/></g></svg>');
    expect(orphanLedgerLines(withHead)).toEqual([]);
  });
  it('stemmedContinuations finds a revealed continuation with a stem', () => {
    const base = (inner: string): string => `<svg><g id="c1" class="note split-continuation"><g class="notehead"><use/></g>${inner}</g><g class="layer"></g></svg>`;
    expect(stemmedContinuations(base('<g class="stem"/>'))).toEqual(['c1']);
    expect(stemmedContinuations(base(''))).toEqual([]);
  });
  it('stubArcs finds a short mid-system arc but not one at a system edge', () => {
    const staff = '<path d="M0 100 L20000 100"/>';
    const arc = (x: number): string => `<g class="tie"><path d="M${x},50 C${x + 20},0 ${x + 60},0 ${x + 80},50"/></g>`;
    expect(stubArcs(`<svg>${staff}${arc(8000)}</svg>`)).toEqual(['tie 8000-8080']);
    expect(stubArcs(`<svg>${staff}${arc(19900)}</svg>`)).toEqual([]);
    expect(stubArcs(`<svg>${staff}${arc(500)}</svg>`)).toEqual([]);
  });
});

describe('real MEI, all 13 cases', { timeout: WASM_TIMEOUT_MS * 8 }, () => {
  const { newToolkit } = useRealVerovio();
  it.each(PIECES)('%s', async (_name, file, boundaries) => {
    const part = partOf(fx(file), boundaries);
    const problems: string[] = [];
    for (const [id, patch] of MATRIX) {
      const s = settingsFor(patch);
      const layout = await renderMei(part, s, [], ctxOf(newToolkit()), rectsOf(s));
      if (errors(layout.diagnostics).length > 0) { problems.push(`${id}: layout failed`); continue; }
      layout.pages.forEach((p, i) => {
        for (const f of orphanLedgerLines(p.svg)) problems.push(`${id} p${i + 1}: ${f}`);
        for (const f of stemmedContinuations(p.svg)) problems.push(`${id} p${i + 1}: stem on ${f}`);
        for (const f of stubArcs(p.svg)) problems.push(`${id} p${i + 1}: stub ${f}`);
      });
    }
    expect(problems).toEqual([]);
  });
});
