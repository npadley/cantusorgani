import { describe, expect, it } from 'vitest';
import { WASM_TIMEOUT_MS, useRealVerovio } from './__fixtures__/layoutHarness';
import { MATRIX, catalogueSlugs, loadPiece, runCase } from './__fixtures__/catalogueSweep';

/**
 * The 19 catalogue pieces that the first dry run left in needs-review (fixtures under
 * __fixtures__/catalogue/), laid out in all 13 Contracts section 3 cases with real Verovio.
 * Every case must lay out; ties must be drawn; automatic lines must not start inside a word.
 *
 * KNOWN lists what is still unavoidable, as upper bounds: a start that cannot move to a word boundary
 * without squeezing two syllables closer than 0.3 mm or overfilling a neighbouring line. Shrink an entry
 * when the layout improves; never grow one.
 */
const KNOWN_MID_WORD: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'al-ostende-nobis': { 'custom-160x230-auto': 1 },
  'in-ecce-advenit': { 'ipadmini-p-auto': 1 },
  'in-exsurge': { 'ipadmini-p-auto': 3 },
  'in-in-nomine-jesu--ps-domine': { 'ipadmini-p-auto': 2 },
  'in-miserere--tribulor': { 'ipad11-l-large-auto': 1, 'ipadmini-p-auto': 1 }, // precheck counts the first as clean
};
/** Syllable pairs under 0.3 mm in Verovio's own automatic layout (not caused by a moved break). */
const KNOWN_COLLISIONS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'al-crastina-die': { 'letter-p-large-auto': 1, 'ipadmini-p-auto': 1 },
  'al-spiritus-ejus': { 'a5-p-auto': 1 },
  'in-exsurge': { 'ipadmini-p-auto': 1 },
};

describe('catalogue pieces that needed review', { timeout: WASM_TIMEOUT_MS * 8 }, () => {
  const { newToolkit } = useRealVerovio();

  it('has the 19 fixtures', () => {
    expect(catalogueSlugs()).toHaveLength(19);
  });

  it.each(catalogueSlugs())('%s: all 13 cases lay out cleanly', async (slug) => {
    const piece = loadPiece(slug);
    const failures: string[] = [];
    for (const [id, patch] of MATRIX) {
      const { result } = await runCase(piece, id, patch, newToolkit());
      if (result.errors.length > 0) failures.push(`${id}: ${result.errors.join('; ')}`);
      if (result.pages === 0 && result.errors.length === 0) failures.push(`${id}: no pages`);
      if (result.deadTies.length > 0) failures.push(`${id}: ties not drawn ${result.deadTies.join(',')}`);
      const mid = KNOWN_MID_WORD[slug]?.[id] ?? 0;
      if (result.midWord > mid) failures.push(`${id}: ${result.midWord} mid-word starts (known ${mid})`);
      const col = id.endsWith('-auto') ? (KNOWN_COLLISIONS[slug]?.[id] ?? 0) : Infinity; // original lines keep the source breaks
      if (result.collisions > col) failures.push(`${id}: ${result.collisions} lyric collisions (known ${col})`);
    }
    expect(failures).toEqual([]);
  });

  // Root causes, each with a case that failed before.
  it.each([
    ['al-confitemini-domino', 'custom-160x230-auto'], // a line overflowed the width: re-measured with a larger right reserve
    ['in-ego-autem-cum-justitia', 'a5-p-auto'],
    ['al-crastina-die', 'ipad11-l-large-auto'],
    ['al-spiritus-ejus', 'ipad11-l-large-auto'], // justified page ended below the content: re-planned from pass 2 sizes
    ['in-ecce-advenit', 'ipad11-l-large-auto'],
    ['al-ostende-nobis', 'a5-p-auto'], // a six-measure word: later starts shift with it
    ['co-illumina-faciem', 'a5-p-auto'],
    ['in-cibavit-cum-alleluia--corpus-christi', 'a5-p-auto'],
  ])('%s %s: lays out with no mid-word start', async (slug, id) => {
    const piece = loadPiece(slug);
    const patch = MATRIX.find((m) => m[0] === id)![1];
    const { result } = await runCase(piece, id, patch, newToolkit());
    expect(result.errors).toEqual([]);
    expect(result.pages).toBeGreaterThan(0);
    expect(result.midWord).toBe(0);
  });
});
