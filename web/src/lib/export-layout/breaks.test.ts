import { describe, it, expect } from 'vitest';
import type { BreakOverride, LayoutSettings, MeiPart, SafeBoundary } from './types';
import { DEFAULT_SETTINGS } from './types';
import { resolveBreaks } from './breaks';

const REV = 'a'.repeat(32);

function boundary(id: string, onset: string, sourceBreak = false): SafeBoundary {
  return { id, onset, sourceBreak, division: null, measureId: `m-${id}`, afterText: null };
}

function makePart(boundaries: readonly SafeBoundary[], sourceRevision = REV): MeiPart {
  return {
    meiXml: '<mei/>',
    part: {
      id: 'seg:0', kind: 'mei', label: 'Kyrie', heading: null, sourceSystemCount: 3, sourceRevision,
      target: 'movement:x/kyrie', renderHash: sourceRevision,
      conversion: {
        digest: 'd'.repeat(64), meiUrl: 'u', meiSha256: 's', sourceRevision, profile: 'accompaniment-v1',
        verovio: '6.3.0', boundaries, capabilities: { manualBreaks: true },
      },
    },
  };
}

const ov = (boundaryId: string, kind: 'system' | 'page', sourceRevision = REV): BreakOverride => ({ boundaryId, sourceRevision, kind });
const original: LayoutSettings = { ...DEFAULT_SETTINGS, linePolicy: 'original' };
const automatic: LayoutSettings = { ...DEFAULT_SETTINGS, linePolicy: 'automatic' };

const part = makePart([boundary('b1', '1/4', true), boundary('b2', '1/2'), boundary('b3', '3/4', true)]);

describe('resolveBreaks', () => {
  it('returns partId and no breaks for empty overrides under automatic policy', () => {
    const r = resolveBreaks(part, automatic, []);
    expect(r).toEqual({ partId: 'seg:0', breaks: [], droppedOverrides: [] });
  });

  it('empty overrides under original policy yields source breaks', () => {
    const r = resolveBreaks(part, original, []);
    expect(r.breaks).toEqual([
      { boundaryId: 'b1', kind: 'system', origin: 'source' },
      { boundaryId: 'b3', kind: 'system', origin: 'source' },
    ]);
  });

  it('drops stale overrides with STALE_ANCHOR', () => {
    const stale = ov('b2', 'system', 'f'.repeat(32));
    const r = resolveBreaks(part, automatic, [stale]);
    expect(r.breaks).toEqual([]);
    expect(r.droppedOverrides).toEqual([{ override: stale, reason: 'STALE_ANCHOR' }]);
  });

  it('drops unknown boundaries with UNSAFE_ANCHOR', () => {
    const bad = ov('nope', 'page');
    const r = resolveBreaks(part, automatic, [bad]);
    expect(r.breaks).toEqual([]);
    expect(r.droppedOverrides).toEqual([{ override: bad, reason: 'UNSAFE_ANCHOR' }]);
  });

  it('stale takes precedence over unsafe when both apply', () => {
    const both = ov('nope', 'page', 'f'.repeat(32));
    expect(resolveBreaks(part, automatic, [both]).droppedOverrides[0]?.reason).toBe('STALE_ANCHOR');
  });

  it('page wins over system on the same boundary, in either order', () => {
    for (const list of [[ov('b2', 'system'), ov('b2', 'page')], [ov('b2', 'page'), ov('b2', 'system')]]) {
      const r = resolveBreaks(part, automatic, list);
      expect(r.breaks).toEqual([{ boundaryId: 'b2', kind: 'page', origin: 'user' }]);
      expect(r.droppedOverrides).toEqual([]);
    }
  });

  it('collapses identical duplicate overrides to one break', () => {
    const r = resolveBreaks(part, automatic, [ov('b2', 'system'), ov('b2', 'system')]);
    expect(r.breaks).toEqual([{ boundaryId: 'b2', kind: 'system', origin: 'user' }]);
  });

  it('a user system break on a source-break boundary takes origin user', () => {
    const r = resolveBreaks(part, original, [ov('b1', 'system')]);
    expect(r.breaks).toEqual([
      { boundaryId: 'b1', kind: 'system', origin: 'user' },
      { boundaryId: 'b3', kind: 'system', origin: 'source' },
    ]);
  });

  it('a user page break on a source-break boundary wins', () => {
    const r = resolveBreaks(part, original, [ov('b3', 'page')]);
    expect(r.breaks).toEqual([
      { boundaryId: 'b1', kind: 'system', origin: 'source' },
      { boundaryId: 'b3', kind: 'page', origin: 'user' },
    ]);
  });

  it('omits source breaks under automatic policy but keeps user breaks', () => {
    const r = resolveBreaks(part, automatic, [ov('b2', 'system')]);
    expect(r.breaks).toEqual([{ boundaryId: 'b2', kind: 'system', origin: 'user' }]);
  });

  it('sorts by exact rational onset, not lexically or by float', () => {
    const p = makePart([boundary('x', '109/8'), boundary('y', '14/1'), boundary('z', '3/2'), boundary('w', '27/2')]);
    const r = resolveBreaks(p, automatic, [ov('y', 'system'), ov('x', 'page'), ov('z', 'system'), ov('w', 'system')]);
    // 27/2 = 13.5 < 109/8 = 13.625 < 14/1, so w precedes x.
    expect(r.breaks.map((b) => b.boundaryId)).toEqual(['z', 'w', 'x', 'y']);
  });

  it('distinguishes onsets too close for floats', () => {
    const p = makePart([
      boundary('hi', '9007199254740993/9007199254740992'),
      boundary('lo', '1/1'),
    ]);
    const r = resolveBreaks(p, automatic, [ov('hi', 'system'), ov('lo', 'system')]);
    expect(r.breaks.map((b) => b.boundaryId)).toEqual(['lo', 'hi']);
  });

  it('gives identical breaks under different page, orientation and staff settings', () => {
    const overrides = [ov('b2', 'page'), ov('b1', 'system')];
    const a = resolveBreaks(part, original, overrides);
    const b = resolveBreaks(part, { ...original, page: 'a5', orientation: 'landscape', staff: 'large', marginMm: 5 }, overrides);
    const c = resolveBreaks(part, { ...original, page: 'ipad-13', staff: 'small', maxSystems: 3 }, overrides);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('does not mutate inputs', () => {
    const overrides = [ov('b2', 'system'), ov('b2', 'page'), ov('nope', 'system')];
    const settings = { ...original };
    const snap = JSON.stringify({ part, overrides, settings });
    resolveBreaks(part, settings, overrides);
    expect(JSON.stringify({ part, overrides, settings })).toBe(snap);
  });
});
